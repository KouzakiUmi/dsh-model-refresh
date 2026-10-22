import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import { flattenInstalled, toYamlFragment } from './merge.mjs';
import { loadState, saveState, discoverRoutes, validateSettingsPatch, validRouteName, STATE_VERSION } from './state.mjs';
import { DEFAULT_OFFICIAL_ROUTES, catalogBaseUrl, fetchOfficialListing, validModelId } from './official.mjs';
import { normalizeCatalog } from './catalog-format.mjs';
import { catalogHash } from './catalog-store.mjs';
import { planRoute } from './planner.mjs';
import { synchronizeCatalog, recoverCatalogTransactions } from './catalog-store.mjs';
import { atomicWrite, atomicWriteJson } from './host-io.mjs';
import { HttpError, readJsonBody, validLocalRequest, sendJson } from './host-http.mjs';
import { acquireStateLease } from './host-lease.mjs';
import { validateManualModel } from './manual-models.mjs';
import { providerTargets, buildProviderProfile, changeProvider, providerPreviewHash, recoverProviderTransactions } from './provider-config.mjs';
import { readFileSync } from 'node:fs';
import { refreshPiAiCatalog } from './pi-ai-upstream.mjs';

export const name = 'model-refresh';
export const PLUGIN_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const PLUGIN_DIR = fileURLToPath(new URL('../', import.meta.url));
const HTTP_BASE = '/plugins/dsh-model-refresh';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const activeStates = new Set();
const messageOf = (error) => error instanceof Error ? error.message : String(error);
const piAiEntries = editor => (editor?.entries?.() ?? []).filter(entry => entry.options?.name === '@deepseek-ai/dsh-llm-pi-ai');
function declaredProviders(editor) {
  if (!editor?.entries) return undefined;
  return new Set(piAiEntries(editor).flatMap(entry => Object.keys(entry.options.config?.providers ?? {})));
}
function hasCatalogOwnership(runtime, route) {
  return (runtime.catalogOwned?.[route]?.length ?? 0) > 0 || Object.keys(runtime.catalogRemoved?.[route] ?? {}).length > 0;
}

/**
 * Locate the pi-ai package root by Node's own layout rule, walking up from the
 * consuming entry. pi-ai >= 0.87 exports only `.`, `./compat`, `./providers/*`,
 * `./api/*`, `./utils/*`, `./oauth`, `./bedrock-provider` and `./bun-oauth`;
 * `./package.json` is NOT an exported subpath, so
 * `require.resolve('<pkg>/package.json')` is refused by the exports gate before
 * any directory check can run. This reproduces the node_modules lookup Node
 * already performed to reach that package, so it resolves the very same install
 * the consuming process loads and never targets a different one.
 */
async function findPackageRootFromEntry(entry) {
  const suffix = path.join('node_modules', '@earendil-works', 'pi-ai');
  let directory = path.dirname(path.resolve(entry));
  for (;;) {
    const candidate = path.join(directory, suffix);
    const found = await stat(candidate).catch(() => null);
    if (found?.isDirectory()) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`no ${suffix} directory walking up from the consuming entry`);
    directory = parent;
  }
}

/** Resolve the package used by the consuming process, never a bundled local dependency. */
export async function locateCatalogData({ explicit = process.env.DSH_PI_AI_DATA_DIR, entry = process.argv[1] } = {}) {
  if (explicit) {
    const directory = path.resolve(explicit);
    if (!(await stat(directory)).isDirectory()) throw new Error('DSH_PI_AI_DATA_DIR is not a directory');
    return directory; // An invalid explicit override fails closed; it never targets a different install.
  }
  if (!entry) throw new Error('Cannot locate consuming DSH entry; set DSH_PI_AI_DATA_DIR explicitly');
  try {
    const require = createRequire(path.resolve(entry));
    let root;
    try {
      root = path.dirname(require.resolve('@earendil-works/pi-ai/package.json'));
    } catch {
      root = await findPackageRootFromEntry(entry); // exports gate refused ./package.json
    }
    const directory = path.join(root, 'dist', 'providers', 'data');
    if (!(await stat(directory)).isDirectory()) throw new Error('catalog is not a directory');
    return directory;
  } catch (error) {
    throw new Error(`Cannot locate the consuming pi-ai catalog; set DSH_PI_AI_DATA_DIR: ${messageOf(error)}`);
  }
}

async function boundedJson(response, maxBytes, signal) {
  signal.throwIfAborted();
  if (Number(response.headers?.get?.('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel?.();
    throw new Error('Upstream response exceeds configured byte limit');
  }
  if (!response.body?.getReader) {
    const value = await response.json();
    signal.throwIfAborted();
    if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new Error('Upstream response exceeds configured byte limit');
    return value;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Upstream response exceeds configured byte limit');
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  signal.throwIfAborted();
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readCatalog(directory, route) {
  if (!validRouteName(route)) throw new Error('Unsafe catalog route name');
  const value = JSON.parse(await readFile(path.join(directory, `${route}.json`), 'utf8'));
  if (!record(value)) throw new Error(`Invalid catalog for ${route}`);
  return normalizeCatalog(value);
}

/** Testable controller; apply() binds this same implementation to the Cordis lifecycle. */
export function createHost(ctx, options = {}) {
  const stateFile = path.resolve(options.statePath ?? process.env.DSH_MODEL_REFRESH_STATE ?? path.join(homedir(), '.dsh', 'model-refresh', 'state.json'));
  const stateDir = path.dirname(stateFile);
  const seedFile = options.seedPath ?? process.env.DSH_MODEL_REFRESH_CONFIG ?? path.join(PLUGIN_DIR, 'config.json');
  const abort = new AbortController();
  const { signal } = abort;
  let state;
  let dataDir;
  let proxyAgent;
  let timer;
  let disposed = false;
  let tail = Promise.resolve();
  let pending = 0;
  let refreshPending;
  let bootstrapError = null;
  let ownsState = false;
  let releaseLease;
  let disposing;
  const registrations = new Set();
  const log = (message) => { try { ctx.logger?.info?.(`[model-refresh] ${message}`); } catch {} };
  const ensureActive = () => { signal.throwIfAborted(); if (disposed) throw new Error('model-refresh is disposed'); };
  const persist = async ({ committing = false } = {}) => {
    if (!committing) ensureActive();
    try { await (options.saveState ?? saveState)(stateFile, state, { signal: committing ? undefined : signal }); }
    catch (error) { if (state) state.runtime.lastError = `State persistence failed: ${messageOf(error)}`; throw error; }
  };
  const queue = (task) => {
    if (disposed) return Promise.reject(new HttpError(503, 'plugin disposed'));
    if (pending >= 32) return Promise.reject(new HttpError(429, 'too many queued operations'));
    pending++;
    const next = tail.catch(() => {}).then(() => { ensureActive(); return task(); });
    tail = next;
    void next.finally(() => { pending--; }).catch(() => {});
    return next;
  };
  const outputDirectory = () => state.settings.outputDir ? path.resolve(state.settings.outputDir) : stateDir;
  const resetTimer = () => {
    if (timer !== undefined) (options.clearTimeout ?? clearTimeout)(timer);
    if (disposed || !state || bootstrapError) return;
    timer = (options.setTimeout ?? setTimeout)(() => {
      timer = undefined;
      void requestRefresh().catch((error) => log(`scheduled refresh failed: ${messageOf(error)}`));
    }, state.settings.intervalMinutes * 60_000);
    timer.unref?.();
  };
  const makeProxy = async (url) => {
    if (!url || options.fetchFn) return undefined;
    const { ProxyAgent } = await import('undici');
    ensureActive();
    return new ProxyAgent(url);
  };
  const closeProxy = async (agent) => { try { await (agent?.destroy?.() ?? agent?.close?.()); } catch {} };
  const fetchThrough = async (url, init = {}) => {
    ensureActive();
    const combined = AbortSignal.any([signal, init.signal ?? AbortSignal.timeout(30_000)]);
    let response;
    if (options.fetchFn) response = await options.fetchFn(url, { ...init, signal: combined });
    else if (proxyAgent) {
      const { fetch: undiciFetch } = await import('undici');
      ensureActive();
      response = await undiciFetch(url, { ...init, signal: combined, dispatcher: proxyAgent });
    } else response = await fetch(url, { ...init, signal: combined });
    ensureActive();
    return { ok: response.ok, status: response.status, headers: response.headers, body: response.body,
      json: () => boundedJson(response, 4 * 1024 * 1024, combined) };
  };
  const fetchJson = async (url) => {
    const response = await fetchThrough(url, { headers: { accept: 'application/json' } });
    if (!response.ok) { await response.body?.cancel?.(); throw new Error(`Upstream responded ${response.status}`); }
    const maxBytes = 16 * 1024 * 1024;
    if (Number(response.headers?.get?.('content-length') ?? 0) > maxBytes) throw new Error('Upstream response exceeds 16 MiB');
    if (!response.body?.getReader) {
      // Injected unit-test responses may not have a stream. Production responses do.
      const value = await response.json();
      ensureActive();
      if (!record(value)) throw new Error('Upstream JSON must be an object');
      return value;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        ensureActive();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) throw new Error('Upstream response exceeds 16 MiB');
        chunks.push(Buffer.from(chunk.value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    ensureActive();
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!record(value)) throw new Error('Upstream JSON must be an object');
    return value;
  };
  const fetchBytes = async (url, maxBytes) => {
    const response = await fetchThrough(url, { headers: { accept: 'application/octet-stream' } });
    if (!response.ok) { await response.body?.cancel?.(); throw new Error(`Upstream responded ${response.status}`); }
    if (Number(response.headers?.get?.('content-length') ?? 0) > maxBytes) throw new Error('Upstream archive exceeds its download limit');
    if (!response.body?.getReader) throw new Error('Streaming response body is required for the pi-ai package');
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        ensureActive();
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) throw new Error('Upstream archive exceeds its download limit');
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    ensureActive();
    return Buffer.concat(chunks);
  };
  /**
   * Resolve one credential reference the way the llm adapter does.
   *
   * Order matters: the profile credential service first, then the launcher's
   * environment snapshot, and only then this process's own environment. Reading
   * `process.env` alone misses user-level variables that the launcher resolves for
   * providers (the same reason the pi-ai adapter goes through `launchEnvironmentOf`),
   * which would report "凭据未解析到值" for a key that is in fact configured.
   */
  const resolveKey = async (reference) => {
    if (typeof reference !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) return undefined;
    const credentials = ctx.get?.('credentials');
    const hit = await credentials?.resolve?.(reference);
    if (typeof hit?.value === 'string' && hit.value.length > 0) return hit.value;
    const launch = ctx.get?.('launchEnvironment');
    const resolved = launch?.get?.(reference)?.value;
    if (typeof resolved === 'string' && resolved.length > 0) return resolved;
    return typeof process.env[reference] === 'string' && process.env[reference] ? process.env[reference] : undefined;
  };
  const writeArtifacts = async (route, models, diff, metadata) => {
    ensureActive();
    const directory = outputDirectory();
    await atomicWriteJson(path.join(directory, `${route}.models.json`), { route, ...metadata, models }, { signal });
    await atomicWrite(path.join(directory, `${route}.models.yml`), toYamlFragment(route, models) + '\n', { signal });
    await atomicWriteJson(path.join(directory, `${route}.diff.json`), { ...metadata, ...diff }, { signal });
  };
  const routeSnapshot = (catalog) => Object.values(flattenInstalled(catalog)).map((entry) =>
    Object.fromEntries(['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoning'].filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]])));

  const refreshRound = async ({ forceUpstream = false } = {}) => {
    ensureActive();
    const settings = structuredClone(state.settings);
    const routes = structuredClone(state.routes);
    const now = new Date().toISOString();
    state.runtime.running = true;
    state.runtime.lastError = null;
    const failures = [];
    try {
      await persist();
      let piAi;
      let fallbackCatalog;
      if (routes.some(route => route.enabled)) {
        try {
          piAi = await refreshPiAiCatalog({ file: path.join(stateDir, 'pi-ai-upstream.json'), fetchJson, fetchBytes, signal, force: forceUpstream });
          state.runtime.piAiUpstream = { package: piAi.package, version: piAi.version, checkedAt: piAi.checkedAt,
            providerCount: Object.keys(piAi.models).length, modelCount: Object.values(piAi.models).reduce((n, entries) => n + Object.keys(entries).length, 0),
            stale: Boolean(piAi.staleError), error: piAi.staleError ?? null };
          if (piAi.staleError) failures.push(`pi-ai upstream unavailable; using ${piAi.version} cache: ${piAi.staleError}`);
        } catch (error) {
          ensureActive();
          const upstreamError = messageOf(error);
          failures.push(`pi-ai upstream: ${upstreamError}`);
          state.runtime.piAiUpstream = { package: '@earendil-works/pi-ai', version: null, checkedAt: now,
            providerCount: 0, modelCount: 0, stale: false, error: upstreamError };
          piAi = { models: {}, version: null, source: 'pi-ai unavailable' };
        }
        if (!piAi?.version && settings.modelsDevFallback) {
          try { fallbackCatalog = await fetchJson(settings.endpoint); }
          catch (error) { ensureActive(); failures.push(`models.dev fallback: ${messageOf(error)}`); }
        }
      }
      let installedAt = null;
      try { installedAt = JSON.parse(await readFile(path.join(dataDir, '.manifest.json'), 'utf8')).generatedAt ?? null; } catch {}
      // Routes the profile does not declare are not this plugin's business: refreshing them
      // produced a wall of per-route failures for catalogs nobody configured.
      const declared = declaredProviders(ctx.get?.('configEditor'));
      for (const routeConfig of routes) {
        ensureActive();
        const route = routeConfig.route;
        if (declared !== undefined && !declared.has(route) && !routeConfig.enabled && !hasCatalogOwnership(state.runtime, route)) continue;
        try {
          let catalog = await readCatalog(dataDir, route);
          const provider = routeConfig.as ?? route;
          if (!routeConfig.enabled) {
            const sync = await synchronizeCatalog({ dataDir, route, state, runtime: state.runtime, plan: undefined,
              enabled: false, patchCatalog: settings.patchCatalog, removeStale: settings.removeStale, persist, stateDir, signal });
            ensureActive();
            const actual = sync.catalog ?? catalog;
            const models = routeSnapshot(actual);
            await writeArtifacts(route, models, { added: [], updated: [], stale: [], excluded: [], unverified: [], pending: [] }, { provider, fetchedAt: now, installedAt });
            state.runtime.perRoute[route] = { enabled: false, models: models.length, fetchedAt: now, source: 'catalog',
              rollback: sync.conflicts?.length ? 'conflict' : 'complete', conflicts: sync.conflicts ?? [], lastError: null, error: null };
            if (sync.conflicts?.length) failures.push(`${route}: rollback conflicts: ${sync.conflicts.join(', ')}`);
            continue;
          }
          if (!settings.patchCatalog) {
            const reverted = await synchronizeCatalog({ dataDir, route, state, runtime: state.runtime, plan: {},
              enabled: true, patchCatalog: false, removeStale: false, persist, stateDir, signal });
            ensureActive();
            catalog = reverted.catalog ?? catalog;
          }
          // Deleted records remain part of the logical baseline until official evidence allows restoration.
          const logicalCatalog = structuredClone(catalog);
          const logicalIds = new Set(Object.values(logicalCatalog).flatMap((bucket) => Object.keys(bucket)));
          const restoreLogical = (id, group, entry) => {
            if (!logicalIds.has(id) && entry?.id === id && typeof group === 'string' && !['__proto__', 'constructor', 'prototype'].includes(group)) {
              logicalCatalog[group] ??= {};
              logicalCatalog[group][id] = structuredClone(entry);
              logicalIds.add(id);
            }
          };
          for (const owned of state.runtime.catalogOwned[route] ?? []) {
            if (owned.after === null && owned.before !== null) restoreLogical(owned.id, owned.group, owned.before);
          }
          for (const [id, backup] of Object.entries(state.runtime.catalogRemoved[route] ?? {})) restoreLogical(id, backup?.group, backup?.entry);
          const upstreamModels = record(piAi?.models?.[provider]) ? piAi.models[provider] : undefined;
          const fallbackModels = record(fallbackCatalog?.[provider]?.models) ? fallbackCatalog[provider].models : undefined;
          const useFallback = !piAi?.version && Boolean(fallbackModels && Object.keys(fallbackModels).length);
          const metadata = useFallback ? fallbackModels : upstreamModels ?? {};
          const source = useFallback ? 'models.dev fallback' : piAi?.version ? `pi-ai@${piAi.version}` : piAi?.source ?? 'pi-ai unavailable';
          const metadataSources = Object.fromEntries(Object.keys(metadata).map(id => [id, useFallback ? 'models.dev' : 'pi-ai']));
          const override = settings.officialRoutes[route];
          const officialConfig = override === null ? null : { ...(DEFAULT_OFFICIAL_ROUTES[route] ?? {}), ...(override ?? {}) };
          const officialConfigured = record(officialConfig) && Object.keys(officialConfig).length > 0;
          let official;
          let officialStatus = !settings.officialVerify ? 'disabled' : officialConfigured ? 'no-key' : 'unconfigured';
          const warnings = [];
          if (officialConfigured && settings.officialVerify) {
            try {
              const key = await resolveKey(officialConfig.apiKeyEnv);
              ensureActive();
              official = await fetchOfficialListing(officialConfig.baseUrl ?? catalogBaseUrl(logicalCatalog), key, fetchThrough,
                { ...officialConfig, signal });
              officialStatus = 'verified';
              if (official.partial) warnings.push('官方仅返回部分清单；可用于正向发现，不能用于移除');
            } catch (error) {
              ensureActive();
              officialStatus = error?.code === 'MISSING_KEY' ? 'no-key' : 'failed';
              warnings.push(`Official verification ${officialStatus}: ${messageOf(error)}`);
            }
          }
          const previous = { ...(state.runtime.perRoute[route] ?? {}), missing: state.runtime.missing[route] ?? state.runtime.perRoute[route]?.missing ?? {} };
          const plan = planRoute({ route, catalog: logicalCatalog, metadata, metadataSources, source, official,
            officialConfigured, officialConfig: officialConfig ?? {}, settings: { ...settings, removeStale: settings.patchCatalog && settings.removeStale },
            routeConfig: { ...routeConfig, keep: [...(routeConfig.keep ?? []), ...(state.runtime.legacyProtected?.[route] ?? [])] }, previous, now: Date.parse(now) });
          const sync = await synchronizeCatalog({ dataDir, route, state, runtime: state.runtime, plan,
            enabled: true, patchCatalog: settings.patchCatalog, removeStale: settings.removeStale, persist, stateDir, signal });
          ensureActive();
          // Never publish a new ID if catalog application was skipped/failed.
          const actual = flattenInstalled(sync.catalog ?? catalog);
          const projected = new Map(plan.models.filter((entry) => Object.hasOwn(actual, entry.id)).map((entry) => [entry.id, entry]));
          // A conflicted/failed removal must not hide a model still present on disk.
          const excludedIds = new Set(routeConfig.exclude ?? []);
          for (const entry of routeSnapshot(sync.catalog ?? catalog)) {
            if (!projected.has(entry.id) && !excludedIds.has(entry.id)) projected.set(entry.id, entry);
          }
          const models = [...projected.values()].sort((a, b) => a.id.localeCompare(b.id));
          const pendingAdditions = (plan.additions ?? []).filter((item) => !Object.hasOwn(actual, item.id)).map((item) => ({ id: item.id,
            reason: !settings.patchCatalog ? '目录写入关闭，尚未应用' : '目录提交未应用；检查冲突或写入权限' }));
          const pendingModels = [...(plan.pending ?? []), ...pendingAdditions];
          const diff = { ...plan.diff, pending: [...new Set([...(plan.diff.pending ?? []), ...pendingAdditions.map((entry) => entry.id)])].sort() };
          await writeArtifacts(route, models, diff, { provider, fetchedAt: now, installedAt });
          state.runtime.missing[route] = plan.missing ?? {};
          // Per-model rows for the settings table: one entry per served model plus every
          // candidate that is not served yet, so the surface never has to merge eight lists.
          const addedSet = new Set(diff.added ?? []);
          const staleSet = new Set(diff.stale ?? []);
          const unverifiedSet = new Set(diff.unverified ?? []);
          const pendingById = new Map(pendingModels.map((item) => [item.id, item.reason ?? '待确认']));
          const modelList = models.map((entry) => {
            let modelState = 'ok';
            let reason;
            if (addedSet.has(entry.id)) modelState = 'added';
            else if (pendingById.has(entry.id)) { modelState = 'pending'; reason = pendingById.get(entry.id); }
            else if (staleSet.has(entry.id)) modelState = 'stale';
            else if (unverifiedSet.has(entry.id)) modelState = 'unverified';
            return { id: entry.id, name: entry.name, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens,
              input: entry.input, reasoning: entry.reasoning === true, state: modelState, ...(reason === undefined ? {} : { reason }) };
          });
          const servedIds = new Set(modelList.map((row) => row.id));
          for (const item of pendingModels) {
            if (servedIds.has(item.id)) continue;
            modelList.push({ id: item.id, state: 'pending', reason: item.reason ?? '待确认' });
            servedIds.add(item.id);
          }
          for (const id of diff.unverified ?? []) {
            if (!servedIds.has(id)) modelList.push({ id, state: 'unverified', reason: '上游候选未获当前端点清单确认' });
            servedIds.add(id);
          }
          modelList.sort((a, b) => a.id.localeCompare(b.id));
          state.runtime.perRoute[route] = { enabled: true, fetchedAt: now, installedAt, source,
            official: officialStatus, officialEndpoint: official?.endpoint ?? null, officialComplete: official?.complete ?? false,
            officialAdded: plan.officialAdded ?? [], models: models.length, modelList,
            ...diff, missing: plan.missing ?? {}, pending: pendingModels, warnings: [...warnings, ...(plan.warnings ?? [])],
            conflicts: sync.conflicts ?? [], lastError: warnings.length ? warnings.join('\n') : null,
            error: warnings.length ? warnings.join('\n') : null, applied: sync.applied ?? [], removed: sync.removed ?? [] };
          if (sync.conflicts?.length) failures.push(`${route}: catalog conflicts: ${sync.conflicts.join(', ')}`);
          if (officialStatus === 'failed') failures.push(`${route}: official check ${officialStatus}`);
          if (sync.changed) { state.runtime.restartRequired = true; state.runtime.catalogWritable = true; }
        } catch (error) {
          ensureActive();
          const detail = messageOf(error);
          failures.push(`${route}: ${detail}`);
          state.runtime.perRoute[route] = { ...(state.runtime.perRoute[route] ?? {}), enabled: routeConfig.enabled, lastError: detail, error: detail, attemptedAt: now };
          if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) state.runtime.catalogWritable = false;
          log(`route ${route} failed: ${detail}`);
        }
      }
      state.runtime.lastRun = new Date().toISOString();
      state.runtime.lastError = failures.length ? failures.join('\n') : null;
    } catch (error) {
      if (!disposed) { state.runtime.lastError = messageOf(error); log(`refresh failed: ${messageOf(error)}`); }
      throw error;
    } finally {
      state.runtime.running = false;
      if (!disposed) await persist();
    }
  };

  const requestRefresh = ({ forceUpstream = false } = {}) => {
    if (refreshPending) return refreshPending;
    refreshPending = queue(() => refreshRound({ forceUpstream }));
    void refreshPending.finally(() => { refreshPending = undefined; resetTimer(); }).catch(() => {});
    return refreshPending;
  };
  const requireReady = () => { if (!state || !dataDir || bootstrapError) throw new HttpError(503, bootstrapError ?? 'plugin initializing'); };
  const updateSettings = (patch, expectedRevision) => queue(async () => {
    requireReady();
    if (expectedRevision !== undefined && expectedRevision !== (state.settingsRevision ?? 0)) throw new HttpError(409, 'settings changed; reload before saving');
    let validated;
    try { validated = validateSettingsPatch(patch); } catch (error) { throw new HttpError(400, messageOf(error)); }
    const next = { ...state, settings: { ...state.settings, ...validated }, settingsRevision: (state.settingsRevision ?? 0) + 1 };
    const proxyChanged = next.settings.proxyUrl !== state.settings.proxyUrl;
    const agent = proxyChanged ? await makeProxy(next.settings.proxyUrl) : proxyAgent;
    try { ensureActive(); await (options.saveState ?? saveState)(stateFile, next, { signal }); ensureActive(); }
    catch (error) { if (proxyChanged) await closeProxy(agent); throw error; }
    state = next;
    if (proxyChanged) { const previous = proxyAgent; proxyAgent = agent; await closeProxy(previous); }
    resetTimer();
    return status();
  });
  const setRoute = (route, enabled) => queue(async () => {
    requireReady();
    if (!validRouteName(route) || typeof enabled !== 'boolean') throw new HttpError(400, 'expected a safe route and boolean enabled');
    if (!state.routes.some((entry) => entry.route === route)) throw new HttpError(404, 'unknown route');
    const next = { ...state, settingsRevision: (state.settingsRevision ?? 0) + 1,
      routes: state.routes.map((entry) => entry.route === route ? { ...entry, enabled } : entry) };
    await (options.saveState ?? saveState)(stateFile, next, { signal });
    ensureActive();
    state = next;
    return status();
  });
  const status = () => ({
    version: STATE_VERSION, pluginVersion: PLUGIN_VERSION, settingsRevision: state?.settingsRevision ?? 0,
    initialized: Boolean(state && dataDir && !bootstrapError), running: state?.runtime.running ?? false,
    queued: pending, lastRun: state?.runtime.lastRun ?? null,
    lastError: bootstrapError ?? state?.runtime.lastError ?? null,
    // A failed bootstrap must stay visible as a degraded plugin, never as a missing route.
    degraded: Boolean(bootstrapError),
    degradedHint: bootstrapError ? '插件启动失败；设置页仍可读取错误。修复下方 lastError 后重启 DSH。' : null,
    restartRequired: state?.runtime.restartRequired ?? false, catalogWritable: state?.runtime.catalogWritable ?? null,
    catalogGrantCommand: process.platform === 'win32' && state?.runtime.catalogWritable === false && dataDir
      ? `icacls '${dataDir.replaceAll("'", "''")}' /grant '*S-1-5-32-545:(OI)(CI)M'` : null,
    catalogGrantNote: process.platform === 'win32' && state?.runtime.catalogWritable === false
      ? '仅用于确认的目录权限错误。此命令授予本机 Users 组对 pi-ai data 目录的修改权限，扩大写入信任边界；请评估后由管理员手动执行。插件不会自动执行，非权限故障不适用。' : null,
    settings: state ? { ...state.settings, proxyConfigured: Boolean(state.settings.proxyUrl) } : null,
    providerTargets: providerTargets(ctx.get?.('configEditor')),
    providerApplications: Object.fromEntries(Object.entries(state?.runtime.providerOwned ?? {}).map(([key, value]) => [key,
      { namespace: value.namespace, route: value.route, appliedAt: value.appliedAt, ids: value.after?.models?.map(m => m.id) ?? [] }])),
    warnings: state?.runtime.migrationWarnings ?? [],
    piAiUpstream: state?.runtime.piAiUpstream ?? null,
    routes: state?.routes.map((entry) => ({ ...(state.runtime.perRoute[entry.route] ?? {}), ...entry })) ?? [],
  });

  const saveManual = (body) => queue(async () => {
    requireReady();
    if (!validRouteName(body.route)) throw new HttpError(400, '无效 provider 名称');
    if (body.expectedRevision !== state.settingsRevision) throw new HttpError(409, '设置已变化，请重新载入后保存');
    const items = [...(state.settings.manualModels[body.route] ?? [])];
    const index = items.findIndex(m => m.id === (body.previousId ?? (body.remove === true ? body.id : undefined)));
    if (body.remove === true) {
      if (index < 0) throw new HttpError(404, '模型不存在');
      items.splice(index, 1);
    } else {
      let model;
      try { model = validateManualModel(body.model); } catch (error) { throw new HttpError(400, messageOf(error)); }
      if (body.previousId !== undefined && index < 0) throw new HttpError(409, '原模型已移除，请重新载入');
      if (items.some((m, i) => i !== index && m.id === model.id)) throw new HttpError(409, '模型 ID 已存在');
      if (index < 0 && items.length >= 1000) throw new HttpError(400, '单个 provider 最多保存 1000 个手动模型');
      if (index < 0) items.push(model); else items[index] = model;
    }
    const next = { ...state, settingsRevision: state.settingsRevision + 1,
      settings: { ...state.settings, manualModels: { ...state.settings.manualModels, [body.route]: items } } };
    await (options.saveState ?? saveState)(stateFile, next, { signal });
    state = next;
    return status();
  });
  const providerOperation = (body, operation) => queue(async () => {
    requireReady();
    if (!validRouteName(body.route) || typeof body.namespace !== 'string') throw new HttpError(400, '请选择 provider 与配置入口');
    if (body.expectedRevision !== state.settingsRevision) throw new HttpError(409, '声明已变化，请重新预览');
    if (body.apiKeyEnv !== undefined && (typeof body.apiKeyEnv !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(body.apiKeyEnv))) throw new HttpError(400, '仅接受凭据名称');
    const editor = ctx.get?.('configEditor');
    await recoverProviderTransactions({ editor, state, stateDir, persist });
    const models = state.settings.manualModels[body.route] ?? [];
    let catalog = {};
    try { catalog = await readCatalog(dataDir, body.route); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (operation === 'preview') {
      const entry = editor?.entries?.().find(e => e.options?.name === '@deepseek-ai/dsh-llm-pi-ai' && e.options.id === body.namespace);
      if (!entry) throw new HttpError(503, 'DSH 配置编辑服务不可用');
      const owned = state.runtime.providerOwned?.[`${body.namespace}/${body.route}`];
      const before = owned ? owned.before : entry.options.config?.providers?.[body.route] ?? null;
      const profile = buildProviderProfile({ before, models, apiKeyEnv: body.apiKeyEnv, catalog });
      return { namespace: body.namespace, route: body.route, models: profile.models, api: profile.api, baseURL: profile.baseURL, count: profile.models.length, expectedRevision: state.settingsRevision,
        previewHash: providerPreviewHash(body.namespace, body.route, entry.options.config?.providers?.[body.route] ?? null, profile) };
    }
    return changeProvider({ editor, namespace: body.namespace, route: body.route, models, apiKeyEnv: body.apiKeyEnv,
      catalog, state, stateDir, persist, revert: operation === 'revert', signal, expectedHash: body.previewHash });
  });

  /**
   * Interrogate one configured provider's own model listing for the models it really serves.
   *
   * This is deliberately read-only: it never writes settings, never patches the install
   * directory, and never sends an inference request. The caller decides what to adopt.
   */
  const providerEntry = (body) => {
    const entries = piAiEntries(ctx.get?.('configEditor'));
    const matches = typeof body.namespace === 'string' && body.namespace.length > 0
      ? entries.filter(entry => entry.options.id === body.namespace) : entries;
    if (matches.length !== 1) throw new HttpError(400, '请指定唯一的 pi-ai 配置入口 namespace');
    return matches[0];
  };
  const optionalCatalog = async (route) => {
    try { return await readCatalog(dataDir, route); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
  };
  const configuredModels = (profile, catalog) => {
    if (profile.models != null && !Array.isArray(profile.models)) throw new HttpError(400, '该 provider 的 models 不是静态数组，无法追加');
    if (profile.models?.length) return profile.models;
    const native = Object.values(flattenInstalled(catalog));
    if (!native.length) throw new HttpError(400, '无法确定该 provider 当前的默认模型；请先显式配置 models');
    return native.map(model => ({ id: model.id, ...(profile.modelOverrides?.[model.id] ?? {}) }));
  };
  const discoverProvider = (body) => queue(async () => {
    requireReady();
    if (!validRouteName(body?.route)) throw new HttpError(400, '无效 provider 名称');
    const entry = providerEntry(body);
    const profile = structuredClone(entry.options.config?.providers?.[body.route]);
    if (profile === void 0 || profile === null) throw new HttpError(404, '该 provider 尚未在配置中声明');
    const catalog = await optionalCatalog(body.route);
    const apis = Object.keys(catalog).filter(api => Object.keys(catalog[api]).length > 0);
    const api = typeof profile.api === 'string' && profile.api.length > 0 ? profile.api : apis.length === 1 ? apis[0] : undefined;
    if (!api) throw new HttpError(400, '该 provider 的推理协议不唯一；请先显式配置 api');
    const baseURL = typeof profile.baseURL === 'string' && profile.baseURL.length > 0 ? profile.baseURL : catalogBaseUrl(catalog, api);
    // Never send a provider credential to an endpoint learned from a third-party directory.
    if (!baseURL) throw new HttpError(400, '该 provider 没有配置 baseURL，内置目录也没有该协议的唯一默认值');
    const apiKeyEnv = typeof profile.apiKeyEnv === 'string' && profile.apiKeyEnv.length > 0 ? profile.apiKeyEnv : undefined;
    if (apiKeyEnv === void 0) throw new HttpError(400, '该 provider 未声明 apiKeyEnv，无法拉取需要鉴权的端点；请在配置中补上凭据引用');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new HttpError(400, 'apiKeyEnv 不是合法凭据引用名');
    const apiKey = await resolveKey(apiKeyEnv);
    if (typeof apiKey !== 'string' || apiKey.length === 0) throw new HttpError(400, `凭据 ${apiKeyEnv} 未解析到值；请确认环境变量或凭据库`);
    // The listing endpoint's auth scheme is not derivable from the inference protocol:
    // opendesign serves anthropic-messages but rejects x-api-key on /v1/models while
    // accepting Bearer. Try the inference protocol's scheme first, then the other, and
    // adopt whichever answers 200. Only an auth rejection moves on; any other failure is
    // final so a 404/500 is not retried as if it were a credential problem.
    const preferred = api === 'anthropic-messages' ? 'anthropic' : 'bearer';
    const attempts = [preferred, preferred === 'bearer' ? 'anthropic' : 'bearer'];
    let listing;
    let usedAuth;
    let lastError;
    for (const auth of attempts) {
      try {
        listing = await fetchOfficialListing(baseURL, apiKey, fetchThrough, { auth, signal });
        usedAuth = auth;
        break;
      } catch (error) {
        lastError = error;
        if (error?.code !== 'INVALID_KEY') break;
      }
    }
    if (listing === undefined) {
      throw new HttpError(502, `拉取失败：${messageOf(lastError)}`);
    }
    const configured = new Set(configuredModels(profile, catalog).map(model => model.id));
    const candidates = [];
    const filtered = [];
    for (const [id, model] of Object.entries(listing.models ?? {})) {
      const output = Array.isArray(model?.modalities?.output) ? model.modalities.output : undefined;
      const type = typeof model?.type === 'string' ? model.type : undefined;
      const mode = typeof model?.mode === 'string' ? model.mode : undefined;
      const nonChat = (type !== void 0 && ['embedding', 'embeddings', 'image', 'image-generation', 'audio', 'rerank'].includes(type.toLowerCase()))
        || (mode !== void 0 && !['chat', 'completion', 'reasoning'].includes(mode.toLowerCase()))
        || (output !== void 0 && !output.includes('text'));
      if (nonChat) { filtered.push({ id, reason: '非聊天/文本模型' }); continue; }
      candidates.push({ id, name: model?.name, contextWindow: model?.limit?.context, maxTokens: model?.limit?.output,
        reasoning: model?.reasoning === true, configured: configured.has(id) });
    }
    candidates.sort((a, b) => a.id.localeCompare(b.id));
    return { route: body.route, namespace: entry.options.id, profileHash: catalogHash(profile), api, auth: usedAuth, baseURL, endpoint: listing.endpoint,
      partial: listing.partial === true, fetchedAt: new Date().toISOString(),
      configured: [...configured].sort(), candidates, filtered };
  });

  /**
   * Append the models the caller adopted into one provider's configured `models` list.
   *
   * Append-only on purpose: nothing already configured is dropped or rewritten, so a
   * mistaken click can never narrow a working route. Existing ids are left untouched.
   */
  const adoptModels = (body) => queue(async () => {
    requireReady();
    if (!validRouteName(body?.route)) throw new HttpError(400, '无效 provider 名称');
    if (!Array.isArray(body?.ids) || body.ids.length === 0 || body.ids.length > 1000 || !body.ids.every(validModelId)) throw new HttpError(400, '请选择 1–1000 个有效模型 ID');
    const ids = [...new Set(body.ids)];
    const params = record(body.params) ? body.params : {};
    const editor = ctx.get?.('configEditor');
    const entry = providerEntry(body);
    const profile = entry.options.config?.providers?.[body.route];
    if (profile === void 0 || profile === null) throw new HttpError(404, '该 provider 尚未在配置中声明');
    if (typeof body.profileHash !== 'string' || body.profileHash !== catalogHash(profile)) throw new HttpError(409, 'provider 配置已变化，请重新获取清单');
    const beforeHash = catalogHash(profile);
    const catalog = await optionalCatalog(body.route);
    const existing = configuredModels(profile, catalog);
    const known = new Set(existing.map(model => model.id));
    const additions = ids.filter((id) => !known.has(id)).map((id) => {
      const p = params[id] && typeof params[id] === 'object' ? params[id] : {};
      const model = { id };
      if (typeof p.name === 'string' && p.name.length > 0 && p.name !== id) model.name = p.name;
      if (Number.isSafeInteger(p.contextWindow) && p.contextWindow > 0) model.contextWindow = p.contextWindow;
      if (Number.isSafeInteger(p.maxTokens) && p.maxTokens > 0) model.maxTokens = p.maxTokens;
      if (p.input !== undefined) {
        if (!Array.isArray(p.input) || p.input.length === 0 || !p.input.every(input => ['text', 'image'].includes(input))) throw new HttpError(400, 'input 只能包含 text/image');
        model.input = [...new Set(p.input)];
      }
      // A boolean capability does not specify supported wire-level reasoning values.
      return model;
    });
    if (additions.length === 0) return { adopted: [], skipped: ids, status: status() };
    ensureActive();
    await editor.edit(entry, (raw) => {
      ensureActive();
      const current = raw.providers?.[body.route];
      if (!current || catalogHash(current) !== beforeHash) throw new HttpError(409, 'provider 在提交前已变化，请重新获取清单');
      const live = configuredModels(current, catalog);
      const next = structuredClone(raw);
      const updated = { ...structuredClone(current), models: [...live, ...additions] };
      // Overrides are already represented on their corresponding baseline rows.
      delete updated.modelOverrides;
      next.providers[body.route] = updated;
      return next;
    });
    return { adopted: additions.map((m) => m.id), skipped: ids.filter((id) => known.has(id)), status: status() };
  });

  const installRoutes = () => {
    if (typeof ctx.inject !== 'function') return;
    ctx.inject(['webServer'], (webCtx) => {
      // Skip a late webServer injection into an already-disposed host; the handler
      // itself re-checks `disposed` on every request.
      if (disposed) return;
      const local = [];
      const cleanup = () => { for (const dispose of local.splice(0)) { registrations.delete(dispose); dispose(); } };
      const register = (suffix, method, action) => {
        const dispose = webCtx.webServer.register({ kind: 'exact', path: `${HTTP_BASE}/${suffix}`, handler: async (req, res) => {
          try {
            if (disposed) throw new HttpError(503, 'plugin disposed');
            if (req.method !== method) throw new HttpError(405, 'method not allowed');
            if (!validLocalRequest(req, { port: webCtx.webServer.port, mutate: method === 'POST' })) throw new HttpError(403, 'exact same-origin loopback request required');
            const body = method === 'POST' ? await readJsonBody(req, { signal }) : undefined;
            await action(body, res);
          } catch (error) { sendJson(res, error.status ?? 500, { error: messageOf(error) }); }
        } });
        local.push(dispose); registrations.add(dispose);
      };
      try {
        register('status', 'GET', async (_body, res) => sendJson(res, 200, status()));
        register('config', 'POST', async (body, res) => {
          const { expectedRevision, ...patch } = body;
          sendJson(res, 200, await updateSettings(patch, expectedRevision));
        });
        register('manual/save', 'POST', async (body, res) => sendJson(res, 200, await saveManual(body)));
        register('discover', 'POST', async (body, res) => sendJson(res, 200, await discoverProvider(body)));
        register('adopt', 'POST', async (body, res) => sendJson(res, 200, await adoptModels(body)));
        for (const action of ['preview', 'apply', 'revert']) {
          register(`manual/${action}`, 'POST', async (body, res) => sendJson(res, 200, await providerOperation(body, action)));
        }
        register('route', 'POST', async (body, res) => {
          await setRoute(body.route, body.enabled);
          const promise = requestRefresh();
          void promise.catch((error) => log(`route reconcile failed: ${messageOf(error)}`));
          sendJson(res, 202, { started: true, status: status() });
        });
        register('refresh', 'POST', async (_body, res) => {
          requireReady();
          const alreadyQueued = Boolean(refreshPending);
          const promise = requestRefresh({ forceUpstream: true });
          void promise.catch((error) => log(`manual refresh failed: ${messageOf(error)}`));
          sendJson(res, 202, { started: true, coalesced: alreadyQueued });
        });
        // Always answer the status route, even while bootstrap is still running or has failed.
        webCtx.on('dispose', cleanup);
      } catch (error) { cleanup(); throw error; }
    });
  };
  const dispose = () => {
    if (disposing) return disposing;
    disposed = true;
    abort.abort(new Error('model-refresh disposed'));
    if (timer !== undefined) (options.clearTimeout ?? clearTimeout)(timer);
    for (const unregister of [...registrations]) { registrations.delete(unregister); try { unregister(); } catch {} }
    const agent = proxyAgent; proxyAgent = undefined;
    disposing = (async () => {
      // Keep exclusive ownership until every queued operation has settled. Releasing the
      // lease first lets a replacement host start while this instance may still finish a
      // catalog commit or state write. abort() makes ordinary network waits settle quickly;
      // the process 'exit' hook remains the last-resort cleanup for an unawaited shutdown.
      await tail.catch(() => {});
      const release = releaseLease; releaseLease = undefined;
      try { await release?.(); } catch (error) { log(`lease release failed: ${messageOf(error)}`); }
      await closeProxy(agent);
      if (ownsState) { activeStates.delete(stateFile); ownsState = false; }
    })();
    return disposing;
  };
  if (typeof ctx.on !== 'function') throw new Error('Cordis dispose lifecycle is required');
  ctx.on('dispose', dispose);
  // Registered on the Cordis lifecycle, never inside `ready`: a failed bootstrap
  // (lease held elsewhere, unreadable state, unwritable catalog) must degrade the
  // plugin into a readable error page, not into a 404 the settings page cannot explain.
  installRoutes();
  const ready = queue(async () => {
    try {
    if (activeStates.has(stateFile)) throw new Error('A model-refresh instance already owns this state file');
    activeStates.add(stateFile);
    ownsState = true;
    releaseLease = await acquireStateLease(stateFile);
    ensureActive();
    state = await loadState(stateFile, seedFile);
    ensureActive();
    // Preserve the original v1/v2 document before the first v3 persistence.
    try {
      const original = await readFile(stateFile, 'utf8');
      const document = JSON.parse(original);
      if (document.version < STATE_VERSION) {
        const backup = `${stateFile}.pre-v3-${Date.now()}.bak`;
        await atomicWrite(backup, original, { signal });
        log(`migration backup saved: ${backup}`);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    ensureActive();
    dataDir = await locateCatalogData({ explicit: options.dataDir ?? process.env.DSH_PI_AI_DATA_DIR, entry: options.entry });
    ensureActive();
    // Only providers the profile actually declares are worth scanning. pi-ai ships dozens of
    // catalogs nobody configured, and touching them produced a wall of per-route failures.
    const declaredRoutes = declaredProviders(ctx.get?.('configEditor'));
    discoverRoutes(state, await readdir(dataDir), declaredRoutes);
    // Recover every existing journal before considering route pruning.
    await recoverCatalogTransactions({ dataDir, state, stateDir, persist, signal });
    // Drop routes an earlier build discovered by scanning every shipped catalog. Only
    // auto-discovered, undeclared and disabled rows are removed; anything the user
    // enabled or added by hand stays.
    if (declaredRoutes !== undefined) {
      const kept = state.routes.filter((r) => r.enabled || declaredRoutes.has(r.route) || r.discovered !== true || hasCatalogOwnership(state.runtime, r.route));
      if (kept.length !== state.routes.length) {
        const removed = new Set(state.routes.filter((r) => !kept.includes(r)).map((r) => r.route));
        state.routes = kept;
        for (const gone of removed) {
          delete state.runtime.perRoute?.[gone];
          delete state.runtime.missing?.[gone];
        }
        log(`pruned ${removed.size} undeclared discovered routes`);
      }
    }
    const editor = ctx.get?.('configEditor');
    if (editor) await recoverProviderTransactions({ editor, state, stateDir, persist });
    ensureActive();
    await persist();
    proxyAgent = await makeProxy(state.settings.proxyUrl);
    ensureActive();
    if (options.initialRefresh !== false) await refreshRound({ forceUpstream: true });
    resetTimer();
    } catch (error) {
      try { await releaseLease?.(); releaseLease = undefined; } catch (releaseError) { log(messageOf(releaseError)); }
      if (ownsState) { activeStates.delete(stateFile); ownsState = false; }
      throw error;
    }
  });
  void ready.catch((error) => { if (!disposed) { bootstrapError = messageOf(error); log(`bootstrap failed: ${bootstrapError}`); } });
  return { ready, dispose, requestRefresh, updateSettings, setRoute, saveManual, providerOperation, status, idle: () => tail.catch(() => {}) };
}

export function apply(ctx) { createHost(ctx); }

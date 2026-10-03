import { readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import path from 'node:path';
import { flattenInstalled, toYamlFragment } from './merge.mjs';
import { loadState, saveState, discoverRoutes, validateSettingsPatch, validRouteName, STATE_VERSION } from './state.mjs';
import { DEFAULT_LITELLM_ROUTES, litellmRouteModels } from './litellm.mjs';
import { DEFAULT_OFFICIAL_ROUTES, catalogBaseUrl, fetchOfficialListing } from './official.mjs';
import { planRoute } from './planner.mjs';
import { synchronizeCatalog, recoverCatalogTransactions } from './catalog-store.mjs';
import { atomicWrite, atomicWriteJson } from './host-io.mjs';
import { HttpError, readJsonBody, validLocalRequest, sendJson } from './host-http.mjs';
import { acquireStateLease } from './host-lease.mjs';

export const name = 'model-refresh';
export const PLUGIN_VERSION = '0.6.1';
const PLUGIN_DIR = fileURLToPath(new URL('../', import.meta.url));
const HTTP_BASE = '/plugins/dsh-model-refresh';
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const activeStates = new Set();
const messageOf = (error) => error instanceof Error ? error.message : String(error);

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
    const manifest = require.resolve('@earendil-works/pi-ai/package.json');
    const directory = path.join(path.dirname(manifest), 'dist', 'providers', 'data');
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
  return value;
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
  const resolveKey = async (reference) => {
    if (typeof reference !== 'string') return undefined;
    if (typeof process.env[reference] === 'string' && process.env[reference]) return process.env[reference];
    const credentials = ctx.get?.('credentials');
    const result = await credentials?.resolve?.(reference);
    return typeof result?.value === 'string' ? result.value : undefined;
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

  const refreshRound = async () => {
    ensureActive();
    const settings = structuredClone(state.settings);
    const routes = structuredClone(state.routes);
    const now = new Date().toISOString();
    state.runtime.running = true;
    state.runtime.lastError = null;
    const failures = [];
    try {
      await persist();
      let api;
      let lite;
      let litePromise;
      if (routes.some((route) => route.enabled)) {
        try { api = await fetchJson(settings.endpoint); }
        catch (error) { ensureActive(); failures.push(`models.dev: ${messageOf(error)}`); }
      }
      let installedAt = null;
      try { installedAt = JSON.parse(await readFile(path.join(dataDir, '.manifest.json'), 'utf8')).generatedAt ?? null; } catch {}
      for (const routeConfig of routes) {
        ensureActive();
        const route = routeConfig.route;
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
          let metadata = record(api?.[provider]?.models) && Object.keys(api[provider].models).length > 0 ? api[provider].models : undefined;
          let source = metadata ? 'models.dev' : 'none';
          if (!metadata && settings.litellmEnabled) {
            const prefix = Object.hasOwn(settings.litellmRoutes, route) ? settings.litellmRoutes[route] : DEFAULT_LITELLM_ROUTES[route];
            if (typeof prefix === 'string' && prefix) {
              litePromise ??= fetchJson(settings.litellmUrl).catch((error) => { ensureActive(); failures.push(`LiteLLM: ${messageOf(error)}`); return undefined; });
              lite = await litePromise;
              if (lite) {
                const converted = litellmRouteModels(lite, prefix);
                if (Object.keys(converted.models).length) { metadata = converted.models; source = 'litellm'; }
              }
            }
          }
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
          const plan = planRoute({ route, catalog: logicalCatalog, metadata: metadata ?? {}, source, official,
            officialConfigured, officialConfig: officialConfig ?? {}, settings: { ...settings, removeStale: settings.patchCatalog && settings.removeStale },
            routeConfig, previous, now: Date.parse(now) });
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
          state.runtime.perRoute[route] = { enabled: true, fetchedAt: now, installedAt, source,
            official: officialStatus, officialEndpoint: official?.endpoint ?? null, officialComplete: official?.complete ?? false,
            officialAdded: plan.officialAdded ?? [], models: models.length,
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

  const requestRefresh = () => {
    if (refreshPending) return refreshPending;
    refreshPending = queue(refreshRound);
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
    warnings: state?.runtime.migrationWarnings ?? [],
    routes: state?.routes.map((entry) => ({ ...(state.runtime.perRoute[entry.route] ?? {}), ...entry })) ?? [],
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
        register('route', 'POST', async (body, res) => {
          await setRoute(body.route, body.enabled);
          const promise = requestRefresh();
          void promise.catch((error) => log(`route reconcile failed: ${messageOf(error)}`));
          sendJson(res, 202, { started: true, status: status() });
        });
        register('refresh', 'POST', async (_body, res) => {
          requireReady();
          const alreadyQueued = Boolean(refreshPending);
          const promise = requestRefresh();
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
      await closeProxy(agent);
      await tail.catch(() => {});
      await releaseLease?.(); releaseLease = undefined;
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
    discoverRoutes(state, await readdir(dataDir));
    await recoverCatalogTransactions({ dataDir, state, stateDir, persist, signal });
    ensureActive();
    await persist();
    proxyAgent = await makeProxy(state.settings.proxyUrl);
    ensureActive();
    if (options.initialRefresh !== false) await refreshRound();
    resetTimer();
    } catch (error) {
      try { await releaseLease?.(); releaseLease = undefined; } catch (releaseError) { log(messageOf(releaseError)); }
      if (ownsState) { activeStates.delete(stateFile); ownsState = false; }
      throw error;
    }
  });
  void ready.catch((error) => { if (!disposed) { bootstrapError = messageOf(error); log(`bootstrap failed: ${bootstrapError}`); } });
  return { ready, dispose, requestRefresh, updateSettings, setRoute, status, idle: () => tail.catch(() => {}) };
}

export function apply(ctx) { createHost(ctx); }

/** Production Host: publish independent runtime mirrors; never mutate the installed catalog. */
import { access, readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadState, saveState, discoverRoutes, validateSettingsPatch, validRouteName, STATE_VERSION } from './state.mjs';
import { DEFAULT_OFFICIAL_ROUTES, fetchOfficialListing } from './official.mjs';
import { normalizePiAiRecord, refreshPiAiCatalog } from './pi-ai-upstream.mjs';
import { buildMirrorCatalog, mirrorRouteName } from './mirror-catalog.mjs';
import { createMirrorProvider, createMirrorProfile } from './mirror-provider.mjs';
import { atomicWrite } from './host-io.mjs';
import { HttpError, readJsonBody, validLocalRequest, sendJson } from './host-http.mjs';
import { acquireStateLease } from './host-lease.mjs';
import { COMPAT_FIELDS } from './model-capabilities.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const BASE = '/plugins/dsh-model-refresh';
const settingsKeys = new Set(['intervalMinutes', 'proxyUrl', 'modelsDevFallback', 'officialVerify', 'removeStale',
  'staleGraceHours', 'staleConfirmations', 'officialRoutes', 'autoDiscover']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const messageOf = error => error instanceof Error ? error.message : String(error);

/** Resolve pi-ai's public import-only exports from the adapter's Node lookup paths.
 * require.resolve uses the require condition, so it cannot select these exports.
 * Only manifest-declared import targets are loaded; no private dist-path fallback.
 */
async function piAiImportTargets(require) {
  for (const directory of require.resolve.paths('@earendil-works/pi-ai') ?? []) {
    const root = path.join(directory, '@earendil-works', 'pi-ai');
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (manifest.name !== '@earendil-works/pi-ai') throw new Error('Invalid consuming pi-ai package identity');
    const target = (key, star) => {
      const declared = manifest.exports?.[key]?.import;
      if (typeof declared !== 'string' || !declared.startsWith('./')) throw new Error(`pi-ai lacks the public import export ${key}`);
      const file = path.resolve(root, star ? declared.replace('*', star) : declared);
      if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Unsafe pi-ai import export');
      return pathToFileURL(file).href;
    };
    return { providers: target('./providers/*', 'all'), models: target('./models') };
  }
  throw new Error('Cannot locate the pi-ai package consumed by the installed adapter');
}

/** Import host-owned peers only at runtime; fixture tests inject this exact seam. */
export async function loadMirrorContracts({ entry = process.argv[1] } = {}) {
  if (typeof entry !== 'string' || entry.length === 0) throw new Error('Cannot identify the consuming DSH entry');
  const hostRequire = createRequire(path.resolve(entry));
  const adapterEntry = hostRequire.resolve('@deepseek-ai/dsh-llm-pi-ai');
  const require = createRequire(adapterEntry);
  const targets = await piAiImportTargets(require);
  const peer = specifier => import(pathToFileURL(require.resolve(specifier)).href);
  const [adapter, pi, llm, credentials, environment, models] = await Promise.all([
    import(pathToFileURL(adapterEntry).href), import(targets.providers),
    peer('@deepseek-ai/dsh-llm'), peer('@deepseek-ai/dsh-credentials'), peer('@deepseek-ai/dsh-launch-environment'),
    import(targets.models),
  ]);
  const contracts = { PiAiAdapter: adapter.PiAiAdapter, providers: pi.builtinProviders(), getModels: pi.getBuiltinModels,
    LlmError: llm.LlmError, assertUsableApiKey: llm.assertUsableApiKey, resolveRetryPolicy: llm.resolveRetryPolicy,
    resolveImageAttachmentAccess: llm.resolveImageAttachmentAccess, credentialRef: credentials.credentialRef,
    launchEnvironmentOf: environment.launchEnvironmentOf, getSupportedThinkingLevels: models.getSupportedThinkingLevels };
  for (const name of ['PiAiAdapter', 'getModels', 'LlmError', 'assertUsableApiKey', 'resolveRetryPolicy',
    'resolveImageAttachmentAccess', 'credentialRef', 'launchEnvironmentOf', 'getSupportedThinkingLevels']) {
    if (typeof contracts[name] !== 'function') throw new Error(`Installed DSH mirror contract is missing ${name}`);
  }
  if (!Array.isArray(contracts.providers) || !contracts.providers.length) throw new Error('Installed pi-ai provider directory is empty');
  return contracts;
}

/** Read connection facts only. A duplicate route across namespaces is ambiguous, never guessed. */
function configuredRoutes(ctx, supplied) {
  if (supplied) return new Map(Object.entries(supplied()).map(([route, profile]) => [route, structuredClone(profile)]));
  const editor = ctx.get?.('configEditor');
  const entries = editor?.entries?.();
  if (!Array.isArray(entries)) throw new Error('DSH configEditor is required to read configured pi-ai routes');
  const profiles = new Map();
  for (const entry of entries) {
    if (entry.options?.name !== '@deepseek-ai/dsh-llm-pi-ai') continue;
    for (const [route, profile] of Object.entries(entry.options.config?.providers ?? {})) {
      if (!validRouteName(route)) continue;
      if (profiles.has(route)) throw new Error(`Ambiguous pi-ai route in multiple namespaces: ${route}`);
      if (!record(profile)) throw new Error(`Invalid pi-ai connection profile: ${route}`);
      profiles.set(route, structuredClone(profile));
    }
  }
  return profiles;
}
function uniqueBase(models, api) {
  const urls = new Set(models.filter(model => api === undefined || model.api === api)
    .map(model => model.baseUrl?.replace(/\/+$/, '')).filter(Boolean));
  return urls.size === 1 ? [...urls][0] : undefined;
}
function legacyWarning(state) {
  return Object.values(state.runtime.catalogOwned ?? {}).some(rows => rows?.length)
    || Object.values(state.runtime.catalogRemoved ?? {}).some(rows => Object.keys(rows ?? {}).length)
    || Object.values(state.runtime.catalogPatched ?? {}).some(rows => rows?.length);
}

/** Stateless mirror auth store: no borrowed grants and no silently discarded writes. */
export function createMirrorCredentialStore(LlmError) {
  const unsupported = () => new LlmError('Mirror routes do not support stored credentials; use apiKeyEnv', 'NO_CREDENTIAL_STORE');
  return {
    async read() { return undefined; },
    async list() { return []; },
    async modify() { throw unsupported(); },
    async delete() { throw unsupported(); },
  };
}

/** All writes stay inside the plugin's own state directory. */
export function createMirrorHost(ctx, options = {}) {
  const stateFile = path.resolve(options.statePath ?? process.env.DSH_MODEL_REFRESH_STATE ?? path.join(homedir(), '.dsh', 'model-refresh', 'state.json'));
  const stateDir = path.dirname(stateFile);
  const seedFile = options.seedPath ?? process.env.DSH_MODEL_REFRESH_CONFIG ?? new URL('../config.json', import.meta.url);
  const abort = new AbortController();
  const { signal } = abort;
  let state, contracts, bases, releaseLease, proxy, timer, bootError, disposal;
  let disposed = false, pending = 0, tail = Promise.resolve(), refreshing;
  let profiles = new Map(), registration, adapter;
  const registered = new Set(), webDisposers = new Set();
  const warnings = new Set();
  const log = error => { try { ctx.logger?.warn?.(`[model-refresh] ${messageOf(error)}`); } catch {} };
  const active = () => { signal.throwIfAborted(); if (disposed) throw new Error('model-refresh disposed'); };
  const persist = async () => { active(); await (options.saveState ?? saveState)(stateFile, state, { signal }); };
  const queue = task => {
    if (disposed) return Promise.reject(new HttpError(503, 'plugin disposed'));
    if (pending >= 32) return Promise.reject(new HttpError(429, 'too many queued operations'));
    pending++;
    const result = tail.catch(() => {}).then(() => { active(); return task(); });
    tail = result;
    void result.finally(() => { pending--; }).catch(() => {});
    return result;
  };
  const closeProxy = async value => { try { await value?.destroy?.(); } catch {} };
  const makeProxy = async url => {
    if (!url || options.fetchFn) return undefined;
    const { ProxyAgent } = await import('undici');
    active(); return new ProxyAgent(url);
  };
  const resetTimer = () => {
    if (timer !== undefined) (options.clearTimeout ?? clearTimeout)(timer);
    if (!state || disposed || bootError) return;
    timer = (options.setTimeout ?? setTimeout)(() => {
      timer = undefined;
      void requestRefresh().catch(log);
    }, state.settings.intervalMinutes * 60_000);
    timer.unref?.();
  };
  const fetchResponse = async (url, init = {}) => {
    active();
    const combined = AbortSignal.any([signal, AbortSignal.timeout(30_000), ...(init.signal ? [init.signal] : [])]);
    let response;
    if (options.fetchFn) response = await options.fetchFn(url, { ...init, signal: combined });
    else if (proxy) {
      const { fetch: proxyFetch } = await import('undici');
      active(); response = await proxyFetch(url, { ...init, signal: combined, dispatcher: proxy });
    } else response = await fetch(url, { ...init, signal: combined });
    active(); return { response, combined };
  };
  const boundedBytes = async (response, combined, limit) => {
    combined.throwIfAborted();
    if (Number(response.headers?.get?.('content-length') ?? 0) > limit) {
      await response.body?.cancel?.(); throw new Error('upstream response exceeds byte limit');
    }
    if (!response.body?.getReader) {
      if (!response.json) throw new Error('upstream streaming response body is required');
      const bytes = Buffer.from(JSON.stringify(await response.json()));
      if (bytes.length > limit) throw new Error('upstream response exceeds byte limit');
      active(); return bytes;
    }
    const reader = response.body.getReader(), chunks = [];
    let size = 0;
    try {
      while (true) {
        combined.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) throw new Error('upstream response exceeds byte limit');
        chunks.push(Buffer.from(chunk.value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    active(); return Buffer.concat(chunks);
  };
  const fetchJson = async url => {
    const { response, combined } = await fetchResponse(url, { headers: { accept: 'application/json' }, redirect: 'error' });
    if (!response.ok) { await response.body?.cancel?.(); throw new Error(`upstream responded ${response.status}`); }
    return JSON.parse((await boundedBytes(response, combined, 16 * 1024 * 1024)).toString('utf8'));
  };
  const fetchBytes = async (url, limit) => {
    const { response, combined } = await fetchResponse(url, { redirect: 'error' });
    if (!response.ok) { await response.body?.cancel?.(); throw new Error(`upstream responded ${response.status}`); }
    return boundedBytes(response, combined, limit);
  };
  const officialFetch = async (url, init) => {
    const { response, combined } = await fetchResponse(url, init);
    return { ok: response.ok, status: response.status, headers: response.headers, body: response.body,
      json: async () => JSON.parse((await boundedBytes(response, combined, 4 * 1024 * 1024)).toString('utf8')) };
  };
  const resolveKey = async reference => {
    if (typeof reference !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) return undefined;
    const credential = await ctx.get?.('credentials')?.resolve?.(contracts.credentialRef?.(reference) ?? reference);
    if (typeof credential?.value === 'string' && credential.value.length) return credential.value;
    const environment = contracts.launchEnvironmentOf?.(ctx) ?? ctx.get?.('launchEnvironment');
    const launched = environment?.get?.(reference)?.value;
    if (typeof launched === 'string' && launched.length) return launched;
    return process.env[reference] || undefined;
  };
  const resolveApiKey = async (_provider, profile) => {
    if (profile.apiKeyEnv === undefined) return undefined;
    const value = await resolveKey(profile.apiKeyEnv);
    if (!value) throw new contracts.LlmError('Mirror provider credential reference is unresolved', 'MISSING_CREDENTIAL');
    return contracts.assertUsableApiKey(value, 'dsh-model-refresh', profile.apiKeyEnv);
  };
  const publish = next => {
    active();
    const prior = profiles;
    profiles = next;
    try {
      const routes = [...next.keys()];
      if (routes.length && !adapter) adapter = new contracts.PiAiAdapter({
        profiles: () => profiles, resolveApiKey,
        // Mirrors accept explicit keys or native ambient discovery, not stored
        // grants. Never borrow the source route's credential identity, and reject
        // writes instead of reporting a successful login/refresh that is lost.
        auth: { credentials: createMirrorCredentialStore(contracts.LlmError), authContext: {
          env: resolveKey,
          async fileExists(file) {
            const expanded = file === '~' || file.startsWith('~/') ? path.resolve(homedir(), file.slice(2)) : file;
            try { await access(expanded); return true; } catch { return false; }
          },
        } },
        resolveAttachments: () => ctx.get?.('attachments'),
        resolveImageAccess: (attachments, ref) => contracts.resolveImageAttachmentAccess?.(attachments,
          hostPath => ctx.get?.('fs')?.processPathFromHostPath(hostPath), ref),
        onReplayDegrade: () => log('Mirror replay state degraded to provider-neutral history'),
      });
      if (registration) registration.replace(routes);
      else if (routes.length) registration = ctx.llm.registerAdapter(routes, adapter);
      registered.clear();
      for (const route of routes) registered.add(route);
    } catch (error) { profiles = prior; throw error; }
  };
  const requireReady = () => {
    if (!state || !contracts || bootError) throw new HttpError(503, bootError ?? 'plugin initializing');
  };
  const refreshRound = async ({ forceUpstream = false } = {}) => {
    active();
    const settings = structuredClone(state.settings), routeSettings = structuredClone(state.routes);
    state.runtime.running = true;
    state.runtime.lastError = null;
    const failures = [], nextProfiles = new Map(), nextRows = Object.create(null);
    const nextMissing = structuredClone(state.runtime.missing);
    const nextCatalogs = record(state.runtime.mirrorCatalogs) ? structuredClone(state.runtime.mirrorCatalogs) : {};
    const fetchedAt = new Date().toISOString();
    try {
      const connections = configuredRoutes(ctx, options.sourceProfiles);
      discoverRoutes(state, [...connections.keys()].map(route => `${route}.json`), new Set(connections.keys()));
      await persist();
      let upstream, fallback;
      if (routeSettings.some(route => route.enabled && connections.has(route.route))) {
        try {
          upstream = await (options.refreshCatalog ?? refreshPiAiCatalog)({ file: path.join(stateDir, 'pi-ai-upstream.json'),
            fetchJson, fetchBytes, signal, force: forceUpstream });
          state.runtime.piAiUpstream = { package: upstream.package, version: upstream.version, checkedAt: upstream.checkedAt,
            providerCount: Object.keys(upstream.models ?? {}).length,
            modelCount: Object.values(upstream.models ?? {}).reduce((n, rows) => n + Object.keys(rows).length, 0),
            stale: Boolean(upstream.staleError), recordsComplete: upstream.recordsComplete !== false, error: upstream.staleError ?? null };
          if (upstream.staleError) failures.push(`pi-ai upstream unavailable; using cached catalog: ${upstream.staleError}`);
        } catch (error) {
          active(); failures.push(`pi-ai upstream: ${messageOf(error)}`);
          state.runtime.piAiUpstream = { package: '@earendil-works/pi-ai', version: null, checkedAt: fetchedAt,
            providerCount: 0, modelCount: 0, stale: false, error: messageOf(error) };
          if (settings.modelsDevFallback) {
            try { fallback = await fetchJson(settings.endpoint); }
            catch (fallbackError) { active(); failures.push(`models.dev fallback: ${messageOf(fallbackError)}`); }
          }
        }
      }
      const occupied = new Set((ctx.llm.listProviders?.() ?? []).map(provider => provider.id).filter(route => !registered.has(route)));
      for (const routeConfig of routeSettings) {
        active();
        const route = routeConfig.route, mirrorRoute = mirrorRouteName(route);
        const previous = state.runtime.perRoute[route] ?? {};
        if (!routeConfig.enabled) {
          nextRows[route] = { enabled: false, mirrorRoute, registered: false, models: 0, modelList: [], error: null };
          continue;
        }
        try {
          const connection = connections.get(route);
          if (!connection) throw new Error('Source pi-ai route is not configured; mirror not registered');
          if (connection.apiKeyEnv !== undefined && (typeof connection.apiKeyEnv !== 'string'
            || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(connection.apiKeyEnv))) throw new Error('Source apiKeyEnv is not a credential reference');
          if (occupied.has(mirrorRoute)) throw new Error(`Mirror route is already owned by another adapter: ${mirrorRoute}`);
          const sourceProvider = routeConfig.as ?? route, baseProvider = bases.get(sourceProvider);
          if (!baseProvider) throw new Error(`Installed pi-ai has no provider implementation: ${sourceProvider}`);
          const allInstalled = structuredClone(contracts.getModels(sourceProvider));
          const native = connection.api === undefined ? allInstalled : allInstalled.filter(model => model.api === connection.api);
          if (!native.length) throw new Error('Source protocol has no installed model baseline; upgrade pi-ai or use its native route');
          if (connection.apiKeyEnv === undefined && !baseProvider.auth?.apiKey) {
            throw new Error('Native OAuth credentials are not implicitly transferred to a mirror; configure an explicit apiKeyEnv');
          }
          const currentApis = new Set(native.map(model => model.api));
          const baseline = new Map(native.map(model => [model.id, model]));
          const history = nextCatalogs[route];
          if (history?.sourceProvider === sourceProvider && Array.isArray(history.models) && history.models.length <= 10_000) {
            for (const row of history.models) {
              const validated = normalizePiAiRecord(row);
              if (validated && currentApis.has(validated.api) && !baseline.has(validated.id))
                baseline.set(validated.id, { ...validated, provider: sourceProvider });
            }
          }
          const installed = [...baseline.values()];
          const override = settings.officialRoutes[route];
          const defaultOfficial = DEFAULT_OFFICIAL_ROUTES[sourceProvider];
          const officialConfig = override === null ? null : { ...(defaultOfficial ?? {}), ...(override ?? {}) };
          if (officialConfig && (override?.apiKeyEnv ?? connection.apiKeyEnv) !== undefined)
            officialConfig.apiKeyEnv = override?.apiKeyEnv ?? connection.apiKeyEnv;
          const officialConfigured = settings.officialVerify && officialConfig !== null
            && (override !== undefined || defaultOfficial !== undefined);
          let official, officialState = !settings.officialVerify ? 'disabled' : officialConfigured ? 'no-key' : 'unconfigured';
          const routeWarnings = [];
          if (officialConfigured) {
            try {
              const key = await resolveKey(officialConfig.apiKeyEnv ?? connection.apiKeyEnv);
              official = await fetchOfficialListing(officialConfig.baseUrl ?? connection.baseURL ?? uniqueBase(installed, connection.api),
                key, officialFetch, { ...officialConfig, signal });
              officialState = 'verified';
            } catch (error) {
              active(); officialState = error.code === 'MISSING_KEY' ? 'no-key' : 'failed';
              const safeCodes = new Set(['MISSING_KEY', 'INVALID_KEY', 'HTTP_ERROR', 'EMPTY_LISTING', 'NOT_FOUND', 'INVALID_LISTING', 'INVALID_URL']);
              routeWarnings.push(`Official verification ${officialState}: ${safeCodes.has(error.code) ? error.code : 'network or response validation failed'}`);
            }
          }
          let bucket = upstream?.recordsComplete !== false
            ? upstream?.records?.[sourceProvider] ?? upstream?.models?.[sourceProvider]
            : Object.fromEntries(Object.entries(upstream.models?.[sourceProvider] ?? {}).map(([id, row]) => [id, {
              id, name: row.name, reasoning: row.reasoning, piApi: row.piApi ?? row.api,
              limit: row.limit ?? { context: row.contextWindow, output: row.maxTokens },
              modalities: row.modalities ?? { input: row.input, output: ['text'] },
            }]));
          bucket ??= fallback?.[sourceProvider]?.models;
          if (upstream?.recordsComplete === false) routeWarnings.push('pi-ai 缓存仅有旧投影；新模型需重新获取完整记录，当前只保留已有模型。');
          const source = upstream?.version ? `pi-ai@${upstream.version}` : fallback ? 'models.dev fallback' : 'installed catalog';
          const result = buildMirrorCatalog({ route, mirrorRoute, installedModels: installed, upstreamModels: bucket,
            routeConfig: { ...routeConfig, keep: [...routeConfig.keep, ...(state.runtime.legacyProtected?.[route] ?? [])] },
            source, official, officialConfigured, officialConfig, settings,
            previous: { ...previous, missing: state.runtime.missing[route] ?? {} }, now: Date.parse(fetchedAt), baseURL: connection.baseURL });
          const models = result.models.map(model => {
            const overrides = Object.fromEntries(Object.entries(connection.compat ?? {})
              .filter(([field]) => COMPAT_FIELDS[model.api]?.includes(field)));
            return Object.keys(overrides).length ? { ...model, compat: { ...model.compat, ...overrides } } : model;
          });
          if (models.length) {
            const displayName = `${connection.displayName ?? baseProvider.name ?? route}（动态目录）`;
            const piProvider = createMirrorProvider({ baseProvider, mirrorRoute, displayName, models,
              baseURL: connection.baseURL, useApiKey: connection.apiKeyEnv !== undefined });
            const sourceProfile = { ...connection, retryPolicy: contracts.resolveRetryPolicy(connection.retryPolicy, `mirror ${route}`) };
            if (sourceProfile.reasoning !== undefined && !models.every(model =>
              contracts.getSupportedThinkingLevels?.(model).includes(sourceProfile.reasoning))) {
              delete sourceProfile.reasoning;
              routeWarnings.push('原路由默认推理档位不适用于完整镜像目录；保留逐模型档位，不继承全局默认档。');
            }
            const profile = createMirrorProfile({ provider: mirrorRoute, displayName, piProvider, models, sourceProfile });
            // Explicit source connection headers remain request-local; never persist this profile in status/state.
            if (connection.headers !== undefined) {
              if (!record(connection.headers) || Object.values(connection.headers).some(value => typeof value !== 'string'))
                throw new Error('Source headers must be a string dictionary');
              try { new Headers(connection.headers); }
              catch { throw new Error('Source headers contain invalid HTTP fields'); }
              profile.headers = structuredClone(connection.headers);
            }
            nextProfiles.set(mirrorRoute, profile);
          }
          nextMissing[route] = result.missing;
          // Retain accepted data even when excluded/removed from this projection, so changing
          // keep/exclude/removeStale can restore it without relying on an upstream reappearance.
          const retained = new Map([...baseline.values()].flatMap(model => {
            const sanitized = normalizePiAiRecord(model);
            return sanitized ? [[sanitized.id, sanitized]] : [];
          }));
          for (const model of result.models) {
            // Persist data-only descriptors, never source headers, credentials, connection overrides or profiles.
            const origin = normalizePiAiRecord(bucket?.[model.id]) ?? normalizePiAiRecord(baseline.get(model.id));
            const sanitized = origin && normalizePiAiRecord({ ...model, provider: sourceProvider, baseUrl: origin.baseUrl });
            if (sanitized) retained.set(model.id, sanitized);
          }
          nextCatalogs[route] = { sourceProvider, models: [...retained.values()] };
          nextRows[route] = { enabled: true, mirrorRoute, registered: false, fetchedAt, source,
            ...result.diff, models: models.length, modelList: result.modelList, pending: result.pending,
            official: officialState, officialEndpoint: official?.endpoint ?? null, officialComplete: official?.complete ?? false,
            officialAdded: result.officialAdded, warnings: [...routeWarnings, ...result.warnings], error: routeWarnings.join('\n') || null };
          if (officialState === 'failed') failures.push(`${route}: official verification failed`);
        } catch (error) {
          active(); failures.push(`${route}: ${messageOf(error)}`);
          nextRows[route] = { enabled: true, mirrorRoute, registered: false, models: 0, modelList: [],
            error: messageOf(error), fetchedAt, warnings: [] };
        }
      }
      publish(nextProfiles);
      Object.assign(state.runtime.perRoute, nextRows);
      state.runtime.missing = nextMissing;
      state.runtime.mirrorCatalogs = nextCatalogs;
      for (const route of state.routes) {
        const row = state.runtime.perRoute[route.route];
        if (row) row.registered = registered.has(row.mirrorRoute);
      }
      state.runtime.lastRun = new Date().toISOString();
      state.runtime.lastError = failures.join('\n') || null;
    } catch (error) {
      if (!disposed) state.runtime.lastError = messageOf(error);
      throw error;
    } finally {
      state.runtime.running = false;
      if (!disposed) await persist();
    }
  };
  const requestRefresh = ({ forceUpstream = false } = {}) => {
    if (refreshing) return refreshing;
    refreshing = queue(() => refreshRound({ forceUpstream }));
    void refreshing.finally(() => { refreshing = undefined; resetTimer(); }).catch(() => {});
    return refreshing;
  };
  const updateSettings = (patch, expectedRevision) => queue(async () => {
    requireReady();
    if (expectedRevision !== undefined && expectedRevision !== state.settingsRevision) throw new HttpError(409, 'settings changed; reload before saving');
    if (!record(patch) || Object.keys(patch).some(key => !settingsKeys.has(key))) throw new HttpError(400, 'Unsupported mirror setting; catalog/profile mutations are not available');
    let validated;
    try { validated = validateSettingsPatch(patch); } catch (error) { throw new HttpError(400, messageOf(error)); }
    const next = { ...state, settings: { ...state.settings, ...validated }, settingsRevision: state.settingsRevision + 1 };
    const changed = next.settings.proxyUrl !== state.settings.proxyUrl;
    const agent = changed ? await makeProxy(next.settings.proxyUrl) : proxy;
    try { await (options.saveState ?? saveState)(stateFile, next, { signal }); active(); }
    catch (error) { if (changed) await closeProxy(agent); throw error; }
    state = next;
    if (changed) { const old = proxy; proxy = agent; await closeProxy(old); }
    resetTimer(); return status();
  });
  const setRoute = (route, enabled) => queue(async () => {
    requireReady();
    if (!validRouteName(route) || typeof enabled !== 'boolean') throw new HttpError(400, 'expected a route and boolean enabled');
    if (!state.routes.some(row => row.route === route)) throw new HttpError(404, 'unknown route');
    const next = { ...state, settingsRevision: state.settingsRevision + 1,
      routes: state.routes.map(row => row.route === route ? { ...row, enabled } : row) };
    await (options.saveState ?? saveState)(stateFile, next, { signal }); active(); state = next;
    // Withdrawing a disabled route is synchronous with this queued operation, not deferred to a network round.
    if (!enabled) { const nextProfiles = new Map(profiles); nextProfiles.delete(mirrorRouteName(route)); publish(nextProfiles); }
    else void requestRefresh().catch(log);
    return status();
  });
  const status = () => ({
    version: STATE_VERSION, pluginVersion: VERSION, mode: 'mirror', settingsRevision: state?.settingsRevision ?? 0,
    initialized: Boolean(state && contracts && !bootError), degraded: Boolean(bootError),
    degradedHint: bootError ? '镜像启动失败；原 provider 未被修改。修复错误后重新加载插件。' : null,
    running: state?.runtime.running ?? false, queued: pending, lastRun: state?.runtime.lastRun ?? null,
    lastError: bootError ?? state?.runtime.lastError ?? null,
    warnings: [...new Set([...warnings, ...(state?.runtime.migrationWarnings ?? [])])], piAiUpstream: state?.runtime.piAiUpstream ?? null,
    settings: state ? Object.fromEntries([...settingsKeys].map(key => [key, state.settings[key]]).concat([['proxyConfigured', Boolean(state.settings.proxyUrl)]])) : null,
    routes: state?.routes.map(route => ({ ...Object.fromEntries([
      'fetchedAt', 'source', 'models', 'modelList', 'added', 'updated', 'stale', 'excluded', 'unverified', 'pending',
      'official', 'officialEndpoint', 'officialComplete', 'officialAdded', 'warnings', 'error',
    ].filter(key => state.runtime.perRoute[route.route]?.[key] !== undefined)
      .map(key => [key, state.runtime.perRoute[route.route][key]])), ...route,
      mirrorRoute: mirrorRouteName(route.route), registered: registered.has(mirrorRouteName(route.route)) })) ?? [],
  });
  const dispose = () => {
    if (disposal) return disposal;
    disposed = true; abort.abort(new Error('model-refresh disposed'));
    if (timer !== undefined) (options.clearTimeout ?? clearTimeout)(timer);
    for (const unregister of webDisposers) { try { unregister(); } catch {} }
    webDisposers.clear();
    try { registration?.(); } catch (error) { log(error); }
    registration = undefined; registered.clear(); profiles = new Map();
    disposal = (async () => {
      await tail.catch(() => {});
      try { await releaseLease?.(); } finally { releaseLease = undefined; await closeProxy(proxy); proxy = undefined; }
    })();
    return disposal;
  };
  if (typeof ctx.on !== 'function') throw new Error('Cordis lifecycle is required');
  ctx.on('dispose', dispose);
  ctx.inject?.(['webServer'], web => {
    if (disposed) return;
    const local = [];
    const cleanup = () => { for (const unregister of local.splice(0)) { webDisposers.delete(unregister); unregister(); } };
    for (const [suffix, method, action] of [
      ['status', 'GET', async () => status()],
      ['config', 'POST', body => { const { expectedRevision, ...patch } = body; return updateSettings(patch, expectedRevision); }],
      ['route', 'POST', async body => { await setRoute(body.route, body.enabled); void requestRefresh().catch(log); return status(); }],
      ['refresh', 'POST', async () => { requireReady(); void requestRefresh({ forceUpstream: true }).catch(log); return { started: true }; }],
    ]) {
      const unregister = web.webServer.register({ kind: 'exact', path: `${BASE}/${suffix}`, handler: async (req, res) => {
        try {
          if (disposed) throw new HttpError(503, 'plugin disposed');
          if (req.method !== method) throw new HttpError(405, 'method not allowed');
          if (!validLocalRequest(req, { port: web.webServer.port, mutate: method === 'POST' })) throw new HttpError(403, 'exact same-origin loopback request required');
          sendJson(res, 200, await action(method === 'POST' ? await readJsonBody(req, { signal }) : undefined));
        } catch (error) { sendJson(res, error.status ?? 500, { error: messageOf(error) }); }
      } });
      local.push(unregister); webDisposers.add(unregister);
    }
    web.on('dispose', cleanup);
  });
  ctx.on('loader/volatile-update', () => { if (state && !bootError && !disposed) void queue(() => refreshRound()).catch(log); });
  const ready = queue(async () => {
    try {
      releaseLease = await acquireStateLease(stateFile); active();
      state = await loadState(stateFile, seedFile); active();
      try {
        const raw = await readFile(stateFile, 'utf8');
        if (JSON.parse(raw).version < STATE_VERSION) await atomicWrite(`${stateFile}.pre-v3-${Date.now()}.bak`, raw, { signal });
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (legacyWarning(state)) warnings.add('检测到旧版 catalog 所有权记录；新版不会修改安装目录。请使用旧版显式恢复流程核验遗留变更。');
      try {
        if ((await readdir(path.join(stateDir, 'transactions'))).some(file => file.endsWith('.json')))
          warnings.add('存在旧版未完成 catalog 事务；日志保留，镜像 Host 不自动恢复或删除。');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      contracts = await (options.loadContracts ?? loadMirrorContracts)({ entry: options.entry }); active();
      if (typeof ctx.llm?.registerAdapter !== 'function') throw new Error('DSH LLM registry is required');
      bases = new Map(contracts.providers.map(provider => [provider.id, provider]));
      const connections = configuredRoutes(ctx, options.sourceProfiles);
      discoverRoutes(state, [...connections.keys()].map(route => `${route}.json`), new Set(connections.keys()));
      await persist(); proxy = await makeProxy(state.settings.proxyUrl); active();
      if (options.initialRefresh !== false) await refreshRound({ forceUpstream: true });
      resetTimer();
    } catch (error) {
      if (!disposed) { bootError = messageOf(error); log(error); }
      try { registration?.(); } catch (cleanupError) { log(cleanupError); }
      registration = undefined; registered.clear(); profiles = new Map();
      await releaseLease?.(); releaseLease = undefined;
      throw error;
    }
  });
  void ready.catch(() => {});
  return { ready, dispose, requestRefresh, updateSettings, setRoute, status, idle: () => tail.catch(() => {}) };
}

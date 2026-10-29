/**
 * Structural pi-ai provider/profile builders for a `refresh-*` mirror route.
 *
 * This module deliberately has no imports: it must stay loadable in an offline
 * repository test and never pulls in `@deepseek-ai/*` or `@earendil-works/pi-ai`
 * at module load time. The base provider is supplied by the host.
 */

const MAX_ROUTE_LENGTH = 128;
const DANGEROUS_ROUTES = new Set(['__proto__', 'constructor', 'prototype']);
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20_971_520;
const DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET = 4_194_304;
const DEFAULT_REQUEST_IMAGE_MAX_BYTES = 1_048_576;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
// Request operations a base provider may expose later in the collection
// lifecycle. Catalog/auth ownership stays with this mirror route, so
// `refreshModels`, `fetchModels`, `login` and `logout` are deliberately not
// exposed: delegating them would let the base catalog or the base auth flow
// replace this route's snapshot or identity.
const DEFERRED_METHODS = ['fetchDeferred', 'cancelDeferred'];
// Request headers are intentionally excluded: a profile copied into host state
// must not carry credential-bearing headers from another route. `apiKeyEnv` is
// inherited only when it is a credential reference name (never a literal key).
const INHERITED_PROFILE_FIELDS = ['transport', 'timeoutMs', 'websocketConnectTimeoutMs',
  'reasoning', 'thinkingBudgets', 'cacheRetention', 'defaultInput', 'defaultContextWindow',
  'defaultMaxTokens'];
const CREDENTIAL_REFERENCE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validRouteName(value) {
  return typeof value === 'string' && new RegExp(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,${MAX_ROUTE_LENGTH - 1}}$`).test(value)
    && !DANGEROUS_ROUTES.has(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function validBaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) return undefined;
    return value;
  } catch { return undefined; }
}

/**
 * API-key auth shaped for pi-ai's `Models` collection.
 *
 * `Models` resolves a stored credential and hands it to `resolve` as
 * `{ credential }`; the returned key is the harness credential's own key and is
 * never captured or serialized here. A route with no resolved credential stays
 * configured-but-keyless, exactly as pi-ai treats an empty auth result.
 *
 * @param name - status label for the resolution.
 * @returns an `ApiKeyAuth` object.
 */
function harnessApiKeyAuth(name) {
  return {
    name,
    resolve: ({ credential } = {}) => Promise.resolve({
      auth: credential?.key === undefined ? {} : { apiKey: credential.key },
      source: name,
    }),
  };
}

/**
 * Build the structural pi-ai provider for one mirror route.
 *
 * Dispatch is delegated to the installed provider, so protocol implementations
 * and compatibility quirks keep working; only identity, the snapshot model list
 * and (optionally) auth are replaced. Request-operation hooks (`fetchDeferred`,
 * `cancelDeferred`) are delegated when present; catalog and auth lifecycle
 * methods are not, because this route owns its model list and credential.
 *
 * @param input.baseProvider - installed pi-ai provider; its `refreshModels` is never called here.
 * @param input.mirrorRoute - the `refresh-*` route this provider serves.
 * @param input.displayName - display label; defaults to the mirror route.
 * @param input.models - complete runtime model records for the snapshot.
 * @param input.baseURL - optional route-level endpoint.
 * @param input.useApiKey - expose harness-resolved API-key auth (no key is stored).
 * @returns a pi-ai provider-shaped object.
 */
export function createMirrorProvider(input = {}) {
  const { baseProvider, mirrorRoute, displayName, models, baseURL, useApiKey } = record(input) ? input : {};
  if (!record(baseProvider) || typeof baseProvider.stream !== 'function' || typeof baseProvider.streamSimple !== 'function') {
    throw new Error('createMirrorProvider requires a base pi-ai provider with stream and streamSimple');
  }
  if (!validRouteName(mirrorRoute)) throw new Error('createMirrorProvider requires a valid mirrorRoute');
  if (!Array.isArray(models) || models.length === 0) throw new Error('createMirrorProvider requires the complete runtime model array');
  const name = typeof displayName === 'string' && displayName.length > 0 ? displayName : mirrorRoute;
  let routeBaseURL;
  if (baseURL !== undefined) {
    routeBaseURL = validBaseUrl(baseURL);
    if (routeBaseURL === undefined) throw new Error('createMirrorProvider baseURL must be an HTTP(S) URL without credentials');
  }
  if (typeof baseProvider.id !== 'string' || !baseProvider.id.length) throw new Error('Base provider identity is required for wire compatibility');
  // The registry/auth collection owns the mirror identity. Native protocol code
  // must still see its real vendor id (e.g. opencode-go reasoning replay and
  // github-copilot/OpenAI special serialization branch on model.provider).
  const wireModel = model => ({ ...model, provider: baseProvider.id });
  const baseAuth = record(baseProvider.auth) ? baseProvider.auth : {};
  const auth = useApiKey === true ? { ...baseAuth, apiKey: harnessApiKeyAuth(name) } : baseAuth;
  // Clone once so later mutation of the caller's array cannot change the route's
  // catalog; freezing makes the snapshot read-only for every consumer.
  const snapshot = deepFreeze(structuredClone(models));
  const authBaseURL = routeBaseURL ?? validBaseUrl(baseProvider.baseUrl);
  const provider = {
    id: mirrorRoute,
    name,
    ...authBaseURL === undefined ? {} : { baseUrl: authBaseURL },
    auth,
    getModels: () => snapshot,
    stream: (model, context, options) => baseProvider.stream(wireModel(model), context, options),
    streamSimple: (model, context, options) => baseProvider.streamSimple(wireModel(model), context, options),
  };
  for (const method of DEFERRED_METHODS) {
    if (typeof baseProvider[method] === 'function') provider[method] = (model, ...args) => baseProvider[method](wireModel(model), ...args);
  }
  return provider;
}

function inheritedBaseURL(models, sourceProfile) {
  const urls = new Set();
  let missing = false;
  for (const model of models) {
    const url = validBaseUrl(model?.baseUrl);
    if (url === undefined) { missing = true; continue; }
    urls.add(url.replace(/\/+$/, ''));
  }
  if (missing || urls.size !== 1) return undefined;
  const shared = [...urls][0];
  // A source baseURL only applies when it points at the same endpoint the
  // mirror models carry; otherwise a route-level URL would override them.
  if (typeof sourceProfile?.baseURL === 'string' && sourceProfile.baseURL.length > 0
    && validBaseUrl(sourceProfile.baseURL)?.replace(/\/+$/, '') !== shared) return undefined;
  return validBaseUrl(models.find(model => validBaseUrl(model?.baseUrl))?.baseUrl);
}

/**
 * Build the profile a host can hand to its pi-ai-backed adapter.
 *
 * Connection, timeout, image-budget and reasoning fields are inherited from the
 * source profile when present; the route, display label, `piProvider`, the
 * empty `configuredMaxTokens` map and `modelErrors` are authoritative
 * here. Route-level `compat` is intentionally not inherited (the host owns
 * sourceProfile.compat merging) and `retryPolicy` is passed through untouched
 * (the host normalizes it with its own retry-policy resolver). Request headers
 * are excluded, and `apiKeyEnv` is inherited only as a credential reference
 * name, so no plaintext header or key is copied into host state.
 *
 * @param input.provider - the mirror route key.
 * @param input.displayName - display label; defaults to the route.
 * @param input.piProvider - provider returned by {@link createMirrorProvider}.
 * @param input.models - the complete runtime model records behind `piProvider`.
 * @param input.sourceProfile - installed route's resolved profile, when known.
 * @returns a pi-ai adapter profile-shaped object.
 */
export function createMirrorProfile(input = {}) {
  const { provider, displayName, piProvider, models, sourceProfile } = record(input) ? input : {};
  if (!validRouteName(provider)) throw new Error('createMirrorProfile requires a valid provider route');
  if (!record(piProvider)) throw new Error('createMirrorProfile requires the mirror piProvider');
  if (!Array.isArray(models) || models.length === 0) throw new Error('createMirrorProfile requires the complete runtime model array');
  const source = record(sourceProfile) ? sourceProfile : {};
  const profile = {};
  for (const field of INHERITED_PROFILE_FIELDS) {
    if (source[field] !== undefined) profile[field] = structuredClone(source[field]);
  }
  if (typeof source.apiKeyEnv === 'string' && CREDENTIAL_REFERENCE.test(source.apiKeyEnv)) profile.apiKeyEnv = source.apiKeyEnv;
  const sharedBaseURL = inheritedBaseURL(models, source);
  if (sharedBaseURL !== undefined) profile.baseURL = sharedBaseURL;
  else delete profile.baseURL;
  // Catalog output capacity is not an explicitly configured request default.
  // Source model overrides are intentionally not inherited by mirror routes.
  const configuredMaxTokens = new Map();
  const streamIdleTimeoutMs = Number.isFinite(source.streamIdleTimeoutMs) && source.streamIdleTimeoutMs > 0
    && source.streamIdleTimeoutMs <= MAX_TIMER_DELAY_MS ? source.streamIdleTimeoutMs : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
  return {
    ...profile,
    provider,
    displayName: typeof displayName === 'string' && displayName.length > 0 ? displayName : provider,
    piProvider,
    configuredMaxTokens,
    modelErrors: new Map(),
    streamIdleTimeoutMs,
    maxRequestImageBytes: positiveInteger(source.maxRequestImageBytes) ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES,
    requestImagePixelBudget: positiveInteger(source.requestImagePixelBudget) ?? DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET,
    requestImageMaxBytes: positiveInteger(source.requestImageMaxBytes) ?? DEFAULT_REQUEST_IMAGE_MAX_BYTES,
    ...(source.retryPolicy === undefined ? {} : { retryPolicy: structuredClone(source.retryPolicy) }),
  };
}

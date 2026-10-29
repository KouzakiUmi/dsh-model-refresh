import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMirrorProfile, createMirrorProvider } from '../lib/mirror-provider.mjs';

const source = await readFile(new URL('../lib/mirror-provider.mjs', import.meta.url), 'utf8');
assert.equal(/from\s+['"]@deepseek-ai\//.test(source), false, 'no static @deepseek-ai import');
assert.equal(/from\s+['"]@earendil-works\/pi-ai/.test(source), false, 'no static pi-ai import');
assert.equal(/require\s*\(/.test(source), false, 'no runtime require');

const models = [
  { id: 'alpha', name: 'Alpha', type: 'chat', api: 'anthropic-messages', provider: 'refresh-demo',
    baseUrl: 'https://shared.invalid/anthropic', reasoning: true, input: ['text', 'image'],
    contextWindow: 200_000, maxTokens: 16_000, compat: { supportsStore: false } },
  { id: 'beta', name: 'Beta', type: 'chat', api: 'anthropic-messages', provider: 'refresh-demo',
    baseUrl: 'https://shared.invalid/anthropic', reasoning: false, input: ['text'],
    contextWindow: 100_000, maxTokens: 8_000 },
];

function baseProvider() {
  const calls = [];
  const base = {
    id: 'demo', name: 'Demo', baseUrl: 'https://base.invalid',
    auth: { oauth: { name: 'Demo OAuth' }, apiKey: { name: 'Demo key', resolve: async () => ({ auth: {} }) } },
    stream: (...args) => { calls.push(['stream', ...args]); return { kind: 'stream' }; },
    streamSimple: (...args) => { calls.push(['streamSimple', ...args]); return { kind: 'streamSimple' }; },
    fetchDeferred: (...args) => { calls.push(['fetchDeferred', ...args]); return { kind: 'deferred' }; },
    cancelDeferred: (...args) => { calls.push(['cancelDeferred', ...args]); return Promise.resolve({ kind: 'cancelled' }); },
    refreshModels: () => { calls.push(['refreshModels']); return 'refreshed'; },
    fetchModels: () => { calls.push(['fetchModels']); return 'fetched'; },
    login: () => { calls.push(['login']); },
    logout: () => { calls.push(['logout']); },
  };
  return { base, calls };
}

// --- provider structure and delegation --------------------------------------
{
  const { base, calls } = baseProvider();
  const snapshot = structuredClone(models);
  const provider = createMirrorProvider({ baseProvider: base, mirrorRoute: 'refresh-demo', displayName: 'Demo mirror',
    models: snapshot, baseURL: 'https://mirror.invalid/v1' });
  assert.equal(provider.id, 'refresh-demo');
  assert.equal(provider.name, 'Demo mirror');
  assert.equal(provider.baseUrl, 'https://mirror.invalid/v1');
  assert.equal(typeof provider.auth, 'object');
  assert.equal(typeof provider.getModels, 'function');
  assert.equal(typeof provider.stream, 'function');
  assert.equal(typeof provider.streamSimple, 'function');
  assert.deepEqual(calls, [], 'creating the provider never invokes base operations');
  for (const forbidden of ['refreshModels', 'fetchModels', 'login', 'logout']) {
    assert.equal(provider[forbidden], undefined, `${forbidden} must not be delegated`);
  }
  assert.equal(typeof provider.fetchDeferred, 'function');
  assert.equal(typeof provider.cancelDeferred, 'function');
  const model = provider.getModels()[0];
  const context = { messages: [] };
  const options = { signal: new AbortController().signal };
  assert.deepEqual(provider.stream(model, context, options), { kind: 'stream' });
  assert.deepEqual(provider.streamSimple(model, context, options), { kind: 'streamSimple' });
  assert.deepEqual(provider.fetchDeferred(model, 'handle', options), { kind: 'deferred' });
  assert.deepEqual(await provider.cancelDeferred(model, 'handle', options), { kind: 'cancelled' });
  assert.deepEqual(calls.map(call => call[0]), ['stream', 'streamSimple', 'fetchDeferred', 'cancelDeferred']);
  for (const call of calls) {
    assert.deepEqual(call[1], { ...model, provider: base.id }, 'native serializers receive their original vendor identity');
    assert.notEqual(call[1], model, 'the mirror descriptor is not mutated at dispatch');
  }
  assert.equal(model.provider, 'refresh-demo', 'catalog/auth retain the mirror identity');
  assert.equal(calls[0][2], context);
  assert.equal(calls[0][3], options);

  // The snapshot is cloned and frozen: caller mutation cannot change the route.
  snapshot[0].name = 'Mutated';
  snapshot.push({ id: 'late' });
  assert.equal(provider.getModels().length, 2);
  assert.equal(provider.getModels()[0].name, 'Alpha');
  assert.equal(Object.isFrozen(provider.getModels()), true);
  assert.equal(Object.isFrozen(provider.getModels()[0]), true);
}
{
  const { base } = baseProvider();
  const provider = createMirrorProvider({ baseProvider: base, mirrorRoute: 'refresh-demo', models });
  assert.equal(provider.name, 'refresh-demo', 'display name defaults to the route');
  assert.equal(provider.baseUrl, base.baseUrl, 'native auth retains its original endpoint context');
}
{
  const { base } = baseProvider();
  assert.throws(() => createMirrorProvider({ baseProvider: {}, mirrorRoute: 'refresh-demo', models }), /stream and streamSimple/);
  assert.throws(() => createMirrorProvider({ baseProvider: base, mirrorRoute: 'bad route', models }), /valid mirrorRoute/);
  assert.throws(() => createMirrorProvider({ baseProvider: base, mirrorRoute: 'refresh-demo', models: [] }), /runtime model array/);
  assert.throws(() => createMirrorProvider({ baseProvider: base, mirrorRoute: 'refresh-demo', models, baseURL: 'file:///x' }), /baseURL/);
}

// --- explicit API-key auth shape -------------------------------------------
{
  const { base } = baseProvider();
  const ambient = createMirrorProvider({ baseProvider: base, mirrorRoute: 'refresh-demo', models });
  assert.equal(ambient.auth, base.auth, 'without an explicit key the base auth is preserved');
  assert.equal(ambient.auth.apiKey.name, 'Demo key');

  const explicit = createMirrorProvider({ baseProvider: base, mirrorRoute: 'refresh-demo', displayName: 'Demo mirror',
    models, useApiKey: true });
  assert.equal(explicit.auth.oauth, base.auth.oauth, 'OAuth declarations survive the added api-key method');
  assert.equal(explicit.auth.apiKey.name, 'Demo mirror');
  const resolved = await explicit.auth.apiKey.resolve({ credential: { key: 'fixture-not-a-real-key' } });
  assert.deepEqual(resolved, { auth: { apiKey: 'fixture-not-a-real-key' }, source: 'Demo mirror' });
  const missing = await explicit.auth.apiKey.resolve({ credential: undefined });
  assert.deepEqual(missing, { auth: {}, source: 'Demo mirror' });
  assert.equal(JSON.stringify(explicit).includes('fixture-not-a-real-key'), false);
  assert.equal(explicit.apiKey, undefined);
}
{
  const noApiKey = { id: 'demo', auth: { oauth: { name: 'oauth only' } },
    stream: () => 'stream', streamSimple: () => 'simple' };
  const provider = createMirrorProvider({ baseProvider: noApiKey, mirrorRoute: 'refresh-demo', models, useApiKey: true });
  assert.equal(typeof provider.auth.apiKey.resolve, 'function');
  assert.deepEqual(provider.auth.oauth, { name: 'oauth only' });
}

// --- profile shaping --------------------------------------------------------
const piProvider = createMirrorProvider({ baseProvider: baseProvider().base, mirrorRoute: 'refresh-demo', models });
{
  const sourceProfile = {
    provider: 'demo', baseURL: 'https://shared.invalid/anthropic', apiKeyEnv: 'FIXTURE_KEY',
    headers: { Authorization: 'Bearer fixture-not-a-real-key', 'X-Trace': '1' },
    timeoutMs: 45_000, websocketConnectTimeoutMs: 9_000, transport: 'sse', reasoning: 'high',
    thinkingBudgets: { low: 1024, high: 8192 }, cacheRetention: 'long', defaultInput: ['text', 'image'],
    defaultContextWindow: 262_144, defaultMaxTokens: 32_768,
    streamIdleTimeoutMs: 123_456, maxRequestImageBytes: 12_345_678,
    requestImagePixelBudget: 2_097_152, requestImageMaxBytes: 524_288,
    retryPolicy: { mode: 'normal', maxRetries: 3 },
    compat: { supportsStore: false }, models: [{ id: 'alpha' }], modelOverrides: { alpha: { name: 'Override' } },
  };
  const profile = createMirrorProfile({ provider: 'refresh-demo', displayName: 'Demo mirror', piProvider,
    models, sourceProfile });
  assert.equal(profile.provider, 'refresh-demo');
  assert.equal(profile.displayName, 'Demo mirror');
  assert.equal(profile.piProvider, piProvider);
  assert.equal(profile.baseURL, 'https://shared.invalid/anthropic');
  assert.equal(profile.apiKeyEnv, 'FIXTURE_KEY');
  assert.equal(profile.streamIdleTimeoutMs, 123_456);
  assert.equal(profile.maxRequestImageBytes, 12_345_678);
  assert.equal(profile.requestImagePixelBudget, 2_097_152);
  assert.equal(profile.requestImageMaxBytes, 524_288);
  assert.equal(profile.timeoutMs, 45_000);
  assert.equal(profile.websocketConnectTimeoutMs, 9_000);
  assert.equal(profile.transport, 'sse');
  assert.equal(profile.reasoning, 'high');
  assert.deepEqual(profile.thinkingBudgets, { low: 1024, high: 8192 });
  assert.equal(profile.cacheRetention, 'long');
  assert.deepEqual(profile.defaultInput, ['text', 'image']);
  assert.equal(profile.defaultContextWindow, 262_144);
  assert.equal(profile.defaultMaxTokens, 32_768);
  assert.deepEqual(profile.retryPolicy, { mode: 'normal', maxRetries: 3 }, 'retryPolicy passes through for the host resolver');
  assert.deepEqual(profile.compat, undefined, 'route compat is the host merge responsibility');
  assert.equal(profile.models, undefined);
  assert.equal(profile.modelOverrides, undefined);
  assert.equal(profile.headers, undefined, 'plaintext request headers never enter profile state');
  assert.equal(JSON.stringify(profile).includes('Bearer'), false);
  assert.equal(JSON.stringify(profile).includes('fixture-not-a-real-key'), false);
  assert.deepEqual([...profile.configuredMaxTokens.entries()], [], 'catalog capacities and source fallbacks are not request defaults');
  assert.equal(profile.piProvider.getModels()[0].maxTokens, 16_000, 'output capability remains in the catalog');
  assert.equal(profile.modelErrors instanceof Map, true);
  assert.equal(profile.modelErrors.size, 0);
}
{
  const profile = createMirrorProfile({ provider: 'refresh-demo', piProvider, models,
    sourceProfile: { apiKeyEnv: 'sk-fixture-not-a-reference', headers: { Authorization: 'Bearer raw' } } });
  assert.equal(profile.displayName, 'refresh-demo');
  assert.equal(profile.streamIdleTimeoutMs, 300_000);
  assert.equal(profile.maxRequestImageBytes, 20_971_520);
  assert.equal(profile.requestImagePixelBudget, 4_194_304);
  assert.equal(profile.requestImageMaxBytes, 1_048_576);
  assert.equal(profile.retryPolicy, undefined);
  assert.equal(profile.configuredMaxTokens.size, 0, 'an unconfigured mirror leaves the request output default unset');
  assert.equal(profile.baseURL, 'https://shared.invalid/anthropic');
  assert.equal(profile.apiKeyEnv, undefined, 'a literal secret is never copied as a credential reference');
  assert.equal(JSON.stringify(profile).includes('raw'), false);
}
{
  // A source endpoint that disagrees with the mirror models is not inherited.
  const profile = createMirrorProfile({ provider: 'refresh-demo', piProvider, models,
    sourceProfile: { baseURL: 'https://elsewhere.invalid/v1' } });
  assert.equal(profile.baseURL, undefined);
  // Divergent model endpoints have no single route-level endpoint.
  const divergent = createMirrorProfile({ provider: 'refresh-demo', piProvider,
    models: [{ ...models[0] }, { ...models[1], baseUrl: 'https://other.invalid/anthropic' }],
    sourceProfile: { baseURL: 'https://shared.invalid/anthropic' } });
  assert.equal(divergent.baseURL, undefined);
}
{
  assert.throws(() => createMirrorProfile({ provider: 'bad route', piProvider, models }), /valid provider route/);
  assert.throws(() => createMirrorProfile({ provider: 'refresh-demo', piProvider: null, models }), /mirror piProvider/);
  assert.throws(() => createMirrorProfile({ provider: 'refresh-demo', piProvider, models: [] }), /runtime model array/);
}

console.log('MIRROR PROVIDER TESTS PASSED: no static host imports, provider structure/delegation, frozen snapshot, explicit API-key auth, profile inheritance/defaults and no header/secret leakage');

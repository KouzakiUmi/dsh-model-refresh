// Explicit installed-library contract test. No plugin mount, user state, network or credentials.
import assert from 'node:assert/strict';
import { loadMirrorContracts, createMirrorCredentialStore } from '../lib/mirror-host.mjs';
import { createMirrorProvider, createMirrorProfile } from '../lib/mirror-provider.mjs';
const entry = process.argv[2];
if (!entry) throw new Error('Usage: node scripts/preflight-mirror-core.mjs <installed DSH consuming entry or dsh-llm-pi-ai/lib/index.js>');
const core = await loadMirrorContracts({ entry });
assert.equal(typeof core.PiAiAdapter, 'function');
assert.ok(core.providers.length > 0);
for (const name of ['getModels', 'resolveRetryPolicy', 'getSupportedThinkingLevels', 'assertUsableApiKey', 'credentialRef', 'launchEnvironmentOf'])
  assert.equal(typeof core[name], 'function', name);
const native = core.getModels('opencode-go');
assert.ok(native.length > 0 && native.every(model => model.id && model.api && model.contextWindow > 0));
assert.equal(typeof core.resolveRetryPolicy(undefined, 'offline fixture'), 'object');
const route = 'refresh-offline-fixture';
const models = [{ id: 'new-fixture', type: 'chat', name: 'Before', api: 'openai-completions', provider: route,
  baseUrl: 'https://fixture.invalid/v1', input: ['text'], reasoning: true, contextWindow: 8192, maxTokens: 1024,
  thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: null },
  compat: { supportsStore: false }, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }];
let dispatched;
const baseProvider = {
  id: 'offline-fixture', auth: {},
  stream() { throw new Error('raw stream must not be used'); },
  streamSimple(model, context, options) {
    dispatched = { model, context, options };
    const message = { role: 'assistant', api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(),
      content: [{ type: 'text', text: 'offline-ok' }], stopReason: 'stop',
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    return (async function* () {
      yield { type: 'text_start', contentIndex: 0, partial: message };
      yield { type: 'text_delta', contentIndex: 0, delta: 'offline-ok', partial: message };
      yield { type: 'text_end', contentIndex: 0, content: 'offline-ok', partial: message };
      yield { type: 'done', reason: 'stop', message };
    })();
  },
};
function profile(rows) {
  const piProvider = createMirrorProvider({ baseProvider, mirrorRoute: route, models: rows, useApiKey: true });
  return { ...createMirrorProfile({ provider: route, piProvider, models: rows,
    sourceProfile: { apiKeyEnv: 'OFFLINE_FIXTURE', reasoning: 'high' } }), headers: { 'x-fixture-source': 'source-value' } };
}
let snapshot = new Map([[route, profile(models)]]);
const credentials = createMirrorCredentialStore(core.LlmError);
const adapter = new core.PiAiAdapter({ profiles: () => snapshot, resolveApiKey: async () => 'offline-fixture-not-a-real-key',
  auth: { credentials, authContext: { env: async () => undefined, fileExists: async () => false } } });
const listing = await adapter.listModels(route);
assert.deepEqual(listing.map(row => row.id), ['new-fixture']);
const resolved = await adapter.resolveModel(route, 'new-fixture');
assert.equal(resolved.context.contextWindow, 8192);
assert.equal(resolved.defaultMaxTokens, undefined, 'catalog capacity is not a configured request default');
assert.ok(resolved.reasoning.efforts.some(row => row.id === 'high'));
assert.equal(resolved.reasoning.defaultEffort, 'high');
const prepared = await adapter.prepareCall(route, 'new-fixture');
snapshot = new Map([[route, profile([{ ...models[0], name: 'After', contextWindow: 16384 }])]]);
assert.equal((await adapter.resolveModel(route, 'new-fixture')).name, 'After');
assert.equal(prepared.model.name, 'Before');
const chunks = await Array.fromAsync(prepared.stream({ provider: route, model: 'new-fixture', maxTokens: 64,
  reasoningEffort: 'high', messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }] }));
assert.equal(dispatched.model.name, 'Before');
assert.equal(dispatched.model.provider, baseProvider.id, 'native driver vendor checks retain the original provider identity');
assert.equal(dispatched.options.apiKey, 'offline-fixture-not-a-real-key');
assert.equal(dispatched.options.maxRetries, 0);
assert.ok(chunks.some(chunk => chunk.type === 'text-delta' && chunk.text === 'offline-ok'));
assert.equal(chunks.at(-1).type, 'finish');
assert.equal(chunks.at(-1).reason.kind, 'stop');
assert.equal(chunks.at(-1).replayState.response.provider, baseProvider.id, 'native identity survives durable protocol replay');
assert.equal(dispatched.options.headers['x-fixture-source'], 'source-value');
assert.ok(Object.keys(dispatched.options.headers).length > 1, 'adapter includes attribution headers besides source headers');
const ambientProvider = createMirrorProvider({ baseProvider: { ...baseProvider, auth: { apiKey: {
  name: 'offline ambient', resolve: async ({ ctx }) => ({ auth: { apiKey: await ctx.env('OFFLINE_AMBIENT') } }),
} } }, mirrorRoute: route, models, useApiKey: false });
const ambientSnapshot = new Map([[route, createMirrorProfile({ provider: route, piProvider: ambientProvider, models, sourceProfile: {} })]]);
const ambientAdapter = new core.PiAiAdapter({ profiles: () => ambientSnapshot, resolveApiKey: async () => undefined,
  auth: { credentials, authContext: { env: async name => { assert.equal(name, 'OFFLINE_AMBIENT'); return 'offline-ambient-not-real'; }, fileExists: async () => false } } });
const ambient = await ambientAdapter.prepareCall(route, 'new-fixture');
const ambientChunks = await Array.fromAsync(ambient.stream({ provider: route, model: 'new-fixture', maxTokens: 64,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'fixture' }] }] }));
assert.equal(dispatched.options.apiKey, 'offline-ambient-not-real', 'native api-key resolution uses the injected host auth context');
assert.equal(ambientChunks.at(-1).reason.kind, 'stop');
console.log('INSTALLED MIRROR CONTRACT PASSED: native peer resolution, model discovery/metadata, snapshot isolation, auth override, stream translation, attribution; no network');

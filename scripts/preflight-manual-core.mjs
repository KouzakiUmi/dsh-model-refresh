// Read-only contract check against an explicitly supplied installed DSH pi-ai plugin.
// No profile, credentials, catalog, network request, or running DSH service is modified.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildProviderProfile } from '../lib/provider-config.mjs';
import { validateManualModel, MANUAL_PROTOCOLS } from '../lib/manual-models.mjs';
const supplied = process.argv[2];
if (!supplied) throw new Error('Usage: node scripts/preflight-manual-core.mjs <installed dsh-llm-pi-ai/lib/index.js>');
const core = await import(pathToFileURL(path.resolve(supplied)).href);
const providers = Object.fromEntries(MANUAL_PROTOCOLS.map((protocol, index) => [`fixture-${index}`, buildProviderProfile({
  models: [validateManualModel({ id: 'manual-fixture', name: 'Manual fixture', protocol, baseUrl: 'https://fixture.invalid/v1',
    contextWindow: 8192, maxTokens: 1024, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high' },
    ...(protocol === 'openai-completions' ? { compat: { supportsStore: false, maxTokensField: 'max_completion_tokens' } } : {}) })]
})]));
let adapter;
const events = new Map();
const ctx = { fiber: { entry: { options: { id: 'fixture-pi' } } }, inject() {}, get() {},
  on(event, fn) { events.set(event, fn); }, logger: { warn() {}, error(error) { throw error; } },
  llm: { registerConfigurableProviders(entries) { for (const entry of entries.filter(e => e.provider.startsWith('fixture-'))) assert.equal(entry.error, undefined); return { replace() {} }; }, registerModelDiscovery() {},
    registerAdapter(_routes, value) { adapter = value; return { replace() {} }; } } };
core.apply(ctx, core.Config({ providers }));
// Exercise strict configuration writes as configEditor does before persistence.
events.get('internal/config').call(ctx.fiber, {}, () => ({ providers }));
for (const provider of Object.keys(providers)) {
  const models = await adapter.listModels(provider);
  assert.equal(models.length, 1);
  assert.equal(models[0].id, 'manual-fixture');
  const info = await adapter.resolveModel(provider, 'manual-fixture');
  assert.ok(info);
}
assert.throws(() => events.get('internal/config').call(ctx.fiber, {}, () => ({ providers: {
  broken: { ...providers['fixture-0'], models: [{ ...providers['fixture-0'].models[0], compat: { unknownField: true } }] }
} })), /compat|unknown/i);
console.log('INSTALLED CORE MANUAL CONTRACT PASSED: three protocols, explicit new IDs, capacity, image, reasoning, strict compatibility validation');

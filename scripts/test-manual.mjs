import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { validateManualModel, validateCompat } from '../lib/manual-models.mjs';
import { buildProviderProfile, changeProvider, providerPreviewHash, recoverProviderTransactions } from '../lib/provider-config.mjs';
import { planRoute } from '../lib/planner.mjs';
import { createHost } from '../lib/index.js';
import { acquireStateLease } from '../lib/host-lease.mjs';
import { synchronizeCatalog } from '../lib/catalog-store.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'dsh-manual-test-'));
let host;
try {
  const model = validateManualModel({ id: 'new', name: 'New', protocol: 'anthropic-messages', baseUrl: 'https://fixture.invalid',
    contextWindow: 8192, maxTokens: 1024, input: ['text', 'image'], reasoningEfforts: { low: 'low', high: 'high' }, compat: { supportsTemperature: false } });
  assert.throws(() => validateManualModel({ ...model, maxTokens: 99999 }));
  assert.throws(() => validateManualModel({ ...model, apiKey: 'secret' }));
  assert.throws(() => validateManualModel({ ...model, baseUrl: 'https://user:password@fixture.invalid' }));
  assert.throws(() => validateManualModel({ ...model, reasoningEfforts: { low: null } }));
  assert.throws(() => validateCompat(JSON.parse('{"__proto__": {"x":1}}')));
  assert.throws(() => validateCompat({ authorization: 'secret' }));
  assert.throws(() => validateManualModel({ ...model, protocol: 'openai-completions' }), /不适用于协议/);
  assert.deepEqual(validateCompat({ chatTemplateKwargs: { enable_thinking: { $var: 'thinking.enabled' } } }).chatTemplateKwargs.enable_thinking, { $var: 'thinking.enabled' });
  const native = { id: 'old', name: 'Old', api: 'anthropic-messages', baseUrl: 'https://fixture.invalid', contextWindow: 8192, maxTokens: 1024 };
  const catalog = { 'anthropic-messages': { old: native } };
  const baseline = { api: native.api, baseURL: native.baseUrl, apiKeyEnv: 'FIXTURE_KEY', modelOverrides: { old: { name: 'User name', compat: { supportsTemperature: true } } } };
  const profile = buildProviderProfile({ before: baseline, models: [model], catalog });
  assert.deepEqual(profile.models.map(m => m.id), ['old', 'new']);
  assert.equal(profile.models[0].name, 'User name');
  assert.equal(profile.apiKeyEnv, 'FIXTURE_KEY');
  assert.equal(profile.modelOverrides, undefined);
  assert.throws(() => buildProviderProfile({ before: { ...baseline, api: 'openai-responses' }, models: [model], catalog }));
  assert.throws(() => buildProviderProfile({ before: { ...baseline, models: { __jsExpr: 'dynamic models' } }, models: [model], catalog }), /静态数组/);
  assert.throws(() => buildProviderProfile({ models: [model, { ...model, id: 'other', baseUrl: 'https://other.invalid' }] }));
  const original = structuredClone(baseline);
  const entry = { options: { name: '@deepseek-ai/dsh-llm-pi-ai', id: 'pi', config: { providers: { demo: baseline, untouched: { apiKeyEnv: 'OTHER_KEY' } } } } };
  const editor = { documentPath: path.join(root, 'profile.patch.yml'), entries: () => [entry], async edit(target, fn) { target.options.config = fn(structuredClone(target.options.config)); } };
  const state = { runtime: {} };
  let fail = false;
  const persist = async () => { if (fail) throw new Error('injected persistence failure'); };
  const args = { editor, namespace: 'pi', route: 'demo', models: [model], catalog, state, stateDir: root, persist };
  const hash = (before, after) => providerPreviewHash('pi', 'demo', before, after);
  await changeProvider({ ...args, expectedHash: hash(baseline, profile) });
  assert.deepEqual(entry.options.config.providers.demo, profile);
  assert.equal(entry.options.config.providers.untouched.apiKeyEnv, 'OTHER_KEY');
  const override = buildProviderProfile({ before: original, models: [{ ...model, id: 'old', compat: {} }], catalog });
  assert.equal(override.models[0].compat.supportsTemperature, true, 'unspecified compatibility preserves original declaration');
  entry.options.config.providers.demo.displayName = 'External edit';
  await assert.rejects(changeProvider({ ...args, revert: true }), /其它设置修改/);
  entry.options.config.providers.demo = structuredClone(profile);
  await changeProvider({ ...args, revert: true });
  assert.deepEqual(entry.options.config.providers.demo, original);
  assert.equal(state.runtime.providerOwned['pi/demo'], undefined);
  // A commit followed by a state failure is recoverable without overwriting the profile.
  fail = true;
  await assert.rejects(changeProvider({ ...args, expectedHash: hash(original, profile) }), /persistence failure/);
  assert.ok((await readdir(path.join(root, 'provider-transactions'))).some(f => f.endsWith('.json')));
  const recovering = { runtime: {} }; fail = false;
  await recoverProviderTransactions({ editor, state: recovering, stateDir: root, persist });
  assert.deepEqual(recovering.runtime.providerOwned['pi/demo'].before, original);
  await changeProvider({ ...args, state: recovering, revert: true });
  await assert.rejects(changeProvider({ ...args, state: recovering, expectedHash: 'stale-preview' }), /预览已变化/);

  const chat = { id: 'chat', mode: 'chat', tool_call: false, limit: { context: 8192, output: 1024 }, modalities: { output: ['text'] } };
  assert.equal(planRoute({ route: 'demo', catalog, source: 'models.dev', metadata: { chat } }).additions.length, 1);
  assert.equal(planRoute({ route: 'demo', catalog, source: 'models.dev', metadata: { chat }, officialConfigured: true }).additions.length, 0,
    'fallback-source candidates still require configured official availability evidence');

  const dataDir = path.join(root, 'data'); await mkdir(dataDir);
  await writeFile(path.join(dataDir, 'demo.json'), JSON.stringify(catalog));
  const protectedState = { routes: [{ route: 'demo' }], runtime: { catalogOwned: {}, catalogRemoved: {}, legacyProtected: { demo: ['old'] } } };
  const protectedResult = await synchronizeCatalog({ dataDir, stateDir: root, route: 'demo', state: protectedState, plan: { removals: ['old'] }, enabled: true, patchCatalog: true, removeStale: true, persist });
  assert.deepEqual(protectedResult.removed, []);
  assert.ok(JSON.parse(await readFile(path.join(dataDir, 'demo.json'), 'utf8'))['anthropic-messages'].old);

  const statePath = path.join(root, 'state.json');
  await writeFile(statePath, JSON.stringify({ version: 3, settings: { autoDiscover: false }, routes: [] }));
  const ctx = { on() {}, inject() {}, get: service => service === 'configEditor' ? editor : undefined, logger: { info() {} } };
  host = createHost(ctx, { dataDir, statePath, initialRefresh: false, fetchFn: async () => { throw new Error('unexpected network'); } });
  await host.ready;
  await assert.rejects(host.saveManual({ route: 'demo', model, expectedRevision: -1 }), e => e.status === 409);
  await host.saveManual({ route: 'demo', model, expectedRevision: host.status().settingsRevision });
  await assert.rejects(host.saveManual({ route: 'demo', model, expectedRevision: host.status().settingsRevision }), e => e.status === 409);
  const preview = await host.providerOperation({ route: 'demo', namespace: 'pi', expectedRevision: host.status().settingsRevision }, 'preview');
  await host.providerOperation({ route: 'demo', namespace: 'pi', previewHash: preview.previewHash, expectedRevision: host.status().settingsRevision }, 'apply');
  assert.ok(host.status().providerApplications['pi/demo']);
  assert.equal(host.status().providerApplications['pi/demo'].before, undefined, 'status does not expose original provider payload');
  await host.providerOperation({ route: 'demo', namespace: 'pi', expectedRevision: host.status().settingsRevision }, 'revert');
  await host.saveManual({ route: 'demo', remove: true, id: model.id, expectedRevision: host.status().settingsRevision });
  assert.deepEqual(host.status().settings.manualModels.demo, []);
  await host.dispose(); host = undefined;
  // Regression: two reclaimers must not both acquire a dead owner's lease.
  const deadPid = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
  assert.ok(deadPid > 0);
  for (let round = 0; round < 8; round++) {
    const file = path.join(root, `lease-${round}.json`);
    await writeFile(`${file}.lock`, JSON.stringify({ pid: deadPid, token: 'dead' }));
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => acquireStateLease(file)));
    const winners = results.filter(r => r.status === 'fulfilled');
    assert.equal(winners.length, 1, 'only one lease may survive concurrent reclamation');
    await winners[0].value();
  }
  console.log('MANUAL TESTS PASSED: validation, native preservation, preview, apply/revert, external conflict, crash journal, source provenance, lifecycle API, legacy protection, concurrent reclaim');
} finally {
  await host?.dispose();
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(root, { recursive: true, force: true });
}

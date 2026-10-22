// Host API regressions: fake credentials/network, isolated files, no installed state.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHost } from '../lib/index.js';
import { catalogHash } from '../lib/catalog-store.mjs';
const root = await mkdtemp(path.join(tmpdir(), 'refresh-discovery-'));
const hosts = [];
let sequence = 0;
const api = 'anthropic-messages';
const native = { id: 'old', type: 'chat', api, baseUrl: 'https://fixture.invalid', contextWindow: 8192, maxTokens: 1024, input: ['text'] };
const catalog = { [api]: { 'chat:old': native } };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(data) });
async function setup({ profile = { api, baseURL: 'https://fixture.invalid', apiKeyEnv: 'FIXTURE_KEY' }, catalogValue = catalog,
  routes = [], runtime = {}, profiles, services = {}, fetchFn = async () => response({ data: [{ id: 'old' }, { id: 'new', reasoning: true }] }), beforeEdit } = {}) {
  // Each scenario finishes before the next; avoid accumulating live process-exit hooks.
  await Promise.all(hosts.splice(0).map(host => host.dispose()));
  const dir = path.join(root, String(++sequence)); const dataDir = path.join(dir, 'data'); await mkdir(dataDir, { recursive: true });
  if (catalogValue !== null) await writeFile(path.join(dataDir, 'demo.json'), JSON.stringify(catalogValue));
  const statePath = path.join(dir, 'state.json');
  await writeFile(statePath, JSON.stringify({ version: 3, settings: { autoDiscover: false, patchCatalog: false }, routes, runtime }));
  const entries = profiles ?? [{ options: { name: '@deepseek-ai/dsh-llm-pi-ai', id: 'pi', config: { providers: { demo: profile } } } }];
  let edits = 0;
  const editor = { entries: () => entries, async edit(entry, change) {
    beforeEdit?.(entry);
    const next = change(structuredClone(entry.options.config));
    entry.options.config = next; edits++;
  } };
  const registered = new Map(); const calls = [];
  const ctx = { logger: { info() {} }, on() {}, get(name) { return name === 'configEditor' ? editor : services[name] ?? (name === 'credentials' ? { resolve: async () => ({ value: 'fixture-credential' }) } : undefined); },
    inject(_deps, apply) { apply({ on() {}, webServer: { port: 39999, register(route) { registered.set(route.path, route.handler); return () => registered.delete(route.path); } } }); } };
  const host = createHost(ctx, { statePath, seedPath: path.join(dir, 'none'), dataDir, initialRefresh: false,
    fetchFn: async (url, init) => { calls.push({ url, init }); return fetchFn(url, init); } });
  hosts.push(host); await host.ready;
  const invoke = async (endpoint, body) => {
    const req = Readable.from([JSON.stringify(body)]); req.method = 'POST'; req.socket = { encrypted: false };
    req.headers = { host: '127.0.0.1:39999', origin: 'http://127.0.0.1:39999', 'content-type': 'application/json' };
    const res = { writeHead(code) { this.code = code; }, end(data) { this.data = JSON.parse(data); this.writableEnded = true; } };
    await registered.get(`/plugins/dsh-model-refresh/${endpoint}`)(req, res); return res;
  };
  return { host, calls, entries, invoke, statePath, dataDir, edits: () => edits };
}
try {
  const test = await setup();
  const discovered = await test.invoke('discover', { route: 'demo', namespace: 'pi' });
  assert.equal(discovered.code, 200); assert.equal(discovered.data.api, api);
  assert.equal(test.calls[0].init.headers['x-api-key'], 'fixture-credential');
  assert.equal(discovered.data.candidates.find(row => row.id === 'old').configured, true, 'implicit catalog models count as configured');
  const adoptBody = { route: 'demo', namespace: 'pi', profileHash: discovered.data.profileHash, ids: ['new', 'new', 'old'], params: { new: { reasoning: true } } };
  const adopted = await test.invoke('adopt', adoptBody);
  assert.equal(adopted.code, 200); assert.deepEqual(adopted.data.adopted, ['new']);
  assert.deepEqual(test.entries[0].options.config.providers.demo.models, [{ id: 'old' }, { id: 'new' }]);
  assert.equal(test.entries[0].options.config.providers.demo.models[1].reasoningEfforts, undefined, 'do not invent wire reasoning levels');
  assert.equal((await test.invoke('adopt', adoptBody)).code, 409, 'stale discovery must not overwrite changed provider config');
  const hash = catalogHash(test.entries[0].options.config.providers.demo);
  assert.equal((await test.invoke('adopt', { ...adoptBody, profileHash: hash, ids: ['__proto__'] })).code, 400);
  assert.equal((await test.invoke('adopt', { ...adoptBody, profileHash: hash, ids: ['other'], params: { other: { input: ['video'] } } })).code, 400);
  assert.equal(test.edits(), 1);

  for (const models of [undefined, []]) {
    const preservation = await setup({ profile: { api, apiKeyEnv: 'FIXTURE_KEY', models, modelOverrides: { old: { name: 'Preserve me', maxTokens: 512 } } } });
    const listing = await preservation.invoke('discover', { route: 'demo' });
    const result = await preservation.invoke('adopt', { route: 'demo', ids: ['new'], profileHash: listing.data.profileHash });
    assert.equal(result.code, 200);
    const changed = preservation.entries[0].options.config.providers.demo;
    assert.deepEqual(changed.models, [{ id: 'old', name: 'Preserve me', maxTokens: 512 }, { id: 'new' }]);
    assert.equal(changed.modelOverrides, undefined, 'migrate overrides instead of leaving an invalid combination');
  }
  const duplicateCatalog = { ...catalog, 'openai-completions': { 'chat:old': { ...native, api: 'openai-completions' } } };
  const duplicates = await setup({ catalogValue: duplicateCatalog });
  const duplicateListing = await duplicates.invoke('discover', { route: 'demo' });
  const duplicateAdoption = await duplicates.invoke('adopt', { route: 'demo', ids: ['new'], profileHash: duplicateListing.data.profileHash });
  assert.equal(duplicateAdoption.code, 200);
  assert.deepEqual(duplicates.entries[0].options.config.providers.demo.models.map(model => model.id), ['old', 'new'], 'flattenInstalled deduplicates native IDs across protocol buckets');

  const explicit = { api, baseURL: 'https://fixture.invalid', apiKeyEnv: 'FIXTURE_KEY', models: [{ id: 'custom', name: 'Keep', compat: { supportsUsage: false } }] };
  const preserving = await setup({ profile: explicit, catalogValue: null });
  const explicitListing = await preserving.invoke('discover', { route: 'demo' });
  const explicitResult = await preserving.invoke('adopt', { route: 'demo', profileHash: explicitListing.data.profileHash, ids: ['custom', 'new'] });
  assert.equal(explicitResult.code, 200);
  assert.deepEqual(preserving.entries[0].options.config.providers.demo.models[0], explicit.models[0]);
  const racing = await setup({ beforeEdit(entry) { entry.options.config.providers.demo.models = 'dynamic expression'; } });
  const raceListing = await racing.invoke('discover', { route: 'demo' });
  assert.equal((await racing.invoke('adopt', { route: 'demo', ids: ['new'], profileHash: raceListing.data.profileHash })).code, 409);
  assert.equal(racing.entries[0].options.config.providers.demo.models, 'dynamic expression');
  assert.equal(racing.edits(), 0);

  let changing;
  changing = await setup({ fetchFn: async () => {
    changing.entries[0].options.config.providers.demo.baseURL = 'https://other.fixture.invalid';
    return response({ data: [{ id: 'new' }] });
  } });
  const beforeDiscovery = structuredClone(changing.entries[0].options.config.providers.demo);
  const changedListing = await changing.invoke('discover', { route: 'demo' });
  assert.equal(changedListing.data.profileHash, catalogHash(beforeDiscovery), 'listing is bound to the immutable config used for its request');
  assert.equal((await changing.invoke('adopt', { route: 'demo', ids: ['new'], profileHash: changedListing.data.profileHash })).code, 409);

  for (const rejectedStatus of [401, 403]) {
    const fallback = await setup({ fetchFn: async (_url, init) => init.headers.authorization ? response({ data: [{ id: 'new' }] }) : response({}, rejectedStatus) });
    const result = await fallback.invoke('discover', { route: 'demo' });
    assert.equal(result.code, 200); assert.equal(result.data.auth, 'bearer'); assert.equal(fallback.calls.length, 2);
  }
  for (const status of [404, 500]) {
    const failed = await setup({ fetchFn: async () => response({}, status) });
    const result = await failed.invoke('discover', { route: 'demo' });
    assert.equal(result.code, 502); assert.equal(failed.calls.length, status === 404 ? 2 : 1);
    assert.ok(failed.calls.every(call => call.init.headers.authorization === undefined), 'non-auth errors never switch auth');
  }
  const noTarget = await setup({ catalogValue: null, profile: { api, apiKeyEnv: 'FIXTURE_KEY', models: [{ id: 'old' }] } });
  assert.equal((await noTarget.invoke('discover', { route: 'demo' })).code, 400);
  assert.equal(noTarget.calls.length, 0, 'no third-party endpoint lookup or credential dispatch');
  const invalidRef = await setup({ profile: { ...explicit, apiKeyEnv: 'not a reference' } });
  assert.equal((await invalidRef.invoke('discover', { route: 'demo' })).code, 400); assert.equal(invalidRef.calls.length, 0);
  const ambient = await setup({ services: { credentials: { resolve: async () => undefined }, launchEnvironment: { get: () => ({ value: 'fixture-launch-value' }) } } });
  assert.equal((await ambient.invoke('discover', { route: 'demo' })).code, 200);
  assert.equal(ambient.calls[0].init.headers['x-api-key'], 'fixture-launch-value');
  const precedence = await setup({ services: { launchEnvironment: { get() { throw new Error('must not read lower-priority source'); } } } });
  assert.equal((await precedence.invoke('discover', { route: 'demo' })).code, 200);
  const typed = await setup({ fetchFn: async () => response({ data: [{ id: 'text-tts-helper' }, { id: 'embed', type: 'embedding' }, { id: 'vision', modalities: { output: ['image'] } }], has_more: true }) });
  const typedResult = await typed.invoke('discover', { route: 'demo' });
  assert.equal(typedResult.data.partial, true);
  assert.deepEqual(typedResult.data.candidates.map(row => row.id), ['text-tts-helper'], 'do not infer type from an ID');
  assert.equal(typedResult.data.filtered.length, 2);

  const profiles = ['first', 'second'].map(id => ({ options: { name: '@deepseek-ai/dsh-llm-pi-ai', id, config: { providers: id === 'second' ? { demo: explicit } : {} } } }));
  const namespaces = await setup({ profiles, routes: [{ route: 'demo', enabled: false, discovered: true }] });
  assert.ok(namespaces.host.status().routes.some(route => route.route === 'demo'), 'routes declared in later entries are not pruned');
  assert.equal((await namespaces.invoke('discover', { route: 'demo' })).code, 400);
  assert.equal((await namespaces.invoke('discover', { route: 'demo', namespace: 'second' })).code, 200);

  const ownership = await setup({ profiles: [], routes: [{ route: 'demo', enabled: false, discovered: true }],
    runtime: { catalogOwned: { demo: [{ id: 'old', group: api, before: null, after: native, revision: catalogHash([]) }] } } });
  assert.equal(ownership.host.status().routes.length, 1, 'undeclared routes with owned catalog work must survive pruning');
  await ownership.host.requestRefresh();
  assert.equal(JSON.parse(await readFile(path.join(ownership.dataDir, 'demo.json'), 'utf8'))[api]['chat:old'], undefined, 'disabled undeclared routes still roll back owned work');
  const pruned = await setup({ profiles: [], routes: [{ route: 'demo', enabled: false, discovered: true }] });
  assert.equal(pruned.host.status().routes.length, 0, 'unowned, disabled, auto-discovered routes may be pruned');

  // Disposal must retain the Host lease while a non-cooperative discovery settles.
  let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; }); const blocked = new Promise(resolve => { finish = resolve; });
  const lifecycle = await setup({ fetchFn: async () => { enter(); await blocked; return response({ data: [{ id: 'new' }] }); } });
  const discovery = lifecycle.invoke('discover', { route: 'demo' }); await entered;
  const disposal = lifecycle.host.dispose();
  assert.ok(await stat(`${lifecycle.statePath}.lock`));
  finish(); await discovery; await disposal;
  await assert.rejects(stat(`${lifecycle.statePath}.lock`), error => error.code === 'ENOENT');
  console.log('DISCOVERY TESTS PASSED: default/explicit preservation, overrides, deduplication, stale edits, auth fallback, safe endpoints, credentials, types, namespaces, disposal');
} finally {
  await Promise.all(hosts.map(host => host.dispose()));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(root, { recursive: true, force: true });
}

// Production mirror Host in isolated fixtures: no host packages, real credentials, catalog or network.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createMirrorHost } from '../lib/mirror-host.mjs';
import { acquireStateLease } from '../lib/host-lease.mjs';
import { inject } from '../lib/index.js';

assert.deepEqual(inject, ['llm'], 'the production plugin waits for the LLM service');
const root = await mkdtemp(path.join(tmpdir(), 'refresh-mirror-host-'));
const hosts = [];
let sequence = 0;
const model = (id, extra = {}) => ({ id, name: id, type: 'chat', provider: 'demo', api: 'openai-completions',
  baseUrl: 'https://trusted.fixture/v1', reasoning: true, thinkingLevelMap: { low: 'low', high: 'high' },
  input: ['text'], contextWindow: 8192, maxTokens: 1024,
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, compat: { supportsStore: false }, ...extra });
class FixtureError extends Error { constructor(message, code) { super(message); this.code = code; } }
class FixtureAdapter {
  constructor(config) { this.config = config; }
  providerInfo(route) { return { id: route, name: this.config.profiles().get(route).displayName }; }
  async listModels(route) {
    const profile = this.config.profiles().get(route);
    await this.config.resolveApiKey(route, profile);
    return profile.piProvider.getModels();
  }
  async prepareCall(route, id) {
    const profile = this.config.profiles().get(route);
    const exact = profile.piProvider.getModels().find(row => row.id === id);
    if (!exact) throw new Error('UNKNOWN_MODEL');
    return { model: exact, stream: async function* () { yield exact.name; } };
  }
}
async function setup({ source, upstream, refreshCatalog, loadContracts, stateDoc, fetchFn, baseId = 'demo', external = [], initialRefresh = true } = {}) {
  const dir = path.join(root, String(++sequence)), statePath = path.join(dir, 'state.json');
  const routes = new Map(), events = new Map(), entries = new Map(external.map(id => [id, { original: true }]));
  const original = entries.get('demo');
  const connections = source ?? { demo: { apiKeyEnv: 'FIXTURE_KEY', baseURL: 'https://trusted.fixture/v1',
    headers: { 'x-fixture-private': 'fixture-private-header' }, compat: { supportsStore: true } } };
  const native = [model('old')];
  let data = upstream ?? { demo: { old: model('old'), new: model('new') } };
  let refreshes = 0, registrations = 0, keyReads = 0, rejectPublish = false, rejectConnections = false;
  const contracts = { PiAiAdapter: FixtureAdapter, providers: [{ id: baseId, name: 'Demo', auth: { apiKey: { name: 'Fixture' } },
    stream() {}, streamSimple() {} }], getModels: () => native,
    LlmError: FixtureError, credentialRef: value => value, assertUsableApiKey: value => value,
    resolveRetryPolicy: policy => ({ mode: 'normal', maxRetries: 5, ...policy }) };
  const ctx = {
    logger: { warn() {} },
    on(name, handler) { const rows = events.get(name) ?? []; rows.push(handler); events.set(name, rows); },
    get(name) {
      if (name === 'credentials') return { resolve: async ref => { assert.equal(ref, 'FIXTURE_KEY'); keyReads++; return { value: 'fixture-private-key' }; } };
    },
    inject(_deps, fn) { fn({ on() {}, webServer: { port: 39999, register(row) { routes.set(row.path, row.handler); return () => routes.delete(row.path); } } }); },
    llm: {
      listProviders: () => [...entries.keys()].map(id => ({ id, name: id })),
      registerAdapter(ids, adapter) {
        registrations++;
        let held = [], released = false;
        const replace = next => {
          assert.equal(released, false);
          if (rejectPublish) { rejectPublish = false; throw new Error('fixture atomic replacement failure'); }
          for (const id of next) if (entries.has(id) && !held.includes(id)) throw new Error('DUPLICATE_ADAPTER');
          for (const id of held) entries.delete(id);
          held = [...next];
          for (const id of held) entries.set(id, adapter);
        };
        replace(ids);
        const dispose = () => { if (released) return; for (const id of held) entries.delete(id); released = true; };
        dispose.replace = replace; return dispose;
      },
    },
  };
  // Seed is supplied through the existing state loader; no production profile is read or edited.
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(dir);
  await writeFile(statePath, JSON.stringify(stateDoc ?? { version: 3, settings: { autoDiscover: true, officialVerify: false },
    routes: [{ route: 'demo', enabled: true }], runtime: {} }));
  const host = createMirrorHost(ctx, { statePath, seedPath: path.join(dir, 'none'), initialRefresh,
    sourceProfiles: () => { if (rejectConnections) throw new Error('fixture source configuration unavailable'); return connections; },
    loadContracts: loadContracts ?? (async () => contracts),
    refreshCatalog: refreshCatalog ?? (async () => { refreshes++; return { package: '@earendil-works/pi-ai', version: '1.2.3',
      checkedAt: new Date().toISOString(), models: data, records: data }; }),
    fetchFn: fetchFn ?? (async () => { throw new Error('unexpected fixture network'); }),
  });
  hosts.push(host);
  const invoke = async (name, body, headers = {}, method = 'POST') => {
    const req = Readable.from([JSON.stringify(body ?? {})]); req.method = method; req.socket = { encrypted: false };
    req.headers = { host: '127.0.0.1:39999', origin: 'http://127.0.0.1:39999', 'content-type': 'application/json', ...headers };
    const res = { writeHead(code) { this.code = code; }, end(text) { this.body = JSON.parse(text); this.writableEnded = true; } };
    await routes.get(`/plugins/dsh-model-refresh/${name}`)(req, res); return res;
  };
  return { host, statePath, dir, routes, entries, original, connections, invoke,
    setData(value) { data = value; }, failNextPublish() { rejectPublish = true; }, failConnections(value) { rejectConnections = value; }, refreshes: () => refreshes, registrations: () => registrations, keyReads: () => keyReads };
}
try {
  const main = await setup({ external: ['demo'] }); await main.host.ready;
  const mirrorAuth = main.entries.get('refresh-demo').config.auth;
  assert.equal(await mirrorAuth.credentials.read('demo'), undefined, 'source grants are not borrowed');
  assert.equal(await mirrorAuth.credentials.read('refresh-demo'), undefined);
  assert.deepEqual(await mirrorAuth.credentials.list(), []);
  let mutated = false;
  await assert.rejects(mirrorAuth.credentials.modify('refresh-demo', () => { mutated = true; }), error => error.code === 'NO_CREDENTIAL_STORE');
  assert.equal(mutated, false, 'unsupported grant writes do not invoke refresh callbacks');
  await assert.rejects(mirrorAuth.credentials.delete('refresh-demo'), error => error.code === 'NO_CREDENTIAL_STORE');
  assert.equal(typeof mirrorAuth.authContext.env, 'function');
  assert.equal(main.host.status().mode, 'mirror');
  assert.equal(main.host.status().routes[0].mirrorRoute, 'refresh-demo');
  assert.equal(main.host.status().routes[0].registered, true);
  assert.equal(main.entries.get('demo'), main.original, 'native provider remains untouched');
  const adapter = main.entries.get('refresh-demo');
  assert.equal(adapter.config.profiles().get('refresh-demo').headers['x-fixture-private'], 'fixture-private-header', 'trusted source headers are inherited only in memory');
  assert.deepEqual((await adapter.listModels('refresh-demo')).map(row => row.id), ['new', 'old']);
  assert.equal(main.keyReads(), 1);
  assert.equal((await adapter.listModels('refresh-demo')).find(row => row.id === 'new').compat.supportsStore, true, 'connection overrides affect the live mirror');
  const firstState = JSON.parse(await readFile(main.statePath, 'utf8'));
  assert.equal(firstState.runtime.mirrorCatalogs.demo.models.find(row => row.id === 'new').compat.supportsStore, false, 'connection overrides do not enter persisted model evidence');
  const prepared = await adapter.prepareCall('refresh-demo', 'new');
  main.setData({ demo: { old: model('old'), new: model('new', { name: 'Updated', contextWindow: 16384 }),
    unsupported: model('unsupported', { api: 'brand-new-wire' }) } });
  await main.host.requestRefresh();
  assert.equal((await adapter.prepareCall('refresh-demo', 'new')).model.name, 'Updated');
  assert.equal(prepared.model.name, 'new', 'prepared calls retain one immutable generation');
  assert.deepEqual(await Array.fromAsync(prepared.stream()), ['new']);
  assert.ok(main.host.status().routes[0].pending.some(row => row.id === 'unsupported'));
  main.setData({ demo: { old: model('old'), later: model('later') } });
  main.failNextPublish();
  await assert.rejects(main.host.requestRefresh(), /atomic replacement failure/);
  assert.equal(main.host.status().routes[0].registered, true);
  assert.equal(main.host.status().routes[0].models, 2, 'failed topology commit cannot publish candidate counts');
  assert.deepEqual((await adapter.listModels('refresh-demo')).map(row => row.id), ['new', 'old']);
  main.failConnections(true);
  await assert.rejects(main.host.requestRefresh(), /source configuration unavailable/);
  assert.match(main.host.status().lastError, /source configuration unavailable/);
  assert.equal(main.host.status().running, false);
  main.failConnections(false);
  delete main.connections.demo.compat;
  main.setData({ demo: { old: model('old') } });
  await main.host.requestRefresh();
  assert.equal((await adapter.prepareCall('refresh-demo', 'new')).model.name, 'Updated', 'a previously published addition survives upstream omission');
  assert.equal((await adapter.prepareCall('refresh-demo', 'new')).model.compat.supportsStore, false, 'removing a source override takes effect even while upstream omits the model');
  const publicStatus = JSON.stringify(main.host.status());
  for (const secret of ['fixture-private-header', 'fixture-private-key']) assert.ok(!publicStatus.includes(secret));
  assert.deepEqual((await readdir(main.dir)).sort(), ['state.json', 'state.json.lock'], 'no catalog, YAML or model artifacts');
  const onDisk = JSON.parse(await readFile(main.statePath, 'utf8'));
  assert.equal(onDisk.runtime.catalogOwned.demo, undefined, 'mirror creates no catalog ownership');
  for (const secret of ['fixture-private-header', 'fixture-private-key']) assert.ok(!JSON.stringify(onDisk).includes(secret), 'state stores no connection secrets');
  onDisk.runtime.mirrorCatalogs.demo.models.find(row => row.id === 'old').name = 'outdated-native-history';
  const restarted = await setup({ stateDoc: onDisk, upstream: { demo: {} } });
  await restarted.host.ready;
  const restartedModels = await restarted.entries.get('refresh-demo').listModels('refresh-demo');
  assert.ok(restartedModels.some(row => row.id === 'new'), 'complete accepted data survives restart and upstream omission');
  assert.equal(restartedModels.find(row => row.id === 'old').name, 'old', 'historical data cannot override the current native baseline');
  await restarted.host.dispose();
  assert.equal((await main.invoke('config', { patchCatalog: true })).code, 400, 'legacy catalog write switches are refused');
  assert.equal((await main.invoke('config', { intervalMinutes: 1 }, { origin: undefined })).code, 403);
  assert.equal((await main.invoke('config', { intervalMinutes: 1, expectedRevision: 999 })).code, 409);
  await main.host.setRoute('demo', false);
  assert.equal(main.entries.has('refresh-demo'), false, 'disable withdraws without waiting for network');
  assert.equal(main.entries.get('demo'), main.original);
  const calls = main.refreshes(); await main.host.requestRefresh(); assert.equal(main.refreshes(), calls);
  await main.host.setRoute('demo', true); await main.host.idle();
  assert.equal(main.entries.has('refresh-demo'), true, 'programmatic enable schedules a runtime rebuild');
  await main.host.dispose(); assert.equal(main.routes.size, 0);
  await assert.rejects(stat(`${main.statePath}.lock`), error => error.code === 'ENOENT');

  const conflict = await setup({ external: ['refresh-demo'] }); await conflict.host.ready;
  assert.equal(conflict.host.status().routes[0].registered, false);
  assert.match(conflict.host.status().routes[0].error, /already owned/);
  assert.equal(conflict.registrations(), 0);
  await conflict.host.dispose();

  const oauth = await setup({ source: { demo: { api: 'new-wire' } } }); await oauth.host.ready;
  assert.equal(oauth.host.status().routes[0].registered, false);
  assert.match(oauth.host.status().routes[0].error, /no installed model baseline/);
  await oauth.host.dispose();

  const broken = await setup({ loadContracts: async () => { throw new Error('fixture import failure'); } });
  await assert.rejects(broken.host.ready, /fixture import failure/);
  await assert.rejects(stat(`${broken.statePath}.lock`), error => error.code === 'ENOENT', 'failed bootstrap releases its lease');
  const diagnostic = await broken.invoke('status', {}, {}, 'GET');
  assert.equal(diagnostic.code, 200); assert.equal(diagnostic.body.degraded, true);
  await broken.host.dispose();

  const legacy = await setup({ refreshCatalog: async () => ({ version: 'legacy', recordsComplete: false,
    records: { demo: { new: model('new') } }, models: { demo: { old: model('old'), new: model('new') } } }) });
  await legacy.host.ready;
  assert.deepEqual((await legacy.entries.get('refresh-demo').listModels('refresh-demo')).map(row => row.id), ['old']);
  assert.equal(legacy.host.status().piAiUpstream.recordsComplete, false);
  assert.ok(legacy.host.status().routes[0].warnings.some(row => row.includes('旧投影')));
  assert.ok(legacy.host.status().routes[0].pending.some(row => row.id === 'new'));
  await legacy.host.dispose();

  let verifiedWithSourceKey = false;
  const officialRef = await setup({ baseId: 'kimi-coding',
    stateDoc: { version: 3, settings: { officialVerify: true }, routes: [{ route: 'demo', as: 'kimi-coding', enabled: true }], runtime: {} },
    fetchFn: async (_url, init) => {
      assert.equal(init.headers.authorization, 'Bearer fixture-private-key'); verifiedWithSourceKey = true;
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'old' }, { id: 'new' }] }) };
    },
    upstream: { 'kimi-coding': { old: model('old'), new: model('new') } },
  });
  await officialRef.host.ready;
  assert.equal(verifiedWithSourceKey, true, 'source key reference takes priority over a built-in guessed default');
  assert.equal(officialRef.host.status().routes[0].official, 'verified');
  assert.equal(officialRef.host.status().routes[0].models, 2);
  await officialRef.host.dispose();

  const invalidHeaders = await setup({ source: { demo: { apiKeyEnv: 'FIXTURE_KEY', headers: { 'x-header': 'secret-value\ninvalid' } } } });
  await invalidHeaders.host.ready;
  assert.equal(invalidHeaders.host.status().routes[0].registered, false);
  assert.ok(!JSON.stringify(invalidHeaders.host.status()).includes('secret-value'));
  await invalidHeaders.host.dispose();

  const multiple = await setup({ external: ['refresh-blocked'], source: { demo: { apiKeyEnv: 'FIXTURE_KEY' }, blocked: { apiKeyEnv: 'FIXTURE_KEY' } },
    stateDoc: { version: 3, settings: { officialVerify: false }, runtime: {}, routes: [
      { route: 'demo', enabled: true }, { route: 'blocked', as: 'demo', enabled: true },
    ] } });
  await multiple.host.ready;
  assert.equal(multiple.host.status().routes.find(row => row.route === 'demo').registered, true);
  assert.equal(multiple.host.status().routes.find(row => row.route === 'blocked').registered, false);
  await multiple.host.dispose();

  let enter, finish;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { finish = resolve; });
  const lifetime = await setup({ initialRefresh: false, refreshCatalog: async () => { enter(); await blocked; return { models: {}, records: {} }; } });
  await lifetime.host.ready;
  const refreshing = lifetime.host.requestRefresh(); await entered;
  const closing = lifetime.host.dispose();
  await assert.rejects(acquireStateLease(lifetime.statePath), /State lock exists/);
  finish(); await assert.rejects(refreshing, /disposed/); await closing;
  const release = await acquireStateLease(lifetime.statePath); await release();
  assert.equal(lifetime.entries.has('refresh-demo'), false);
  console.log('MIRROR HOST TESTS PASSED: independent registration, snapshots, secrets, no catalog/profile writes, conflicts, degraded startup, queue/dispose lease');
} finally {
  await Promise.allSettled(hosts.map(host => host.dispose()));
  assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
  assert.ok(path.basename(root).startsWith('refresh-mirror-host-'));
  await rm(root, { recursive: true, force: true });
}

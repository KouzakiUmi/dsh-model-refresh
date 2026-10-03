// Fully isolated tests: no real network, installed catalog, user state, or process.exit().
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHost, locateCatalogData } from '../lib/index.js';
import { loadState, saveState, validateSettingsPatch, discoverRoutes, STATE_VERSION } from '../lib/state.mjs';
import { readJsonBody, validLocalRequest } from '../lib/host-http.mjs';
import { acquireStateLease } from '../lib/host-lease.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'dsh-model-refresh-host-'));
const controllers = [];
let count = 0;
const baseCatalog = { 'openai-completions': { old: { id: 'old', name: 'Old', api: 'openai-completions', baseUrl: 'http://127.0.0.1:39999/v1', contextWindow: 1000, maxTokens: 100, input: ['text'] } } };
function context() {
  const routes = new Map();
  const handlers = [];
  const web = { port: 39999, register(route) {
    assert.ok(!routes.has(route.path), 'duplicate registration');
    routes.set(route.path, route.handler);
    return () => routes.delete(route.path);
  } };
  return { routes, handlers, logger: { info() {} }, on(event, callback) { if (event === 'dispose') handlers.push(callback); },
    inject(_services, callback) { callback({ webServer: web, on(event, fn) { if (event === 'dispose') handlers.push(fn); } }); }, get() {} };
}
const jsonResponse = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(value) });
async function setup({ settings = {}, routes = [{ route: 'demo', enabled: true }], runtime = {}, fetchFn = async () => jsonResponse({ demo: { models: {} } }), ...options } = {}) {
  const directory = path.join(root, `case-${++count}`);
  const dataDir = path.join(directory, 'data');
  await mkdir(dataDir, { recursive: true });
  for (const route of routes) await writeFile(path.join(dataDir, `${route.route}.json`), JSON.stringify(baseCatalog));
  const statePath = path.join(directory, 'state.json');
  await writeFile(statePath, JSON.stringify({ version: 3, settings: { patchCatalog: false, autoDiscover: false, litellmEnabled: false, ...settings }, routes, runtime }));
  const ctx = context();
  const host = createHost(ctx, { statePath, seedPath: path.join(directory, 'missing-seed.json'), dataDir, fetchFn, initialRefresh: false, ...options });
  controllers.push(host);
  await host.ready;
  return { host, directory, statePath, dataDir, ctx };
}
function req(body, headers = {}, method = 'POST') {
  const request = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]);
  request.headers = { host: '127.0.0.1:39999', origin: 'http://127.0.0.1:39999', 'content-type': 'application/json', ...headers };
  request.socket = { encrypted: false };
  request.method = method;
  return request;
}
async function invoke(ctx, endpoint, body, headers = {}, method = 'POST') {
  const response = { writeHead(code) { this.code = code; }, end(data) { this.data = JSON.parse(data); this.writableEnded = true; } };
  await ctx.routes.get(`/plugins/dsh-model-refresh/${endpoint}`)(req(body, headers, method), response);
  return response;
}
try {
  // Atomic writes snapshot input immediately and use unique temp files.
  const atom = path.join(root, 'atomic.json');
  const value = { n: 1 };
  const first = saveState(atom, value); value.n = 2;
  await Promise.all([first, saveState(atom, value)]);
  assert.equal(JSON.parse(await readFile(atom, 'utf8')).n, 2);
  assert.ok(!(await readdir(root)).some((name) => name.endsWith('.tmp')));

  const legacyFile = path.join(root, 'legacy.json');
  await writeFile(legacyFile, JSON.stringify({ version: 2, settings: { patchCatalog: true, litellmRoutes: { demo: 'vendor' } },
    routes: [{ route: 'demo', enabled: false }], runtime: { running: true, restartRequired: true, catalogPatched: { demo: ['old'] }, catalogRemoved: {} } }));
  const migrated = await loadState(legacyFile);
  assert.equal(migrated.version, STATE_VERSION);
  assert.equal(migrated.settings.patchCatalog, true);
  assert.equal(migrated.settings.litellmRoutes.demo, 'vendor');
  assert.equal(migrated.runtime.running, false);
  assert.equal(migrated.runtime.restartRequired, false);
  assert.deepEqual(migrated.runtime.legacyProtected.demo, ['old']);
  discoverRoutes(migrated, ['new-provider.json', '../escape.json']);
  assert.equal(migrated.routes.find((r) => r.route === 'new-provider').enabled, false);
  assert.ok(!migrated.routes.some((r) => r.route.includes('/')));
  await writeFile(legacyFile, '{invalid');
  await assert.rejects(loadState(legacyFile), /Cannot safely load/);
  assert.equal(await readFile(legacyFile, 'utf8'), '{invalid');
  assert.throws(() => validateSettingsPatch({ intervalMinutes: Infinity }));
  assert.throws(() => validateSettingsPatch({ endpoint: 'http-not-url' }));
  assert.throws(() => validateSettingsPatch({ officialRoutes: { demo: { apiKey: 'secret' } } }));
  assert.throws(() => validateSettingsPatch(JSON.parse('{"officialRoutes":{"__proto__":{}}}')));
  await assert.rejects(locateCatalogData({ explicit: path.join(root, 'does-not-exist') }));

  // No-Origin / cross-scheme / DNS Host CSRF is rejected; object-only and bounded bodies.
  assert.equal(validLocalRequest(req({}), { port: 39999, mutate: true }), true);
  assert.equal(validLocalRequest(req({}, { origin: undefined }), { port: 39999, mutate: true }), false);
  assert.equal(validLocalRequest(req({}, { origin: 'https://127.0.0.1:39999' }), { port: 39999, mutate: true }), false);
  assert.equal(validLocalRequest(req({}, { host: 'evil.example:39999', origin: 'http://evil.example:39999' }), { port: 39999, mutate: true }), false);
  await assert.rejects(readJsonBody(req('null')), /JSON object/);
  await assert.rejects(readJsonBody(req({ x: 'x'.repeat(70_000) })), /too large/);
  await assert.rejects(readJsonBody(req({}, { 'content-type': 'text/plain' })), /application\/json/);

  // All trigger paths coalesce and serialize with configuration changes.
  let releaseFetch;
  let startedFetch;
  const entered = new Promise((resolve) => { startedFetch = resolve; });
  const block = new Promise((resolve) => { releaseFetch = resolve; });
  let requests = 0;
  let timerCallback;
  const queued = await setup({ fetchFn: async () => { requests++; startedFetch(); await block; return jsonResponse({ demo: { models: {} } }); },
    setTimeout(callback) { timerCallback = callback; return { unref() {} }; }, clearTimeout() {} });
  const refresh = queued.host.requestRefresh();
  assert.equal(refresh, queued.host.requestRefresh());
  await entered;
  timerCallback();
  const update = queued.host.updateSettings({ intervalMinutes: 2 });
  assert.equal(queued.host.status().settings.intervalMinutes, 360);
  releaseFetch();
  await Promise.all([refresh, update]);
  assert.equal(requests, 1);
  assert.equal(queued.host.status().settings.intervalMinutes, 2);
  assert.equal(queued.host.status().running, false);
  await assert.rejects(queued.host.updateSettings({ intervalMinutes: 0, patchCatalog: true }), /intervalMinutes/);
  assert.equal(queued.host.status().settings.patchCatalog, false);
  await assert.rejects(queued.host.updateSettings({ intervalMinutes: 3 }, 0), /reload/);
  const forbidden = await invoke(queued.ctx, 'config', { patchCatalog: true }, { origin: undefined });
  assert.equal(forbidden.code, 403);
  const invalid = await invoke(queued.ctx, 'config', 'null');
  assert.equal(invalid.code, 400);
  await queued.host.dispose();
  assert.equal(queued.ctx.routes.size, 0);
  await assert.rejects(stat(`${queued.statePath}.lock`), (error) => error.code === 'ENOENT');
  const restarted = createHost(context(), { statePath: queued.statePath, seedPath: path.join(root, 'none'), dataDir: queued.dataDir,
    initialRefresh: false, fetchFn: async () => jsonResponse({}) });
  controllers.push(restarted); await restarted.ready; await restarted.dispose();

  // Migration backs up the original v2 document before any v3 write.
  const oldDocument = { version: 2, settings: { patchCatalog: false, autoDiscover: false }, routes: [{ route: 'demo', enabled: false }], runtime: {} };
  await writeFile(queued.statePath, JSON.stringify(oldDocument));
  const migrationHost = createHost(context(), { statePath: queued.statePath, seedPath: path.join(root, 'none'), dataDir: queued.dataDir,
    initialRefresh: false, fetchFn: async () => jsonResponse({}) });
  controllers.push(migrationHost); await migrationHost.ready;
  const backupName = (await readdir(queued.directory)).find(name => name.includes('.pre-v3-') && name.endsWith('.bak'));
  assert.ok(backupName);
  assert.deepEqual(JSON.parse(await readFile(path.join(queued.directory, backupName), 'utf8')), oldDocument);
  await migrationHost.dispose();

  // Explicit existing lease is never removed or auto-recovered by a second bootstrap.
  const locked = path.join(root, 'locked-state.json');
  const releaseLock = await acquireStateLease(locked);
  const denied = createHost(context(), { statePath: locked, dataDir: queued.dataDir, initialRefresh: false });
  controllers.push(denied);
  await assert.rejects(denied.ready, /State lock exists/);
  await denied.dispose();
  assert.ok(await stat(`${locked}.lock`));
  await releaseLock();

  // Strict persistence failure neither commits an in-memory configuration nor acknowledges success.
  let failSave = false;
  const failing = await setup({ saveState: (...args) => failSave ? Promise.reject(new Error('simulated disk full')) : saveState(...args) });
  failSave = true;
  const failedSave = await invoke(failing.ctx, 'config', { patchCatalog: true });
  assert.equal(failedSave.code, 500);
  assert.equal(failing.host.status().settings.patchCatalog, false);
  failSave = false; await failing.host.dispose();

  // Main-source outage cannot block official discovery or disabled rollback.
  const official = await setup({ settings: { patchCatalog: true, officialRoutes: { demo: { auth: 'none', endpoint: 'http://127.0.0.1:39999/list', complete: true } } },
    fetchFn: async (url) => {
      if (url.includes('/list')) return jsonResponse({ data: [{ id: 'old' }, { id: 'official-new', mode: 'chat', contextWindow: 2000, maxTokens: 200 }] });
      throw new Error('primary offline');
    } });
  await official.host.requestRefresh();
  assert.ok(JSON.parse(await readFile(path.join(official.dataDir, 'demo.json'), 'utf8'))['openai-completions']['official-new']);
  assert.match(official.host.status().lastError, /primary offline/);
  await official.host.setRoute('demo', false);
  assert.equal(official.host.status().routes[0].enabled, false);
  await official.host.requestRefresh();
  assert.ok(!JSON.parse(await readFile(path.join(official.dataDir, 'demo.json'), 'utf8'))['openai-completions']['official-new']);
  assert.equal(official.host.status().routes[0].rollback, 'complete');
  await official.host.dispose();

  // Discoveries stay pending when catalog writing is off; only on-disk IDs are published.
  const pendingCase = await setup({ fetchFn: async () => jsonResponse({ demo: { models: {
    discovered: { id: 'discovered', name: 'Discovered', limit: { context: 2000, output: 200 }, modalities: { input: ['text'], output: ['text'] } }
  } } }) });
  await pendingCase.host.requestRefresh();
  assert.ok(pendingCase.host.status().routes[0].pending.some((entry) => entry.id === 'discovered' && entry.reason.includes('写入关闭')));
  const pendingArtifact = JSON.parse(await readFile(path.join(pendingCase.directory, 'demo.models.json'), 'utf8'));
  assert.ok(!pendingArtifact.models.some((entry) => entry.id === 'discovered'));
  await pendingCase.host.dispose();

  // Empty models.dev maps permit LiteLLM fallback instead of blocking it.
  const liteCase = await setup({ settings: { litellmEnabled: true, litellmRoutes: { demo: 'vendor' }, litellmUrl: 'http://127.0.0.1:39999/lite' },
    fetchFn: async (url) => jsonResponse(url.includes('/lite')
      ? { 'vendor/old': { mode: 'chat', max_input_tokens: 1000, max_output_tokens: 100 } }
      : { demo: { models: {} } }) });
  await liteCase.host.requestRefresh();
  assert.equal(liteCase.host.status().routes[0].source, 'litellm');
  await liteCase.host.dispose();

  // Logical baseline remembers deletions across rounds; turning the switch off restores once.
  const staleCase = await setup({ settings: { patchCatalog: true, removeStale: true,
    officialRoutes: { demo: { auth: 'none', endpoint: 'http://127.0.0.1:39999/list', complete: true } } },
    runtime: { missing: { demo: { old: { firstSeen: Date.now() - 25 * 3600_000, count: 1 } } } },
    fetchFn: async (url) => jsonResponse(url.includes('/list') ? { data: [{ id: 'different' }] } : { demo: { models: {} } }) });
  await staleCase.host.requestRefresh();
  assert.ok(!JSON.parse(await readFile(path.join(staleCase.dataDir, 'demo.json'), 'utf8'))['openai-completions'].old);
  await staleCase.host.requestRefresh();
  assert.ok(!JSON.parse(await readFile(path.join(staleCase.dataDir, 'demo.json'), 'utf8'))['openai-completions'].old, 'deleted model must not oscillate back');
  await staleCase.host.updateSettings({ removeStale: false });
  await staleCase.host.requestRefresh();
  assert.ok(JSON.parse(await readFile(path.join(staleCase.dataDir, 'demo.json'), 'utf8'))['openai-completions'].old);
  await staleCase.host.dispose();

  // A catalog already committed must persist its ownership even if dispose starts mid-commit.
  let commitCase;
  let commitDisposal;
  const commitSave = async (file, value, options) => {
    if (commitCase && value.runtime.catalogOwned?.demo?.some((record) => record.id === 'new-commit') && options.signal === undefined && !commitDisposal) {
      commitDisposal = commitCase.host.dispose();
    }
    return saveState(file, value, options);
  };
  commitCase = await setup({ settings: { patchCatalog: true }, saveState: commitSave,
    fetchFn: async () => jsonResponse({ demo: { models: { 'new-commit': { id: 'new-commit', mode: 'chat', limit: { context: 2000, output: 200 } } } } }) });
  const committing = commitCase.host.requestRefresh();
  await assert.rejects(committing, /disposed/);
  await commitDisposal;
  const committedState = await loadState(commitCase.statePath);
  assert.ok(committedState.runtime.catalogOwned.demo.some((record) => record.id === 'new-commit'));
  assert.ok(JSON.parse(await readFile(path.join(commitCase.dataDir, 'demo.json'), 'utf8'))['openai-completions']['new-commit']);
  assert.ok(!(await readdir(commitCase.directory)).some((file) => file.endsWith('.models.json')));

  // Aborted in-flight requests settle; no artifacts are written after dispose.
  let markStarted;
  const fetchStarted = new Promise((resolve) => { markStarted = resolve; });
  const cancelling = await setup({ fetchFn: async (_url, { signal }) => {
    markStarted();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  const cancelled = cancelling.host.requestRefresh();
  await fetchStarted;
  await cancelling.host.dispose();
  await assert.rejects(cancelled, /disposed/);
  assert.equal(cancelling.ctx.routes.size, 0);
  assert.ok(!(await readdir(cancelling.directory)).some((name) => name.endsWith('.models.json')));
  const diskState = await loadState(cancelling.statePath);
  assert.equal(diskState.runtime.running, false);
  console.log('HOST TESTS PASSED: migration, atomic persistence, validation, origin/body limits, shared queue/timer coalescing, strict save errors, lease/dispose/restart, official outage fallback, disabled rollback');
} finally {
  await Promise.allSettled(controllers.map((host) => host.dispose()));
  // The only deleted directory is the exact mkdtemp result created by this test.
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
  assert.ok(path.basename(root).startsWith('dsh-model-refresh-host-'));
  await rm(root, { recursive: true, force: true });
}

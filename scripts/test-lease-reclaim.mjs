// Offline: a lease is only ever reclaimed when its recorded owner is provably dead.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHost } from '../lib/index.js';
import { acquireStateLease } from '../lib/host-lease.mjs';

const root = await mkdtemp(path.join(tmpdir(), 'dsh-model-refresh-lease-'));
const lockOf = (state) => `${state}.lock`;
const writeLock = (state, doc) => writeFile(lockOf(state), JSON.stringify(doc));
const deadPid = () => {
  for (const pid of [999999, 999998, 999997, 900001]) {
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return pid; }
  }
  throw new Error('no provably dead PID available for this test');
};
const hostContext = () => {
  const routes = new Map();
  const web = { port: 39999, register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); } };
  return { routes, logger: { info() {} }, on() {}, inject(_services, callback) { callback({ webServer: web, on() {} }); }, get() {} };
};
try {
  // 1) A provably dead owner is reclaimed: the old lock is archived, a fresh one is created.
  const dead = path.join(root, 'dead.json');
  const pid = deadPid();
  await writeLock(dead, { token: 'dead-token', pid, createdAt: new Date().toISOString() });
  const releaseDead = await acquireStateLease(dead);
  const fresh = JSON.parse(await readFile(lockOf(dead), 'utf8'));
  assert.equal(fresh.pid, process.pid);
  assert.notEqual(fresh.token, 'dead-token');
  const archived = (await readdir(root)).filter((name) => name.startsWith('dead.json.lock.stale-') && name.endsWith('.bak'));
  assert.equal(archived.length, 1);
  assert.equal(JSON.parse(await readFile(path.join(root, archived[0]), 'utf8')).token, 'dead-token');
  await releaseDead();
  await assert.rejects(stat(lockOf(dead)), (error) => error.code === 'ENOENT');

  // 2) A live owner keeps the fail-closed behaviour: nothing is archived or replaced.
  const live = path.join(root, 'live.json');
  await writeLock(live, { token: 'live-token', pid: process.pid, createdAt: new Date().toISOString() });
  await assert.rejects(acquireStateLease(live), /State lock exists/);
  assert.equal(JSON.parse(await readFile(lockOf(live), 'utf8')).token, 'live-token');

  // 3) An unreadable or pid-less lock has an unknown owner and is never reclaimed.
  const broken = path.join(root, 'broken.json');
  await writeFile(lockOf(broken), '{not json');
  await assert.rejects(acquireStateLease(broken), /State lock exists/);
  const anonymous = path.join(root, 'anonymous.json');
  await writeLock(anonymous, { token: 'no-pid' });
  await assert.rejects(acquireStateLease(anonymous), /State lock exists/);
  assert.equal(JSON.parse(await readFile(lockOf(anonymous), 'utf8')).token, 'no-pid');

  // 4) Reclaim is opt-out, and the opt-out keeps a single strict attempt.
  const strict = path.join(root, 'strict.json');
  await writeLock(strict, { token: 'dead-token', pid, createdAt: new Date().toISOString() });
  await assert.rejects(acquireStateLease(strict, { reclaimDeadLocks: false }), /State lock exists/);
  assert.equal(JSON.parse(await readFile(lockOf(strict), 'utf8')).token, 'dead-token');

  // 5) Release is idempotent and tolerates a lock that is already gone.
  const gone = path.join(root, 'gone.json');
  const releaseGone = await acquireStateLease(gone);
  await rm(lockOf(gone));
  await releaseGone();
  await releaseGone();

  // 6) Host bootstrap survives a lock left behind by a host that already exited.
  const hostDir = path.join(root, 'host');
  const dataDir = path.join(hostDir, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'demo.json'), JSON.stringify({ 'openai-completions': { old: { id: 'old', name: 'Old', api: 'openai-completions', baseUrl: 'http://127.0.0.1:39999/v1', contextWindow: 1000, maxTokens: 100, input: ['text'] } } }));
  const hostState = path.join(hostDir, 'state.json');
  await writeLock(hostState, { token: 'dead-token', pid, createdAt: new Date().toISOString() });
  const host = createHost(hostContext(), { statePath: hostState, seedPath: path.join(hostDir, 'missing-seed.json'), dataDir,
    initialRefresh: false, fetchFn: async () => { throw new Error('unexpected network access'); } });
  await host.ready;
  assert.equal(JSON.parse(await readFile(lockOf(hostState), 'utf8')).pid, process.pid);
  await host.dispose();
  await assert.rejects(stat(lockOf(hostState)), (error) => error.code === 'ENOENT');

  console.log('LEASE TESTS PASSED: dead-owner reclaim with archive, live owner fail-closed, unreadable/pid-less owner fail-closed, reclaim opt-out, idempotent release, host bootstrap past a stale lock');
} finally {
  await rm(root, { recursive: true, force: true });
}

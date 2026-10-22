import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { synchronizeCatalog, recoverCatalogTransactions, catalogHash } from '../lib/catalog-store.mjs';
const dir = await mkdtemp(path.join(tmpdir(), 'refresh-store-'));
console.log('isolated temp directory:', dir);
try {
  const dataDir = path.join(dir, 'catalog'); await mkdir(dataDir);
  const file = path.join(dataDir, 'test.json');
  const base = { id: 'base', api: 'anthropic-messages', baseUrl: 'https://a', contextWindow: 1000, maxTokens: 100 };
  const original = { 'anthropic-messages': { base } };
  await writeFile(file, JSON.stringify(original));
  const state = { routes: [{ route: 'test' }], runtime: { catalogOwned: {}, catalogRemoved: {}, catalogPatched: {} } };
  const read = async () => JSON.parse(await readFile(file, 'utf8'));
  let persistFail = false;
  const persist = async () => { if (persistFail) throw new Error('injected state failure'); };
  const args = { dataDir, route: 'test', state, stateDir: dir, persist, enabled: true, patchCatalog: true, removeStale: true };
  const entry = { ...base, id: 'new' };
  let result = await synchronizeCatalog({ ...args, plan: { additions: [{ id: 'new', group: base.api, entry }] } });
  assert.deepEqual(result.applied, ['new']);
  assert.equal(state.runtime.catalogOwned.test[0].before, null);
  result = await synchronizeCatalog({ ...args, patchCatalog: false });
  assert.deepEqual(await read(), original, 'disable rolls back owned addition only');
  await synchronizeCatalog({ ...args, plan: { additions: [{ id: 'new', group: base.api, entry }] } });
  const upgraded = await read(); upgraded[base.api].new.contextWindow = 2000;
  await writeFile(file, JSON.stringify(upgraded));
  result = await synchronizeCatalog({ ...args, patchCatalog: false });
  assert.equal(result.conflicts.length, 1);
  assert.equal((await read())[base.api].new.contextWindow, 2000, 'upstream adopted id must never be deleted');
  result = await synchronizeCatalog({ ...args, plan: { removals: ['base'] } });
  assert.deepEqual(result.removed, ['base']);
  assert.equal((await read())[base.api].base, undefined);
  await synchronizeCatalog({ ...args, plan: { removals: [] } });
  assert.deepEqual((await read())[base.api].base, base, 'model reappearance or incomplete evidence restores deletion');
  persistFail = true;
  await assert.rejects(() => synchronizeCatalog({ ...args, plan: { additions: [{ id: 'crash', group: base.api, entry: { ...base, id: 'crash' } }] } }), /state failure/);
  assert.ok((await read())[base.api].crash);
  const recovering = { routes: state.routes, runtime: { catalogOwned: {}, catalogRemoved: {} } };
  persistFail = false;
  await recoverCatalogTransactions({ dataDir, state: recovering, stateDir: dir, persist });
  assert.ok(recovering.runtime.catalogOwned.test.some(r => r.id === 'crash'), 'journal repairs ownership after state write failure');
  state.runtime.catalogPatched.test = ['new']; state.runtime.legacyProtected = { test: ['new'] };
  await synchronizeCatalog({ ...args, enabled: false });
  assert.ok((await read())[base.api].new, 'legacy id-only ledger never grants deletion rights');
  // Cross-protocol duplicate protection during recovery of old removal backup.
  state.runtime.catalogRemoved.test = { new: { group: 'openai-completions', entry: { ...entry, api: 'openai-completions' } } };
  await synchronizeCatalog({ ...args, enabled: false });
  assert.equal((await read())['openai-completions'], undefined);
  await synchronizeCatalog({ ...args, plan: { additions: [{ id: 'adopted', group: base.api, entry: { ...base, id: 'adopted' } }] } });
  await writeFile(path.join(dataDir, '.manifest.json'), JSON.stringify({ generatedAt: 'new-upstream-revision' }));
  result = await synchronizeCatalog({ ...args, patchCatalog: false });
  assert.ok((await read())[base.api].adopted, 'same-content upstream adoption is protected by catalog revision');
  assert.ok(result.conflicts.some(v => v.includes('revision')));
  // Typed catalogs must retain every non-chat row and use the same key format on write.
  const typed = { [base.api]: { 'chat:base': base, 'embedding:base': { id: 'base', type: 'embedding', dimensions: 2048 } },
    'image-generation': { 'image:paint': { id: 'paint', type: 'image', vendor: { untouched: true } } } };
  state.runtime.catalogOwned = {}; state.runtime.catalogRemoved = {};
  await writeFile(file, JSON.stringify(typed));
  await synchronizeCatalog({ ...args, plan: { additions: [{ id: 'new', group: base.api, entry }] } });
  const typedAfter = await read();
  assert.deepEqual(typedAfter[base.api]['embedding:base'], typed[base.api]['embedding:base']);
  assert.deepEqual(typedAfter['image-generation'], typed['image-generation']);
  assert.deepEqual(typedAfter[base.api]['chat:new'], entry);
  assert.equal(typedAfter[base.api].new, undefined);
  await synchronizeCatalog({ ...args, enabled: false });
  assert.deepEqual(await read(), typed, 'rollback restores typed chat rows without touching other kinds');
  persistFail = true;
  await assert.rejects(() => synchronizeCatalog({ ...args, plan: { additions: [{ id: 'new', group: base.api, entry }] } }), /state failure/);
  persistFail = false;
  const typedRecovery = { routes: state.routes, runtime: { catalogOwned: {}, catalogRemoved: {} } };
  const external = await read(); external[base.api]['embedding:base'].dimensions = 4096;
  await writeFile(file, JSON.stringify(external));
  await assert.rejects(() => recoverCatalogTransactions({ dataDir, state: typedRecovery, stateDir: dir, persist }), /transaction conflict/,
    'journal fingerprints include untouched non-chat data');
  external[base.api]['embedding:base'].dimensions = 2048;
  await writeFile(file, JSON.stringify(external));
  await recoverCatalogTransactions({ dataDir, state: typedRecovery, stateDir: dir, persist });
  assert.ok(typedRecovery.runtime.catalogOwned.test.some(record => record.id === 'new'));
  // Historical v1 journals hashed the chat-only shape with non-chat/empty buckets dropped.
  const journalFile = path.join(dir, 'transactions', 'test.json');
  const logicalBefore = { [base.api]: { base } };
  const logicalAfter = { [base.api]: { base, new: entry } };
  for (const committed of [false, true]) {
    const raw = structuredClone(typed);
    if (committed) raw[base.api]['chat:new'] = entry;
    await writeFile(file, JSON.stringify(raw));
    await writeFile(journalFile, JSON.stringify({ version: 1, route: 'test', dataDir: path.resolve(dataDir),
      beforeHash: catalogHash(logicalBefore), afterHash: catalogHash(logicalAfter),
      nextOwned: [{ id: 'new', group: base.api, before: null, after: entry }], nextRemoved: {} }));
    const legacyRecovery = { routes: state.routes, runtime: { catalogOwned: {}, catalogRemoved: {} } };
    await recoverCatalogTransactions({ dataDir, state: legacyRecovery, stateDir: dir, persist });
    assert.equal(legacyRecovery.runtime.catalogOwned.test?.length ?? 0, committed ? 1 : 0);
    assert.deepEqual(await read(), raw, 'v1 recovery must not rewrite chat or non-chat data');
    await assert.rejects(readFile(journalFile), error => error.code === 'ENOENT');
  }
  // Invalid chat keys/buckets must fail closed, not disappear during normalization.
  for (const malformed of [{ [base.api]: { mismatch: base } }, { [base.api]: [] }, { [base.api]: { 'chat:base': base, base } }]) {
    await writeFile(file, JSON.stringify(malformed));
    const text = await readFile(file, 'utf8');
    await assert.rejects(() => synchronizeCatalog({ ...args, plan: {} }), /catalog/);
    assert.equal(await readFile(file, 'utf8'), text);
  }
  console.log('STORE TESTS PASSED');
} finally {
  // dir is verified mkdtemp return; never targets the real catalog or state.
  assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(dir, { recursive: true, force: true });
}

/** 安装目录写入边界：协调锁、写前日志、内容匹配所有权、可恢复提交。 */
import { readFile, writeFile, mkdir, rename, unlink, open } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { validateCatalog } from './planner.mjs';
import { acquireFileLease } from './host-lease.mjs';
const routeOk = route => typeof route === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(route) && !['__proto__', 'constructor', 'prototype'].includes(route);
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const catalogHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const equal = (a, b) => catalogHash(a ?? null) === catalogHash(b ?? null);
export async function writeAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(tmp, 'wx');
    await handle.writeFile(JSON.stringify(value, null, 2), 'utf8');
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(tmp, file);
  } finally { await handle?.close(); await unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
async function lock(file, action) {
  const release = await acquireFileLease(file);
  try { return await action(); } finally { await release(); }
}
function paths(dataDir, stateDir, route) {
  if (!routeOk(route)) throw new Error('unsafe catalog route');
  return { file: path.join(dataDir, `${route}.json`), journal: path.join(stateDir, 'transactions', `${route}.json`),
    lock: path.join(stateDir, 'transactions', `${catalogHash(path.resolve(dataDir)).slice(0, 16)}-${route}.lock`) };
}
async function readCatalog(file) { return validateCatalog(JSON.parse(await readFile(file, 'utf8'))); }
async function catalogRevision(dataDir) {
  const parts = [];
  for (const file of [path.join(dataDir, '.manifest.json'), path.resolve(dataDir, '../../../package.json')]) {
    try { parts.push(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return catalogHash(parts);
}
function valueAt(catalog, record) { return catalog[record.group]?.[record.id] ?? null; }
function hasId(catalog, id) { return Object.values(catalog).some(bucket => Object.hasOwn(bucket, id)); }
function setAt(catalog, record, value) {
  if (value === null) { if (catalog[record.group]) delete catalog[record.group][record.id]; }
  else { catalog[record.group] ??= {}; catalog[record.group][record.id] = structuredClone(value); }
}
async function recoverOne({ dataDir, stateDir, state, persist, route }) {
  const p = paths(dataDir, stateDir, route);
  let journal;
  try { journal = JSON.parse(await readFile(p.journal, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (journal.route !== route || journal.dataDir !== path.resolve(dataDir)) throw new Error(`transaction target mismatch: ${route}`);
  const current = await readCatalog(p.file), hash = catalogHash(current);
  if (hash === journal.afterHash) {
    state.runtime.catalogOwned[route] = journal.nextOwned;
    state.runtime.catalogRemoved[route] = journal.nextRemoved;
    state.runtime.restartRequired = true;
    await persist({ committing: true });
  } else if (hash !== journal.beforeHash) throw new Error(`catalog transaction conflict: ${route}; journal retained for inspection`);
  await unlink(p.journal);
}
export async function recoverCatalogTransactions({ dataDir, state, stateDir, persist }) {
  for (const { route } of state.routes) {
    const p = paths(dataDir, stateDir, route);
    await lock(p.lock, () => recoverOne({ dataDir, state, stateDir, persist, route }));
  }
}
export async function synchronizeCatalog({ dataDir, route, state, runtime = state.runtime, plan = {}, enabled,
  patchCatalog, removeStale, persist, stateDir, signal }) {
  const p = paths(dataDir, stateDir, route);
  return lock(p.lock, async () => {
    signal?.throwIfAborted();
    await recoverOne({ dataDir, state, stateDir, persist, route });
    const before = await readCatalog(p.file), catalog = structuredClone(before);
    const revision = await catalogRevision(dataDir);
    runtime.catalogOwned ??= {};
    runtime.catalogRemoved ??= {};
    const records = runtime.catalogOwned[route] ?? [];
    const nextOwned = [], conflicts = [], applied = [], removed = [], externallyChanged = new Set();
    const active = enabled !== false && patchCatalog === true;
    const removalSet = new Set(active && removeStale ? plan.removals ?? [] : []);
    const legacyRemoved = runtime.catalogRemoved[route] ?? {};
    const nextRemoved = structuredClone(legacyRemoved);
    // v2 删除备份只恢复缺失值；v2 新增台账没有内容指纹，永不凭 ID 删除。
    for (const [id, backup] of Object.entries(legacyRemoved)) {
      if (!hasId(catalog, id) && backup?.entry?.id === id && typeof backup.group === 'string') setAt(catalog, { id, group: backup.group }, backup.entry);
      if (hasId(catalog, id)) delete nextRemoved[id];
      else conflicts.push(`${id}: invalid legacy removal backup`);
    }
    for (const record of records) {
      const current = valueAt(catalog, record);
      if (record.revision !== revision) {
        conflicts.push(`${record.id}: catalog package revision changed; ownership released without overwrite`);
        externallyChanged.add(record.id);
        continue;
      }
      if (!equal(current, record.after)) {
        conflicts.push(`${record.id}: catalog changed externally; ownership released without overwrite`);
        externallyChanged.add(record.id);
        continue;
      }
      const rollback = !active || (record.after === null && !removalSet.has(record.id));
      if (rollback) {
        if (record.before !== null && current === null && hasId(catalog, record.id)) {
          conflicts.push(`${record.id}: protocol moved; old entry not restored`);
        } else setAt(catalog, record, record.before);
      } else nextOwned.push(record);
    }
    if (active) {
      for (const item of plan.additions ?? []) {
        if (hasId(catalog, item.id)) continue;
        if (item.entry?.id !== item.id || item.entry?.api !== item.group) throw new Error('invalid catalog addition');
        setAt(catalog, item, item.entry);
        nextOwned.push({ id: item.id, group: item.group, before: null, after: structuredClone(item.entry), revision });
        applied.push(item.id);
      }
      for (const id of removalSet) {
        if ((runtime.legacyProtected?.[route] ?? []).includes(id)) { conflicts.push(`${id}: legacy ownership is protected`); continue; }
        if (externallyChanged.has(id)) continue;
        for (const [group, bucket] of Object.entries(catalog)) {
          if (!Object.hasOwn(bucket, id)) continue;
          const previous = nextOwned.find(r => r.id === id && r.group === group);
          const original = previous ? previous.before : structuredClone(bucket[id]);
          if (previous) nextOwned.splice(nextOwned.indexOf(previous), 1);
          nextOwned.push({ id, group, before: original, after: null, revision });
          delete bucket[id]; removed.push(id); break;
        }
      }
    }
    validateCatalog(catalog);
    const beforeHash = catalogHash(before), afterHash = catalogHash(catalog);
    if (beforeHash === afterHash) {
      runtime.catalogOwned[route] = nextOwned;
      runtime.catalogRemoved[route] = nextRemoved;
      await persist();
      return { catalog, applied, removed, conflicts, changed: false };
    }
    signal?.throwIfAborted();
    await writeAtomic(p.journal, { version: 1, route, dataDir: path.resolve(dataDir), beforeHash, afterHash,
      nextOwned, nextRemoved, createdAt: new Date().toISOString() });
    // 写前重读，防止未遵守协调锁的安装器/升级器覆盖。外部写者仍需停止才有绝对原子 CAS。
    if (catalogHash(await readCatalog(p.file)) !== beforeHash || await catalogRevision(dataDir) !== revision) throw new Error(`catalog changed before commit: ${route}`);
    signal?.throwIfAborted();
    await writeAtomic(p.file, catalog);
    // 从此完成提交，不因 dispose 中断台账；persist失败保留journal供下次恢复。
    runtime.catalogOwned[route] = nextOwned;
    runtime.catalogRemoved[route] = nextRemoved;
    runtime.restartRequired = true;
    await persist({ committing: true });
    await unlink(p.journal);
    return { catalog, applied, removed, conflicts, changed: true };
  });
}

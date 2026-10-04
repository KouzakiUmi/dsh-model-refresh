/** Apply through the supported profile editor, with a durable journal and conservative rollback. */
import { readFile, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import { catalogHash } from './catalog-store.mjs';
import { atomicWriteJson } from './host-io.mjs';
import { manualProfileModel } from './manual-models.mjs';
const same = (a, b) => catalogHash(a ?? null) === catalogHash(b ?? null);
export function providerTargets(editor) {
  if (!editor?.entries) return [];
  return editor.entries().filter(e => e.options?.name === '@deepseek-ai/dsh-llm-pi-ai').map(e => ({ id: e.options.id }));
}
function entryFor(editor, namespace) {
  const entries = editor?.entries?.().filter(e => e.options?.name === '@deepseek-ai/dsh-llm-pi-ai' && e.options.id === namespace) ?? [];
  if (entries.length !== 1) throw new Error('目标 pi-ai 配置入口不可用；需要支持 configEditor 的 DSH 核心');
  return entries[0];
}
export function buildProviderProfile({ before, models, catalog = {}, apiKeyEnv }) {
  if (!models.length) throw new Error('至少添加一个手动模型');
  const protocols = new Set(models.map(m => m.protocol)), urls = new Set(models.map(m => m.baseUrl));
  if (protocols.size !== 1 || urls.size !== 1) throw new Error('同一 provider 的手动模型必须使用相同协议和端点；其它协议请使用单独 provider');
  const protocol = models[0].protocol, baseURL = models[0].baseUrl;
  const next = structuredClone(before ?? {});
  const native = Object.values(catalog).flatMap(bucket => Object.values(bucket));
  if (before) {
    const apis = new Set(native.map(m => m.api));
    const nativeUrls = new Set(native.map(m => m.baseUrl?.replace(/\/+$/, '')).filter(Boolean));
    if ((before.api ?? (apis.size === 1 ? [...apis][0] : undefined)) !== protocol ||
      (before.baseURL?.replace(/\/+$/, '') ?? (nativeUrls.size === 1 ? [...nativeUrls][0] : undefined)) !== baseURL) {
      throw new Error('目标 provider 的协议或端点不同/不唯一；请新建独立 provider，避免改变已有模型路由');
    }
  } else { next.api = protocol; next.baseURL = baseURL; }
  if (apiKeyEnv) next.apiKeyEnv = apiKeyEnv;
  if (before?.models != null && !Array.isArray(before.models)) throw new Error('目标 models 不是静态数组；请使用独立 provider');
  const baseline = before?.models?.length ? before.models : native.map(m => ({ id: m.id, ...(before?.modelOverrides?.[m.id] ?? {}) }));
  if (!Array.isArray(baseline)) throw new Error('目标 models 不是静态数组；请使用独立 provider');
  const merged = new Map(baseline.map(m => [m.id, structuredClone(m)]));
  for (const m of models) {
    const original = merged.get(m.id) ?? {};
    const declaration = manualProfileModel(m);
    merged.set(m.id, { ...original, ...declaration,
      ...(original.compat || declaration.compat ? { compat: { ...original.compat, ...declaration.compat } } : {}) });
  }
  next.models = [...merged.values()];
  delete next.modelOverrides;
  return next;
}
export const providerPreviewHash = (namespace, route, before, after) => catalogHash({ namespace, route, before, after });
export async function recoverProviderTransactions({ editor, state, stateDir, persist }) {
  const directory = path.join(stateDir, 'provider-transactions');
  let files;
  try { files = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  state.runtime.providerOwned ??= {};
  for (const file of files.filter(file => /^[a-f0-9]{64}\.json$/.test(file))) {
    const journalFile = path.join(directory, file);
    const journal = JSON.parse(await readFile(journalFile, 'utf8'));
    if (journal.key !== `${journal.namespace}/${journal.route}` || file !== `${catalogHash(journal.key)}.json` || journal.documentPath !== editor?.documentPath) throw new Error('配置事务目标不匹配或配置编辑服务不可用');
    const entry = entryFor(editor, journal.namespace);
    const current = entry.options.config?.providers?.[journal.route] ?? null;
    if (same(current, journal.after)) {
      if (journal.owned) state.runtime.providerOwned[journal.key] = journal.owned; else delete state.runtime.providerOwned[journal.key];
      await persist({ committing: true });
    } else if (!same(current, journal.before)) throw new Error('配置事务冲突，保留 journal；请核对目标 provider');
    await unlink(journalFile);
  }
}
export async function changeProvider({ editor, namespace, route, models, apiKeyEnv, catalog, state, stateDir, persist, revert = false, signal, expectedHash }) {
  const entry = entryFor(editor, namespace);
  const key = `${namespace}/${route}`;
  const journalFile = path.join(stateDir, 'provider-transactions', `${catalogHash(key)}.json`);
  state.runtime.providerOwned ??= {};
  await recoverProviderTransactions({ editor, state, stateDir, persist });
  const currentProfile = () => entry.options.config?.providers?.[route] ?? null;
  const owned = state.runtime.providerOwned[key];
  const before = structuredClone(currentProfile());
  if (owned && (!same(before, owned.after) || owned.documentPath !== editor.documentPath)) throw new Error('provider 已被其它设置修改；不覆盖、不撤销外部修改');
  if (revert && !owned) throw new Error('没有可撤销的本插件配置记录');
  const baseline = owned ? owned.before : before;
  const after = revert ? owned.before : buildProviderProfile({ before: baseline, models, apiKeyEnv, catalog });
  if (!revert && expectedHash !== providerPreviewHash(namespace, route, before, after)) throw new Error('provider 或预览已变化，请重新预览后应用');
  const result = { before, after, owned: revert ? null : { before: baseline, after, namespace, route, documentPath: editor.documentPath, appliedAt: new Date().toISOString() } };
  signal?.throwIfAborted();
  await atomicWriteJson(journalFile, { key, namespace, route, documentPath: editor.documentPath, ...result }, { signal });
  await editor.edit(entry, raw => {
    signal?.throwIfAborted();
    const current = raw.providers?.[route] ?? null;
    if (!same(current, before)) throw new Error('provider 在提交前已变化，请重新预览');
    const next = structuredClone(raw);
    next.providers ??= {};
    if (after === null) delete next.providers[route]; else next.providers[route] = structuredClone(after);
    return next;
  });
  if (result.owned) state.runtime.providerOwned[key] = result.owned; else delete state.runtime.providerOwned[key];
  await persist({ committing: true });
  await unlink(journalFile).catch(e => { if (e.code !== 'ENOENT') throw e; });
  return { applied: !revert, reverted: revert, ids: revert ? [] : models.map(m => m.id), namespace, route };
}

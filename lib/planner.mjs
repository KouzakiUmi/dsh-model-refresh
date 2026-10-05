/** 统一决策层：第三方只提供元数据，官方清单只证明存在，不证明推理成功。 */
import { fromModelsDev } from './merge.mjs';
import { buildCatalogEntry, namespacePair } from './catalog-patch.mjs';
import { validModelId } from './official.mjs';
const FIELDS = ['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoning'];
const PROTOCOLS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']);
const own = (o, k) => Object.hasOwn(o ?? {}, k);
const positive = x => Number.isSafeInteger(x) && x > 0;
export function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) throw new Error('catalog must be a protocol object');
  for (const [group, bucket] of Object.entries(catalog)) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) throw new Error(`invalid catalog bucket: ${group}`);
    for (const [id, entry] of Object.entries(bucket)) {
      if (!validModelId(id) || !entry || typeof entry !== 'object' || Array.isArray(entry) || entry.id !== id) throw new Error(`invalid catalog entry: ${group}/${id}`);
    }
  }
  return catalog;
}
export function projectModel(entry) {
  return Object.fromEntries(FIELDS.filter(k => entry[k] !== undefined).map(k => [k, entry[k]]));
}
function indexed(catalog) {
  const map = Object.create(null), duplicates = new Set();
  for (const [group, bucket] of Object.entries(catalog)) for (const [id, entry] of Object.entries(bucket)) {
    if (map[id]) duplicates.add(id);
    else map[id] = { group, entry };
  }
  return { map, duplicates };
}
function cleanMetadata(raw, warnings) {
  const out = Object.create(null);
  for (const [id, md] of Object.entries(raw ?? {})) {
    if (!validModelId(id) || !md || typeof md !== 'object' || md.id !== id) { warnings.push(`invalid metadata id: ${id}`); continue; }
    out[id] = md;
  }
  return out;
}
function routeProtocol(catalog, md, cfg) {
  const groups = Object.keys(catalog).filter(k => Object.keys(catalog[k]).length > 0);
  let group = cfg?.protocol ?? (PROTOCOLS.has(md?.piApi) && (groups.length === 0 || groups.includes(md.piApi)) ? md.piApi : undefined);
  if (!group && groups.length === 1) group = groups[0];
  if (!group && md?.provider?.npm === '@ai-sdk/anthropic' && groups.includes('anthropic-messages')) group = 'anthropic-messages';
  // @ai-sdk/openai 不区分 Responses 与 Completions；多协议目录不猜。
  if (!PROTOCOLS.has(group)) return { reason: '缺少明确的推理协议（多协议或不支持的路由）' };
  const urls = new Set(Object.values(catalog[group] ?? {}).map(v => v.baseUrl).filter(Boolean));
  const baseUrl = cfg?.baseUrl ?? (urls.size === 1 ? [...urls][0] : undefined) ?? md?.piBaseUrl;
  if (!baseUrl) return { reason: '缺少该推理协议的唯一 baseUrl；清单 URL 不等于推理 URL' };
  let parsed;
  try { parsed = new URL(baseUrl); } catch { return { reason: '推理 baseUrl 无效' }; }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return { reason: '推理 baseUrl 无效' };
  return { group, baseUrl };
}
function metadataFor(id, md, official, cfg) {
  const info = official?.models?.[id];
  const model = { ...(md ?? {}), id, name: info?.name ?? md?.name ?? id,
    limit: { context: info?.limit?.context ?? md?.limit?.context ?? cfg?.contextWindow,
      output: info?.limit?.output ?? md?.limit?.output ?? cfg?.maxTokens } };
  if (info?.modalities) model.modalities = info.modalities;
  for (const key of ['mode', 'type', 'tool_call']) if (info?.[key] !== undefined) model[key] = info[key];
  if (typeof info?.reasoning === 'boolean') model.reasoning = info.reasoning;
  else if (typeof cfg?.reasoning === 'boolean' && !md) model.reasoning = cfg.reasoning;
  return model;
}
export function planRoute({ route, catalog, metadata = {}, source = 'none', official,
  metadataSources = {},
  officialConfigured = false, officialConfig = {}, settings = {}, routeConfig = {}, previous = {}, now = Date.now() }) {
  validateCatalog(catalog);
  const { map, duplicates } = indexed(catalog);
  const warnings = [], fresh = Object.create(null), pending = [], additions = [], removals = [], missing = Object.create(null);
  const meta = cleanMetadata(metadata, warnings);
  const diff = { added: [], updated: [], stale: [], excluded: [], unverified: [], pending: [] };
  const keep = new Set(routeConfig.keep ?? []), exclude = new Set(routeConfig.exclude ?? []);
  const evidence = official?.ids instanceof Set ? official : undefined;
  const models = [];
  const candidates = new Set([...Object.keys(meta), ...(evidence?.ids ?? [])]);
  const officialAdded = [];
  const defer = (id, reason) => { pending.push({ id, reason }); diff.pending.push(id); };
  for (const [id, { entry: base }] of Object.entries(map)) {
    if (exclude.has(id)) { diff.excluded.push(id); continue; }
    const entry = projectModel(base);
    if (duplicates.has(id)) warnings.push(`${id}: 多协议重复 ID，保留首个目录条目，不自动修改`);
    const md = meta[id], info = evidence?.models?.[id];
    const converted = fromModelsDev(md), officialFields = fromModelsDev(info);
    // 原生目录优先：第三方只能填空；明确官方字段可更新展示/容量。
    for (const key of FIELDS) {
      if (key === 'id') continue;
      if (entry[key] === undefined && converted?.[key] !== undefined) entry[key] = converted[key];
      if (officialFields?.[key] !== undefined && evidence.ids.has(id)) entry[key] = officialFields[key];
    }
    if (!positive(entry.contextWindow) || !positive(entry.maxTokens) || entry.maxTokens > entry.contextWindow) {
      warnings.push(`${id}: 官方容量字段组合无效，保留已安装容量`);
      entry.contextWindow = base.contextWindow;
      entry.maxTokens = base.maxTokens;
    }
    if (JSON.stringify(entry) !== JSON.stringify(projectModel(base))) diff.updated.push(id);
    if (evidence?.complete === true && !evidence.ids.has(id)) {
      diff.stale.push(id);
      const old = previous.missing?.[id];
      missing[id] = { firstSeen: Number.isFinite(old?.firstSeen) ? old.firstSeen : now,
        count: (Number.isSafeInteger(old?.count) ? old.count : 0) + 1 };
      const namespace = [...candidates].some(a => namespacePair(id, a));
      const ready = missing[id].count >= Math.max(2, settings.staleConfirmations ?? 2)
        && now - missing[id].firstSeen >= Math.max(1, settings.staleGraceHours ?? 24) * 3600_000;
      if (settings.removeStale && !keep.has(id) && !namespace && !duplicates.has(id) && ready) {
        removals.push(id);
        continue;
      }
    } else if (!evidence && !own(meta, id)) {
      // 缺第三方数据不等于下架，无权进入删除计划。
      warnings.push(`${id}: 上游未收录，保留目录`);
    }
    models.push(entry);
  }
  // 拉取失败/部分清单中断连续缺失观察，不能累积删除资格。
  for (const id of candidates) {
    if (own(map, id)) continue;
    if (exclude.has(id)) { diff.excluded.push(id); continue; }
    if (evidence && !evidence.ids.has(id)) { diff.unverified.push(id); continue; }
    if (!evidence && (officialConfigured || !['models.dev', 'pi-ai'].includes(metadataSources[id] ?? source))) { defer(id, '缺少官方可用性确认；不会仅凭模型目录推断套餐支持'); continue; }
    const md = metadataFor(id, meta[id], evidence, officialConfig);
    const nonChat = typeof md.mode === 'string' && !['chat', 'completion', 'reasoning'].includes(md.mode)
      || typeof md.type === 'string' && ['embedding', 'embeddings', 'image', 'image-generation', 'image_generation', 'audio', 'rerank'].includes(md.type);
    if (nonChat || (Array.isArray(md.modalities?.output) && !md.modalities.output.includes('text'))) {
      defer(id, '非聊天/文本输出模型，当前路由不能安全注入'); continue;
    }
    const knownChat = ['chat', 'completion', 'reasoning'].includes(md.mode) || md.tool_call === true
      || md.modalities?.output?.includes('text') || officialConfig.assumeChat === true;
    if (!knownChat) { defer(id, '缺少聊天/文本输出类型依据；需要元数据或显式确认未知模型用途'); continue; }
    if (!positive(md.limit.context) || !positive(md.limit.output) || md.limit.output > md.limit.context) {
      defer(id, '缺少有效容量元数据；请提供该模型容量或明确的路由默认值'); continue;
    }
    if ([...Object.keys(map)].some(old => namespacePair(id, old)) && !evidence?.ids.has(id)) {
      defer(id, '与现有 ID 构成命名空间对应，未确认是真新增'); continue;
    }
    const protocol = routeProtocol(catalog, md, officialConfig);
    if (protocol.reason) { defer(id, protocol.reason); continue; }
    const entry = buildCatalogEntry(route, protocol.group, md);
    entry.baseUrl = protocol.baseUrl;
    fresh[id] = md;
    additions.push({ id, group: protocol.group, entry });
    models.push(projectModel(entry));
    diff.added.push(id);
    if (evidence?.ids.has(id) && !own(meta, id)) officialAdded.push(id);
  }
  for (const key of Object.keys(diff)) diff[key].sort();
  models.sort((a, b) => a.id.localeCompare(b.id));
  return { models, fresh, diff, additions, removals, missing, officialAdded: officialAdded.sort(), pending,
    warnings: [...new Set(warnings)] };
}

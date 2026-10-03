/** 官方模型发现：返回正向证据与完整性，不把鉴权响应当端点验证。 */
export const DEFAULT_OFFICIAL_ROUTES = {
  'kimi-coding': { apiKeyEnv: 'KIMI_CODING_API_KEY', auth: 'bearer' },
  'zai-coding-cn': { apiKeyEnv: 'ZAI_CODING_CN_API_KEY' },
  fireworks: { apiKeyEnv: 'FIREWORKS_API_KEY' },
  together: { apiKeyEnv: 'TOGETHER_API_KEY' },
  'qwen-token-plan': { apiKeyEnv: 'DASHSCOPE_API_KEY' },
  'qwen-token-plan-cn': { apiKeyEnv: 'DASHSCOPE_API_KEY' },
  'qwen-token-plan-individual': { apiKeyEnv: 'DASHSCOPE_API_KEY' },
  'vercel-ai-gateway': { apiKeyEnv: 'VERCEL_AI_GATEWAY_API_KEY' }
};
const error = (code, message) => Object.assign(new Error(message), { code });
const positive = v => Number.isSafeInteger(v) && v > 0 ? v : undefined;
export function catalogBaseUrl(raw) {
  const urls = new Set();
  for (const bucket of Object.values(raw ?? {})) {
    for (const entry of Object.values(bucket ?? {})) {
      if (typeof entry?.baseUrl === 'string' && entry.baseUrl) urls.add(entry.baseUrl.replace(/\/+$/, ''));
    }
  }
  return urls.size === 1 ? [...urls][0] : undefined;
}
export function validModelId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 512 && !/[\x00-\x1f\x7f]/.test(id)
    && !['__proto__', 'prototype', 'constructor'].includes(id);
}
function listingRows(json) {
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.models)) return json.models;
  if (json?.models && typeof json.models === 'object') return Object.entries(json.models).map(([id, v]) => ({ ...v, id: v?.id ?? id }));
  throw error('INVALID_LISTING', '官方返回不是模型清单（需要 data 数组或 models 集合）');
}
export function parseOfficialModels(json) {
  return new Set(listingRows(json).map(item => item?.id ?? item?.name).filter(validModelId));
}
function normalizeModel(item, id) {
  const context = positive(item?.contextWindow ?? item?.context_window ?? item?.context_length ?? item?.max_input_tokens ?? item?.limit?.context);
  const output = positive(item?.max_output_tokens ?? item?.maxOutputTokens ?? item?.maxTokens ?? item?.limit?.output ?? item?.top_provider?.max_completion_tokens);
  const model = { id, name: item?.display_name ?? item?.displayName ?? item?.name ?? id, limit: { context, output } };
  if (typeof item?.mode === 'string') model.mode = item.mode;
  if (typeof item?.type === 'string') model.type = item.type;
  if (typeof item?.tool_call === 'boolean') model.tool_call = item.tool_call;
  if (typeof item?.reasoning === 'boolean') model.reasoning = item.reasoning;
  if (item?.modalities && typeof item.modalities === 'object') model.modalities = item.modalities;
  return model;
}
function checkedUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw error('INVALID_URL', '官方接口 URL 无效'); }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) {
    throw error('INVALID_URL', '携带凭据的官方接口须使用 HTTPS，且 URL 不得含凭据或 fragment');
  }
  return url;
}
/** cfg.endpoint 是明确的列表 URL，不追加路径；否则仅 404 时尝试兼容路径。
 * complete 需用户/适配器明确声明套餐清单全量；分页信号会强制降为部分清单。
 * 无自动重定向，避免凭据发送到其它源；不记录 key 或上游响应正文。
 */
export async function fetchOfficialListing(baseUrl, apiKey, fetchFn, cfg = {}) {
  if (cfg.auth !== 'none' && (typeof apiKey !== 'string' || !apiKey.trim())) throw error('MISSING_KEY', '官方核对缺少凭据');
  const explicit = typeof cfg.endpoint === 'string' && cfg.endpoint.length > 0;
  const root = explicit ? undefined : checkedUrl(baseUrl).href.replace(/\/+$/, '');
  const candidates = explicit ? [checkedUrl(cfg.endpoint).href] : [`${root}/models`];
  if (!explicit && !/\/v\d+$/.test(root)) candidates.push(`${root}/v1/models`);
  for (const endpoint of candidates) {
    checkedUrl(endpoint);
    const headers = { accept: 'application/json' };
    if (cfg.auth === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (cfg.auth !== 'none') headers.authorization = `Bearer ${apiKey.trim()}`;
    const signal = cfg.signal ? AbortSignal.any([cfg.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
    const res = await fetchFn(endpoint, { headers, signal, redirect: 'error' });
    if (res.status === 404) { await res.body?.cancel?.(); continue; }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel?.();
      throw error('INVALID_KEY', `官方清单请求被拒绝 (${res.status})，不能据此证明端点正确`);
    }
    if (!res.ok) { await res.body?.cancel?.(); throw error('HTTP_ERROR', `官方清单请求失败 (${res.status})`); }
    const json = await res.json();
    const rows = listingRows(json);
    const ids = parseOfficialModels(json);
    // 空清单或含无效行不允许负向推断/删除。
    if (ids.size === 0) throw error('EMPTY_LISTING', '官方清单为空，保留原目录');
    const models = Object.fromEntries(rows.filter(v => validModelId(v?.id ?? v?.name)).map(v => {
      const id = v.id ?? v.name;
      return [id, normalizeModel(v, id)];
    }));
    const link = res.headers?.get?.('link') ?? '';
    const partial = /rel\s*=\s*["']?next\b/i.test(link) || json.has_more === true || Boolean(json.next_page || json.next_cursor || json.next || json.links?.next)
      || (Number.isFinite(json.total) && json.total > rows.length)
      || rows.some(v => !validModelId(v?.id ?? v?.name));
    return { ids, models, complete: cfg.complete === true && !partial, endpoint, protocol: cfg.protocol, partial };
  }
  throw error('NOT_FOUND', '官方模型列表候选路径均返回 404；请配置明确的清单 URL');
}
export async function fetchOfficialIds(baseUrl, key, fetchFn, cfg = {}) {
  return (await fetchOfficialListing(baseUrl, key, fetchFn, cfg)).ids;
}
/** 不再从邻居众数猜容量；未知模型需要实际元数据或用户显式默认值。 */
export function officialCapacity(_installed, cfg = {}) {
  return { context: positive(cfg.contextWindow), output: positive(cfg.maxTokens) };
}
export function officialOnlyEntries(installed, fresh, official, exclude, cfg = {}) {
  const entries = Object.create(null), ids = [];
  if (!(official instanceof Set)) return { entries, ids };
  for (const id of official) {
    if (!validModelId(id) || installed?.[id] || fresh?.[id] || exclude?.has(id)) continue;
    entries[id] = { id, name: id, limit: officialCapacity(installed, cfg) };
    if (typeof cfg.reasoning === 'boolean') entries[id].reasoning = cfg.reasoning;
    ids.push(id);
  }
  return { entries, ids: ids.sort() };
}

/**
 * dsh-model-refresh —— 官方接口核对 + 官方补缺（v0.5）。
 *
 * 背景：本插件的核心目标——官方接口已经上了新模型，但 pi-ai 内置数据库
 * （静态快照，上游 models.dev/litellm 滞后）没有数据，模型看不到/用不了。
 * 官方接口（OpenAI 兼容 GET {baseUrl}/models）才是权威存在性清单。
 *
 * 两件事：
 *   1. **核对**（修正上游近似数据源的误判，如 litellm moonshot/* ≠ kimi-coding
 *      套餐）：installed id 官方还在 → 不算 stale；上游新增但官方没有 →
 *      不算 added（diff.unverified 剔除）；
 *   2. **补缺**（核心诉求）：官方列表有、但安装目录与全部上游都没有的 id
 *      → 构造条目注入 fresh，走既有 merge/catalog-patch 链路进列表与
 *      安装树 catalog —— 官方上了新模型，即使内置库全无数据也进得来。
 *      容量策略：route 配置显式值 > 同 route 已有模型的众数 > 保守兜底
 *      （200000/64000）；modalities 保守 text-only（官方 /models 不给能力
 *      字段，宁可少给不可猜多）。
 *
 * 端点：默认从安装目录 catalog 的 baseUrl 派生（OpenAI 兼容惯例 /models）；
 * 凭据：settings 里内置 env 名 → env 取不到时由 Host 走 credentials 服务。
 * 没有 key / 拉取失败 / 无 baseUrl → 该 route 跳过核对（fail-soft，
 * perRoute.official 记状态，设置页标注"未核对"）。
 */

/** route → 官方核对凭据（env 名）。url 默认由 catalog baseUrl + /models 派生。 */
export const DEFAULT_OFFICIAL_ROUTES = {
  "kimi-coding": { apiKeyEnv: "KIMI_CODING_API_KEY" },
  "zai-coding-cn": { apiKeyEnv: "ZAI_CODING_CN_API_KEY" },
  fireworks: { apiKeyEnv: "FIREWORKS_API_KEY" },
  together: { apiKeyEnv: "TOGETHER_API_KEY" },
  "qwen-token-plan": { apiKeyEnv: "DASHSCOPE_API_KEY" },
  "qwen-token-plan-cn": { apiKeyEnv: "DASHSCOPE_API_KEY" },
  "qwen-token-plan-individual": { apiKeyEnv: "DASHSCOPE_API_KEY" },
  "vercel-ai-gateway": { apiKeyEnv: "VERCEL_AI_GATEWAY_API_KEY" }
  // azure-openai-responses：deployment 型，无统一列表端点 —— 不核对
};

/** 从安装目录 route 数据取任一 wire 组条目的 baseUrl（OpenAI 兼容模型列表端点的根）。 */
export function catalogBaseUrl(catalogRaw) {
  if (catalogRaw === null || typeof catalogRaw !== "object") return undefined;
  for (const bucket of Object.values(catalogRaw)) {
    if (bucket === null || typeof bucket !== "object" || Array.isArray(bucket)) continue;
    for (const entry of Object.values(bucket)) {
      if (entry !== null && typeof entry === "object" && typeof entry.baseUrl === "string" && entry.baseUrl.length > 0) {
        return entry.baseUrl;
      }
    }
  }
  return undefined;
}

/** OpenAI 兼容 models 列表响应（{data:[{id}]}）→ id 集合。 */
export function parseOfficialModels(json) {
  const ids = new Set();
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  for (const item of list) {
    const id = item?.id ?? item?.name;
    if (typeof id === "string" && id.length > 0) ids.add(id);
  }
  return ids;
}

/**
 * 拉官方模型列表。
 * @param baseUrl  catalog baseUrl（不带 /models）
 * @param apiKey   Bearer key（undefined 直接抛 MISSING_KEY）
 * @param fetchFn  可注入（测试）；默认走 Host 的代理 fetch（由调用方传入）
 * @returns Promise<Set<string>>；错误原样抛出（调用方 fail-soft）
 */
export async function fetchOfficialIds(baseUrl, apiKey, fetchFn) {
  if (typeof baseUrl !== "string" || baseUrl.length === 0) throw new Error("no baseUrl in catalog");
  if (typeof apiKey !== "string" || apiKey.length === 0) throw Object.assign(new Error("official check: API key not available"), { code: "MISSING_KEY" });
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const res = await fetchFn(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!res.ok) throw new Error(`official models endpoint responded ${res.status} (${url})`);
  const ids = parseOfficialModels(await res.json());
  if (ids.size === 0) throw new Error(`official models endpoint returned no ids (${url})`);
  return ids;
}

/**
 * 官方补缺的容量策略：cfg 显式值 > 同 route 已有模型的**众数** > 保守兜底。
 * 众数取自安装目录（同套餐模型容量通常一致），比全局猜值可靠。
 */
export function officialCapacity(installed, cfg = {}) {
  const pick = (values, fallback) => {
    const counts = new Map();
    let best; let bestN = 0;
    for (const v of values) {
      const n = (counts.get(v) ?? 0) + 1;
      counts.set(v, n);
      if (n > bestN) { bestN = n; best = v; }
    }
    return best ?? fallback;
  };
  const ctxs = [];
  const outs = [];
  for (const base of Object.values(installed ?? {})) {
    if (base === null || typeof base !== "object") continue;
    if (Number.isFinite(base.contextWindow) && base.contextWindow > 0) ctxs.push(base.contextWindow);
    if (Number.isFinite(base.maxTokens) && base.maxTokens > 0) outs.push(base.maxTokens);
  }
  return {
    context: Number.isFinite(cfg.contextWindow) && cfg.contextWindow > 0
      ? cfg.contextWindow : pick(ctxs, 200_000),
    output: Number.isFinite(cfg.maxTokens) && cfg.maxTokens > 0
      ? cfg.maxTokens : pick(outs, 64_000)
  };
}

/**
 * 官方补缺：official 里有、installed 与上游 fresh 都没有的 id → 构造
 * models.dev 形状条目（调用方并入 fresh，走既有 merge + catalog-patch 链路，
 * 从而进模型列表和安装树 catalog —— 这是"官方上了新模型而内置库没有"
 * 场景的完整通路）。
 * @param installed  展平后的安装目录 {id: entry}
 * @param fresh      当前上游数据（models.dev 形状；不修改）
 * @param official   Set<string> 官方可用 id（undefined = 未核对 → 不补）
 * @param exclude    Set<string> route 排除名单
 * @param cfg        officialRoutes 条目（可带 contextWindow/maxTokens 覆盖）
 * @returns {{ entries: object, ids: string[] }} entries 形状同 fresh 条目
 */
export function officialOnlyEntries(installed, fresh, official, exclude, cfg = {}) {
  const entries = {};
  const ids = [];
  if (!(official instanceof Set)) return { entries, ids };
  const caps = officialCapacity(installed, cfg);
  for (const id of official) {
    if (installed?.[id] !== undefined) continue;
    if (fresh?.[id] !== undefined) continue;
    if (exclude instanceof Set && exclude.has(id)) continue;
    entries[id] = {
      id,
      name: id,
      reasoning: cfg.reasoning === true,
      modalities: { input: ["text"], output: ["text"] },
      limit: caps
    };
    ids.push(id);
  }
  ids.sort();
  return { entries, ids };
}

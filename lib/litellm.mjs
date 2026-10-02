/**
 * dsh-model-refresh —— LiteLLM 第二上游适配器（纯函数）。
 *
 * 数据源：BerriAI/litellm 的 model_prices_and_context_window.json（MIT），
 * GitHub raw 直链。用途：models.dev 没有数据的 provider route（fireworks、
 * together、azure-openai-responses、vercel-ai-gateway、zai-coding-cn、
 * qwen-token-plan*、kimi-coding）的元数据补缺。
 *
 * 转换输出** models.dev 形状**（{id, name, reasoning, modalities, limit, cost}），
 * 直接复用 mergeRoute 链路；不猜 wire 协议（litellm 无该信息）——
 * 因此 litellm 来源只做已知 id 的元数据刷新与列表展示，added 不进
 * catalog patch（归组无依据，见 index.js syncCatalog 的 source 参数）。
 *
 * id 对齐：litellm key 形如 "<provider-prefix>/rest..."，剥掉 prefix 后与
 * 安装目录 id 同形态（实测：fireworks_ai/accounts/fireworks/models/x →
 * accounts/fireworks/models/x；vercel_ai_gateway/alibaba/q → alibaba/q）。
 */

/** route → litellm provider 前缀（内置默认；settings.litellmRoutes 可覆盖/追加）。 */
export const DEFAULT_LITELLM_ROUTES = {
  fireworks: "fireworks_ai",
  together: "together_ai",
  "azure-openai-responses": "azure",
  "vercel-ai-gateway": "vercel_ai_gateway",
  "zai-coding-cn": "zai",
  "qwen-token-plan": "dashscope",
  "qwen-token-plan-cn": "dashscope",
  "qwen-token-plan-individual": "dashscope",
  "kimi-coding": "moonshot"
};

/**
 * 从 litellm 原始 JSON 取一个前缀下的全部模型，key 剥掉前缀。
 * @returns {{ id: litellmEntry }} 形如 models.dev 的 models 映射（值仍是 litellm 原始条目）
 */
export function litellmProviderModels(raw, prefix) {
  const out = {};
  if (raw === null || typeof raw !== "object" || typeof prefix !== "string" || prefix.length === 0) return out;
  const head = `${prefix}/`;
  for (const [key, entry] of Object.entries(raw)) {
    if (!key.startsWith(head)) continue;
    const id = key.slice(head.length);
    if (id.length === 0 || entry === null || typeof entry !== "object") continue;
    out[id] = entry;
  }
  return out;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * litellm 条目 → models.dev 形状（mergeRoute/refreshCatalogMetadata 可直接消费）。
 * 缺 context/output 容量返回 undefined（不猜，调用方跳过）。
 * @param id   已剥前缀的 id
 * @param e    litellm 原始条目
 */
export function fromLitellmEntry(id, e) {
  const context = Number.isFinite(e?.max_input_tokens) && e.max_input_tokens > 0
    ? e.max_input_tokens
    : (Number.isFinite(e?.max_tokens) && e.max_tokens > 0 ? e.max_tokens : undefined);
  const output = Number.isFinite(e?.max_output_tokens) && e.max_output_tokens > 0
    ? e.max_output_tokens
    : (Number.isFinite(e?.max_tokens) && e.max_tokens > 0 ? e.max_tokens : undefined);
  if (context === undefined || output === undefined) return undefined;

  const modalities = Array.isArray(e?.input_modalities) ? e.input_modalities : ["text"];
  const entry = {
    id,
    name: typeof e?.model_name === "string" && e.model_name.length > 0 ? e.model_name : id,
    reasoning: e?.mode === "reasoning" || e?.supports_reasoning === true,
    modalities: {
      input: modalities.includes("image") ? ["text", "image"] : ["text"],
      output: ["text"]
    },
    limit: { context, output }
  };
  const cost = {};
  if (Number.isFinite(e?.input_cost_per_token)) cost.input = round6(e.input_cost_per_token * 1e6);
  if (Number.isFinite(e?.output_cost_per_token)) cost.output = round6(e.output_cost_per_token * 1e6);
  if (Number.isFinite(e?.cache_read_input_token_cost)) cost.cache_read = round6(e.cache_read_input_token_cost * 1e6);
  if (Number.isFinite(e?.cache_creation_input_token_cost)) cost.cache_write = round6(e.cache_creation_input_token_cost * 1e6);
  if (Object.keys(cost).length > 0) entry.cost = cost;
  return entry;
}

/**
 * 一个 route 的 litellm 数据 → models.dev 形状的 models 映射（全部转换）。
 * @returns {{ models: object, skipped: string[] }}
 */
export function litellmRouteModels(raw, prefix) {
  const source = litellmProviderModels(raw, prefix);
  const models = {};
  const skipped = [];
  for (const [id, e] of Object.entries(source)) {
    const converted = fromLitellmEntry(id, e);
    if (converted === undefined) { skipped.push(id); continue; }
    models[id] = converted;
  }
  return { models, skipped };
}

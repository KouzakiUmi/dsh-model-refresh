// 官方接口核对 + 官方补缺纯函数测试
import assert from "node:assert";
import {
  DEFAULT_OFFICIAL_ROUTES,
  catalogBaseUrl,
  parseOfficialModels,
  fetchOfficialIds,
  officialCapacity,
  officialOnlyEntries,
} from "../lib/official.mjs";
import { mergeRoute } from "../lib/merge.mjs";

// --- catalog baseUrl 派生（任意 wire 组） ---
const catalogRaw = {
  "anthropic-messages": {
    k3: { id: "k3", api: "anthropic-messages", baseUrl: "https://api.moonshot.cn/v1", contextWindow: 262144, maxTokens: 65536 }
  },
  "openai-completions": {
    "kimi-for-coding": { id: "kimi-for-coding", api: "openai-completions", baseUrl: "https://api.moonshot.cn/v1", contextWindow: 131072, maxTokens: 32768 }
  }
};
assert.strictEqual(catalogBaseUrl(catalogRaw), "https://api.moonshot.cn/v1");
assert.strictEqual(catalogBaseUrl({ g: { x: { id: "x" } } }), undefined, "无 baseUrl 返回 undefined");
console.log("catalogBaseUrl ok");

// --- OpenAI 兼容响应解析（两种形状 + 容错） ---
assert.deepStrictEqual(
  [...parseOfficialModels({ data: [{ id: "a" }, { id: "b" }, { id: "a" }] })].sort(),
  ["a", "b"]
);
assert.deepStrictEqual([...parseOfficialModels({ models: [{ name: "m1" }] })], ["m1"]);
assert.strictEqual(parseOfficialModels({ data: [] }).size, 0);
console.log("parseOfficialModels ok");

// --- fetchOfficialIds：注入 fetch（URL、Bearer、错误路径） ---
const calls = [];
const okFetch = async (url, init) => {
  calls.push({ url, init });
  return { ok: true, json: async () => ({ data: [{ id: "new-model" }, { id: "k3" }] }) };
};
const ids = await fetchOfficialIds("https://api.x.cn/v1", "sk-test", okFetch);
assert.deepStrictEqual([...ids].sort(), ["k3", "new-model"]);
assert.strictEqual(calls[0].url, "https://api.x.cn/v1/models", "尾斜杠归一 + /models");
assert.strictEqual(calls[0].init.headers.authorization, "Bearer sk-test");
await assert.rejects(() => fetchOfficialIds("https://x.cn/v1", undefined, okFetch),
  (e) => e.code === "MISSING_KEY", "缺 key 抛 MISSING_KEY");
await assert.rejects(() => fetchOfficialIds("https://x.cn/v1", "k", async () => ({ ok: false, status: 401 })));
console.log("fetchOfficialIds ok");

// --- 容量众数策略 ---
const installed = {
  a: { contextWindow: 262144, maxTokens: 65536 },
  b: { contextWindow: 262144, maxTokens: 65536 },
  c: { contextWindow: 131072, maxTokens: 32768 },
};
assert.deepStrictEqual(officialCapacity(installed, {}), { context: 262144, output: 65536 }, "取众数");
assert.deepStrictEqual(officialCapacity(installed, { contextWindow: 200000, maxTokens: 64000 }),
  { context: 200000, output: 64000 }, "cfg 显式优先");
assert.deepStrictEqual(officialCapacity({}, {}), { context: 200000, output: 64000 }, "空目录走兜底");
console.log("officialCapacity ok");

// --- 官方补缺：官方有、目录与上游都没有 → 注入；已有的不重复；exclude 豁免 ---
const fresh = { "kimi-k3": { id: "kimi-k3", limit: { context: 1, output: 1 }, modalities: { input: ["text"], output: ["text"] } } };
const official = new Set(["k3", "kimi-k3", "k4-fresh", "excluded-one"]);
const only = officialOnlyEntries(
  { k3: installed.a }, fresh, official, new Set(["excluded-one"]), { contextWindow: 200000 }
);
assert.deepStrictEqual(only.ids, ["k4-fresh"], "只补 官方有+目录无+上游无+未排除 的 id");
assert.strictEqual(only.entries["k4-fresh"].limit.context, 200000, "cfg 覆盖容量");
assert.strictEqual(only.entries["k4-fresh"].limit.output, 65536, "众数容量");
assert.deepStrictEqual(only.entries["k4-fresh"].modalities.input, ["text"], "能力保守 text-only");
const none = officialOnlyEntries({}, fresh, undefined, new Set(), {});
assert.deepStrictEqual(none.ids, [], "未核对不补");
console.log("officialOnlyEntries ok");

// --- mergeRoute official 语义：翻案 stale + 剔除幽灵 added ---
const installedMap = { "k3": { id: "k3", name: "K3", contextWindow: 262144, maxTokens: 65536 } };
const freshMap = {
  "ghost-model": { id: "ghost-model", name: "Ghost", limit: { context: 100, output: 10 } },
  "real-new": { id: "real-new", name: "Real", limit: { context: 100, output: 10 } },
};
const officialSet = new Set(["k3", "real-new"]);
const merged = mergeRoute(installedMap, freshMap, { official: officialSet });
const mIds = merged.models.map((m) => m.id);
assert.ok(mIds.includes("k3"), "官方确认存在 → 保留");
assert.deepStrictEqual(merged.diff.stale, [], "官方确认存在 → 不算 stale（k3 不在 fresh）");
assert.ok(mIds.includes("real-new") && merged.diff.added.includes("real-new"));
assert.deepStrictEqual(merged.diff.unverified, ["ghost-model"], "官方没有的幽灵新增被剔除");
assert.ok(!mIds.includes("ghost-model"));

// 无 official 时保持纯上游语义
const noVerify = mergeRoute(installedMap, freshMap, {});
assert.deepStrictEqual(noVerify.diff.stale, ["k3"], "未核对 → 上游语义照旧");
assert.deepStrictEqual(noVerify.diff.unverified, []);
console.log("merge official semantics ok");

// --- 内置表覆盖全部 litellm 补缺 route，排除无端点的 azure ---
for (const r of ["kimi-coding", "zai-coding-cn", "fireworks", "together",
  "qwen-token-plan", "qwen-token-plan-cn", "qwen-token-plan-individual", "vercel-ai-gateway"]) {
  assert.ok(typeof DEFAULT_OFFICIAL_ROUTES[r]?.apiKeyEnv === "string", `${r} 应有官方核对配置`);
}
assert.ok(DEFAULT_OFFICIAL_ROUTES["azure-openai-responses"] === undefined, "azure 无统一列表端点");
console.log("DEFAULT_OFFICIAL_ROUTES ok");

console.log("ALL OFFICIAL TESTS PASSED");

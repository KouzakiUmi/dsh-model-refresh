// LiteLLM 第二上游适配器纯函数测试（含真实网络：与安装目录 id 对齐验证）
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  DEFAULT_LITELLM_ROUTES,
  litellmProviderModels,
  fromLitellmEntry,
  litellmRouteModels,
} from "../lib/litellm.mjs";

// --- 前缀过滤与剥离 ---
const raw = {
  "fireworks_ai/accounts/fireworks/models/deepseek-v4-flash-0731": {
    mode: "chat", max_input_tokens: 131072, max_output_tokens: 16384,
    input_cost_per_token: 0.0000009, output_cost_per_token: 0.0000012,
    input_modalities: ["text"],
  },
  "fireworks_ai/WhereIsAI/UAE-Large-V1": {
    mode: "embedding", max_tokens: 512,
  },
  "together_ai/Qwen/Qwen2.5-7B-Instruct-Turbo": {
    mode: "chat", max_input_tokens: 32768, max_output_tokens: 8192,
    input_cost_per_token: 0.0000001, output_cost_per_token: 0.0000001,
  },
  "azure/gpt-4": { mode: "chat", max_input_tokens: 128000, max_output_tokens: 32768 },
  "openai/gpt-4o": { mode: "chat", max_input_tokens: 128000, max_output_tokens: 16384 },
};

const fw = litellmProviderModels(raw, "fireworks_ai");
assert.deepStrictEqual(Object.keys(fw).sort(),
  ["WhereIsAI/UAE-Large-V1", "accounts/fireworks/models/deepseek-v4-flash-0731"],
  "剥前缀后保留剩余斜杠段");
assert.deepStrictEqual(litellmProviderModels(raw, "no-such"), {});
console.log("litellmProviderModels ok");

// --- 条目转换：models.dev 形状、cost ×1e6、缺容量返回 undefined ---
const c = fromLitellmEntry("accounts/fireworks/models/deepseek-v4-flash-0731", fw["accounts/fireworks/models/deepseek-v4-flash-0731"]);
assert.strictEqual(c.id, "accounts/fireworks/models/deepseek-v4-flash-0731");
assert.strictEqual(c.limit.context, 131072);
assert.strictEqual(c.limit.output, 16384);
assert.strictEqual(c.cost.input, 0.9);       // $/1M tokens
assert.strictEqual(c.cost.output, 1.2);
assert.deepStrictEqual(c.modalities.input, ["text"]);
assert.strictEqual(c.reasoning, false);
assert.strictEqual(fromLitellmEntry("no-limit", { mode: "chat" }), undefined, "缺容量的条目跳过");
const embedding = fromLitellmEntry("x", { mode: "embedding", max_tokens: 512 });
assert.strictEqual(embedding.limit.context, 512, "无 max_input_tokens 时回退 max_tokens");
assert.strictEqual(embedding.limit.output, 512);
console.log("fromLitellmEntry ok");

const { models: rtModels, skipped } = litellmRouteModels(raw, "fireworks_ai");
assert.strictEqual(Object.keys(rtModels).length, 2, "两条 fireworks 条目都应转换成功");
assert.deepStrictEqual(skipped, []);
console.log("litellmRouteModels ok:", JSON.stringify(skipped));

// --- 内置映射覆盖了全部 LiteLLM 可补的缺口 route ---
for (const r of ["fireworks", "together", "azure-openai-responses", "vercel-ai-gateway",
  "zai-coding-cn", "qwen-token-plan", "qwen-token-plan-cn", "qwen-token-plan-individual", "kimi-coding"]) {
  assert.ok(typeof DEFAULT_LITELLM_ROUTES[r] === "string", `route ${r} 应有 litellm 映射`);
}
for (const r of ["ant-ling", "radius", "openai-codex"]) {
  assert.ok(DEFAULT_LITELLM_ROUTES[r] === undefined, `route ${r} 无公开数据源，不应有映射`);
}
console.log("DEFAULT_LITELLM_ROUTES mapping ok");

// --- 真实网络：litellm id 与安装目录 id 对齐（关键回归：前缀剥离正确） ---
const res = await fetch("https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
  { signal: AbortSignal.timeout(60_000) });
const remote = await res.json();
const dir = "C:/Program Files/DSH NEXT/resources/app/node_modules/@earendil-works/pi-ai/dist/providers/data";
const catalogFireworks = JSON.parse(readFileSync(`${dir}/fireworks.json`, "utf8"));
const catIds = new Set();
for (const g of Object.values(catalogFireworks)) Object.keys(g).forEach((id) => catIds.add(id));

const live = litellmRouteModels(remote, DEFAULT_LITELLM_ROUTES.fireworks).models;
const aligned = Object.keys(live).filter((id) => catIds.has(id));
assert.ok(aligned.length >= 5,
  `litellm 剥前缀后应与安装目录 id 对齐（对齐 ${aligned.length} 个，样本：${aligned.slice(0, 5).join(", ")}）`);
console.log(`real-network id alignment ok: ${aligned.length} litellm ids match the installed catalog`);

console.log("ALL LITELLM TESTS PASSED");

// 工作区验证：合并核心 ×（本机安装 catalog × models.dev 实测样本）
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { flattenInstalled, mergeRoute, fromModelsDev, toYamlFragment } from "../lib/merge.mjs";

// 1) 固定基线：pi-ai 0.87.1 原始 opencode-go 快照（npm 包提取，30 条）。
//    不读实时安装目录——插件 patch 后 gpt-6-luna 等不再是“新增”，断言会漂移。
//    （pi-ai 升级时替换 .orig-opencode-go.json 并同步期望值。）
const installed = flattenInstalled(JSON.parse(readFileSync(new URL("../.orig-opencode-go.json", import.meta.url), "utf8")));
console.log("installed ids:", Object.keys(installed).length);

// 2) models.dev 实测样本（2026-10-02 抓取的 opencode-go 33 条中挑选，
//    覆盖：已存在需刷新 / 全新 / provider-specific）
const fresh = {
  "minimax-m3": { id: "minimax-m3", name: "MiniMax-M3", reasoning: true, tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 131072 }, cost: { input: 0.3, output: 1.2 } },
  "gpt-6-luna": { id: "gpt-6-luna", name: "GPT-6 Luna", reasoning: true, tool_call: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1050000, output: 128000 }, cost: { input: 0.1, output: 0.5 } },
  "grok-4.5": { id: "grok-4.5", name: "Grok 4.5", reasoning: true, tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 500000, output: 500000 }, cost: { input: 2, output: 6 } },
  "space-bunny-free": { id: "space-bunny-free", name: "Space Bunny Free", reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1048576, output: 524288 } },
  "glm-5.2": { id: "glm-5.2", name: "GLM-5.2", reasoning: true, tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 131072 }, cost: { input: 1.4, output: 4.4 } },
  "no-limit-model": { id: "no-limit-model", name: "No Limit" } // 无容量 → 应被跳过
};

// --- 单元：fromModelsDev ---
const converted = fromModelsDev(fresh["gpt-6-luna"]);
assert.deepStrictEqual(converted, {
  id: "gpt-6-luna", name: "GPT-6 Luna", contextWindow: 1050000, maxTokens: 128000, input: ["text"], reasoning: true
});
console.log("fromModelsDev ok:", JSON.stringify(converted));

// --- 合并：全量 installed + 样本 fresh ---
const { models, diff } = mergeRoute(installed, fresh, { keep: [], exclude: ["space-bunny-free"] });
const byId = new Map(models.map((m) => [m.id, m]));

// 已存在条目只投影 route 允许字段：vendor 级字段（api/baseUrl/compat 等）
// 全部不进产物，由 llm-pi-ai 从安装目录/route 继承（compat 进 route 会报配置校验错）
const minimax = byId.get("minimax-m3");
assert.strictEqual(minimax.contextWindow, 1000000);
assert.strictEqual(minimax.api, undefined);
assert.strictEqual(minimax.baseUrl, undefined);
assert.strictEqual(minimax.compat, undefined);
console.log("vendor fields stripped for known id ok");

// 新 id：无 api/baseUrl（route 继承），带容量
const luna = byId.get("gpt-6-luna");
assert.ok(luna.api === undefined && luna.contextWindow === 1050000);
console.log("new id entry ok:", JSON.stringify(luna));

// exclude 生效；无容量新 id 跳过；stale 检出（glm-5.1 上游已移除、样本未含全部上游 id）
assert.ok(!byId.has("space-bunny-free"));
assert.ok(!byId.has("no-limit-model"));
assert.ok(diff.stale.includes("glm-5.1"));
assert.deepStrictEqual(diff.added, ["gpt-6-luna", "grok-4.5"]);
console.log("exclude / no-capacity skip / stale ok:", JSON.stringify(diff));

// 顺序稳定
const ids = models.map((m) => m.id);
assert.deepStrictEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
console.log("sort ok; total models:", ids.length);

// YAML 片段可读
const yaml = toYamlFragment("opencode-go", models.slice(0, 2));
console.log("--- yaml sample ---\n" + yaml);

// 3) 真实安装数据 + 全量在线样本的结构冒烟（用真实文件再跑一次空 fresh）
const empty = mergeRoute(installed, {}, {});
assert.strictEqual(empty.models.length, Object.keys(installed).length);
assert.strictEqual(empty.diff.added.length, 0);
console.log("empty-fresh passthrough ok:", empty.models.length, "models");

console.log("\nALL MERGE TESTS PASSED");

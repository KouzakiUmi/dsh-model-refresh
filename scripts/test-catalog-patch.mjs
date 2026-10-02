// catalog patch / metadata / rollback 纯函数回归
// （含 2026-10-03 事故防回归：patch 不得把已有 wire-protocol 组重置）
import assert from "node:assert";
import { applyCatalogPatch, rollbackCatalogPatch, refreshCatalogMetadata, groupOf } from "../lib/catalog-patch.mjs";

// 形态照真实 opencode-go.json：{wire-protocol: {modelId: entry}}
const original = {
  "anthropic-messages": {
    "mm-3": { id: "mm-3", name: "MM3", api: "anthropic-messages", contextWindow: 100, maxTokens: 10 }
  },
  "openai-responses": {
    "gpt-5": { id: "gpt-5", name: "GPT-5", api: "openai-responses", contextWindow: 200, maxTokens: 20 },
    "gpt-5b": { id: "gpt-5b", name: "GPT-5b", api: "openai-responses", contextWindow: 210, maxTokens: 21 }
  }
};

const fresh = {
  "gpt-6": { id: "gpt-6", name: "GPT-6", provider: { npm: "@ai-sdk/openai" },
    modalities: { input: ["text"], output: ["text"] }, limit: { context: 300, output: 30 } },
  "mm-3": { id: "mm-3", name: "MiniMax M3 v2", reasoning: true,
    modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 111, output: 11 } }
};

// --- applyCatalogPatch：新条目进正确组，已有组条目全保留 ---
const { next, patched } = applyCatalogPatch(original, "opencode-go", ["gpt-6"], fresh);
assert.deepStrictEqual(patched, ["gpt-6"]);
assert.strictEqual(Object.keys(next["openai-responses"]).length, 3, "已有组必须保留原有条目（事故防回归）");
assert.ok(next["openai-responses"]["gpt-5"] !== undefined && next["openai-responses"]["gpt-5b"] !== undefined);
assert.strictEqual(next["openai-responses"]["gpt-6"].api, "openai-responses");
assert.strictEqual(next["openai-responses"]["gpt-6"].baseUrl, undefined, "空组时 baseUrl 留空（物化走 providerBaseUrl）");
console.log("applyCatalogPatch keeps existing groups ok");

// 同组兄弟继承 baseUrl
const { next: n2 } = applyCatalogPatch(
  { "openai-responses": { "gpt-5": { id: "gpt-5", api: "openai-responses", baseUrl: "https://x/v1", contextWindow: 1, maxTokens: 1 } } },
  "opencode-go", ["gpt-6"], fresh
);
assert.strictEqual(n2["openai-responses"]["gpt-6"].baseUrl, "https://x/v1");
console.log("baseUrl inherited from sibling ok");

// groupOf 映射
assert.strictEqual(groupOf(fresh["gpt-6"]), "openai-responses");
assert.strictEqual(groupOf({ provider: { npm: "@ai-sdk/anthropic" } }), "anthropic-messages");
assert.strictEqual(groupOf({}), "openai-completions");
console.log("groupOf mapping ok");

// --- refreshCatalogMetadata：只刷展示/容量/成本，不删不碰 vendor 字段 ---
const meta = refreshCatalogMetadata(original, fresh);
assert.strictEqual(meta.changed.length, 1, "只有 mm-3 变化");
assert.strictEqual(next0(meta.next)["anthropic-messages"]["mm-3"].name, "MiniMax M3 v2");
assert.strictEqual(next0(meta.next)["anthropic-messages"]["mm-3"].contextWindow, 111);
// 不碰 vendor 字段：mm-3 的 api 保留
assert.strictEqual(next0(meta.next)["anthropic-messages"]["mm-3"].api, "anthropic-messages");
// fresh 没有的条目原样保留
assert.ok(next0(meta.next)["openai-responses"]["gpt-5b"] !== undefined);
console.log("refreshCatalogMetadata ok");

function next0(o) { return o; }

// 无变化时 changed 为空
const meta2 = refreshCatalogMetadata(original, { "mm-3": { name: "MM3", limit: { context: 100, output: 10 } } });
assert.deepStrictEqual(meta2.changed, []);
console.log("refreshCatalogMetadata no-op ok");

// --- rollback：只删台账 id，官方条目保留 ---
const rb = rollbackCatalogPatch(n2, ["gpt-6"]);
assert.ok(rb.next["openai-responses"]["gpt-6"] === undefined);
assert.ok(rb.next["openai-responses"]["gpt-5"] !== undefined);
assert.deepStrictEqual(rb.removed, ["gpt-6"]);
console.log("rollbackCatalogPatch ok");

// --- 命名空间错位防御（cloudflare-ai-gateway 实测两种方向） ---
const gwOriginal = {
  "openai-completions": {
    "claude-fable-5": { id: "claude-fable-5", name: "CF5", contextWindow: 1, maxTokens: 1 },
    "workers-ai/@cf/meta/llama-3.1-8b": { id: "workers-ai/@cf/meta/llama-3.1-8b", name: "L31", contextWindow: 1, maxTokens: 1 }
  }
};
const gwFresh = {
  "anthropic/claude-fable-5": { id: "anthropic/claude-fable-5", name: "CF5", limit: { context: 200, output: 20 } },
  "@cf/meta/llama-3.1-8b": { id: "@cf/meta/llama-3.1-8b", name: "L31", limit: { context: 200, output: 20 } },
  "brand-new/model-x": { id: "brand-new/model-x", name: "NewX", limit: { context: 300, output: 30 } }
};
const gw = applyCatalogPatch(
  gwOriginal, "cloudflare-ai-gateway",
  ["anthropic/claude-fable-5", "@cf/meta/llama-3.1-8b", "brand-new/model-x"],
  gwFresh,
  ["claude-fable-5", "workers-ai/@cf/meta/llama-3.1-8b"]
);
assert.deepStrictEqual(gw.namespaceMismatch.sort(),
  ["@cf/meta/llama-3.1-8b", "anthropic/claude-fable-5"], "两种错位方向都应跳过");
assert.deepStrictEqual(gw.patched, ["brand-new/model-x"], "无 stale 对应的真新模型仍应写入");
assert.ok(gw.next["openai-completions"]["claude-fable-5"] !== undefined, "原有条目保留");
assert.ok(gw.next["openai-completions"]["workers-ai/@cf/meta/llama-3.1-8b"] !== undefined);
console.log("namespace-mismatch defense ok");

// --- removeStale：先备份后删除（错位保护）+ 恢复 ---
import { removeStaleFromCatalog, restoreStaleToCatalog, namespacePair } from "../lib/catalog-patch.mjs";

assert.ok(namespacePair("anthropic/claude-fable-5", "claude-fable-5"));
assert.ok(namespacePair("workers-ai/@cf/meta/llama", "@cf/meta/llama"));
assert.ok(!namespacePair("claude-fable-5", "claude-opus-5"), "不同模型不算错位");
assert.ok(!namespacePair("a", "a"));
console.log("namespacePair ok");

const staleCat = {
  "openai-completions": {
    "old-model": { id: "old-model", name: "Old", api: "openai-completions", baseUrl: "https://x/v1", contextWindow: 1, maxTokens: 1 },
    "claude-fable-5": { id: "claude-fable-5", name: "CF5", contextWindow: 1, maxTokens: 1 }
  }
};
const rm = removeStaleFromCatalog(staleCat, ["old-model", "claude-fable-5"], ["anthropic/claude-fable-5"]);
assert.deepStrictEqual(rm.removed.map((x) => x.id), ["old-model"], "真过时条目被删");
assert.deepStrictEqual(rm.skipped, ["claude-fable-5"], "错位保护：与 added 对应的不删");
assert.ok(rm.next["openai-completions"]["old-model"] === undefined);
assert.ok(rm.next["openai-completions"]["claude-fable-5"] !== undefined);
assert.strictEqual(rm.backups["old-model"].group, "openai-completions");
assert.strictEqual(rm.backups["old-model"].entry.api, "openai-completions", "备份含完整 vendor 字段");
assert.deepStrictEqual(staleCat["openai-completions"]["old-model"] !== undefined, true, "入参不被修改");
console.log("removeStaleFromCatalog ok");

// 恢复：备份条目回原组；同 id 已存在不覆盖
const rs = restoreStaleToCatalog(rm.next, rm.backups);
assert.deepStrictEqual(rs.restored, ["old-model"]);
assert.deepStrictEqual(rs.next["openai-completions"]["old-model"], rm.backups["old-model"].entry, "条目逐字段还原");
const conflict = restoreStaleToCatalog(
  { "openai-completions": { "old-model": { id: "old-model", name: "NEWER" } } },
  { "old-model": { group: "openai-completions", entry: { id: "old-model", name: "OLD" } } }
);
assert.deepStrictEqual(conflict.restored, [], "现有条目不被备份覆盖");
assert.strictEqual(conflict.next["openai-completions"]["old-model"].name, "NEWER");
const noGroup = restoreStaleToCatalog({}, { "lost": { group: "some-group", entry: { id: "lost", name: "L" } } });
assert.deepStrictEqual(noGroup.restored, ["lost"], "组缺失时重建组");
console.log("restoreStaleToCatalog ok");

console.log("ALL CATALOG-PATCH TESTS PASSED");

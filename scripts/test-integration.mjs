// 全链路离线集成测试：
//   本地 HTTP 服务器模拟 models.dev api.json
//   → 插件服务真实 fetch + 读取本机安装 catalog + 合并 + 落盘
//   → 校验 ~/.dsh/model-refresh 产物内容与原子写。
// 不触碰安装树与 profile；输出走 config.outputDir 指定的临时目录。
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert";

const PLUGIN_DIR = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// fixture：models.dev 形状（与 test-merge.mjs 同一份实测样本）
const freshModels = {
  "minimax-m3": { id: "minimax-m3", name: "MiniMax-M3", reasoning: true, tool_call: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 1000000, output: 131072 } },
  "gpt-6-luna": { id: "gpt-6-luna", name: "GPT-6 Luna", reasoning: true,
    modalities: { input: ["text"], output: ["text"] },
    limit: { context: 1050000, output: 128000 } },
  "grok-4.5": { id: "grok-4.5", name: "Grok 4.5", reasoning: true,
    modalities: { input: ["text", "image"], output: ["text"] },
    limit: { context: 500000, output: 500000 } }
};
const apiJson = JSON.stringify({ "opencode-go": { id: "opencode-go", models: freshModels } });

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(apiJson);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/api.json`;
console.log("fixture server at", endpoint);

const outDir = await mkdtemp(path.join(tmpdir(), "model-refresh-test-"));

// 固定安装目录基线（pi-ai 0.87.1 原始快照拷进临时 data 目录）：安装树被插件
// patch 后 gpt-6-luna 等会变成 known id，断言会漂移；经 DSH_PI_AI_DATA_DIR
// 指到临时目录，locateCatalogData 全链路照常、基线稳定。
const fakeDataDir = path.join(outDir, "fake-data");
await mkdir(fakeDataDir, { recursive: true });
await copyFile(new URL("../.orig-opencode-go.json", import.meta.url), path.join(fakeDataDir, "opencode-go.json"));
await writeFile(path.join(fakeDataDir, ".manifest.json"), JSON.stringify({ generatedAt: "2026-09-22T00:00:00.000Z" }), "utf8");
process.env.DSH_PI_AI_DATA_DIR = fakeDataDir;

const configPath = path.join(outDir, "config.json");
await writeFile(configPath, JSON.stringify({
  endpoint,
  intervalMinutes: 60, // 不会被等到：测试进程提前退出
  patchCatalog: false, // 测试纪律：绝不写安装树
  outputDir: path.join(outDir, "out"),
  routes: [{ route: "opencode-go", exclude: ["grok-4.5"] }]
}), "utf8");

process.env.DSH_MODEL_REFRESH_CONFIG = configPath;
process.env.DSH_MODEL_REFRESH_STATE = path.join(outDir, "state.json"); // 隔离：不读正式 state
const logs = [];
const mod = await import(new URL("../lib/index.js", import.meta.url).href);
mod.apply({
  logger: { info: (s) => logs.push(s) },
  on: (_ev, _cb) => {},
  inject: (_deps, _cb) => {} // 无 webServer 服务
});

// 轮询等首次刷新完成
const jsonPath = path.join(outDir, "out", "opencode-go.models.json");
for (let i = 0; i < 50 && !existsSync(jsonPath); i++) await new Promise((r) => setTimeout(r, 100));
assert.ok(existsSync(jsonPath), "models.json not produced; logs: " + logs.join(" | "));

const result = JSON.parse(await readFile(jsonPath, "utf8"));
const byId = new Map(result.models.map((m) => [m.id, m]));

// 内容校验
assert.strictEqual(result.provider, "opencode-go");
assert.ok(typeof result.fetchedAt === "string" && typeof result.installedAt === "string");
assert.strictEqual(byId.get("minimax-m3").api, undefined); // vendor 字段不进产物（route 继承）
assert.strictEqual(byId.get("minimax-m3").contextWindow, 1000000);    // 在线元数据
assert.strictEqual(byId.get("gpt-6-luna").contextWindow, 1050000);    // 新增 id
assert.ok(!byId.has("grok-4.5"), "exclude failed");                   // exclude 生效
const installedCount = result.models.length;

const diff = JSON.parse(await readFile(path.join(outDir, "out", "opencode-go.diff.json"), "utf8"));
assert.deepStrictEqual(diff.added, ["gpt-6-luna"]);
assert.ok(diff.stale.length > 0);

const yml = await readFile(path.join(outDir, "out", "opencode-go.models.yml"), "utf8");
assert.ok(yml.startsWith("opencode-go:\n  models:\n    - id: deepseek-v4-flash"));

// 原子写：无 .tmp 残留
assert.ok(!existsSync(jsonPath + ".tmp"));

console.log(`models: ${installedCount}, added: ${JSON.stringify(diff.added)}, stale: ${diff.stale.length}`);
console.log("logs:", JSON.stringify(logs));

server.close();
await rm(outDir, { recursive: true, force: true });
console.log("INTEGRATION TEST PASSED");
process.exit(0);

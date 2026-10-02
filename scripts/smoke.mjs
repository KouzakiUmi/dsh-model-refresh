// stub ctx 冒烟：验证入口可导入、apply 可执行、真实拉取与产物落盘。
// 纪律：绝不写安装树（临时 state 固定 patchCatalog=false，与 Host 进程互斥；
// 2026-10-03 事故根因就是测试进程与 Host 并发写同一安装树 catalog）。
import { writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const statePath = path.join(tmpdir(), `model-refresh-smoke-${process.pid}.json`);
await writeFile(statePath, JSON.stringify({
  version: 2,
  settings: { patchCatalog: false, intervalMinutes: 360 },
  routes: [{ route: "opencode-go", enabled: true, exclude: ["longcat-2.5-preview-free", "space-bunny-free"] }]
}), "utf8");
process.env.DSH_MODEL_REFRESH_STATE = statePath;

const mod = await import(new URL("../lib/index.js", import.meta.url).href);
const logs = [];
const ctx = {
  logger: { info: (s) => logs.push(s) },
  on: (_ev, _cb) => {}, // 不触发 dispose
  inject: (deps, _cb) => { logs.push(`(inject skipped: ${deps.join(",")})`); } // 无 webServer 服务，路由不装
};
mod.apply(ctx);
await new Promise((r) => setTimeout(r, 5000));
console.log("name =", mod.name);
console.log("logs =", JSON.stringify(logs, null, 2));
await rm(statePath, { force: true });
if (!mod.name || logs.length === 0) { console.error("SMOKE FAILED"); process.exit(1); }
console.log("SMOKE PASSED");
process.exit(0);

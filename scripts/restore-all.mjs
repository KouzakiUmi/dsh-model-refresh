// 一次性全量恢复：安装树 data/*.json 恢复为 pi-ai 0.87.1 原包内容，
// 清除测试进程污染（组重置 + cloudflare 前缀重复），opencode-go 额外补入
// 两个官方目录尚未收录的新模型，state 台账与磁盘对齐。
// 用法：node scripts/restore-all.mjs <原包 data 目录>
import { readFile, writeFile, rename } from "node:fs/promises";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { applyCatalogPatch } from "../lib/catalog-patch.mjs";

const origDir = process.argv[2];
if (!origDir || !existsSync(origDir)) { console.error("usage: node scripts/restore-all.mjs <orig-data-dir>"); process.exit(1); }

const DATA = "C:/Program Files/DSH NEXT/resources/app/node_modules/@earendil-works/pi-ai/dist/providers/data";
const STATE = path.join(process.env.USERPROFILE.replaceAll("\\", "/"), ".dsh/model-refresh/state.json");
const WIRE_GROUP_FIX = { "opencode-go": ["gpt-6-luna", "grok-4.5"] };

// models.dev 真实数据（补条目用）
let freshById = {};
try {
  const res = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(30_000) });
  const api = await res.json();
  freshById = Object.fromEntries(Object.entries(api ?? {}).map(([key, p]) => [key, p.models ?? {}]));
} catch (e) {
  console.warn("models.dev unreachable; WIRE_GROUP_FIX routes will restore originals only:", e.message);
}

let restored = 0;
const ledger = {};
for (const name of readdirSync(origDir)) {
  if (!name.endsWith(".json") || name.startsWith(".")) continue;
  const route = name.slice(0, -5);
  const original = JSON.parse(await readFile(path.join(origDir, name), "utf8"));
  let target = original;
  const adds = WIRE_GROUP_FIX[route];
  if (adds !== undefined && freshById[route] !== undefined) {
    const { next, patched, skipped } = applyCatalogPatch(original, route, adds, freshById[route], []);
    target = next;
    ledger[route] = patched;
    if (skipped.length > 0) console.warn(`route ${route}: skipped [${skipped.join(", ")}]`);
  }
  const file = path.join(DATA, name);
  let currentRaw = null;
  try { currentRaw = await readFile(file, "utf8"); } catch (_e) { /* not installed */ }
  const nextRaw = JSON.stringify(target, null, 2);
  if (currentRaw === nextRaw) continue;
  const tmp = `${file}.restore.tmp`;
  await writeFile(tmp, nextRaw, "utf8");
  await rename(tmp, file);
  restored += 1;
  console.log(`restored: ${name}`);
}

// state 台账与磁盘对齐
const state = JSON.parse(await readFile(STATE, "utf8"));
state.runtime.catalogPatched = ledger;
state.runtime.catalogWritable = true;
state.runtime.restartRequired = true;
const stmp = `${STATE}.tmp`;
await writeFile(stmp, JSON.stringify(state, null, 2), "utf8");
await rename(stmp, STATE);

console.log(`done: ${restored} files restored; state ledger = ${JSON.stringify(ledger)}`);

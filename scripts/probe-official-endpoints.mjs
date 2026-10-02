// 一次性核查：对 DEFAULT_OFFICIAL_ROUTES 全部 route 实测官方模型端点路径
// （无真 key 探测：200=公开端点 / 401,403=路径对、缺或拒 key / 404=路径错）
import { readFileSync } from "node:fs";
import { DEFAULT_OFFICIAL_ROUTES, catalogBaseUrl } from "../lib/official.mjs";

const dir = "C:/Program Files/DSH NEXT/resources/app/node_modules/@earendil-works/pi-ai/dist/providers/data";

for (const [route, cfg] of Object.entries(DEFAULT_OFFICIAL_ROUTES)) {
  let raw;
  try { raw = JSON.parse(readFileSync(`${dir}/${route}.json`, "utf8")); } catch {
    console.log(route, "-> catalog file MISSING");
    continue;
  }
  const root = (catalogBaseUrl(raw) ?? "(no baseUrl)").replace(/\/+$/, "");
  const candidates = /\/v\d+$/.test(root) ? [`${root}/models`] : [`${root}/models`, `${root}/v1/models`];
  const results = [];
  for (const u of candidates) {
    try {
      const r = await fetch(u, {
        headers: { authorization: "Bearer probe-key", accept: "application/json" },
        signal: AbortSignal.timeout(12000)
      });
      results.push(`${u.replace(root, "<base>")} => ${r.status}`);
      if (r.status !== 404) break; // 路径已命中（200/401/403…）
    } catch (e) {
      results.push(`${u.replace(root, "<base>")} => ERROR ${e.message}`);
      break;
    }
  }
  const verdict = /=> (200|401|403)\b/.test(results.join(" ")) ? "PATH OK" : "PATH BROKEN";
  console.log(
    route.padEnd(26),
    "| key:", (cfg.apiKeyEnv ?? "-").padEnd(26),
    "| base:", root.padEnd(38),
    "|", results.join(" ; "),
    "|", verdict
  );
}

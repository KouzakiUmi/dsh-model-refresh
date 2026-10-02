/**
 * dsh-model-refresh —— Host 服务（v0.2）。
 *
 * 职责：
 *   1. 启动时 + 按 intervalMinutes 从 models.dev api.json 拉取最新模型数据
 *      （可经 proxyUrl 走 undici ProxyAgent）；
 *   2. 对每个 route：读安装 pi-ai catalog 快照，与在线数据做「目录并集 +
 *      元数据刷新」合并（lib/merge.mjs），产物原子写到 ~/.dsh/model-refresh/；
 *   3. patchCatalog=true 时把新增模型合入安装树 data JSON（用户已授权；
 *      Program Files 默认不可写 -> fail-soft，status 引导一次性 icacls）；
 *      route enabled=false 或 patchCatalog 关闭时按台账回滚；
 *   4. 注册 /plugins/dsh-model-refresh/* Web 路由：status（监控）、config、
 *      route 开关、refresh（立即刷新），供设置页（client）调用；
 *   5. 全部状态持久在 ~/.dsh/model-refresh/state.json（v0.1 的 config.json
 *      仅作首次种子）。
 *
 * 生命周期：定时器经 setTimeout 链驱动，dispose 清理；单次失败只记日志与
 * state.runtime.lastError，保留上一次成功产物（不空写）。
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { flattenInstalled, mergeRoute, toYamlFragment } from "./merge.mjs";
import { loadState, saveState, stateExists, validProxyUrl, discoverRoutes, STATE_VERSION } from "./state.mjs";
import { applyCatalogPatch, rollbackCatalogPatch, refreshCatalogMetadata, removeStaleFromCatalog, restoreStaleToCatalog } from "./catalog-patch.mjs";
import { DEFAULT_LITELLM_ROUTES, litellmRouteModels } from "./litellm.mjs";
import { DEFAULT_OFFICIAL_ROUTES, catalogBaseUrl, fetchOfficialIds, officialOnlyEntries } from "./official.mjs";

export const name = "model-refresh";

const PLUGIN_DIR = fileURLToPath(new URL("../", import.meta.url));
const HOME = path.resolve(PLUGIN_DIR, "..", "..");
const DEFAULT_OUTPUT_DIR = path.join(HOME, "model-refresh");
const SEED_CONFIG_PATH = process.env.DSH_MODEL_REFRESH_CONFIG ?? path.join(PLUGIN_DIR, "config.json");
const HTTP_BASE = "/plugins/dsh-model-refresh";

/** 定位已安装 pi-ai 的 data 目录。 */
function locateCatalogData(report) {
  const candidates = [];
  if (process.env.DSH_PI_AI_DATA_DIR) candidates.push(process.env.DSH_PI_AI_DATA_DIR);
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("@earendil-works/pi-ai/package.json");
    candidates.push(path.join(path.dirname(pkg), "dist", "providers", "data"));
  } catch (_ignored) {}
  candidates.push(
    "C:/Program Files/DSH NEXT/resources/app/node_modules/@earendil-works/pi-ai/dist/providers/data",
    path.join(process.env.LOCALAPPDATA ?? "", "Programs/DeepSeek Harness/resources/app/node_modules/@earendil-works/pi-ai/dist/providers/data"),
    path.join(process.env.APPDATA ?? "", "npm/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/providers/data")
  );
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  report("cannot locate installed pi-ai catalog; set DSH_PI_AI_DATA_DIR to the dist/providers/data directory");
  return undefined;
}

/** 读 + 解析安装树 route 数据文件；文件缺失返回 null。 */
async function readCatalogRoute(dataDir, route) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, `${route}.json`), "utf8"));
  } catch (_ignored) {
    return null;
  }
}

/** 原子写 JSON。 */
async function writeAtomicJson(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

export function apply(ctx) {
  const report = (message) => {
    try {
      ctx.logger?.info?.(`[model-refresh] ${message}`);
    } catch (_ignored) {}
  };

  let disposed = false;
  let timer;
  let refreshInFlight = Promise.resolve();
  let proxyAgent = null;
  let state = undefined;
  let dataDir = undefined;
  ctx.on?.("dispose", () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    const agent = proxyAgent;
    proxyAgent = null;
    if (agent !== null) void agent.close?.().catch?.(() => {});
  });

  const statePath = () => process.env.DSH_MODEL_REFRESH_STATE ?? path.join(DEFAULT_OUTPUT_DIR, "state.json");
  const outputDir = () => {
    const override = state?.settings?.outputDir;
    return typeof override === "string" && override.length > 0 ? path.resolve(override) : DEFAULT_OUTPUT_DIR;
  };

  const persist = () => saveState(statePath(), state).catch((error) =>
    report(`state write failed (${error instanceof Error ? error.message : String(error)})`));

  /** 按当前 proxyUrl 重建 undici ProxyAgent（'' 清除）。 */
  const applyProxy = async () => {
    const url = validProxyUrl(state?.settings?.proxyUrl ?? "");
    if (url === undefined || url === "") {
      const previous = proxyAgent;
      proxyAgent = null;
      if (previous !== null) void previous.close?.().catch?.(() => {});
      return;
    }
    const { ProxyAgent } = await import("undici");
    const previous = proxyAgent;
    proxyAgent = new ProxyAgent(url);
    if (previous !== null) void previous.close?.().catch?.(() => {});
  };

  /** 带代理的 fetch（init 可覆盖 headers/signal，供官方核对等自定义请求）。 */
  const fetchThrough = async (url, init = {}) => {
    const headers = { accept: "application/json", ...(init.headers ?? {}) };
    const signal = init.signal ?? AbortSignal.timeout(30_000);
    if (proxyAgent !== null) {
      const { fetch: undiciFetch } = await import("undici");
      return undiciFetch(url, { ...init, headers, dispatcher: proxyAgent, signal });
    }
    return fetch(url, { ...init, headers, signal });
  };

  /** 官方核对凭据：process.env → credentials 服务（cordis credential ref 同源）。 */
  const resolveOfficialKey = async (envName) => {
    if (typeof envName !== "string" || envName.length === 0) return undefined;
    const fromEnv = process.env[envName];
    if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
    try {
      const creds = typeof ctx.get === "function" ? ctx.get("credentials") : undefined;
      const hit = typeof creds?.resolve === "function" ? await creds.resolve(envName) : undefined;
      if (typeof hit?.value === "string" && hit.value.length > 0) return hit.value;
    } catch (_ignored) {}
    return undefined;
  };

  /** 写一个 route 的三个产物文件。 */
  const writeArtifacts = async (route, providerKey, fetchedAt, installedAt, models, diff) => {
    const dir = outputDir();
    await mkdir(dir, { recursive: true });
    const jsonPath = path.join(dir, `${route}.models.json`);
    await writeAtomicJson(jsonPath, { route, provider: providerKey, fetchedAt, installedAt, models });
    await writeFile(path.join(dir, `${route}.models.yml`), toYamlFragment(route, models) + "\n", "utf8");
    if (diff !== undefined) {
      await writeAtomicJson(path.join(dir, `${route}.diff.json`), { fetchedAt, installedAt, ...diff });
    }
  };

  /**
   * 对一个 route 同步安装树 catalog：
   *   - 已知 id 的展示/容量/成本元数据刷新（refreshCatalogMetadata）；
   *   - added 新模型合入对应 wire-protocol 分组（applyCatalogPatch）；
   *   - removeStale：stale 条目先备份后删除（错位保护），关开关 / 禁用即恢复；
   *   - 回滚（ledger 有记录且 patchCatalog 关闭 / route 禁用）。
   * 无实际变化不写盘；fail-soft：不可写只记状态与引导，内存态回滚。
   */
  const syncCatalog = async (route, diffAdded, fresh, diffStale = [], source = "models.dev", officialAddedIds = []) => {
    const runtime = state.runtime;
    const ledger = runtime.catalogPatched[route] ?? [];
    const prevBackups = runtime.catalogRemoved[route] ?? {};
    const enabled = state.routes.find((r) => r.route === route)?.enabled !== false;
    const wantPatch = state.settings.patchCatalog && enabled; // 写安装树总闸
    // litellm 数据集覆盖不全（如 zai 仅 16 条 vs 目录更多），其 stale 语义
    // 不可信——litellm 源不执行 removeStale（不删 catalog）
    const removeIntent = wantPatch && state.settings.removeStale && source !== "litellm" && diffStale.length > 0;
    const restoreIntent = Object.keys(prevBackups).length > 0 && !(wantPatch && state.settings.removeStale);
    // litellm 上游 added 不 patch（无 wire-protocol 信息，归组无依据）；
    // **官方接口确认的补缺不受此限**（官方 /models 是权威，且其端点即
    // OpenAI 兼容 → 归 openai-completions 组合理）——这正是"官方上了
    // 新模型而内置库没有"的核心通路
    const patchableAdded = source === "litellm"
      ? officialAddedIds
      : (Array.isArray(diffAdded) ? diffAdded : []);
    const hasAdds = patchableAdded.length > 0;
    const wantRollback = ledger.length > 0 && !wantPatch;
    if (!wantPatch && !wantRollback && !restoreIntent) return;

    const file = path.join(dataDir, `${route}.json`);
    const current = await readCatalogRoute(dataDir, route);
    if (current === null) return;

    let working = current;
    let backups = prevBackups;
    const changes = []; // 本写盘周期的全部实际变化（为空则不写盘）

    // 1) 恢复 removeStale 删除过的条目（关闭开关 / route 禁用）
    if (restoreIntent) {
      const r = restoreStaleToCatalog(working, prevBackups);
      working = r.next;
      if (r.restored.length > 0) changes.push(`restored stale [${r.restored.join(", ")}]`);
      backups = {};
    }

    let ledgerPending = [];
    if (wantPatch) {
      // 2) 元数据刷新
      const meta = refreshCatalogMetadata(working, fresh);
      working = meta.next;
      if (meta.changed.length > 0) changes.push(`metadata ${meta.changed.length}`);

      // 3) removeStale：先备份完整条目再删除（错位保护跳过）
      if (removeIntent) {
        const rm = removeStaleFromCatalog(working, diffStale, diffAdded, backups);
        working = rm.next;
        backups = rm.backups;
        if (rm.removed.length > 0) changes.push(`removed stale [${rm.removed.map((x) => x.id).join(", ")}]`);
        if (rm.skipped.length > 0) {
          report(`route "${route}": stale ids kept (namespace-mismatched, e.g. id-体系变更) [${rm.skipped.join(", ")}]`);
        }
      }

      // 4) added 新模型合入（litellm 源仅官方确认部分，见上）
      if (hasAdds) {
        const applied = applyCatalogPatch(working, route, patchableAdded, fresh, diffStale);
        working = applied.next;
        ledgerPending = applied.patched;
        if (applied.patched.length > 0) changes.push(`patched [${applied.patched.join(", ")}]`);
        if (applied.namespaceMismatch.length > 0) {
          report(`route "${route}": ${applied.namespaceMismatch.length} added ids look like namespace-mismatched duplicates (e.g. [${applied.namespaceMismatch.slice(0, 3).join(", ")}]); not patching them — models.dev and the catalog use different id schemes`);
        }
        if (applied.skipped.length > 0) {
          report(`route "${route}": catalog patch skipped [${applied.skipped.join(", ")}] (no capacity data)`);
        }
      }
    }

    // 5) 回滚插件写入的 added（patchCatalog 关闭 / route 禁用）
    let rolledBack = false;
    if (wantRollback) {
      const rb = rollbackCatalogPatch(working, ledger);
      working = rb.next;
      if (rb.removed.length > 0) changes.push(`rolled back [${rb.removed.join(", ")}]`);
      rolledBack = true;
    }

    if (changes.length === 0) {
      if (rolledBack) runtime.catalogPatched[route] = []; // 台账条目已不在磁盘，纯清账
      return;
    }
    try {
      await writeAtomicJson(file, working);
      runtime.catalogPatched[route] = rolledBack ? [] : [...new Set([...ledger, ...ledgerPending])];
      if (backups !== prevBackups) runtime.catalogRemoved[route] = backups;
      runtime.catalogWritable = true;
      runtime.restartRequired = true;
      report(`route "${route}": installed catalog updated — ${changes.join("; ")} (restart required to take effect)`);
    } catch (error) {
      runtime.catalogRemoved[route] = prevBackups; // 内存态回滚，避免备份丢失后永不恢复
      runtime.catalogWritable = false;
      runtime.lastError = `catalog update failed for "${route}" (needs one-time admin grant, see status guidance): ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  /** 单轮刷新全部 enabled 的 route。 */
  const refreshOnce = async () => {
    const fetchedAt = new Date().toISOString();
    const response = await fetchThrough(state.settings.endpoint);
    if (!response.ok) throw new Error(`models.dev responded ${response.status}`);
    const api = await response.json();

    let installedAt = null;
    try {
      const manifest = JSON.parse(await readFile(path.join(dataDir, ".manifest.json"), "utf8"));
      installedAt = manifest.generatedAt ?? null;
    } catch (_ignored) {}

    // LiteLLM 第二上游（lazy：只有存在缺数据且映射了前缀的 route 才拉一次）
    let litellmRaw;
    const litellmPrefixOf = (route) =>
      (state.settings.litellmRoutes ?? {})[route] ?? DEFAULT_LITELLM_ROUTES[route];

    for (const routeConfig of state.routes) {
      const route = routeConfig.route;
      if (routeConfig.enabled === false) continue;
      const providerKey = routeConfig.as ?? route;
      let fresh = api?.[providerKey]?.models;
      if (fresh === null || typeof fresh !== "object") fresh = undefined;
      let source = fresh !== undefined ? "models.dev" : null;

      if (source === null && state.settings.litellmEnabled) {
        const prefix = litellmPrefixOf(route);
        if (prefix !== undefined) {
          if (litellmRaw === undefined) {
            try {
              const resp = await fetchThrough(state.settings.litellmUrl);
              if (!resp.ok) throw new Error(`litellm responded ${resp.status}`);
              litellmRaw = await resp.json();
            } catch (error) {
              litellmRaw = null;
              report(`litellm fetch failed (${error instanceof Error ? error.message : String(error)}); routes without models.dev data fall back to catalog-only`);
            }
          }
          if (litellmRaw !== null) {
            const converted = litellmRouteModels(litellmRaw, prefix);
            if (Object.keys(converted.models).length > 0) {
              fresh = converted.models;
              source = "litellm";
            }
          }
        }
      }

      if (source === null) {
        // 无上游数据源（models.dev 与 LiteLLM 都没有）：只标注，不产出新数据
        state.runtime.perRoute[route] = { enabled: true, fetchedAt, source: "none" };
        report(`route "${route}": no upstream data source (models.dev / LiteLLM) — catalog snapshot only`);
        continue;
      }

      const installedRaw = await readCatalogRoute(dataDir, route);
      if (installedRaw === null) {
        report(`installed catalog has no route "${route}"; skipped`);
        continue;
      }

      // 官方接口核对：上游是近似数据源时（如 litellm moonshot/* ≠ kimi-coding
      // 套餐），先拉官方 GET {baseUrl}/models 真实列表修正 added/stale 判定
      let official;
      let officialStatus = "unconfigured";
      const officialCfg =
        (state.settings.officialRoutes ?? {})[route] ?? DEFAULT_OFFICIAL_ROUTES[route];
      if (state.settings.officialVerify !== false && officialCfg !== null && officialCfg !== undefined) {
        officialStatus = "no-key";
        try {
          const key = await resolveOfficialKey(officialCfg?.apiKeyEnv);
          official = await fetchOfficialIds(catalogBaseUrl(installedRaw), key, fetchThrough);
          officialStatus = "verified";
        } catch (error) {
          officialStatus = error?.code === "MISSING_KEY" ? "no-key" : "failed";
          report(`route "${route}": official check ${officialStatus} (${error instanceof Error ? error.message : String(error)}) — merged with upstream verdict only`);
        }
      }

      const installed = flattenInstalled(installedRaw);

      // 官方补缺（核心通路）：官方接口有、安装目录与全部上游都没有的 id
      // → 构造条目注入，走既有 merge + catalog-patch 链路进列表与安装树
      let officialAdded = [];
      if (official !== undefined) {
        const only = officialOnlyEntries(installed, fresh, official, new Set(routeConfig.exclude ?? []), officialCfg);
        if (only.ids.length > 0) {
          fresh = { ...fresh, ...only.entries };
          officialAdded = only.ids;
          report(`route "${route}": official supplement — ${only.ids.length} model(s) official-only (catalog + all upstreams lack them): [${only.ids.join(", ")}]`);
        }
      }

      const { models, diff } = mergeRoute(installed, fresh, {
        keep: routeConfig.keep ?? [],
        exclude: routeConfig.exclude ?? [],
        // litellm 覆盖不全 → 其 stale 不可信，不剔除
        dropStale: state.settings.removeStale && source === "models.dev",
        official
      });

      await writeArtifacts(route, providerKey, fetchedAt, installedAt, models, diff);
      await syncCatalog(route, diff.added, fresh, diff.stale, source, officialAdded);

      state.runtime.perRoute[route] = {
        enabled: true,
        fetchedAt,
        installedAt,
        source,
        official: officialStatus,
        officialAdded,
        models: models.length,
        ...diff
      };
      report(
        `route "${route}" [${source}] official=${officialStatus}: ${models.length} models ` +
        `(added [${diff.added.join(", ") || "-"}], updated ${diff.updated.length}, ` +
        `stale [${diff.stale.join(", ") || "-"}], excluded ${diff.excluded.length}` +
        `${diff.unverified.length > 0 ? `, unverified dropped [${diff.unverified.join(", ")}]` : ""})`
      );
    }
  };

  /** 禁用的 route：回滚 catalog patch + 产物重写为安装目录快照（不删文件，防 !!js 读炸）。 */
  const reconcileDisabled = async () => {
    for (const routeConfig of state.routes) {
      if (routeConfig.enabled !== false) continue;
      const route = routeConfig.route;
      await syncCatalog(route, [], undefined);
      const installedRaw = await readCatalogRoute(dataDir, route);
      if (installedRaw === null) continue;
      const models = flattenInstalled(installedRaw);
      // 投影到 route 允许字段（与 merge.mjs 语义一致）
      const fields = ["id", "name", "contextWindow", "maxTokens", "input", "reasoning"];
      const projected = Object.values(models).map((base) => {
        const entry = {};
        for (const key of fields) if (base[key] !== undefined) entry[key] = base[key];
        return entry;
      });
      await writeArtifacts(route, routeConfig.as ?? route, new Date().toISOString(), null, projected);
      state.runtime.perRoute[route] = { enabled: false, models: projected.length };
      report(`route "${route}": disabled — artifacts reverted to installed catalog (${projected.length} models)`);
    }
  };

  const run = async () => {
    state.runtime.running = true;
    await persist();
    try {
      await refreshOnce();
      await reconcileDisabled();
      state.runtime.lastRun = new Date().toISOString();
      state.runtime.lastError = null;
    } catch (error) {
      state.runtime.lastError = error instanceof Error ? error.message : String(error);
      report(`refresh failed, keeping previous output (${state.runtime.lastError})`);
    } finally {
      state.runtime.running = false;
      await persist();
    }
  };

  /** 手动触发（设置页按钮）：与定时轮共用一个串行闸门。 */
  const requestRefresh = () => {
    refreshInFlight = refreshInFlight.then(() => run()).catch(() => {});
    return refreshInFlight;
  };

  const schedule = () => {
    if (disposed) return;
    const minutes = Math.max(1, Number(state?.settings?.intervalMinutes) || 360);
    timer = setTimeout(async () => {
      if (disposed) return;
      await run();
      schedule();
    }, minutes * 60_000);
    timer.unref?.();
  };

  /** 设置页 GET 的完整监控数据。 */
  const statusPayload = () => ({
    version: STATE_VERSION,
    running: state.runtime.running,
    lastRun: state.runtime.lastRun,
    lastError: state.runtime.lastError,
    restartRequired: state.runtime.restartRequired,
    catalogWritable: state.runtime.catalogWritable,
    // 授权命令独立下发：动态真实 dataDir（任何安装位置都适配）+
    // SID S-1-5-32-545（内置 Users 组，中文系统显示"用户"但 SID 不变）
    catalogGrantCommand: state.runtime.catalogWritable === false && dataDir !== undefined
      ? `icacls "${dataDir}" /grant "*S-1-5-32-545:(OI)(CI)M"`
      : null,
    catalogGrantNote: state.runtime.catalogWritable === false
      ? "以管理员身份打开 PowerShell，粘贴上面的命令运行一次即可。命令用真实安装路径（带空格自动加引号）和内置 Users 组的 SID（S-1-5-32-545，各语言系统通用），授权 pi-ai data 目录的修改权限；之后插件即可自动写入，pi-ai 整包升级不受影响。"
      : null,
    settings: { ...state.settings, proxyConfigured: state.settings.proxyUrl !== "" },
    routes: state.routes.map((r) => ({
      ...r,
      ...(state.runtime.perRoute[r.route] ?? {})
    }))
  });

  const readBody = (req) => new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try { resolve(body.length === 0 ? {} : JSON.parse(body)); } catch (_ignored) { resolve(undefined); }
    });
  });

  const json = (res, code, value) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  };

  const sameOrigin = (req) => {
    try {
      const origin = req.headers?.origin;
      if (origin === undefined) return true; // same-origin GET 无 Origin 头
      const host = req.headers?.host;
      return host !== undefined && new URL(origin).host === host;
    } catch (_ignored) {
      return false;
    }
  };

  /** Web 路由（设置页数据通道；照 grok-kit 模式：exact path + 同源校验）。失败只记日志，不阻塞刷新。 */
  const installRoutes = () => {
    try {
      ctx.inject(["webServer"], (webCtx) => {
      const register = (p, handler) => webCtx.webServer.register({ kind: "exact", path: p, handler });
      register(`${HTTP_BASE}/status`, async (req, res) => {
        if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
        json(res, 200, statusPayload());
      });
      register(`${HTTP_BASE}/refresh`, async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!sameOrigin(req)) return json(res, 403, { error: "forbidden" });
        json(res, 202, { started: true });
        void requestRefresh();
      });
      register(`${HTTP_BASE}/config`, async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!sameOrigin(req)) return json(res, 403, { error: "forbidden" });
        const body = await readBody(req);
        if (body === undefined) return json(res, 400, { error: "invalid json" });
        const s = state.settings;
        let proxyChanged = false;
        if (typeof body.endpoint === "string" && body.endpoint.startsWith("http")) s.endpoint = body.endpoint;
        if (body.intervalMinutes !== undefined) {
          const n = Number(body.intervalMinutes);
          if (!Number.isFinite(n) || n < 1) return json(res, 400, { error: "intervalMinutes must be >= 1" });
          s.intervalMinutes = Math.floor(n);
        }
        if (body.proxyUrl !== undefined) {
          const normalized = validProxyUrl(body.proxyUrl);
          if (normalized === undefined) return json(res, 400, { error: "proxyUrl must be http(s) without embedded credentials" });
          if (s.proxyUrl !== normalized) proxyChanged = true;
          s.proxyUrl = normalized;
        }
        if (typeof body.patchCatalog === "boolean") s.patchCatalog = body.patchCatalog;
        if (typeof body.removeStale === "boolean") s.removeStale = body.removeStale;
        if (typeof body.litellmEnabled === "boolean") s.litellmEnabled = body.litellmEnabled;
        if (typeof body.officialVerify === "boolean") s.officialVerify = body.officialVerify;
        await persist();
        if (proxyChanged) await applyProxy();
        if (timer !== undefined) clearTimeout(timer);
        schedule();
        json(res, 200, statusPayload());
      });
      register(`${HTTP_BASE}/route`, async (req, res) => {
        if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
        if (!sameOrigin(req)) return json(res, 403, { error: "forbidden" });
        const body = await readBody(req);
        if (body === undefined || typeof body.route !== "string" || typeof body.enabled !== "boolean") {
          return json(res, 400, { error: "expected {route: string, enabled: boolean}" });
        }
        const target = state.routes.find((r) => r.route === body.route);
        if (target === undefined) return json(res, 404, { error: `unknown route "${body.route}"` });
        target.enabled = body.enabled;
        await persist();
        json(res, 202, { started: true });
        void requestRefresh(); // 禁用路径里回滚 catalog + 产物
      });
      });
    } catch (error) {
      report(`web routes unavailable (${error instanceof Error ? error.message : String(error)}); refresh still runs`);
    }
  };

  // ---------- 启动 ----------
  void (async () => {
    state = await loadState(statePath(), SEED_CONFIG_PATH);
    dataDir = locateCatalogData(report);
    if (dataDir === undefined) return;
    // 自动发现：安装目录里的每个 provider route 都纳入（settings.autoDiscover=false 关闭）
    let discovered = [];
    try {
      discovered = discoverRoutes(state, readdirSync(dataDir).filter((f) => f.endsWith(".json")));
      if (discovered.length > 0) report(`auto-discovered ${discovered.length} routes: [${discovered.join(", ")}]`);
    } catch (error) {
      report(`route discovery failed (${error instanceof Error ? error.message : String(error)})`);
    }
    await mkdir(outputDir(), { recursive: true });
    await persist();
    await applyProxy();
    installRoutes();
    await run();
    schedule();
  })().catch((error) => report(`bootstrap failed (${error instanceof Error ? error.message : String(error)})`));
}

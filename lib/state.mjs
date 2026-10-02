/**
 * dsh-model-refresh —— 插件自管持久状态（state.json）。
 *
 * 放在输出目录（~/.dsh/model-refresh/state.json），与产物同处：
 *   - settings 部分：endpoint / intervalMinutes / proxyUrl / patchCatalog / routes
 *     （route 条目含 enabled —— 即设置页的 per-provider 开关）；
 *   - runtime 部分：lastRun / lastError / catalogWritable / 每 route 的监控数据
 *     与 catalog patch 台账（哪些 id 是我们写进安装树的，禁用/关闭时据此回滚）。
 *
 * 所有写入都走 tmp + rename 原子替换；读取失败返回 undefined 由调用方重建。
 * v0.1 的 config.json 作为一次性种子导入（state.json 不存在时）。
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const STATE_VERSION = 2;

const DEFAULT_ENDPOINT = "https://models.dev/api.json";
const DEFAULT_INTERVAL_MINUTES = 360;
// LiteLLM 第二上游（models.dev 无数据的 route 补缺；MIT，GitHub raw 直链）
const DEFAULT_LITELLM_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

/** 校验代理 URL：'' = 关闭；仅 http(s)、拒绝内嵌凭据；非法返回 undefined。 */
export function validProxyUrl(url) {
  const trimmed = String(url ?? "").trim();
  if (trimmed === "") return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (parsed.hostname.length === 0) return undefined;
    if (parsed.username !== "" || parsed.password !== "") return undefined;
    return trimmed;
  } catch (_ignored) {
    return undefined;
  }
}

/** 规整 routes 数组（容错：丢掉无 route 字段的条目，补默认值）。 */
function normalizeRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of routes) {
    if (entry === null || typeof entry !== "object") continue;
    const route = typeof entry.route === "string" ? entry.route.trim() : "";
    if (route.length === 0 || seen.has(route)) continue;
    seen.add(route);
    out.push({
      route,
      as: typeof entry.as === "string" && entry.as.trim().length > 0 ? entry.as.trim() : undefined,
      enabled: entry.enabled !== false,
      keep: Array.isArray(entry.keep) ? entry.keep.filter((x) => typeof x === "string") : [],
      exclude: Array.isArray(entry.exclude) ? entry.exclude.filter((x) => typeof x === "string") : []
    });
  }
  return out;
}

/** 用磁盘 state / v0.1 config.json 种子 / 内置默认构造一份完整 state。 */
export async function loadState(statePath, seedConfigPath) {
  let doc = undefined;
  try {
    doc = JSON.parse(await readFile(statePath, "utf8"));
  } catch (_ignored) {}
  if (doc?.version !== STATE_VERSION) doc = undefined;

  let seed = undefined;
  if (doc === undefined) {
    try {
      seed = JSON.parse(await readFile(seedConfigPath, "utf8"));
    } catch (_ignored) {}
  }

  const settings = doc?.settings ?? seed ?? {};
  const proxyUrl = validProxyUrl(settings.proxyUrl ?? "");
  // outputDir 兼容 v0.1 config.json 的顶层字段与 settings 内字段两种写法
  const outputDirRaw = settings.outputDir ?? (doc === undefined ? seed?.outputDir : undefined);
  return {
    version: STATE_VERSION,
    settings: {
      endpoint: typeof settings.endpoint === "string" && settings.endpoint.startsWith("http")
        ? settings.endpoint
        : DEFAULT_ENDPOINT,
      intervalMinutes: Math.max(1, Number(settings.intervalMinutes) || DEFAULT_INTERVAL_MINUTES),
      proxyUrl: proxyUrl === undefined ? "" : proxyUrl,
      patchCatalog: settings.patchCatalog !== false,
      autoDiscover: settings.autoDiscover !== false,
      removeStale: settings.removeStale === true,
      litellmEnabled: settings.litellmEnabled !== false,
      officialVerify: settings.officialVerify !== false,
      officialRoutes: settings.officialRoutes !== null && typeof settings.officialRoutes === "object"
        ? settings.officialRoutes
        : {},
      litellmUrl: typeof settings.litellmUrl === "string" && settings.litellmUrl.startsWith("http")
        ? settings.litellmUrl
        : DEFAULT_LITELLM_URL,
      outputDir: typeof outputDirRaw === "string" && outputDirRaw.length > 0 ? outputDirRaw : undefined
    },
    routes: normalizeRoutes(doc?.routes ?? seed?.routes),
    runtime: {
      lastRun: null,
      lastError: null,
      running: false,
      catalogWritable: null,
      restartRequired: false,
      catalogPatched: {},
      catalogRemoved: {},
      perRoute: {},
      ...(doc?.runtime ?? {})
    }
  };
}

/**
 * 自动发现：把安装目录里存在、state.routes 里还没有的 provider 追加为
 * enabled 条目（autoDiscover=false 时不追加；已在 routes 里的不动）。
 * @returns 追加的 route 名列表。
 */
export function discoverRoutes(state, catalogFileNames) {
  if (state.settings.autoDiscover === false) return [];
  const known = new Set(state.routes.map((r) => r.route));
  const added = [];
  for (const name of catalogFileNames) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const route = name.slice(0, -5);
    if (route.length === 0 || known.has(route)) continue;
    state.routes.push({ route, enabled: true, keep: [], exclude: [] });
    added.push(route);
  }
  return added;
}

/** 原子写 state。 */
export async function saveState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), "utf8");
  await rename(tmp, statePath);
}

/** state 文件是否已存在（区分"新建"与"更新"）。 */
export function stateExists(statePath) {
  return existsSync(statePath);
}

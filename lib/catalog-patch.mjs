/**
 * dsh-model-refresh —— 安装树 catalog 增量合入（纯函数，v0.2）。
 *
 * 背景：pi-ai 的 builtin catalog 是 `dist/providers/data/<route>.json` 的静态
 * import，dsh-llm-pi-ai 的 route 配置面无法为"安装目录不认识的新 id"提供
 * api（resolveRouteModels 只认 route 级 api / 安装目录 / 全目录共享协议）。
 * 把新模型写进安装树 JSON 是唯一让它们走官方 vendor 路径（api/compat/auth
 * 全部正确继承）的办法；pi-ai 整包升级会覆盖该文件，插件下一轮刷新重新合入。
 *
 * 归组（models.dev 没有 wire protocol 字段，按 provider.npm 线索映射）：
 *   @ai-sdk/anthropic    -> anthropic-messages
 *   @ai-sdk/openai       -> openai-responses
 *   其他 / 缺失          -> openai-completions（opencode-go 的多数第三方模型组）
 *
 * 刻意保守：新条目只写展示/容量/成本字段，不带 compat/thinkingLevelMap/
 * inputLimits 等 vendor 特定字段（没有依据，宁缺勿错）。
 */

/** models.dev 模型条目的 modalities.input -> pi-ai input 数组（只认 text/image）。 */
function toInput(model) {
  const list = Array.isArray(model?.modalities?.input) ? model.modalities.input : [];
  const out = [];
  if (list.includes("text")) out.push("text");
  if (list.includes("image")) out.push("image");
  return out.length > 0 ? out : ["text"];
}

/** 为一个新增 id 构造安装树 catalog 条目；容量缺失返回 undefined（不猜）。 */
export function buildCatalogEntry(route, group, model) {
  const context = model?.limit?.context;
  const output = model?.limit?.output;
  if (!Number.isFinite(context) || context <= 0) return undefined;
  if (!Number.isFinite(output) || output <= 0) return undefined;
  const entry = {
    id: model.id,
    name: model.name ?? model.id,
    api: group,
    provider: route,
    baseUrl: undefined, // 由调用方从同组现有条目补齐
    reasoning: model.reasoning === true,
    input: toInput(model),
    contextWindow: context,
    maxTokens: output
  };
  const cost = model.cost;
  if (cost !== null && typeof cost === "object") {
    const pick = (v) => (Number.isFinite(v) ? v : undefined);
    const c = {
      input: pick(cost.input),
      output: pick(cost.output),
      cacheRead: pick(cost.cache_read),
      cacheWrite: pick(cost.cache_write)
    };
    if (Object.values(c).some((v) => v !== undefined)) entry.cost = c;
  }
  return entry;
}

/** 按 provider.npm 推断 wire-protocol 分组名。 */
export function groupOf(model) {
  const npm = model?.provider?.npm;
  if (npm === "@ai-sdk/anthropic") return "anthropic-messages";
  if (npm === "@ai-sdk/openai") return "openai-responses";
  return "openai-completions";
}

/**
 * 把 added ids 合入一个安装树 route 数据对象。
 * @param dataObj  解析后的 <route>.json（{wire-protocol: {id: entry}}）
 * @param route    route 名
 * @param added    合并 diff.added
 * @param fresh    models.dev 的 models 映射
 * @param stale    合并 diff.stale（命名空间错位防御用）
 * @returns {{ next: object, patched: string[], skipped: string[], namespaceMismatch: string[] }}
 *          patched = 实际写入的 id；skipped = 无法构造条目被跳过的 id；
 *          namespaceMismatch = 命名空间错位嫌疑跳过的 id（如 "org/name" 的
 *          尾段命中 stale —— models.dev 换了 id 体系，不是真新模型）。
 */
export function applyCatalogPatch(dataObj, route, added, fresh, stale = []) {
  const next = structuredClone(dataObj);
  const patched = [];
  const skipped = [];
  const namespaceMismatch = [];
  const staleSet = new Set(stale);
  for (const id of added) {
    const model = fresh?.[id];
    if (model === undefined) { skipped.push(id); continue; }
    // 命名空间错位防御：added 与 stale 存在 "A/B" ↔ "B" 或 "A/B" ↔ "X/A/B"
    // 形式的对应（cloudflare-ai-gateway 实测两种都发生），说明 models.dev 换了
    // id 体系而不是真新模型——写入只会让目录翻倍。对称匹配覆盖两种错位方向。
    const tail = typeof id === "string" && id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : null;
    if (tail !== null && (staleSet.has(tail) ||
        [...staleSet].some((s) => s.endsWith("/" + id) || id.endsWith("/" + s)))) {
      namespaceMismatch.push(id);
      continue;
    }
    const group = groupOf(model);
    // 组是 {modelId: entry} 对象映射（不是数组）；只在缺失/形态不对时重建，
    // 绝不能整组重置（Array.isArray 判断曾把整个组清空，2026-10-03 事故根因）
    if (next[group] === null || typeof next[group] !== "object" || Array.isArray(next[group])) next[group] = {};
    // baseUrl 取同组任一现有条目（同组同端点；组为空时留空，物化走 providerBaseUrl）
    const siblings = Object.values(next[group]);
    const baseUrl = siblings.find((e) => typeof e?.baseUrl === "string" && e.baseUrl.length > 0)?.baseUrl;
    const entry = buildCatalogEntry(route, group, model);
    if (entry === undefined) { skipped.push(id); continue; }
    if (typeof baseUrl === "string") entry.baseUrl = baseUrl;
    next[group][id] = entry;
    patched.push(id);
  }
  return { next, patched, skipped, namespaceMismatch };
}

/**
 * 回滚：从数据对象里删掉台账记录的、我们写入的 id（只删自己的，不动官方条目）。
 * @returns 删除后的新对象与实际删除的 id 列表。
 */
export function rollbackCatalogPatch(dataObj, ledgerIds) {
  const next = structuredClone(dataObj);
  const removed = [];
  for (const id of ledgerIds) {
    for (const group of Object.keys(next)) {
      if (next[group] !== null && typeof next[group] === "object" && id in next[group]) {
        delete next[group][id];
        removed.push(id);
      }
    }
  }
  return { next, removed };
}

/**
 * 已知模型的元数据刷新（纯展示/容量/成本字段）：models.dev 的最新值
 * 覆盖 catalog 条目的 name/contextWindow/maxTokens/input/reasoning/cost。
 * 刻意不碰 api/baseUrl/compat/thinkingLevelMap/inputLimits 等 vendor 字段。
 * 只在值实际变化时改写；@returns {{ next: object, changed: string[] }}
 * （changed 为发生字段级变化的 id；无变化时 next 与入参逐字节等价）。
 */
export function refreshCatalogMetadata(dataObj, fresh) {
  const next = structuredClone(dataObj);
  const changed = [];
  const set = (entry, key, value) => {
    if (value === undefined) return false;
    if (JSON.stringify(entry[key]) === JSON.stringify(value)) return false;
    entry[key] = value;
    return true;
  };
  for (const group of Object.keys(next)) {
    const bucket = next[group];
    if (bucket === null || typeof bucket !== "object") continue;
    for (const [id, entry] of Object.entries(bucket)) {
      const md = fresh?.[id];
      if (md === null || typeof md !== "object") continue;
      let touched = false;
      if (typeof md.name === "string" && md.name.length > 0) touched = set(entry, "name", md.name) || touched;
      const ctx = md.limit?.context;
      if (Number.isFinite(ctx) && ctx > 0) touched = set(entry, "contextWindow", ctx) || touched;
      const out = md.limit?.output;
      if (Number.isFinite(out) && out > 0) touched = set(entry, "maxTokens", out) || touched;
      // 只刷新已有字段：不给官方条目新增 input/reasoning/cost（避免首轮大面积改写）
      if (Array.isArray(entry.input)) {
        const input = toInput(md);
        if (input.length > 0) touched = set(entry, "input", input) || touched;
      }
      if ("reasoning" in entry) touched = set(entry, "reasoning", md.reasoning === true) || touched;
      const cost = md.cost;
      if (cost !== null && typeof cost === "object" && entry.cost !== null && typeof entry.cost === "object") {
        const pick = (v) => (Number.isFinite(v) ? v : undefined);
        const c = {
          input: pick(cost.input),
          output: pick(cost.output),
          cacheRead: pick(cost.cache_read),
          cacheWrite: pick(cost.cache_write)
        };
        if (Object.values(c).some((v) => v !== undefined)) touched = set(entry, "cost", c) || touched;
      }
      if (touched) changed.push(id);
    }
  }
  return { next, changed };
}

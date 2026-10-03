/**
 * dsh-model-refresh —— 合并核心（纯函数，便于单独测试）。
 *
 * 输入：
 *   - installed：已安装 pi-ai catalog 中某 route 的条目映射
 *     （由 lib/index.js 从 dist/providers/data/<route>.json 展平而来，
 *      形如 { [modelId]: modelEntry }，entry 保留 pi-ai 原始字段如 api/baseUrl）。
 *   - fresh：models.dev 上同一 provider 的模型映射
 *     （api.json 里 providers[providerId].models，形如 { [modelId]: mdEntry }）。
 *   - options.keep：即使上游已移除也保留的 id 列表（用户冻结）。
 *   - options.exclude：永远不输出的 id 列表。
 *
 * 合并语义（与 llm-pi-ai 固定提交行为一致）：
 *   - 已知 id（installed 有）：catalog 字段为底，models.dev 新元数据逐字段覆盖；
 *   - 未知 id（仅 models.dev 有）：生成新条目，只带安全字段
 *     （id/name/contextWindow/maxTokens/input/reasoning），
 *     api/baseUrl 由 llm-pi-ai 从 route 继承（catalog route 已验证支持）；
 *   - 仅 installed 有：默认保留（这是「目录并集」，避免上游瞬时删除抖动），
 *     但在 diff 中标记 stale，供人决定是否加入 exclude。
 */

/** models.dev modalities.input 里 llm-pi-ai 路由条目认识的取值。 */
const KNOWN_INPUT = new Set(["text", "image"]);

/** 把 models.dev 的一个模型条目转换成 llm-pi-ai 路由 models 数组的条目。 */
export function fromModelsDev(md) {
  if (md === null || typeof md !== "object") return undefined;
  const id = typeof md.id === "string" && md.id.length > 0 ? md.id : undefined;
  if (id === undefined) return undefined;
  const entry = { id };
  if (typeof md.name === "string" && md.name.length > 0) entry.name = md.name;
  const context = md.limit?.context;
  if (typeof context === "number" && Number.isFinite(context) && context > 0) entry.contextWindow = context;
  const output = md.limit?.output;
  if (typeof output === "number" && Number.isFinite(output) && output > 0) entry.maxTokens = output;
  const inputs = Array.isArray(md.modalities?.input)
    ? md.modalities.input.filter((value) => KNOWN_INPUT.has(value))
    : undefined;
  if (inputs !== undefined && inputs.length > 0) entry.input = inputs;
  if (typeof md.reasoning === 'boolean') entry.reasoning = md.reasoning;
  return entry;
}

/**
 * options.dropStale     —— 设置页"移除过时模型"开关：stale 不进产物（keep 豁免）
 * options.official      —— Set<string>，官方接口核对后的可用模型 id 集合：
 *   installed id 官方还在 → 即使上游数据没有也不算 stale（近似数据源如
 *   litellm 的 moonshot/* ≠ kimi-coding 套餐，会误报 stale）；
 *   上游新增但官方列表没有 → 不算 added，进 diff.unverified 剔除。
 *   undefined = 未核对（保持纯上游语义）。
 * @returns {{ models: Array<object>, diff: { added: string[], updated: string[], stale: string[], excluded: string[], unverified: string[] } }}
 */
export function mergeRoute(installed, fresh, options = {}) {
  const keep = new Set(options.keep ?? []);
  const exclude = new Set(options.exclude ?? []);
  const dropStale = options.dropStale === true;
  const official = options.official instanceof Set ? options.official : undefined;
  const models = [];
  const diff = { added: [], updated: [], stale: [], excluded: [], unverified: [] };

  const installedIds = new Set(Object.keys(installed ?? {}));
  const freshIds = new Set(Object.keys(fresh ?? {}));

  // 1) installed 为底 + models.dev 新元数据覆盖。
  //    只投影 route 配置允许的字段（与手写 models 白名单同集）：
  //    vendor 级字段（compat/api/baseUrl/thinkingLevelMap/inputLimits/cost 等）
  //    由 pi-ai 安装目录 per-vendor 声明，route 里再写会触发
  //    "compat ... is not configurable here" 一类的配置校验错误（2026-10-03 实测），
  //    且 llm-pi-ai 物化时未指定的 catalog 字段会自动从安装目录继承。
  const ROUTE_FIELDS = ["id", "name", "contextWindow", "maxTokens", "input", "reasoning"];
  for (const [id, base] of Object.entries(installed ?? {})) {
    if (exclude.has(id)) { diff.excluded.push(id); continue; }
    const md = fresh?.[id];
    const entry = {};
    for (const key of ROUTE_FIELDS) {
      if (base[key] !== undefined) entry[key] = base[key];
    }
    if (md !== undefined) {
      const freshEntry = fromModelsDev(md);
      if (freshEntry !== undefined) {
        for (const key of ROUTE_FIELDS) {
          if (key === "id") continue;
          if (freshEntry[key] !== undefined) entry[key] = freshEntry[key];
        }
        diff.updated.push(id);
      }
    } else if (official !== undefined && official.has(id)) {
      // 官方接口确认仍存在：上游数据缺只是近似源覆盖问题，保留且不算 stale
    } else {
      // 上游已没有此 id。默认保留（防抖动）；dropStale=true（设置页"移除过时
      // 模型"开关）时剔除，keep 白名单里的 id 除外。diff.stale 照记供展示。
      diff.stale.push(id);
      if (dropStale && !keep.has(id)) continue;
    }
    models.push(entry);
  }

  // 2) 新增：models.dev 有、installed 没有的 id
  for (const [id, md] of Object.entries(fresh ?? {})) {
    if (installedIds.has(id)) continue;
    if (exclude.has(id)) { diff.excluded.push(id); continue; }
    // 官方接口核对：官方列表没有的"新增"不进产物（上游数据臆造/不适用）
    if (official !== undefined && !official.has(id)) { diff.unverified.push(id); continue; }
    const entry = fromModelsDev(md);
    if (entry === undefined || entry.id !== id) continue;
    // 新 id 需要可用的容量默认：缺 contextWindow 时不猜测，跳过并在日志可见
    if (entry.contextWindow === undefined) continue;
    models.push(entry);
    diff.added.push(id);
  }

  // 稳定排序：按 id
  models.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  for (const key of Object.keys(diff)) diff[key].sort();

  // keep 冻结列表只是语义声明：installed 侧默认就保留，这里只校验拼写
  const unknownKeep = [...keep].filter((id) => !installedIds.has(id) && !freshIds.has(id));
  if (unknownKeep.length > 0) diff.unknownKeep = unknownKeep;

  return { models, diff };
}

/**
 * 把已安装 catalog 的一个 route 数据文件展平成 { [modelId]: entry }。
 * pi-ai 0.87.1 的 <route>.json 结构是 { "<wire-protocol>": { "<modelId>": entry } }。
 */
export function flattenInstalled(routeData) {
  const installed = {};
  if (routeData === null || typeof routeData !== "object") return installed;
  for (const group of Object.values(routeData)) {
    if (group === null || typeof group !== "object") continue;
    for (const [id, entry] of Object.entries(group)) {
      if (entry === null || typeof entry !== "object") continue;
      installed[id] = entry;
    }
  }
  return installed;
}

/** 把合并结果渲染成可直接粘贴进 cordis.patch.yml 的 YAML 片段（约束形状，手写发射器）。 */
export function toYamlFragment(route, models) {
  const lines = [`${route}:`, "  models:"];
  for (const entry of models) {
    lines.push(`    - id: ${JSON.stringify(entry.id)}`);
    if (entry.name !== undefined) lines.push(`      name: ${JSON.stringify(entry.name)}`);
    if (entry.contextWindow !== undefined) lines.push(`      contextWindow: ${entry.contextWindow}`);
    if (entry.maxTokens !== undefined) lines.push(`      maxTokens: ${entry.maxTokens}`);
    if (entry.input !== undefined) lines.push(`      input: [${entry.input.join(", ")}]`);
    if (entry.reasoning === true) lines.push("      reasoning: true");
  }
  return lines.join("\n");
}

/**
 * Build an in-memory mirror catalog for a `refresh-*` route.
 *
 * Inputs:
 *   - installedModels: complete pi-ai model records from the installed catalog
 *     (the trusted baseline; their `api` values are the protocols this pi-ai
 *     build has proven it can serve).
 *   - upstreamModels: the newer pi-ai provider bucket, either complete records
 *     (`normalizePiAiRecords`) or the legacy normalized projection
 *     (`normalizePiAiCatalog`). Complete records are required to publish a new id.
 *   - routeConfig/settings: keep/exclude, removeStale + grace window.
 *   - official: optional positive evidence (Set, array, or fetchOfficialListing
 *     shape). It can confirm an id but never proves a model has a usable
 *     endpoint, and its absence never drives a removal on its own.
 *
 * The result is a complete runtime model array whose `provider` is rewritten to
 * the mirror route; nothing here writes the installed catalog or calls pi-ai.
 */
import { createHash } from 'node:crypto';
import { validRouteName } from './state.mjs';
import { normalizePiAiRecord } from './pi-ai-upstream.mjs';

const MAX_ROUTE_LENGTH = 128;
const MIRROR_PREFIX = 'refresh-';
const DANGEROUS_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const RECORD_FIELDS = ['name', 'type', 'api', 'reasoning', 'input', 'contextWindow', 'maxTokens',
  'cost', 'compat', 'thinkingLevelMap', 'inputLimits'];
// Installed records may keep their own local headers for dispatch; upstream
// headers are never introduced, so a mirror model cannot gain credential-bearing
// request headers from a catalog it did not originate from.
const OPTIONAL_FIELDS = ['cost', 'compat', 'thinkingLevelMap', 'inputLimits'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const stringList = value => Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string'))] : [];

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 512 && !/[\x00-\x1f\x7f]/.test(id) && !DANGEROUS_IDS.has(id);
}

function validBaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) return undefined;
    return value;
  } catch { return undefined; }
}
const urlKey = value => value.replace(/\/+$/, '');

function collisionSuffix(route) {
  return `-${createHash('sha256').update(route).digest('hex').slice(0, 8)}`;
}

function mirrorBaseName(route) {
  const prefixed = `${MIRROR_PREFIX}${route}`;
  if (prefixed.length <= MAX_ROUTE_LENGTH) return prefixed;
  const suffix = collisionSuffix(route);
  return `${MIRROR_PREFIX}${route.slice(0, MAX_ROUTE_LENGTH - MIRROR_PREFIX.length - suffix.length)}${suffix}`;
}

/**
 * Derive the mirror route name for one source route.
 *
 * A new `refresh-` prefix keeps the mirror out of the way of catalog routes and
 * of common `<vendor>-coding` names. Long source routes are truncated with a
 * deterministic hash suffix so the result always satisfies validRouteName.
 * `taken` (optional) lets a caller avoid names already present in its settings.
 *
 * @param route - an existing valid pi-ai route name.
 * @param taken - already-used route names (Set or array).
 * @returns a valid, deterministic `refresh-*` route name.
 */
export function mirrorRouteName(route, taken = []) {
  if (!validRouteName(route)) throw new Error('mirrorRouteName requires a valid pi-ai route name');
  const base = mirrorBaseName(route);
  const used = taken instanceof Set ? taken : new Set(stringList(taken));
  if (!used.has(base)) return base;
  for (let index = 2; index <= 999; index++) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, MAX_ROUTE_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('cannot derive a unique mirror route name');
}

function collectInstalled(installedModels, warnings) {
  if (!Array.isArray(installedModels)) throw new Error('installedModels must be an array of complete model records');
  const entries = new Map();
  for (const value of installedModels) {
    if (!record(value) || !validId(value.id)) { warnings.push('安装目录包含无效模型条目，已忽略'); continue; }
    if (typeof value.api !== 'string' || value.api.length === 0) { warnings.push(`${value.id}: 安装记录缺少 api，已忽略`); continue; }
    if (value.type !== undefined && value.type !== 'chat') { warnings.push(`${value.id}: 非 chat 安装条目，镜像路由不发布`); continue; }
    if (entries.has(value.id)) { warnings.push(`${value.id}: 安装目录重复条目，保留首个`); continue; }
    entries.set(value.id, structuredClone(value));
  }
  return entries;
}

/**
 * Normalize complete upstream records and legacy projections into one shape.
 *
 * Complete records are passed through the same validator the npm cache uses, so
 * only fields the mirror can verify reach the model. Projection rows can update
 * display metadata of an existing id but never publish a new one.
 */
function collectUpstream(upstreamModels, warnings) {
  if (upstreamModels === undefined || upstreamModels === null) return { available: false, byId: new Map() };
  let rows;
  if (Array.isArray(upstreamModels)) rows = upstreamModels.map(value => record(value) ? value : undefined);
  else if (record(upstreamModels)) rows = Object.entries(upstreamModels).map(([id, value]) => {
    if (!record(value)) return undefined;
    return value.id === undefined ? { ...value, id } : value;
  });
  else throw new Error('upstreamModels must be an array or a provider model record map');
  rows = rows.filter(Boolean);
  if (rows.length === 0) {
    warnings.push('上游 provider 目录为空或不可解析；保留已安装目录，不推断新增或缺失');
    return { available: false, byId: new Map() };
  }
  const byId = new Map();
  for (const value of rows) {
    if (!validId(value.id)) { warnings.push('上游目录包含无效模型 ID，已忽略'); continue; }
    if (typeof value.api === 'string' && typeof value.type === 'string') {
      const normalized = normalizePiAiRecord(value);
      byId.set(value.id, normalized === undefined
        ? { id: value.id, full: true, valid: false, record: value, reason: '上游记录不是有效 chat 模型（类型/容量/输入/协议不完整）' }
        : { id: value.id, full: true, valid: true, record: normalized });
      continue;
    }
    if (typeof value.piApi === 'string' || record(value.limit)) {
      byId.set(value.id, { id: value.id, full: false, valid: true, record: value });
      continue;
    }
    byId.set(value.id, { id: value.id, full: true, valid: false, record: value, reason: '上游记录缺少协议或容量字段' });
  }
  if (byId.size === 0) {
    warnings.push('上游 provider 目录没有可识别的模型记录；保留已安装目录，不推断新增或缺失');
    return { available: false, byId };
  }
  return { available: true, byId };
}

function officialEvidence(official) {
  if (official === undefined || official === null) return undefined;
  if (official instanceof Set) return { ids: official, complete: false };
  if (Array.isArray(official)) return { ids: new Set(official.filter(validId)), complete: false };
  if (record(official)) {
    const ids = official.ids instanceof Set ? official.ids
      : Array.isArray(official.ids) ? new Set(official.ids.filter(validId))
        : undefined;
    if (ids !== undefined) return { ids, complete: official.complete === true };
  }
  return undefined;
}

function previousMissing(previous) {
  const source = record(previous?.missing) ? previous.missing : record(previous) ? previous : {};
  const missing = {};
  for (const [id, value] of Object.entries(source)) {
    if (!validId(id) || !record(value) || !Number.isFinite(value.firstSeen)) continue;
    missing[id] = { firstSeen: value.firstSeen, count: Number.isSafeInteger(value.count) && value.count >= 0 ? value.count : 0 };
  }
  return missing;
}

function parseNow(now) {
  if (now === undefined) return Date.now();
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  if (typeof now === 'string' && Number.isFinite(Date.parse(now))) return Date.parse(now);
  throw new Error('now must be a finite timestamp, Date, or ISO string');
}

function descriptorApi(descriptor) {
  return descriptor.full ? descriptor.record.api : descriptor.record.piApi;
}
function descriptorInputs(descriptor) {
  const inputs = descriptor.full ? descriptor.record.input : descriptor.record.modalities?.input;
  return Array.isArray(inputs) ? inputs.filter(value => value === 'text' || value === 'image') : [];
}
function descriptorCapacity(descriptor) {
  const context = descriptor.full ? descriptor.record.contextWindow : descriptor.record.limit?.context;
  const output = descriptor.full ? descriptor.record.maxTokens : descriptor.record.limit?.output;
  return { context, output };
}

/**
 * Resolve the inference endpoint for one model.
 *
 * Priority is fail-closed: an explicit connection endpoint, the installed
 * record's own endpoint, the single installed endpoint for the same protocol,
 * and only then a baseUrl the complete pi-ai record explicitly provides. An
 * official listing URL or an approximate metadata source never supplies this.
 */
function resolveBaseUrl({ explicit, own, api, installedValues, upstreamRecord }) {
  if (explicit !== undefined) return explicit;
  const ownUrl = validBaseUrl(own);
  if (ownUrl !== undefined) return ownUrl;
  if (typeof api === 'string' && api.length > 0) {
    const urls = new Map();
    for (const value of installedValues) {
      if (value.api !== api) continue;
      const url = validBaseUrl(value.baseUrl);
      if (url !== undefined) urls.set(urlKey(url), url);
    }
    if (urls.size === 1) return [...urls.values()][0];
  }
  return validBaseUrl(upstreamRecord);
}

function overlayFullRecord(base, upstream) {
  const merged = structuredClone(base);
  for (const key of RECORD_FIELDS) if (upstream[key] !== undefined) merged[key] = structuredClone(upstream[key]);
  merged.provider = base.provider;
  return merged;
}

function overlayProjection(base, _descriptor, warnings) {
  // A legacy projection/models.dev row has lost vendor semantics. Do not erase
  // native reasoning/modes or resize a known model using approximate/old data.
  warnings.push(`${base.id}: 上游只有归一化投影，保留完整基线元数据；重新获取 pi-ai 包后才更新能力`);
  return structuredClone(base);
}

function buildNewRecord(upstream, { mirrorRoute, baseUrl }) {
  const entry = { id: upstream.id, name: upstream.name, type: 'chat', api: upstream.api, provider: mirrorRoute, baseUrl,
    reasoning: upstream.reasoning, input: [...upstream.input], contextWindow: upstream.contextWindow, maxTokens: upstream.maxTokens };
  for (const key of OPTIONAL_FIELDS) if (upstream[key] !== undefined) entry[key] = structuredClone(upstream[key]);
  return entry;
}

/**
 * Build the mirror catalog for one route.
 *
 * @param input.route - source pi-ai route name.
 * @param input.mirrorRoute - optional pre-derived `refresh-*` route name.
 * @param input.installedModels - complete installed model records (baseline).
 * @param input.upstreamModels - newer pi-ai provider bucket (complete records or projection).
 * @param input.routeConfig - `{ keep, exclude }` (other fields are ignored).
 * @param input.settings - `{ removeStale, staleGraceHours, staleConfirmations }`.
 * @param input.official - optional positive evidence (Set/array/listing result).
 * @param input.officialConfigured - whether official verification is configured.
 * @param input.officialConfig - accepted for host parity; never used as an endpoint.
 * @param input.previous - prior mirror runtime state carrying `missing`.
 * @param input.now - timestamp for grace-window math.
 * @param input.baseURL - explicit connection endpoint for this mirror route.
 * @param input.source/metadataSources - accepted for host parity and diagnostics only.
 * @returns `{ mirrorRoute, models, modelList, diff, pending, missing, warnings, officialAdded }`.
 */
export function buildMirrorCatalog(input = {}) {
  const { route, installedModels, upstreamModels, routeConfig, settings, official, officialConfigured,
    officialConfig, previous, now, baseURL } = record(input) ? input : {};
  if (!validRouteName(route)) throw new Error('buildMirrorCatalog requires a valid source route');
  const config = record(routeConfig) ? routeConfig : {};
  const options = record(settings) ? settings : {};
  const mirrorRoute = input.mirrorRoute ?? mirrorRouteName(route, config.taken ?? options.takenRoutes ?? []);
  if (!validRouteName(mirrorRoute)) throw new Error('mirrorRoute must be a valid route name');
  if (mirrorRoute === route) throw new Error('mirrorRoute must differ from the source route');
  let explicitBaseURL;
  if (baseURL !== undefined) {
    explicitBaseURL = validBaseUrl(baseURL);
    if (explicitBaseURL === undefined) throw new Error('baseURL must be an HTTP(S) URL without credentials');
  }
  if (officialConfig !== undefined && !record(officialConfig) && officialConfig !== null) throw new Error('officialConfig must be an object or null');

  const warnings = [];
  const installed = collectInstalled(installedModels, warnings);
  const installedValues = [...installed.values()];
  const installedApis = new Set(installedValues.map(value => value.api).filter(api => typeof api === 'string' && api.length > 0));
  const upstream = collectUpstream(upstreamModels, warnings);
  const evidence = officialEvidence(official);
  if (evidence && !evidence.complete) warnings.push('官方清单不完整；仅用于正向确认，不能驱动移除');
  if (!evidence && officialConfigured === true) warnings.push('官方核对未取得清单；新增模型保持 pending，不能仅凭上游目录发布');

  const keep = new Set(stringList(config.keep));
  const exclude = new Set(stringList(config.exclude));
  const removeStale = options.removeStale === true;
  const confirmations = Number.isSafeInteger(options.staleConfirmations) ? Math.max(2, options.staleConfirmations) : 2;
  const graceMs = Number.isFinite(options.staleGraceHours) ? Math.max(1, options.staleGraceHours) * 3_600_000 : 24 * 3_600_000;
  const nowMs = parseNow(now);
  const previousMissingMap = previousMissing(previous);
  // Any failure or partial evidence interrupts continuous-absence observation:
  // a removal can never be justified by data this run could not confirm.
  const missing = {};
  const diff = { added: [], updated: [], stale: [], excluded: [], unverified: [], pending: [], removed: [] };
  const pendingById = new Map();
  const pending = [];
  const defer = (id, reason) => {
    if (pendingById.has(id)) return;
    pendingById.set(id, reason);
    pending.push({ id, reason });
    diff.pending.push(id);
  };
  const models = [];
  const officialAdded = [];

  if (!upstream.available) warnings.push('上游目录不可用；保留已安装目录，不推断新增或缺失');

  for (const [id, base] of installed) {
    if (exclude.has(id)) { diff.excluded.push(id); continue; }
    const descriptor = upstream.byId.get(id);
    let entry = structuredClone(base);
    let changed = false;
    if (descriptor !== undefined && upstream.available) {
      if (!descriptor.valid) {
        warnings.push(`${id}: ${descriptor.reason}；保留安装记录`);
      } else {
        const upstreamApi = descriptorApi(descriptor);
        if (upstreamApi !== undefined && !installedApis.has(upstreamApi)) {
          warnings.push(`${id}: 上游协议 ${upstreamApi} 不在已安装 pi-ai 支持的协议内；保留旧模型 ${base.api}`);
        } else if (descriptor.full) {
          const before = JSON.stringify(entry);
          if (upstreamApi !== base.api) warnings.push(`${id}: 协议由 ${base.api} 更新为 ${upstreamApi}（已安装 pi-ai 支持）`);
          entry = overlayFullRecord(entry, descriptor.record);
          changed = JSON.stringify(entry) !== before;
        } else {
          const before = JSON.stringify(entry);
          entry = overlayProjection(entry, descriptor, warnings);
          changed = JSON.stringify(entry) !== before;
        }
      }
    } else if (upstream.available && descriptor === undefined) {
      if (evidence?.ids.has(id)) {
        // The official endpoint still lists it; absence from upstream is not stale.
      } else {
        diff.stale.push(id);
        // A removal needs authoritative negative evidence: a complete official
        // listing that omits the id. Without it, the observation stays broken
        // (no counter carried forward) and the model is only shown as stale.
        if (evidence?.complete === true) {
          const old = previousMissingMap[id];
          const observation = missing[id] = { firstSeen: Number.isFinite(old?.firstSeen) ? old.firstSeen : nowMs,
            count: (Number.isSafeInteger(old?.count) ? old.count : 0) + 1 };
          const ready = observation.count >= confirmations && nowMs - observation.firstSeen >= graceMs;
          if (removeStale && ready && !keep.has(id)) {
            diff.removed.push(id);
            warnings.push(`${id}: 连续缺失 ${observation.count} 次且超过宽限期，从内存镜像移除（未写入安装目录）`);
            continue;
          }
        }
      }
    }
    const own = entry.api === base.api ? entry.baseUrl : undefined;
    const resolved = resolveBaseUrl({ explicit: explicitBaseURL, own, api: entry.api, installedValues,
      upstreamRecord: descriptor?.valid && descriptor.full && descriptor.record.api === entry.api ? descriptor.record.baseUrl : undefined });
    if (resolved === undefined) {
      defer(id, '无法确定可信推理 baseUrl；不使用官方清单 URL');
      continue;
    }
    entry.id = id;
    entry.provider = mirrorRoute;
    entry.baseUrl = resolved;
    if (changed) diff.updated.push(id);
    models.push(entry);
  }

  for (const [id, descriptor] of upstream.byId) {
    if (installed.has(id)) continue;
    if (exclude.has(id)) { diff.excluded.push(id); continue; }
    if (evidence !== undefined && !evidence.ids.has(id)) { diff.unverified.push(id); continue; }
    // A configured-but-failed official check is not positive evidence: a new
    // model must wait for it instead of being published from upstream alone.
    if (evidence === undefined && officialConfigured === true) {
      defer(id, '官方核对未取得清单；新增模型需要官方确认后才能发布');
      continue;
    }
    if (!descriptor.valid) { defer(id, descriptor.reason); continue; }
    if (!descriptor.full) { defer(id, '上游缓存只有归一化投影，缺少完整 pi-ai 记录；需要重新获取 pi-ai 包'); continue; }
    const upstreamApi = descriptorApi(descriptor);
    if (!installedApis.has(upstreamApi)) {
      const supported = [...installedApis].sort().join(', ') || '无';
      defer(id, `上游模型协议 ${upstreamApi} 不在已安装 pi-ai 支持的协议内（${supported}）；需要升级 pi-ai`);
      continue;
    }
    const inputs = descriptorInputs(descriptor);
    if (!inputs.includes('text')) { defer(id, '上游模型不支持文本输入，不能作为聊天模型发布'); continue; }
    const { context, output } = descriptorCapacity(descriptor);
    if (!positive(context) || !positive(output) || output > context) { defer(id, '上游模型容量无效，不能发布'); continue; }
    const resolved = resolveBaseUrl({ explicit: explicitBaseURL, api: upstreamApi, installedValues, upstreamRecord: descriptor.record.baseUrl });
    if (resolved === undefined) { defer(id, '无法确定可信推理 baseUrl；不使用官方清单 URL'); continue; }
    models.push(buildNewRecord(descriptor.record, { mirrorRoute, baseUrl: resolved }));
    diff.added.push(id);
  }

  for (const id of evidence?.ids ?? []) {
    if (installed.has(id) || upstream.byId.has(id) || exclude.has(id)) continue;
    defer(id, '仅在官方清单中出现，缺少完整 pi-ai 记录；不能作为运行时模型发布');
    officialAdded.push(id);
  }

  models.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  if (diff.stale.length > 0 && evidence?.complete !== true) {
    warnings.push('缺少官方完整清单；上游缺失的模型只标记 stale，不累积移除观察');
  }
  for (const key of Object.keys(diff)) diff[key] = [...new Set(diff[key])].sort();
  pending.sort((left, right) => left.id.localeCompare(right.id));
  const addedSet = new Set(diff.added), staleSet = new Set(diff.stale), unverifiedSet = new Set(diff.unverified);
  const modelList = models.map(entry => ({
    id: entry.id, name: entry.name, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens,
    input: entry.input, reasoning: entry.reasoning === true,
    state: addedSet.has(entry.id) ? 'added' : staleSet.has(entry.id) ? 'stale' : 'ok',
  }));
  const servedIds = new Set(modelList.map(row => row.id));
  for (const item of pending) {
    if (servedIds.has(item.id)) continue;
    modelList.push({ id: item.id, state: 'pending', reason: item.reason });
    servedIds.add(item.id);
  }
  for (const id of unverifiedSet) {
    if (servedIds.has(id)) continue;
    modelList.push({ id, state: 'unverified', reason: '上游候选未获当前端点清单确认' });
    servedIds.add(id);
  }
  modelList.sort((left, right) => left.id.localeCompare(right.id));

  return { mirrorRoute, models, modelList, diff, pending, missing, warnings: [...new Set(warnings)], officialAdded: officialAdded.sort() };
}

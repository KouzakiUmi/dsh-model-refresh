/** Refresh the official pi-ai published catalog and normalize its chat models. */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { atomicWriteJson } from './host-io.mjs';
import { validModelId } from './official.mjs';

const PACKAGE = '@earendil-works/pi-ai';
const REGISTRY = 'https://registry.npmjs.org/@earendil-works/pi-ai/latest';
const CACHE_TTL = 6 * 60 * 60_000;
// v2 stores complete model records. A v1/legacy cache only holds the projection,
// which cannot supply pi-ai vendor fields (compat/thinkingLevelMap/inputLimits/
// cost) and therefore cannot prove a model is fully serviceable.
const CACHE_SCHEMA_VERSION = 2;
const MAX_TARBALL = 4 * 1024 * 1024;
const MAX_EXPANDED = 32 * 1024 * 1024;
const MAX_PROVIDERS = 256;
const MAX_MODELS = 100_000;
const MAX_CATALOG_NODES = 500_000;
const MAX_METADATA_NODES = 20_000;
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/i;
const PROTOCOLS = new Set(['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai']);
// Complete records keep any syntactically legal protocol so a newer pi-ai can
// surface "upgrade pi-ai" instead of silently losing the model. The normalized
// projection keeps the historical four-protocol filter.
const API_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/i;
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function *modelRecords(value, state, depth = 0) {
  if (!record(value) || depth > 8) return;
  if (++state.nodes > MAX_CATALOG_NODES) throw new Error('pi-ai catalog contains too many nested entries');
  if (typeof value.id === 'string' && typeof value.api === 'string' && typeof value.type === 'string') {
    yield value;
    return;
  }
  for (const child of Object.values(value)) yield* modelRecords(child, state, depth + 1);
}

/** Copy JSON metadata while rejecting values a model record cannot carry. */
function metadataValue(value, depth = 0, budget = { nodes: 0 }) {
  if (++budget.nodes > MAX_METADATA_NODES) throw new Error('pi-ai model metadata contains too many entries');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('pi-ai model metadata contains a non-finite number');
    return value;
  }
  if (typeof value !== 'object' || depth >= 8) throw new Error('pi-ai model metadata contains an unsupported value');
  if (Array.isArray(value)) {
    if (value.length > 512) throw new Error('pi-ai model metadata array is too large');
    return value.map(item => metadataValue(item, depth + 1, budget));
  }
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    output[key] = metadataValue(item, depth + 1, budget);
  }
  return output;
}

function optionalMetadata(value, validate) {
  if (value === undefined) return undefined;
  const copied = metadataValue(value);
  if (!record(copied) || !validate(copied)) throw new Error('pi-ai model metadata field has an invalid shape');
  return copied;
}
const numeric = value => value === undefined || Number.isFinite(value);
function validCost(value) {
  if (!['input', 'output', 'cacheRead', 'cacheWrite'].every(key => Number.isFinite(value[key]) && value[key] >= 0)) return false;
  if (value.tiers === undefined) return true;
  return Array.isArray(value.tiers) && value.tiers.every(tier => record(tier)
    && numeric(tier.inputTokensAbove) && numeric(tier.input) && numeric(tier.output)
    && numeric(tier.cacheRead) && numeric(tier.cacheWrite));
}
function validThinkingLevelMap(value) {
  return Object.entries(value).every(([level, wire]) => THINKING_LEVELS.has(level)
    && (wire === null || (typeof wire === 'string' && wire.length > 0)));
}

/**
 * Validate one complete pi-ai chat model record and rebuild it from known fields.
 *
 * The projection returned by {@link normalizePiAiCatalog} is intentionally lossy.
 * The mirror needs the vendor fields that drive pi-ai dispatch, so this keeps the
 * complete record and drops fields it cannot verify. Anything not listed here is
 * not needed to serve the model and never enters the cache.
 *
 * @param value - one catalog row (untrusted until validated).
 * @returns the validated complete record, or undefined when it cannot serve chat.
 */
export function normalizePiAiRecord(value) {
  if (!record(value) || value.type !== 'chat' || !validModelId(value.id)
    || typeof value.api !== 'string' || !API_PATTERN.test(value.api)) return undefined;
  const context = value.contextWindow, output = value.maxTokens;
  if (!Number.isSafeInteger(context) || context <= 0 || !Number.isSafeInteger(output) || output <= 0 || output > context) return undefined;
  let baseUrl;
  try { baseUrl = new URL(value.baseUrl); } catch { return undefined; }
  if (!['https:', 'http:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.hash) return undefined;
  if (!Array.isArray(value.input) || !value.input.includes('text') || !value.input.every(input => ['text', 'image'].includes(input))) return undefined;
  if (typeof value.reasoning !== 'boolean' || !record(value.cost)) return undefined;
  const result = {
    id: value.id,
    name: typeof value.name === 'string' && value.name.length > 0 ? value.name : value.id,
    type: 'chat',
    api: value.api,
    ...(typeof value.provider === 'string' && value.provider.length > 0 ? { provider: value.provider } : {}),
    baseUrl: baseUrl.href,
    reasoning: value.reasoning,
    input: [...value.input],
    contextWindow: context,
    maxTokens: output,
  };
  if (value.cost !== undefined) result.cost = optionalMetadata(value.cost, validCost);
  if (value.compat !== undefined) result.compat = optionalMetadata(value.compat, () => true);
  if (value.thinkingLevelMap !== undefined) result.thinkingLevelMap = optionalMetadata(value.thinkingLevelMap, validThinkingLevelMap);
  if (value.inputLimits !== undefined) result.inputLimits = optionalMetadata(value.inputLimits, () => true);
  return result;
}

/** Project validated complete records onto the shape persisted by v1 caches. */
export function projectPiAiRecords(records) {
  const projected = Object.create(null);
  for (const [provider, entries] of Object.entries(records ?? {})) {
    const rows = Object.create(null);
    for (const [id, value] of Object.entries(entries)) {
      // The legacy projection only ever described the four protocols pi-ai's
      // consumer understood; keep that filter so behavior does not change.
      if (!PROTOCOLS.has(value.api)) continue;
      rows[id] = { id, name: value.name, limit: { context: value.contextWindow, output: value.maxTokens },
        modalities: { input: [...value.input], output: ['text'] }, mode: 'chat', type: 'chat',
        reasoning: value.reasoning, piApi: value.api, piBaseUrl: value.baseUrl };
    }
    if (Object.keys(rows).length) projected[provider] = rows;
  }
  return projected;
}

export function normalizePiAiCatalog(models) {
  if (!record(models) || Object.keys(models).length > MAX_PROVIDERS) throw new Error('Invalid pi-ai provider catalog');
  let count = 0;
  const normalized = Object.create(null);
  const traversal = { nodes: 0 };
  for (const [provider, entries] of Object.entries(models)) {
    if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(provider) || !record(entries)) continue;
    const rows = Object.create(null);
    for (const value of modelRecords(entries, traversal)) {
      if (!record(value) || value.type !== 'chat' || !validModelId(value.id) || !['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].includes(value.api)) continue;
      const context = value.contextWindow, output = value.maxTokens;
      if (!Number.isSafeInteger(context) || context <= 0 || !Number.isSafeInteger(output) || output <= 0 || output > context) continue;
      let baseUrl;
      try { baseUrl = new URL(value.baseUrl); } catch { continue; }
      if (!['https:', 'http:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.hash) continue;
      if (!Array.isArray(value.input) || !value.input.includes('text')) continue;
      const meta = { id: value.id, name: typeof value.name === 'string' ? value.name : value.id,
        limit: { context, output }, modalities: { input: value.input.filter(x => ['text', 'image'].includes(x)), output: ['text'] },
        mode: 'chat', type: 'chat', reasoning: Boolean(value.reasoning), piApi: value.api, piBaseUrl: baseUrl.href };
      rows[value.id] = meta;
      if (++count > MAX_MODELS) throw new Error('pi-ai catalog contains too many chat models');
    }
    if (Object.keys(rows).length) normalized[provider] = rows;
  }
  if (!count) throw new Error('pi-ai catalog contains no supported chat models');
  return normalized;
}

/**
 * Normalize the catalog's complete chat records for the mirror route.
 *
 * Unlike {@link normalizePiAiCatalog}, this keeps `compat`, `thinkingLevelMap`,
 * `inputLimits` and `cost`. Provider-supplied request `headers` are deliberately
 * dropped: a mirror model must not gain arbitrary credential-bearing headers
 * from an upstream catalog. The result is the authoritative source for building
 * a mirror snapshot; the projection above remains for callers that only render
 * capacity metadata.
 *
 * @param models - raw provider-mapped pi-ai catalog (nested buckets allowed).
 * @returns `{ [provider]: { [modelId]: completeRecord } }`.
 */
export function normalizePiAiRecords(models) {
  if (!record(models) || Object.keys(models).length > MAX_PROVIDERS) throw new Error('Invalid pi-ai provider catalog');
  let count = 0;
  const normalized = Object.create(null);
  const traversal = { nodes: 0 };
  for (const [provider, entries] of Object.entries(models)) {
    if (!PROVIDER_PATTERN.test(provider) || !record(entries)) continue;
    const rows = Object.create(null);
    for (const value of modelRecords(entries, traversal)) {
      const normalizedRecord = normalizePiAiRecord(value);
      if (normalizedRecord === undefined) continue;
      rows[normalizedRecord.id] = normalizedRecord;
      if (++count > MAX_MODELS) throw new Error('pi-ai catalog contains too many chat models');
    }
    if (Object.keys(rows).length) normalized[provider] = rows;
  }
  if (!count) throw new Error('pi-ai catalog contains no supported chat models');
  return normalized;
}

function unpackTarball(tarball, integrity) {
  if (!(tarball instanceof Uint8Array) || tarball.byteLength > MAX_TARBALL) throw new Error('pi-ai package exceeds the download limit');
  const expected = String(integrity ?? '').split(/\s+/).find(item => item.startsWith('sha512-'));
  const actual = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  if (!expected || expected !== actual) throw new Error('pi-ai npm package integrity check failed');
  const archive = gunzipSync(tarball, { maxOutputLength: MAX_EXPANDED });
  const files = Object.create(null);
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const text = (from, size) => archive.subarray(offset + from, offset + from + size).toString('utf8').replace(/\0.*$/s, '');
    const length = Number.parseInt(text(124, 12).trim() || '0', 8);
    const filename = text(0, 100);
    if (!Number.isSafeInteger(length) || length < 0 || offset + 512 + length > archive.length) throw new Error('Malformed pi-ai npm archive');
    if (filename.startsWith('package/dist/providers/data/') && filename.endsWith('.json') && !filename.includes('..')) {
      if (filename === 'package/dist/providers/data/.manifest.json') files.manifest = JSON.parse(archive.subarray(offset + 512, offset + 512 + length).toString('utf8'));
      else if (/^package\/dist\/providers\/data\/[a-z0-9][a-z0-9_.-]{0,127}\.json$/i.test(filename)) files[filename.slice('package/dist/providers/data/'.length, -5)] = archive.subarray(offset + 512, offset + 512 + length);
    }
    offset += 512 + Math.ceil(length / 512) * 512;
  }
  const manifest = files.manifest;
  if (!record(manifest?.files) || Object.keys(files).length - 1 < Object.keys(manifest.files).length) throw new Error('pi-ai package is missing catalog files');
  const models = Object.create(null);
  for (const [filename, expectedHash] of Object.entries(manifest.files)) {
    const provider = filename.slice(0, -5), body = files[provider];
    if (!body || createHash('sha256').update(body).digest('hex') !== expectedHash) throw new Error(`pi-ai provider data failed its checksum: ${provider}`);
    models[provider] = JSON.parse(body.toString('utf8'));
  }
  return models;
}

// Legacy v1 cache rows are normalized metadata, not raw pi-ai records. Rebuild
// only known fields and reuse the upstream validator; every cached row must
// survive validation.
function validateCachedModels(models) {
  if (!record(models) || Object.keys(models).length > MAX_PROVIDERS) throw new Error('Invalid pi-ai cached provider catalog');
  const raw = Object.create(null);
  let count = 0;
  for (const [provider, entries] of Object.entries(models)) {
    if (!/^[a-z0-9][a-z0-9_.-]{0,127}$/i.test(provider) || !record(entries) || !Object.keys(entries).length) throw new Error('Invalid pi-ai cached provider');
    const rows = raw[provider] = Object.create(null);
    for (const [id, value] of Object.entries(entries)) {
      if (++count > MAX_MODELS) throw new Error('pi-ai cache contains too many chat models');
      if (!record(value) || value.id !== id || typeof value.name !== 'string' || value.mode !== 'chat' || value.type !== 'chat'
        || typeof value.reasoning !== 'boolean' || !record(value.limit) || !record(value.modalities)
        || !Array.isArray(value.modalities.input) || !value.modalities.input.includes('text')
        || !value.modalities.input.every(input => ['text', 'image'].includes(input))
        || !Array.isArray(value.modalities.output) || value.modalities.output.length !== 1 || value.modalities.output[0] !== 'text') {
        throw new Error('Invalid pi-ai cached model');
      }
      rows[id] = { id, name: value.name, type: 'chat', reasoning: value.reasoning,
        api: value.piApi, baseUrl: value.piBaseUrl, contextWindow: value.limit.context,
        maxTokens: value.limit.output, input: value.modalities.input };
    }
  }
  const normalized = normalizePiAiCatalog(raw);
  if (Object.values(normalized).reduce((n, entries) => n + Object.keys(entries).length, 0) !== count) throw new Error('Invalid pi-ai cached model evidence');
  return normalized;
}

// v2 cache rows are complete records. Validate every untrusted field by
// rebuilding through the same validator used for downloaded packages; any
// unknown or malformed field invalidates the whole cache entry rather than
// being silently trusted.
function validateCachedRecords(records) {
  if (!record(records) || Object.keys(records).length > MAX_PROVIDERS) throw new Error('Invalid pi-ai cached provider records');
  const rebuilt = Object.create(null);
  let count = 0;
  for (const [provider, entries] of Object.entries(records)) {
    if (!PROVIDER_PATTERN.test(provider) || !record(entries) || !Object.keys(entries).length) throw new Error('Invalid pi-ai cached provider');
    const rows = rebuilt[provider] = Object.create(null);
    for (const [id, value] of Object.entries(entries)) {
      if (++count > MAX_MODELS) throw new Error('pi-ai cache contains too many chat models');
      if (!record(value) || value.id !== id || !validModelId(id)) throw new Error('Invalid pi-ai cached model record');
      const normalized = normalizePiAiRecord(value);
      if (normalized === undefined || normalized.id !== id || Object.keys(value).some(key => !Object.hasOwn(normalized, key))) {
        throw new Error('Invalid pi-ai cached model record');
      }
      rows[id] = normalized;
    }
  }
  if (!count) throw new Error('pi-ai cache contains no chat models');
  return { records: rebuilt, models: projectPiAiRecords(rebuilt) };
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;
function cacheHeader(data) {
  if (!record(data) || data.package !== PACKAGE || typeof data.version !== 'string' || !VERSION_PATTERN.test(data.version)
    || typeof data.checkedAt !== 'string' || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('Invalid pi-ai cache schema');
  return { package: PACKAGE, version: data.version, checkedAt: data.checkedAt };
}

async function readCache(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data?.schemaVersion === CACHE_SCHEMA_VERSION) {
      const header = cacheHeader(data);
      const { records, models } = validateCachedRecords(data.records);
      return { schemaVersion: CACHE_SCHEMA_VERSION, ...header, models, records, recordsComplete: true };
    }
    // Pre-versioned releases (and the v1 release) wrote the normalized shape.
    // Keep it as legacy evidence, but flag that it cannot back a mirror model.
    if (!record(data) || (data.schemaVersion !== undefined && data.schemaVersion !== 1)) throw new Error('Invalid pi-ai cache schema');
    const header = cacheHeader(data);
    return { schemaVersion: 1, ...header, models: validateCachedModels(data.models), records: undefined, recordsComplete: false };
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

export async function refreshPiAiCatalog({ file, fetchJson, fetchBytes, signal, force = false, now = Date.now() }) {
  let previous;
  try { previous = await readCache(file); } catch { /* An invalid cache is never used as model evidence. */ }
  if (!force && previous && now - Date.parse(previous.checkedAt) < CACHE_TTL) return { ...previous, source: previous.recordsComplete ? 'pi-ai cache' : 'pi-ai legacy cache' };
  try {
    const manifest = await fetchJson(REGISTRY);
    if (manifest?.name !== PACKAGE || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) throw new Error('Unexpected pi-ai npm package manifest');
    const dist = manifest.dist;
    const expectedUrl = `https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-${manifest.version}.tgz`;
    if (dist?.tarball !== expectedUrl) throw new Error('Unexpected pi-ai package download URL');
    let models, records;
    if (previous?.version === manifest.version && previous.recordsComplete) {
      models = previous.models;
      records = previous.records;
    } else {
      // A same-version legacy cache cannot be reused: it has no complete records.
      records = normalizePiAiRecords(unpackTarball(await fetchBytes(expectedUrl, MAX_TARBALL), dist.integrity));
      models = projectPiAiRecords(records);
    }
    const result = { schemaVersion: CACHE_SCHEMA_VERSION, package: PACKAGE, version: manifest.version, checkedAt: new Date(now).toISOString(), models, records, recordsComplete: true };
    // Persist complete records only; the projection is derived on read so the
    // cache cannot drift into two disagreeing representations.
    await atomicWriteJson(file, { schemaVersion: CACHE_SCHEMA_VERSION, package: PACKAGE, version: manifest.version,
      checkedAt: result.checkedAt, records }, { signal });
    return { ...result, source: 'pi-ai upstream' };
  } catch (error) {
    if (!previous) throw error;
    return { ...previous, source: 'pi-ai cached', staleError: error instanceof Error ? error.message : String(error) };
  }
}

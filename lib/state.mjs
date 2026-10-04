import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { atomicWriteJson } from './host-io.mjs';
import { validateManualModel } from './manual-models.mjs';

export const STATE_VERSION = 3;
export const DEFAULT_SETTINGS = Object.freeze({
  endpoint: 'https://models.dev/api.json', intervalMinutes: 360, proxyUrl: '',
  patchCatalog: false, autoDiscover: true, removeStale: false,
  litellmEnabled: true, officialVerify: true,
  litellmUrl: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  staleGraceHours: 24, staleConfirmations: 2,
});
const dangerous = new Set(['__proto__', 'constructor', 'prototype']);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validRouteName = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value) && !dangerous.has(value);

export function validHttpUrl(value, { empty = false } = {}) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (empty && text === '') return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) return undefined;
    return url.href;
  } catch { return undefined; }
}
export function validProxyUrl(value) { return validHttpUrl(value, { empty: true }); }

function stringList(value, field) {
  if (!Array.isArray(value) || value.length > 10_000 || value.some((x) => typeof x !== 'string' || x.length > 1024)) throw new Error(`${field} must be an array of model IDs`);
  return [...new Set(value)];
}
function finiteNumber(value, field, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${field} must be ${integer ? 'an integer' : 'a number'} in [${min}, ${max}]`);
  return value;
}
function routeMap(value, field, parse) {
  if (!record(value)) throw new Error(`${field} must be an object`);
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (!validRouteName(key)) throw new Error(`${field}: invalid route name`);
    output[key] = parse(item, `${field}.${key}`);
  }
  return output;
}
function officialConfig(value, field) {
  if (value === null) return null;
  if (!record(value)) throw new Error(`${field} must be an object or null`);
  const output = {};
  const allowed = new Set(['apiKeyEnv', 'baseUrl', 'endpoint', 'protocol', 'contextWindow', 'maxTokens', 'reasoning', 'input', 'name', 'auth', 'complete', 'assumeChat']);
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) throw new Error(`${field}: unknown field ${key}`);
    if (key === 'apiKeyEnv') {
      if (typeof item !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(item)) throw new Error(`${field}.apiKeyEnv must be an environment/credential reference name`);
      output[key] = item;
    } else if (key === 'baseUrl' || key === 'endpoint') {
      const url = validHttpUrl(item);
      if (url === undefined) throw new Error(`${field}.${key} must be an HTTP(S) URL without credentials`);
      output[key] = url;
    } else if (key === 'protocol') {
      if (!['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'].includes(item)) throw new Error(`${field}.protocol is unsupported`);
      output[key] = item;
    } else if (key === 'contextWindow' || key === 'maxTokens') {
      output[key] = finiteNumber(item, `${field}.${key}`, 1, 100_000_000, true);
    } else if (key === 'reasoning' || key === 'complete' || key === 'assumeChat') {
      if (typeof item !== 'boolean') throw new Error(`${field}.${key} must be boolean`);
      output[key] = item;
    } else if (key === 'auth') {
      if (!['bearer', 'anthropic', 'none'].includes(item)) throw new Error(`${field}.auth is unsupported`);
      output[key] = item;
    } else if (key === 'input') {
      const inputs = stringList(item, `${field}.input`);
      if (inputs.length === 0 || inputs.some((x) => !['text', 'image', 'audio', 'video', 'file'].includes(x))) throw new Error(`${field}.input contains unsupported modalities`);
      output[key] = inputs;
    } else {
      if (typeof item !== 'string' || item.length > 256) throw new Error(`${field}.name must be a short string`);
      output[key] = item;
    }
  }
  if (output.contextWindow !== undefined && output.maxTokens !== undefined && output.maxTokens > output.contextWindow) throw new Error(`${field}: maxTokens must not exceed contextWindow`);
  return output;
}

/** Validate the whole patch before mutating configuration. Secrets are never accepted here. */
export function validateSettingsPatch(patch) {
  if (!record(patch)) throw new Error('settings must be an object');
  const output = {};
  for (const [key, value] of Object.entries(patch)) {
    if (['endpoint', 'litellmUrl'].includes(key)) {
      const url = validHttpUrl(value);
      if (url === undefined) throw new Error(`${key} must be an HTTP(S) URL without credentials`);
      output[key] = url;
    } else if (key === 'proxyUrl') {
      const url = validProxyUrl(value);
      if (url === undefined) throw new Error('proxyUrl must be HTTP(S), without credentials, or empty');
      output[key] = url;
    } else if (['patchCatalog', 'autoDiscover', 'removeStale', 'litellmEnabled', 'officialVerify'].includes(key)) {
      if (typeof value !== 'boolean') throw new Error(`${key} must be boolean`);
      output[key] = value;
    } else if (key === 'intervalMinutes') output[key] = finiteNumber(value, key, 1, 35_000, true);
    else if (key === 'staleGraceHours') output[key] = finiteNumber(value, key, 1, 8760);
    else if (key === 'staleConfirmations') output[key] = finiteNumber(value, key, 2, 100, true);
    else if (key === 'outputDir') {
      if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value.includes('\0')) throw new Error('outputDir must be a nonempty path');
      output[key] = value;
    } else if (key === 'litellmRoutes') {
      output[key] = routeMap(value, key, (item, field) => {
        if (item === null) return null;
        if (typeof item !== 'string' || item.length === 0 || item.length > 256) throw new Error(`${field} must be a nonempty prefix or null`);
        return item;
      });
    } else if (key === 'manualModels') output[key] = routeMap(value, key, (items, field) => {
      if (!Array.isArray(items) || items.length > 1000) throw new Error(`${field} must be a bounded model array`);
      const parsed = items.map(validateManualModel);
      if (new Set(parsed.map(m => m.id)).size !== parsed.length) throw new Error(`${field}: duplicate model IDs`);
      return parsed;
    });
    else if (key === 'officialRoutes') output[key] = routeMap(value, key, officialConfig);
    else throw new Error(`unknown settings field: ${key}`);
  }
  return output;
}

function normalizeRoutes(routes, warnings) {
  if (!Array.isArray(routes)) return [];
  const seen = new Set();
  const output = [];
  for (const item of routes) {
    if (!record(item) || !validRouteName(item.route) || seen.has(item.route)) {
      warnings.push('Ignored duplicate or unsafe route entry');
      continue;
    }
    seen.add(item.route);
    if (item.as !== undefined && (typeof item.as !== 'string' || item.as.length > 256)) throw new Error(`Invalid provider alias for ${item.route}`);
    output.push({ route: item.route, ...(item.as ? { as: item.as } : {}), enabled: item.enabled !== false,
      keep: stringList(item.keep ?? [], `${item.route}.keep`), exclude: stringList(item.exclude ?? [], `${item.route}.exclude`) });
  }
  return output;
}
function validateRuntimeMaps(runtime) {
  const safeId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 1024 && !/[\x00-\x1f\x7f]/.test(id) && !dangerous.has(id);
  const safeGroup = (group) => typeof group === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(group) && !dangerous.has(group);
  for (const key of ['catalogPatched', 'catalogRemoved', 'catalogOwned', 'perRoute', 'missing', 'conflicts']) {
    for (const route of Object.keys(runtime[key])) if (!validRouteName(route)) throw new Error(`Unsafe route in runtime.${key}`);
  }
  for (const [route, ledger] of Object.entries(runtime.catalogPatched)) stringList(ledger, `catalogPatched.${route}`);
  for (const [route, ledger] of Object.entries(runtime.catalogOwned)) {
    if (!Array.isArray(ledger)) throw new Error(`Invalid catalogOwned.${route}`);
    for (const item of ledger) {
      if (!record(item) || !safeId(item.id) || !safeGroup(item.group) || ![item.before, item.after].every((entry) => entry === null || (record(entry) && entry.id === item.id))) throw new Error(`Invalid owned catalog record for ${route}`);
    }
  }
  for (const [route, backups] of Object.entries(runtime.catalogRemoved)) {
    if (!record(backups)) throw new Error(`Invalid catalogRemoved.${route}`);
    for (const [id, backup] of Object.entries(backups)) {
      if (!safeId(id) || !record(backup) || !safeGroup(backup.group) || !record(backup.entry) || backup.entry.id !== id) throw new Error(`Invalid legacy catalog backup for ${route}`);
    }
  }
}

async function readOptionalJson(file) {
  if (!file) return undefined;
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error(`Cannot safely load state/config at ${file}: ${error.message}`, { cause: error });
  }
}

export async function loadState(statePath, seedConfigPath) {
  const doc = await readOptionalJson(statePath);
  if (doc !== undefined && (!record(doc) || ![1, 2, STATE_VERSION].includes(doc.version))) throw new Error('Unsupported state version; original file was not overwritten');
  const seed = doc === undefined ? await readOptionalJson(seedConfigPath) : undefined;
  if (seed !== undefined && !record(seed)) throw new Error('Seed config must be an object');
  const warnings = [];
  const source = doc?.settings ?? seed?.settings ?? seed ?? {};
  // A v0.1 seed also contains routes; only the documented setting keys are imported.
  const known = new Set([...Object.keys(DEFAULT_SETTINGS), 'outputDir', 'litellmRoutes', 'officialRoutes', 'manualModels']);
  const imported = Object.fromEntries(Object.entries(source).filter(([key]) => known.has(key)));
  const settings = { ...DEFAULT_SETTINGS, litellmRoutes: {}, officialRoutes: {}, manualModels: {}, ...validateSettingsPatch(imported) };
  const previous = record(doc?.runtime) ? doc.runtime : {};
  const runtime = { catalogPatched: {}, catalogRemoved: {}, catalogOwned: {}, perRoute: {}, missing: {}, conflicts: {},
    ...previous, running: false, restartRequired: false, catalogWritable: null,
    lastRun: typeof previous.lastRun === 'string' ? previous.lastRun : null,
    lastError: typeof previous.lastError === 'string' ? previous.lastError : null };
  for (const key of ['catalogPatched', 'catalogRemoved', 'catalogOwned', 'perRoute', 'missing', 'conflicts']) {
    if (!record(runtime[key])) throw new Error(`Invalid runtime.${key}; state was not overwritten`);
  }
  validateRuntimeMaps(runtime);
  if (doc !== undefined && doc.version < STATE_VERSION) {
    runtime.legacyProtected = { ...(record(previous.legacyProtected) ? previous.legacyProtected : {}) };
    for (const [route, ledger] of Object.entries(runtime.catalogPatched)) {
      if (!validRouteName(route)) throw new Error('Unsafe route in legacy catalog ledger');
      if (Array.isArray(ledger) && ledger.length > 0) runtime.legacyProtected[route] = stringList(ledger, `catalogPatched.${route}`);
    }
    warnings.push(`Migrated state v${doc.version} to v${STATE_VERSION}; legacy ID-only ownership is protected from automatic deletion`);
  }
  runtime.migrationWarnings = [...new Set([...(Array.isArray(previous.migrationWarnings) ? previous.migrationWarnings.filter((x) => typeof x === 'string') : []), ...warnings])];
  return { version: STATE_VERSION, settingsRevision: Number.isSafeInteger(doc?.settingsRevision) && doc.settingsRevision >= 0 ? doc.settingsRevision : 0,
    settings, routes: normalizeRoutes(doc?.routes ?? seed?.routes, runtime.migrationWarnings), runtime };
}

export function discoverRoutes(state, catalogFileNames) {
  if (state.settings.autoDiscover === false) return [];
  const known = new Set(state.routes.map((item) => item.route));
  const added = [];
  for (const file of catalogFileNames) {
    if (!file.endsWith('.json') || file.startsWith('.')) continue;
    const route = file.slice(0, -5);
    if (!validRouteName(route) || known.has(route)) continue;
    known.add(route);
    state.routes.push({ route, enabled: false, keep: [], exclude: [], discovered: true });
    added.push(route);
  }
  return added;
}
export function saveState(file, state, options) { return atomicWriteJson(file, state, options); }
export function stateExists(file) { return existsSync(file); }

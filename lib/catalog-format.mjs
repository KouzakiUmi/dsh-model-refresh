/** Read chat rows without changing the installed catalog's keys or other model kinds. */
import { validateCatalog } from './planner.mjs';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function chatKey(key, entry) {
  if (!record(entry) || typeof entry.id !== 'string') throw new Error(`invalid catalog entry: ${key}`);
  if (key === entry.id || key === `chat:${entry.id}`) return true;
  // Other typed rows remain opaque, but a mismatched id is never silently repaired.
  if (key.endsWith(`:${entry.id}`) && key.length > entry.id.length + 1) return false;
  throw new Error(`invalid catalog entry key: ${key}`);
}
export function normalizeCatalog(document) {
  if (!record(document)) throw new Error('catalog must be a protocol object');
  const catalog = Object.create(null);
  for (const [api, bucket] of Object.entries(document)) {
    if (!record(bucket)) throw new Error(`invalid catalog bucket: ${api}`);
    const entries = Object.create(null);
    for (const [key, entry] of Object.entries(bucket)) {
      if (!chatKey(key, entry)) continue;
      if (Object.hasOwn(entries, entry.id)) throw new Error(`duplicate catalog entry: ${api}/${entry.id}`);
      entries[entry.id] = entry;
    }
    catalog[api] = entries;
  }
  return validateCatalog(catalog);
}
export function mergeCatalogDocument(document, catalog) {
  validateCatalog(catalog);
  const next = structuredClone(document);
  const typed = Object.values(document).some(bucket => Object.entries(bucket).some(([key, entry]) => key !== entry.id));
  for (const api of new Set([...Object.keys(document), ...Object.keys(catalog)])) {
    const bucket = next[api] ??= {};
    const keys = new Map();
    for (const [key, entry] of Object.entries(bucket)) {
      if (chatKey(key, entry)) { keys.set(entry.id, key); delete bucket[key]; }
    }
    for (const [id, entry] of Object.entries(catalog[api] ?? {})) {
      const key = keys.get(id) ?? (typed ? `chat:${id}` : id);
      Object.defineProperty(bucket, key, { value: structuredClone(entry), enumerable: true, writable: true, configurable: true });
    }
  }
  return next;
}

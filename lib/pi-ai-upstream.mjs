/** Refresh the official pi-ai published catalog and normalize its chat models. */
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { atomicWriteJson } from './host-io.mjs';
import { validModelId } from './official.mjs';

const PACKAGE = '@earendil-works/pi-ai';
const REGISTRY = 'https://registry.npmjs.org/@earendil-works/pi-ai/latest';
const CACHE_TTL = 6 * 60 * 60_000;
const MAX_TARBALL = 4 * 1024 * 1024;
const MAX_EXPANDED = 32 * 1024 * 1024;
const MAX_PROVIDERS = 256;
const MAX_MODELS = 100_000;
const MAX_CATALOG_NODES = 500_000;
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

async function readCache(file) {
  try {
    const data = JSON.parse(await readFile(file, 'utf8'));
    if (data.package !== PACKAGE || typeof data.version !== 'string' || typeof data.checkedAt !== 'string') return undefined;
    return { ...data, models: normalizePiAiCatalog(data.models) };
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

export async function refreshPiAiCatalog({ file, fetchJson, fetchBytes, signal, force = false, now = Date.now() }) {
  let previous;
  try { previous = await readCache(file); } catch { /* An invalid cache is never used as model evidence. */ }
  if (!force && previous && now - Date.parse(previous.checkedAt) < CACHE_TTL) return { ...previous, source: 'pi-ai cache' };
  try {
    const manifest = await fetchJson(REGISTRY);
    if (manifest?.name !== PACKAGE || typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) throw new Error('Unexpected pi-ai npm package manifest');
    const dist = manifest.dist;
    const expectedUrl = `https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-${manifest.version}.tgz`;
    if (dist?.tarball !== expectedUrl) throw new Error('Unexpected pi-ai package download URL');
    let models;
    if (previous?.version === manifest.version) models = previous.models;
    else models = normalizePiAiCatalog(unpackTarball(await fetchBytes(expectedUrl, MAX_TARBALL), dist.integrity));
    const result = { package: PACKAGE, version: manifest.version, checkedAt: new Date(now).toISOString(), models };
    await atomicWriteJson(file, result, { signal });
    return { ...result, source: 'pi-ai upstream' };
  } catch (error) {
    if (!previous) throw error;
    return { ...previous, source: 'pi-ai cached', staleError: error instanceof Error ? error.message : String(error) };
  }
}

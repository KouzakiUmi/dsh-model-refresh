import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizePiAiCatalog, refreshPiAiCatalog } from '../lib/pi-ai-upstream.mjs';

const model = (id, api = 'openai-responses') => ({
  id,
  name: id.toUpperCase(),
  api,
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  type: 'chat',
  contextWindow: 128_000,
  maxTokens: 16_384,
  input: ['text', 'image'],
  reasoning: true,
});

// Current pi-ai packages nest models below API protocol buckets and use keys
// such as "chat:gpt-4". Older releases exposed models directly under provider.
const catalog = normalizePiAiCatalog({
  openai: {
    'openai-responses': {
      'chat:gpt-4.1': model('gpt-4.1'),
      'chat:gpt-4.1-mini': model('gpt-4.1-mini'),
    },
    'openai-completions': {
      'chat:gpt-3.5-turbo': model('gpt-3.5-turbo', 'openai-completions'),
    },
  },
  google: {
    'google-generative-ai': {
      'chat:gemini-2.5-pro': model('gemini-2.5-pro', 'google-generative-ai'),
    },
  },
});

assert.deepEqual(Object.keys(catalog.openai).sort(), ['gpt-3.5-turbo', 'gpt-4.1', 'gpt-4.1-mini']);
assert.equal(catalog.openai['gpt-4.1'].limit.context, 128_000);
assert.equal(catalog.openai['gpt-4.1'].limit.output, 16_384);
assert.deepEqual(catalog.openai['gpt-4.1'].modalities.input, ['text', 'image']);
assert.equal(catalog.openai['gpt-4.1'].piApi, 'openai-responses');
assert.equal(catalog.google['gemini-2.5-pro'].piApi, 'google-generative-ai');

const legacy = normalizePiAiCatalog({ openai: { 'gpt-4-legacy': model('gpt-4-legacy') } });
assert.equal(legacy.openai['gpt-4-legacy'].piApi, 'openai-responses', 'legacy flat catalogs remain supported');

assert.throws(() => normalizePiAiCatalog({ openai: { 'openai-responses': { 'tool:x': { type: 'tool' } } } }),
  /contains no supported chat models/);

// Construct a published-package fixture in memory; injected fetchers never use the network.
function tarEntry(filename, body) {
  const header = Buffer.alloc(512);
  header.write(filename);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}
const providerData = Buffer.from(JSON.stringify({ 'openai-responses': { 'chat:gpt-4.1': model('gpt-4.1') } }));
const packageManifest = Buffer.from(JSON.stringify({ files: {
  'openai.json': createHash('sha256').update(providerData).digest('hex'),
} }));
const tarball = gzipSync(Buffer.concat([
  tarEntry('package/dist/providers/data/.manifest.json', packageManifest),
  tarEntry('package/dist/providers/data/openai.json', providerData), Buffer.alloc(1024),
]));
const npmManifest = { name: '@earendil-works/pi-ai', version: '1.2.3', dist: {
  tarball: 'https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-1.2.3.tgz',
  integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
} };
const expectedModels = normalizePiAiCatalog({ openai: JSON.parse(providerData.toString()) });
const now = Date.parse('2026-10-12T00:00:00Z');
const ttl = 6 * 60 * 60_000;
const dir = await mkdtemp(path.join(tmpdir(), 'refresh-pi-ai-cache-'));
console.log('isolated temp directory:', dir);
try {
  const file = path.join(dir, 'pi-ai-upstream.json');
  let jsonCalls = 0, byteCalls = 0;
  const fetchJson = async url => {
    jsonCalls++;
    assert.equal(url, 'https://registry.npmjs.org/@earendil-works/pi-ai/latest');
    return structuredClone(npmManifest);
  };
  const fetchBytes = async (url, limit) => {
    byteCalls++;
    assert.equal(url, npmManifest.dist.tarball);
    assert.ok(tarball.length < limit);
    return tarball;
  };
  const args = { file, fetchJson, fetchBytes, now };
  const fresh = await refreshPiAiCatalog(args);
  assert.equal(fresh.source, 'pi-ai upstream');
  assert.deepEqual(fresh.models, expectedModels);
  assert.deepEqual([jsonCalls, byteCalls], [1, 1]);
  const persisted = JSON.parse(await readFile(file, 'utf8'));

  const noNetwork = async () => { assert.fail('fresh cache must not request the network'); };
  const cached = await refreshPiAiCatalog({ ...args, now: now + ttl - 1, fetchJson: noNetwork, fetchBytes: noNetwork });
  assert.equal(cached.source, 'pi-ai cache');
  assert.deepEqual(cached.models, fresh.models, 'fresh cache roundtrip preserves normalized metadata');
  assert.equal(persisted.schemaVersion, 1);

  const renewed = await refreshPiAiCatalog({ ...args, now: now + ttl, fetchBytes: noNetwork });
  assert.equal(renewed.source, 'pi-ai upstream');
  assert.deepEqual(renewed.models, fresh.models);
  assert.equal(renewed.checkedAt, new Date(now + ttl).toISOString());
  assert.deepEqual([jsonCalls, byteCalls], [2, 1], 'expired same-version cache only checks the manifest');
  const forced = await refreshPiAiCatalog({ ...args, now: now + ttl + 1, force: true, fetchBytes: noNetwork });
  assert.equal(forced.source, 'pi-ai upstream');
  assert.deepEqual([jsonCalls, byteCalls], [3, 1], 'force bypasses TTL but still reuses verified same-version models');

  const beforeOffline = await readFile(file, 'utf8');
  let offlineCalls = 0;
  const offline = async () => { offlineCalls++; throw new Error('fixture offline'); };
  const stale = await refreshPiAiCatalog({ ...args, now: now + ttl * 2 + 1, fetchJson: offline, fetchBytes: noNetwork });
  assert.equal(stale.source, 'pi-ai cached');
  assert.equal(stale.staleError, 'fixture offline');
  assert.equal(stale.checkedAt, forced.checkedAt);
  assert.deepEqual(stale.models, fresh.models);
  assert.equal(await readFile(file, 'utf8'), beforeOffline, 'offline fallback must not renew stale evidence');
  assert.equal(offlineCalls, 1);

  // Pre-fix caches stored normalized models without a schema version.
  const oldCache = structuredClone(persisted);
  delete oldCache.schemaVersion;
  oldCache.untrusted = 'not model evidence';
  oldCache.models.openai['gpt-4.1'].untrusted = 'not model metadata';
  await writeFile(file, JSON.stringify(oldCache));
  const oldFresh = await refreshPiAiCatalog({ ...args, fetchJson: noNetwork, fetchBytes: noNetwork });
  assert.equal(oldFresh.source, 'pi-ai cache');
  assert.deepEqual(oldFresh.models, fresh.models);
  assert.equal(oldFresh.untrusted, undefined, 'unvalidated cache fields are not returned');
  const oldStale = await refreshPiAiCatalog({ ...args, now: now + ttl, fetchJson: offline, fetchBytes: noNetwork });
  assert.equal(oldStale.source, 'pi-ai cached');
  assert.deepEqual(oldStale.models, fresh.models);
  const migrated = await refreshPiAiCatalog({ ...args, now: now + ttl, fetchBytes: noNetwork });
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 1);

  const invalidCases = [
    ['unsupported schema', cache => { cache.schemaVersion = 2; }],
    ['null schema', cache => { cache.schemaVersion = null; }],
    ['wrong package', cache => { cache.package = 'unrelated'; }],
    ['invalid timestamp', cache => { cache.checkedAt = 'not a date'; }],
    ['invalid version', cache => { cache.version = ''; }],
    ['unsupported protocol', cache => { cache.models.openai['gpt-4.1'].piApi = 'unsupported'; }],
    ['invalid URL', cache => { cache.models.openai['gpt-4.1'].piBaseUrl = 'file:///fixture'; }],
    ['URL credentials', cache => { cache.models.openai['gpt-4.1'].piBaseUrl = 'https://user:fake@fixture.invalid'; }],
    ['invalid limits', cache => { cache.models.openai['gpt-4.1'].limit.output = 999_999; }],
    ['missing text input', cache => { cache.models.openai['gpt-4.1'].modalities.input = ['image']; }],
    ['unsupported input', cache => { cache.models.openai['gpt-4.1'].modalities.input.push('audio'); }],
    ['unsupported output', cache => { cache.models.openai['gpt-4.1'].modalities.output = ['image']; }],
    ['wrong model key', cache => { cache.models.openai['gpt-4.1'].id = 'different-id'; }],
    ['wrong mode', cache => { cache.models.openai['gpt-4.1'].mode = 'tool'; }],
    ['wrong type', cache => { cache.models.openai['gpt-4.1'].type = 'tool'; }],
    ['invalid reasoning', cache => { cache.models.openai['gpt-4.1'].reasoning = 'true'; }],
    ['invalid name', cache => { cache.models.openai['gpt-4.1'].name = null; }],
    ['mixed invalid model', cache => { cache.models.openai.invalid = { ...cache.models.openai['gpt-4.1'], id: 'invalid', piApi: 'unsupported' }; }],
    ['mixed invalid provider', cache => { cache.models['bad/provider'] = cache.models.openai; }],
  ];
  for (const [label, mutate] of invalidCases) {
    const invalid = structuredClone(persisted);
    mutate(invalid);
    await writeFile(file, JSON.stringify(invalid));
    await assert.rejects(() => refreshPiAiCatalog({ ...args, fetchJson: offline, fetchBytes: noNetwork }), /fixture offline/, label);
  }
  await writeFile(file, '{broken json');
  await assert.rejects(() => refreshPiAiCatalog({ ...args, fetchJson: offline, fetchBytes: noNetwork }), /fixture offline/);
  // Invalid cache cannot skip the package download even when its claimed version matches.
  await writeFile(file, JSON.stringify({ ...persisted, schemaVersion: 2 }));
  const repaired = await refreshPiAiCatalog(args);
  assert.equal(repaired.source, 'pi-ai upstream');
  assert.deepEqual(repaired.models, fresh.models);
  assert.equal(byteCalls, 2);
  console.log('PI-AI CACHE TESTS PASSED: fresh roundtrip, TTL, same-version reuse, force, offline stale fallback, legacy migration, invalid-cache rejection');
} finally {
  // Only the verified mkdtemp directory is removed, never the real cache.
  assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(dir, { recursive: true, force: true });
}
console.log('pi-ai upstream catalog normalization passed');

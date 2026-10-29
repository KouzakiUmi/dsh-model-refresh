import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizePiAiCatalog, normalizePiAiRecord, normalizePiAiRecords, projectPiAiRecords, refreshPiAiCatalog } from '../lib/pi-ai-upstream.mjs';

const fullModel = (id, api = 'openai-responses', extra = {}) => ({
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
  cost: { input: 1.5, output: 6, cacheRead: 0.15, cacheWrite: 1.5, tiers: [{ inputTokensAbove: 100_000, input: 3, output: 12 }] },
  compat: { supportsStore: false, thinkingFormat: 'openai', chatTemplateKwargs: { enable_thinking: { $var: 'thinking', omitWhenOff: true } } },
  thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null },
  inputLimits: { images: { maxPerMessage: 20, resize: { maxWidth: 2000, maxHeight: 2000, maxBytes: 4_718_592, jpegQuality: 80 } } },
  headers: { Authorization: 'Bearer fixture-not-a-real-key' },
  ...extra,
});

// Current pi-ai packages nest models below API protocol buckets and use keys
// such as "chat:gpt-4". Older releases exposed models directly under provider.
const rawCatalog = {
  openai: {
    'openai-responses': {
      'chat:gpt-4.1': fullModel('gpt-4.1'),
      'chat:gpt-4.1-mini': fullModel('gpt-4.1-mini'),
    },
    'openai-completions': {
      'chat:gpt-3.5-turbo': fullModel('gpt-3.5-turbo', 'openai-completions'),
    },
  },
  google: {
    'google-generative-ai': {
      'chat:gemini-2.5-pro': fullModel('gemini-2.5-pro', 'google-generative-ai'),
    },
  },
};
const catalog = normalizePiAiCatalog(rawCatalog);
assert.deepEqual(Object.keys(catalog.openai).sort(), ['gpt-3.5-turbo', 'gpt-4.1', 'gpt-4.1-mini']);
assert.equal(catalog.openai['gpt-4.1'].limit.context, 128_000);
assert.equal(catalog.openai['gpt-4.1'].piApi, 'openai-responses');
assert.equal(catalog.google['gemini-2.5-pro'].piApi, 'google-generative-ai');

// The mirror needs complete records; every vendor field survives validation.
const records = normalizePiAiRecords(rawCatalog);
const gpt = records.openai['gpt-4.1'];
assert.deepEqual(gpt.compat, rawCatalog.openai['openai-responses']['chat:gpt-4.1'].compat);
assert.deepEqual(gpt.thinkingLevelMap, rawCatalog.openai['openai-responses']['chat:gpt-4.1'].thinkingLevelMap);
assert.deepEqual(gpt.inputLimits, rawCatalog.openai['openai-responses']['chat:gpt-4.1'].inputLimits);
assert.deepEqual(gpt.cost, rawCatalog.openai['openai-responses']['chat:gpt-4.1'].cost);
assert.equal(gpt.headers, undefined, 'upstream request headers are never mirrored into cache evidence');
assert.equal(normalizePiAiRecord({ ...gpt, headers: { Authorization: 'Bearer fixture' } }).headers, undefined);
assert.equal(gpt.type, 'chat');
assert.equal(gpt.api, 'openai-responses');
assert.deepEqual(projectPiAiRecords(records), catalog, 'record projection matches the normalized catalog');
assert.equal(normalizePiAiRecord(gpt).id, 'gpt-4.1');
assert.equal(normalizePiAiRecord({ ...gpt, baseUrl: 'file:///fixture' }), undefined);
assert.equal(normalizePiAiRecord({ ...gpt, type: 'embedding' }), undefined);
assert.equal(normalizePiAiRecord({ ...gpt, cost: undefined }), undefined, 'new runtime models require the cost structure read by pi-ai usage serializers');
assert.throws(() => normalizePiAiRecord({ ...gpt, cost: { input: 0 } }), /invalid shape/);
assert.throws(() => normalizePiAiRecord({ ...gpt, cost: { ...gpt.cost, output: -1 } }), /invalid shape/);

const legacy = normalizePiAiCatalog({ openai: { 'gpt-4-legacy': fullModel('gpt-4-legacy') } });
assert.equal(legacy.openai['gpt-4-legacy'].piApi, 'openai-responses', 'legacy flat catalogs remain supported');

// A syntactically legal protocol this build does not know is retained in the
// complete records (so the mirror can report "upgrade pi-ai"), while the legacy
// projection keeps its historical four-protocol filter.
const futureCatalog = { openai: { 'future-protocol': { 'chat:future-model': fullModel('future-model', 'future-protocol') } } };
assert.throws(() => normalizePiAiCatalog(futureCatalog), /contains no supported chat models/);
const futureRecords = normalizePiAiRecords(futureCatalog);
assert.equal(futureRecords.openai['future-model'].api, 'future-protocol');
assert.deepEqual(Object.keys(projectPiAiRecords(futureRecords)), [], 'projection keeps the legacy protocol filter');
assert.throws(() => normalizePiAiRecords({ openai: { 'future-protocol': { 'chat:bad': fullModel('bad', 'bad api!') } } }),
  /contains no supported chat models/);

assert.throws(() => normalizePiAiCatalog({ openai: { 'openai-responses': { 'tool:x': { type: 'tool' } } } }),
  /contains no supported chat models/);
assert.throws(() => normalizePiAiRecords({ openai: { 'openai-responses': { 'tool:x': { type: 'tool' } } } }),
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
const packageRaw = { 'openai-responses': { 'chat:gpt-4.1': fullModel('gpt-4.1') } };
const providerData = Buffer.from(JSON.stringify(packageRaw));
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
const expectedModels = normalizePiAiCatalog({ openai: packageRaw });
const expectedRecords = normalizePiAiRecords({ openai: packageRaw });
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
  assert.equal(fresh.recordsComplete, true);
  assert.deepEqual(fresh.models, expectedModels);
  assert.deepEqual(fresh.records, expectedRecords);
  assert.deepEqual([jsonCalls, byteCalls], [1, 1]);
  const persisted = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(persisted.schemaVersion, 2);
  assert.deepEqual(persisted.records, JSON.parse(JSON.stringify(expectedRecords)));
  assert.equal(persisted.models, undefined, 'the cache stores complete records, not a duplicate projection');

  const noNetwork = async () => { assert.fail('fresh cache must not request the network'); };
  const cached = await refreshPiAiCatalog({ ...args, now: now + ttl - 1, fetchJson: noNetwork, fetchBytes: noNetwork });
  assert.equal(cached.source, 'pi-ai cache');
  assert.deepEqual(cached.models, fresh.models, 'fresh cache roundtrip preserves normalized metadata');
  assert.deepEqual(cached.records, fresh.records, 'fresh cache roundtrip preserves complete records');
  assert.equal(cached.recordsComplete, true);

  const renewed = await refreshPiAiCatalog({ ...args, now: now + ttl, fetchBytes: noNetwork });
  assert.equal(renewed.source, 'pi-ai upstream');
  assert.deepEqual(renewed.records, fresh.records);
  assert.equal(renewed.checkedAt, new Date(now + ttl).toISOString());
  assert.deepEqual([jsonCalls, byteCalls], [2, 1], 'expired same-version cache only checks the manifest');
  const forced = await refreshPiAiCatalog({ ...args, now: now + ttl + 1, force: true, fetchBytes: noNetwork });
  assert.equal(forced.source, 'pi-ai upstream');
  assert.deepEqual([jsonCalls, byteCalls], [3, 1], 'force bypasses TTL but still reuses verified same-version records');

  const beforeOffline = await readFile(file, 'utf8');
  let offlineCalls = 0;
  const offline = async () => { offlineCalls++; throw new Error('fixture offline'); };
  const stale = await refreshPiAiCatalog({ ...args, now: now + ttl * 2 + 1, fetchJson: offline, fetchBytes: noNetwork });
  assert.equal(stale.source, 'pi-ai cached');
  assert.equal(stale.staleError, 'fixture offline');
  assert.equal(stale.checkedAt, forced.checkedAt);
  assert.deepEqual(stale.records, fresh.records);
  assert.equal(await readFile(file, 'utf8'), beforeOffline, 'offline fallback must not renew stale evidence');
  assert.equal(offlineCalls, 1);

  // A v1 cache only carries the projection. It stays usable for capacity
  // metadata but never claims to back a complete mirror model.
  await writeFile(file, JSON.stringify({ schemaVersion: 1, package: '@earendil-works/pi-ai', version: '1.2.3',
    checkedAt: new Date(now).toISOString(), models: fresh.models, untrusted: 'not model evidence' }));
  const legacyFresh = await refreshPiAiCatalog({ ...args, fetchJson: noNetwork, fetchBytes: noNetwork });
  assert.equal(legacyFresh.source, 'pi-ai legacy cache');
  assert.equal(legacyFresh.schemaVersion, 1);
  assert.equal(legacyFresh.recordsComplete, false);
  assert.equal(legacyFresh.records, undefined);
  assert.deepEqual(legacyFresh.models, fresh.models);
  assert.equal(legacyFresh.untrusted, undefined, 'unvalidated cache fields are not returned');
  const legacyExpired = await refreshPiAiCatalog({ ...args, now: now + ttl });
  assert.equal(legacyExpired.source, 'pi-ai upstream', 'a same-version legacy cache cannot skip the full package download');
  assert.equal(byteCalls, 2);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 2);

  // Pre-versioned releases wrote the same legacy normalized shape.
  const oldCache = { package: '@earendil-works/pi-ai', version: '1.2.3', checkedAt: new Date(now).toISOString(), models: fresh.models };
  await writeFile(file, JSON.stringify(oldCache));
  const oldFresh = await refreshPiAiCatalog({ ...args, fetchJson: noNetwork, fetchBytes: noNetwork });
  assert.equal(oldFresh.source, 'pi-ai legacy cache');
  assert.equal(oldFresh.recordsComplete, false);
  const oldStale = await refreshPiAiCatalog({ ...args, now: now + ttl * 2, fetchJson: offline, fetchBytes: noNetwork });
  assert.equal(oldStale.source, 'pi-ai cached');
  assert.equal(oldStale.staleError, 'fixture offline');
  assert.equal(oldStale.recordsComplete, false);
  assert.deepEqual(oldStale.models, fresh.models);
  const migrated = await refreshPiAiCatalog({ ...args, now: now + ttl });
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 2);

  // A legal protocol this build does not implement survives the cache so the
  // mirror can report "upgrade pi-ai" instead of losing the model silently.
  const futureCache = JSON.parse(JSON.stringify({ schemaVersion: 2, package: '@earendil-works/pi-ai', version: '1.2.3',
    checkedAt: new Date(now).toISOString(), records: persisted.records }));
  futureCache.records.openai['gpt-4.1'].api = 'future-protocol';
  await writeFile(file, JSON.stringify(futureCache));
  const futureCached = await refreshPiAiCatalog({ ...args, fetchJson: noNetwork, fetchBytes: noNetwork });
  assert.equal(futureCached.source, 'pi-ai cache');
  assert.equal(futureCached.records.openai['gpt-4.1'].api, 'future-protocol');
  assert.deepEqual(Object.keys(futureCached.models), [], 'the legacy projection still omits unknown protocols');

  const record = () => structuredClone(persisted.records);
  const invalidCases = [
    ['unsupported schema', cache => { cache.schemaVersion = 3; }],
    ['null schema', cache => { cache.schemaVersion = null; }],
    ['wrong package', cache => { cache.package = 'unrelated'; }],
    ['invalid timestamp', cache => { cache.checkedAt = 'not a date'; }],
    ['invalid version', cache => { cache.version = ''; }],
    ['wrong model key', cache => { cache.records.openai['gpt-4.1-x'] = cache.records.openai['gpt-4.1']; delete cache.records.openai['gpt-4.1']; }],
    ['illegal protocol syntax', cache => { cache.records.openai['gpt-4.1'].api = 'bad api!'; }],
    ['protocol is not a string', cache => { cache.records.openai['gpt-4.1'].api = 7; }],
    ['invalid URL', cache => { cache.records.openai['gpt-4.1'].baseUrl = 'file:///fixture'; }],
    ['URL credentials', cache => { cache.records.openai['gpt-4.1'].baseUrl = 'https://user:fake@fixture.invalid'; }],
    ['invalid limits', cache => { cache.records.openai['gpt-4.1'].maxTokens = 999_999; }],
    ['missing text input', cache => { cache.records.openai['gpt-4.1'].input = ['image']; }],
    ['unsupported input', cache => { cache.records.openai['gpt-4.1'].input.push('audio'); }],
    ['wrong type', cache => { cache.records.openai['gpt-4.1'].type = 'tool'; }],
    ['invalid reasoning', cache => { cache.records.openai['gpt-4.1'].reasoning = 'true'; }],
    ['invalid compat', cache => { cache.records.openai['gpt-4.1'].compat = 'not an object'; }],
    ['invalid thinking level map', cache => { cache.records.openai['gpt-4.1'].thinkingLevelMap.ultra = 'ultra'; }],
    ['invalid cost', cache => { cache.records.openai['gpt-4.1'].cost = 'free'; }],
    ['unknown record field', cache => { cache.records.openai['gpt-4.1'].untrusted = 'not model metadata'; }],
    ['upstream headers are not cache evidence', cache => { cache.records.openai['gpt-4.1'].headers = { Authorization: 'Bearer fixture' }; }],
    ['mixed invalid provider', cache => { cache.records['bad/provider'] = cache.records.openai; }],
    ['empty records', cache => { cache.records = {}; }],
  ];
  for (const [label, mutate] of invalidCases) {
    const invalid = { schemaVersion: 2, package: '@earendil-works/pi-ai', version: '1.2.3',
      checkedAt: new Date(now).toISOString(), records: record() };
    mutate(invalid);
    await writeFile(file, JSON.stringify(invalid));
    await assert.rejects(() => refreshPiAiCatalog({ ...args, fetchJson: offline, fetchBytes: noNetwork }), /fixture offline/, label);
  }
  await writeFile(file, '{broken json');
  await assert.rejects(() => refreshPiAiCatalog({ ...args, fetchJson: offline, fetchBytes: noNetwork }), /fixture offline/);
  // Invalid cache cannot skip the package download even when its claimed version matches.
  await writeFile(file, JSON.stringify({ schemaVersion: 2, package: '@earendil-works/pi-ai', version: '1.2.3',
    checkedAt: new Date(now).toISOString(), records: { broken: true } }));
  const repaired = await refreshPiAiCatalog(args);
  assert.equal(repaired.source, 'pi-ai upstream');
  assert.deepEqual(repaired.records, fresh.records);
  assert.equal(byteCalls, 4);
  console.log('PI-AI CACHE TESTS PASSED: complete-record roundtrip, TTL, same-version reuse, force, offline stale fallback, v1/unversioned legacy downgrade, invalid-cache rejection');
} finally {
  // Only the verified mkdtemp directory is removed, never the real cache.
  assert.ok(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(dir, { recursive: true, force: true });
}
console.log('pi-ai upstream catalog normalization passed');

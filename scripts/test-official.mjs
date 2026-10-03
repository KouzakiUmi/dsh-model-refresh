import assert from 'node:assert/strict';
import { catalogBaseUrl, parseOfficialModels, fetchOfficialListing, fetchOfficialIds, officialCapacity } from '../lib/official.mjs';
assert.equal(catalogBaseUrl({ a: { x: { baseUrl: 'https://a/v1' } } }), 'https://a/v1');
assert.equal(catalogBaseUrl({ a: { x: { baseUrl: 'https://a' } }, b: { y: { baseUrl: 'https://b' } } }), undefined);
assert.deepEqual([...parseOfficialModels({ data: [{ id: 'a' }, { id: 'a' }, { id: '__proto__' }] })], ['a']);
assert.throws(() => parseOfficialModels({ error: 'not models' }), /清单/);
assert.deepEqual(officialCapacity({}, {}), { context: undefined, output: undefined });
const calls = [];
const fake = async (url, init) => {
  calls.push({ url, init });
  return url.endsWith('/coding/models') ? { status: 404, ok: false } : { status: 200, ok: true,
    json: async () => ({ data: [{ id: 'new', context_length: 8192, max_output_tokens: 1024 }] }) };
};
const listing = await fetchOfficialListing('https://api.kimi.com/coding', 'fake-only', fake, { complete: true });
assert.equal(listing.complete, true);
assert.deepEqual([...listing.ids], ['new']);
assert.equal(listing.models.new.limit.context, 8192);
assert.equal(calls.length, 2);
assert.equal(calls[0].init.redirect, 'error');
assert.equal(calls[1].init.headers.authorization, 'Bearer fake-only');
await assert.rejects(() => fetchOfficialIds('https://x', undefined, fake), e => e.code === 'MISSING_KEY');
let authCalls = 0;
await assert.rejects(() => fetchOfficialIds('https://x', 'fake', async () => {
  authCalls++; return { status: 401, ok: false };
}), e => e.code === 'INVALID_KEY');
assert.equal(authCalls, 1, '401 must not be used as endpoint proof or trigger another credentialed candidate');
for (const body of [{ data: [] }, { error: 'no' }]) await assert.rejects(() => fetchOfficialListing('https://x', 'f', async () => ({ ok: true, json: async () => body })));
const partial = await fetchOfficialListing('https://x', 'f', async () => ({ ok: true,
  json: async () => ({ data: [{ id: 'one' }], has_more: true }) }), { complete: true });
assert.equal(partial.complete, false);
const notAuthoritative = await fetchOfficialListing('https://x', 'f', async () => ({ ok: true, json: async () => ({ data: [{ id: 'one' }] }) }));
assert.equal(notAuthoritative.complete, false);
await assert.rejects(() => fetchOfficialListing('http://evil.example', 'f', fake), e => e.code === 'INVALID_URL');
let anthropicHeaders;
await fetchOfficialListing(undefined, 'fake', async (_url, init) => {
  anthropicHeaders = init.headers;
  return { ok: true, json: async () => ({ models: { m: { contextWindow: 100, maxTokens: 10 } } }) };
}, { endpoint: 'https://example.com/v1/models', auth: 'anthropic' });
assert.equal(anthropicHeaders['x-api-key'], 'fake');
assert.equal(anthropicHeaders.authorization, undefined);
const linked = await fetchOfficialListing('https://x', 'f', async () => ({ ok: true,
  headers: { get: name => name === 'link' ? '<https://x/models?cursor=2>; rel="next"' : null },
  json: async () => ({ data: [{ id: 'one' }] }) }), { complete: true });
assert.equal(linked.complete, false, 'HTTP pagination is also partial evidence');
const typed = await fetchOfficialListing('https://x', 'f', async () => ({ ok: true,
  json: async () => ({ data: [{ id: 'embed', mode: 'embedding', context_length: 8192, max_output_tokens: 1024 }] }) }));
assert.equal(typed.models.embed.mode, 'embedding');
console.log('OFFICIAL TESTS PASSED (fake credentials, no network)');

import assert from 'node:assert/strict';
import { normalizePiAiCatalog } from '../lib/pi-ai-upstream.mjs';

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

console.log('pi-ai upstream catalog normalization passed');

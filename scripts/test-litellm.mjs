import assert from 'node:assert/strict';
import { DEFAULT_LITELLM_ROUTES, litellmProviderModels, fromLitellmEntry, litellmRouteModels } from '../lib/litellm.mjs';
const raw = {
  'fireworks_ai/accounts/fireworks/models/chat': { mode: 'chat', max_input_tokens: 131072, max_output_tokens: 16384,
    input_cost_per_token: 0.0000009, output_cost_per_token: 0.0000012, input_modalities: ['text'] },
  'fireworks_ai/embedding': { mode: 'embedding', max_tokens: 512 },
  'together_ai/other': { mode: 'chat', max_input_tokens: 32768, max_output_tokens: 8192 }
};
const fw = litellmProviderModels(raw, 'fireworks_ai');
assert.deepEqual(Object.keys(fw).sort(), ['accounts/fireworks/models/chat', 'embedding']);
assert.deepEqual(litellmProviderModels(raw, 'absent'), {});
const c = fromLitellmEntry('accounts/fireworks/models/chat', fw['accounts/fireworks/models/chat']);
assert.equal(c.limit.context, 131072);
assert.equal(c.cost.input, 0.9);
assert.equal(c.cost.output, 1.2);
assert.deepEqual(c.modalities.input, ['text']);
assert.equal(c.reasoning, undefined, 'unknown capability is not false');
assert.equal(fromLitellmEntry('embedding', { mode: 'embedding', max_tokens: 512 }), undefined);
assert.equal(fromLitellmEntry('audio', { mode: 'audio_transcription', max_tokens: 512 }), undefined);
assert.equal(fromLitellmEntry('incomplete', { mode: 'chat' }), undefined);
const incompleteCapabilities = fromLitellmEntry('chat', { mode: 'chat', max_input_tokens: 100, max_output_tokens: 10 });
assert.equal(incompleteCapabilities.modalities, undefined);
const result = litellmRouteModels(raw, 'fireworks_ai');
assert.equal(Object.keys(result.models).length, 1);
assert.deepEqual(result.skipped, ['embedding']);
assert.equal(DEFAULT_LITELLM_ROUTES['kimi-coding'], 'moonshot', 'mapping is metadata only, not an availability proof');
console.log('LITELLM OFFLINE TESTS PASSED');

import assert from 'node:assert/strict';
import { buildMirrorCatalog, mirrorRouteName } from '../lib/mirror-catalog.mjs';

const NOW = Date.parse('2026-10-24T00:00:00Z');
const HOUR = 3_600_000;

function installedModel(id, api = 'anthropic-messages', extra = {}) {
  const baseUrl = api === 'anthropic-messages' ? 'https://installed.invalid/anthropic' : 'https://installed.invalid/v1';
  return {
    id, name: `Installed ${id}`, type: 'chat', api, provider: 'demo', baseUrl,
    reasoning: true, input: ['text', 'image'], contextWindow: 200_000, maxTokens: 16_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    compat: { supportsStore: false, thinkingFormat: 'anthropic' },
    thinkingLevelMap: { off: null, low: 'low', high: 'high' },
    inputLimits: { images: { resize: { maxWidth: 1024, maxHeight: 1024, maxBytes: 1_048_576, jpegQuality: 80 } } },
    ...extra,
  };
}

function upstreamModel(id, api = 'anthropic-messages', extra = {}) {
  return {
    id, name: `Upstream ${id}`, type: 'chat', api, provider: 'demo',
    baseUrl: api === 'anthropic-messages' ? 'https://upstream.invalid/anthropic' : 'https://upstream.invalid/v1',
    reasoning: true, input: ['text', 'image'], contextWindow: 300_000, maxTokens: 32_000,
    cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
    compat: { supportsStore: true, thinkingFormat: 'anthropic', forceAdaptiveThinking: true },
    thinkingLevelMap: { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: null },
    inputLimits: { images: { maxPerMessage: 8, resize: { maxWidth: 2048, maxHeight: 2048, maxBytes: 4_718_592, jpegQuality: 85 } } },
    ...extra,
  };
}

const projection = value => ({
  id: value.id, name: value.name, limit: { context: value.contextWindow, output: value.maxTokens },
  modalities: { input: value.input, output: ['text'] }, mode: 'chat', type: 'chat',
  reasoning: value.reasoning, piApi: value.api, piBaseUrl: value.baseUrl,
});

const upstreamMap = (...models) => Object.fromEntries(models.map(model => [model.id, model]));

// --- mirror route naming ----------------------------------------------------
assert.equal(mirrorRouteName('demo'), 'refresh-demo');
assert.equal(mirrorRouteName('demo'), mirrorRouteName('demo'), 'deterministic');
assert.equal(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(mirrorRouteName('acme.gateway-1')), true);
assert.equal(mirrorRouteName('demo', ['refresh-demo']), 'refresh-demo-2');
assert.equal(mirrorRouteName('demo', ['refresh-demo', 'refresh-demo-2']), 'refresh-demo-3');
const longRoute = 'r'.repeat(128);
const longMirror = mirrorRouteName(longRoute);
assert.ok(longMirror.length <= 128);
assert.match(longMirror, /^refresh-r+-[a-f0-9]{8}$/);
assert.equal(longMirror, mirrorRouteName(longRoute), 'long names stay deterministic');
assert.notEqual(longMirror, mirrorRouteName(`${'r'.repeat(127)}x`), 'different long names do not collide');
for (const unsafe of ['../escape', 'has space', '__proto__', 'constructor', '', 7]) {
  assert.throws(() => mirrorRouteName(unsafe), /valid pi-ai route name/, String(unsafe));
}

// --- complete-record fidelity, same-id update, new id, provider rewrite ------
{
  const installed = [installedModel('alpha')];
  const pristine = structuredClone(installed);
  const upstream = upstreamMap(upstreamModel('alpha'), upstreamModel('gamma'));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  assert.equal(result.mirrorRoute, 'refresh-demo');
  assert.deepEqual(structuredClone(result.models.map(model => model.id)), ['alpha', 'gamma']);
  assert.deepEqual(installed, pristine, 'input records are never mutated');
  for (const model of result.models) assert.equal(model.provider, 'refresh-demo');
  const alpha = result.models.find(model => model.id === 'alpha');
  assert.equal(alpha.name, 'Upstream alpha');
  assert.equal(alpha.contextWindow, 300_000);
  assert.deepEqual(alpha.compat, upstream.alpha.compat, 'compat is preserved verbatim');
  assert.deepEqual(alpha.thinkingLevelMap, upstream.alpha.thinkingLevelMap, 'thinkingLevelMap is preserved verbatim');
  assert.deepEqual(alpha.inputLimits, upstream.alpha.inputLimits, 'inputLimits are preserved verbatim');
  assert.deepEqual(alpha.cost, upstream.alpha.cost, 'cost is preserved verbatim');
  assert.equal(alpha.baseUrl, 'https://installed.invalid/anthropic', 'installed own endpoint wins over the upstream record');
  assert.equal(alpha.headers, undefined);
  assert.deepEqual(result.diff.updated, ['alpha']);
  assert.deepEqual(result.diff.added, ['gamma']);
  const gamma = result.models.find(model => model.id === 'gamma');
  assert.equal(gamma.provider, 'refresh-demo');
  assert.equal(gamma.api, 'anthropic-messages');
  assert.deepEqual(gamma.compat, upstream.gamma.compat);
  assert.equal(result.modelList.find(row => row.id === 'alpha').state, 'ok');
  assert.equal(result.modelList.find(row => row.id === 'gamma').state, 'added');
  assert.deepEqual(result.pending, []);
  assert.equal(result.missing.alpha, undefined);
  assert.deepEqual(result.warnings, []);
}

// --- upstream headers never enter the mirror; installed local headers stay ---
{
  const installed = [installedModel('alpha', 'anthropic-messages', { headers: { 'X-Local': '1' } })];
  const upstream = upstreamMap(upstreamModel('alpha'), upstreamModel('gamma', 'anthropic-messages', {
    headers: { Authorization: 'Bearer fixture-not-a-real-key' },
  }));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  const alpha = result.models.find(model => model.id === 'alpha');
  const gamma = result.models.find(model => model.id === 'gamma');
  assert.deepEqual(alpha.headers, { 'X-Local': '1' }, 'installed local dispatch headers are preserved');
  assert.equal(gamma.headers, undefined, 'upstream headers are never introduced');
  assert.equal(JSON.stringify(result.models).includes('Authorization'), false);
}

// --- legacy normalized projection ------------------------------------------
{
  const installed = [installedModel('alpha')];
  const upstream = { alpha: projection(upstreamModel('alpha', 'anthropic-messages', { name: 'Projected alpha', contextWindow: 250_000 })),
    gamma: projection(upstreamModel('gamma')) };
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  const alpha = result.models.find(model => model.id === 'alpha');
  assert.equal(alpha.name, installed[0].name, 'lossy projection cannot overwrite trusted baseline metadata');
  assert.equal(alpha.contextWindow, installed[0].contextWindow);
  assert.equal(alpha.api, 'anthropic-messages', 'projection never switches protocol');
  assert.equal(alpha.baseUrl, 'https://installed.invalid/anthropic');
  assert.deepEqual(result.diff.updated, []);
  assert.ok(result.warnings.some(message => message.includes('保留完整基线')));
  assert.equal(result.models.some(model => model.id === 'gamma'), false);
  const pending = result.pending.find(item => item.id === 'gamma');
  assert.ok(pending);
  assert.match(pending.reason, /归一化投影|完整/);
  assert.match(pending.reason, /pi-ai/);
}

// --- unsupported protocol boundary -----------------------------------------
{
  const installed = [installedModel('alpha')];
  const upstream = upstreamMap(upstreamModel('gamma', 'google-generative-ai'));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  assert.equal(result.models.some(model => model.id === 'gamma'), false);
  const pending = result.pending.find(item => item.id === 'gamma');
  assert.match(pending.reason, /升级 pi-ai/);
  assert.match(pending.reason, /google-generative-ai/);
  assert.deepEqual(result.diff.pending, ['gamma']);
}
{
  // A syntactically legal protocol unknown to this pi-ai build is retained and
  // reported as "upgrade pi-ai" instead of being dropped before the mirror.
  const installed = [installedModel('alpha')];
  const upstream = upstreamMap(upstreamModel('gamma', 'future-protocol'));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  assert.equal(result.models.some(model => model.id === 'gamma'), false);
  const pending = result.pending.find(item => item.id === 'gamma');
  assert.match(pending.reason, /future-protocol/);
  assert.match(pending.reason, /升级 pi-ai/);
}
{
  const installed = [installedModel('alpha')];
  const upstream = upstreamMap(upstreamModel('alpha', 'google-generative-ai'));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  const alpha = result.models.find(model => model.id === 'alpha');
  assert.equal(alpha.api, 'anthropic-messages', 'unsupported upstream protocol must not replace the model');
  assert.equal(alpha.name, 'Installed alpha', 'the whole old model is retained');
  assert.equal(alpha.contextWindow, 200_000);
  assert.equal(result.warnings.some(warning => /协议 google-generative-ai/.test(warning) && /保留旧模型/.test(warning)), true);
  assert.deepEqual(result.diff.updated, []);
}
{
  const installed = [installedModel('alpha'), installedModel('beta', 'openai-completions')];
  const upstream = upstreamMap(upstreamModel('alpha', 'openai-completions'));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  const alpha = result.models.find(model => model.id === 'alpha');
  assert.equal(alpha.api, 'openai-completions', 'a protocol the installed build supports may be adopted');
  assert.equal(alpha.baseUrl, 'https://installed.invalid/v1', 'switched protocol uses the installed endpoint for that protocol');
  assert.equal(result.warnings.some(warning => /协议由 anthropic-messages 更新为 openai-completions/.test(warning)), true);
  assert.deepEqual(result.diff.updated, ['alpha']);
}

// --- baseURL priority -------------------------------------------------------
{
  const installed = [installedModel('alpha')];
  const upstream = upstreamMap(upstreamModel('alpha'), upstreamModel('gamma'));
  const explicit = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    baseURL: 'https://connection.invalid/v1' });
  for (const model of explicit.models) assert.equal(model.baseUrl, 'https://connection.invalid/v1', 'explicit connection wins');
}
{
  // One installed endpoint per protocol is the fallback for a new model.
  const installed = [installedModel('alpha'), installedModel('beta')];
  const upstream = upstreamMap(upstreamModel('gamma'));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  assert.equal(result.models.find(model => model.id === 'gamma').baseUrl, 'https://installed.invalid/anthropic');
}
{
  // Ambiguous installed endpoints defer to the complete upstream record.
  const installed = [installedModel('alpha', 'openai-completions', { baseUrl: 'https://one.invalid/v1' }),
    installedModel('beta', 'openai-completions', { baseUrl: 'https://two.invalid/v1' })];
  const upstream = upstreamMap(upstreamModel('gamma', 'openai-completions', { baseUrl: 'https://record.invalid/v1' }));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW });
  assert.equal(result.models.find(model => model.id === 'gamma').baseUrl, 'https://record.invalid/v1');
}
{
  // No trusted endpoint at all: the model stays pending and the official
  // listing URL is never reused as an inference endpoint.
  const orphan = installedModel('orphan');
  delete orphan.baseUrl;
  const result = buildMirrorCatalog({ route: 'demo', installedModels: [orphan], upstreamModels: undefined, now: NOW,
    official: { ids: new Set(['orphan']), complete: true }, officialConfig: { baseUrl: 'https://official.invalid' } });
  assert.equal(result.models.length, 0);
  const pending = result.pending.find(item => item.id === 'orphan');
  assert.ok(pending);
  assert.match(pending.reason, /baseUrl/);
  assert.equal(JSON.stringify(result).includes('official.invalid'), false);
}

// --- keep / exclude ---------------------------------------------------------
{
  const installed = [installedModel('alpha'), installedModel('beta')];
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed,
    upstreamModels: upstreamMap(upstreamModel('alpha')), now: NOW, routeConfig: { exclude: ['beta'] } });
  assert.deepEqual(result.models.map(model => model.id), ['alpha']);
  assert.deepEqual(result.diff.excluded, ['beta']);
}

// --- official evidence ------------------------------------------------------
{
  const installed = [installedModel('alpha')];
  const upstream = upstreamMap(upstreamModel('alpha'), upstreamModel('epsilon'));
  const unverified = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    official: new Set(['alpha']), officialConfigured: true });
  assert.equal(unverified.models.some(model => model.id === 'epsilon'), false);
  assert.deepEqual(unverified.diff.unverified, ['epsilon']);
  assert.equal(unverified.modelList.find(row => row.id === 'epsilon').state, 'unverified');
  const verified = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    official: { ids: new Set(['alpha', 'epsilon']), complete: true }, officialConfigured: true });
  assert.equal(verified.models.some(model => model.id === 'epsilon'), true);
  assert.ok(verified.warnings.length === 0);
}
{
  // A configured but failed official check keeps new models pending.
  const installed = [installedModel('alpha')];
  const upstream = upstreamMap(upstreamModel('alpha'), upstreamModel('epsilon'));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    officialConfigured: true });
  assert.equal(result.models.some(model => model.id === 'epsilon'), false);
  const pending = result.pending.find(item => item.id === 'epsilon');
  assert.match(pending.reason, /官方核对未取得清单/);
  assert.equal(result.warnings.some(warning => warning.includes('官方核对未取得清单')), true);
  assert.equal(result.models.some(model => model.id === 'alpha'), true, 'existing ids still refresh');
}
{
  // Official-only candidates lack complete records and stay pending.
  const installed = [installedModel('alpha')];
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed,
    upstreamModels: upstreamMap(upstreamModel('alpha')), now: NOW,
    official: { ids: new Set(['alpha', 'zeta']), complete: true }, officialConfigured: true });
  assert.deepEqual(result.officialAdded, ['zeta']);
  const pending = result.pending.find(item => item.id === 'zeta');
  assert.match(pending.reason, /官方清单/);
  assert.equal(result.models.some(model => model.id === 'zeta'), false);
}
{
  // Partial official listings cannot confirm a new id and never drive removal.
  const installed = [installedModel('alpha'), installedModel('beta')];
  const upstream = upstreamMap(upstreamModel('alpha'), upstreamModel('epsilon'));
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    official: { ids: new Set(['alpha', 'epsilon']), complete: false }, officialConfigured: true,
    settings: { removeStale: true, staleGraceHours: 1, staleConfirmations: 2 },
    previous: { missing: { beta: { firstSeen: NOW - 10 * HOUR, count: 9 } } } });
  assert.equal(result.models.some(model => model.id === 'epsilon'), true);
  assert.deepEqual(result.missing, {}, 'partial evidence interrupts removal observation');
  assert.equal(result.models.some(model => model.id === 'beta'), true);
  assert.deepEqual(result.diff.stale, ['beta']);
  assert.deepEqual(result.diff.removed, []);
  assert.equal(result.warnings.some(warning => /不能驱动移除/.test(warning)), true);
}

// --- stale removal: complete official negative evidence only ----------------
{
  const installed = [installedModel('alpha'), installedModel('beta')];
  const upstream = upstreamMap(upstreamModel('alpha'));
  const settings = { removeStale: true, staleGraceHours: 1, staleConfirmations: 2 };
  // Without a complete official listing there is no negative evidence.
  const noEvidence = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    settings, previous: { missing: { beta: { firstSeen: NOW - 10 * HOUR, count: 9 } } } });
  assert.equal(noEvidence.models.some(model => model.id === 'beta'), true);
  assert.deepEqual(noEvidence.diff.removed, []);
  assert.deepEqual(noEvidence.missing, {});
  // First complete observation only counts once.
  const first = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    settings, official: { ids: new Set(['alpha']), complete: true } });
  assert.equal(first.models.some(model => model.id === 'beta'), true);
  assert.deepEqual(first.missing.beta, { firstSeen: NOW, count: 1 });
  assert.deepEqual(first.diff.removed, []);
  // A failure between observations breaks continuity.
  const interrupted = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW + HOUR,
    settings, officialConfigured: true, previous: first });
  assert.deepEqual(interrupted.missing, {});
  // Counting restarts from the interrupted result, so two fresh observations are needed.
  const second = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW + 2 * HOUR,
    settings, official: { ids: new Set(['alpha']), complete: true }, previous: interrupted });
  assert.deepEqual(second.missing.beta, { firstSeen: NOW + 2 * HOUR, count: 1 });
  assert.deepEqual(second.diff.removed, []);
  const ready = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW + 3 * HOUR,
    settings, official: { ids: new Set(['alpha']), complete: true },
    previous: { missing: { beta: { firstSeen: NOW + 2 * HOUR, count: 1 } } } });
  assert.deepEqual(ready.diff.removed, ['beta']);
  assert.equal(ready.models.some(model => model.id === 'beta'), false);
  assert.deepEqual(ready.diff.stale, ['beta']);
  assert.equal(ready.warnings.some(warning => /未写入安装目录/.test(warning)), true);
}
{
  // keep protects a removed candidate; removeStale=false keeps showing it stale.
  const installed = [installedModel('alpha'), installedModel('beta')];
  const upstream = upstreamMap(upstreamModel('alpha'));
  const previous = { missing: { beta: { firstSeen: NOW - 10 * HOUR, count: 4 } } };
  const kept = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    official: { ids: new Set(['alpha']), complete: true }, routeConfig: { keep: ['beta'] },
    settings: { removeStale: true, staleGraceHours: 1, staleConfirmations: 2 }, previous });
  assert.equal(kept.models.some(model => model.id === 'beta'), true);
  assert.deepEqual(kept.diff.removed, []);
  const notRemoving = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstream, now: NOW,
    official: { ids: new Set(['alpha']), complete: true },
    settings: { removeStale: false, staleGraceHours: 1, staleConfirmations: 2 }, previous });
  assert.equal(notRemoving.models.some(model => model.id === 'beta'), true);
  assert.equal(notRemoving.modelList.find(row => row.id === 'beta').state, 'stale');
}
{
  // The official list confirming an installed id prevents stale/removal.
  const installed = [installedModel('beta')];
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: upstreamMap(upstreamModel('other')),
    now: NOW, official: { ids: new Set(['beta']), complete: true },
    settings: { removeStale: true, staleGraceHours: 1, staleConfirmations: 2 },
    previous: { missing: { beta: { firstSeen: NOW - 10 * HOUR, count: 9 } } } });
  assert.deepEqual(result.diff.stale, []);
  assert.deepEqual(result.diff.removed, []);
  assert.equal(result.models.some(model => model.id === 'beta'), true);
}

// --- empty/failed upstream never invents removals --------------------------
{
  const installed = [installedModel('alpha')];
  const result = buildMirrorCatalog({ route: 'demo', installedModels: installed, upstreamModels: {},
    now: NOW, settings: { removeStale: true, staleGraceHours: 1, staleConfirmations: 2 },
    previous: { missing: { alpha: { firstSeen: NOW - 10 * HOUR, count: 9 } } } });
  assert.equal(result.models.some(model => model.id === 'alpha'), true);
  assert.deepEqual(result.diff.removed, []);
  assert.deepEqual(result.missing, {});
  assert.equal(result.warnings.some(warning => /上游目录不可用/.test(warning)), true);
}

// --- defensive input handling ----------------------------------------------
assert.throws(() => buildMirrorCatalog({ route: '../bad', installedModels: [] }), /valid source route/);
assert.throws(() => buildMirrorCatalog({ route: 'demo', installedModels: 'nope' }), /installedModels must be an array/);
assert.throws(() => buildMirrorCatalog({ route: 'demo', installedModels: [], mirrorRoute: 'demo' }), /must differ/);
{
  const result = buildMirrorCatalog({ route: 'demo', installedModels: [installedModel('alpha'), installedModel('alpha', 'openai-completions')],
    upstreamModels: undefined, now: NOW });
  assert.equal(result.models.filter(model => model.id === 'alpha').length, 1);
  assert.equal(result.warnings.some(warning => /重复条目/.test(warning)), true);
}
{
  const result = buildMirrorCatalog({ route: 'demo', installedModels: [installedModel('embed', 'anthropic-messages', { type: 'embedding' })],
    upstreamModels: undefined, now: NOW });
  assert.equal(result.models.length, 0);
  assert.equal(result.warnings.some(warning => /非 chat/.test(warning)), true);
}

console.log('MIRROR CATALOG TESTS PASSED: naming, fidelity, updates, protocol boundary, baseUrl priority, keep/exclude, official evidence, stale grace, headers, defensive inputs');

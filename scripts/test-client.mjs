import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import renderer from 'react-test-renderer';
const require = createRequire(import.meta.url);
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/client/ManualModels.tsx', import.meta.url))], bundle: true, write: false,
  format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
const mod = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, mod, mod.exports);
let request;
let latest = { settingsRevision: 3, settings: { manualModels: {} } };
const props = { models: {}, targets: [{ id: 'pi' }], applications: {}, disabled: false,
  request: async (endpoint, body) => { request = { endpoint, body }; return endpoint === 'manual/preview' ? { previewHash: 'hash', models: [body.route] } : {}; },
  reload: async () => {}, getLatest: async () => latest };
let tree;
renderer.act(() => { tree = renderer.create(React.createElement(mod.exports.ManualModels, props)); });
const button = label => tree.root.findAllByType('button').find(b => b.children.join('') === label);
renderer.act(() => button('手动增加模型').props.onClick());
const inputs = tree.root.findAllByType('input');
for (const [i, value] of [[0, 'demo'], [1, 'new'], [2, 'New'], [3, 'https://fixture.invalid'], [4, '8192'], [5, '1024']]) renderer.act(() => inputs[i].props.onChange({ target: { value } }));
await renderer.act(async () => { button('保存模型声明').props.onClick(); });
assert.equal(request.endpoint, 'manual/save');
assert.equal(request.body.model.id, 'new');
assert.equal(request.body.model.reasoningEfforts, false);
assert.equal(request.body.expectedRevision, 3);
assert.equal(tree.root.findAllByType('fieldset').length, 1, 'successful save closes the editor');
await renderer.act(async () => { button('预览配置变更').props.onClick(); });
await renderer.act(async () => { button('应用到 DSH').props.onClick(); });
assert.equal(request.body.previewHash, 'hash', 'apply submits the reviewed fingerprint');
// Editing must preserve unsaved input and refuse a concurrently changed declaration.
const model = { id: 'old', name: 'Old', protocol: 'anthropic-messages', baseUrl: 'https://fixture.invalid', contextWindow: 8192, maxTokens: 1024, input: ['text'], reasoningEfforts: false };
renderer.act(() => tree.update(React.createElement(mod.exports.ManualModels, { ...props, models: { demo: [model] } })));
renderer.act(() => button('编辑').props.onClick());
latest = { settingsRevision: 4, settings: { manualModels: { demo: [{ ...model, name: 'Other page' }] } } };
request = undefined;
await renderer.act(async () => { button('保存模型声明').props.onClick(); });
assert.equal(request, undefined);
assert.ok(tree.root.findAll(n => n.props.role === 'alert').some(n => n.children.join('').includes('其它页面修改')));
renderer.act(() => tree.unmount());
// Exercise the settings section contribution without loading a real DSH page.
const clientBuild = await build({ entryPoints: [fileURLToPath(new URL('../src/client/index.tsx', import.meta.url))], bundle: true, write: false,
  format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
const client = { exports: {} };
new Function('require', 'module', 'exports', clientBuild.outputFiles[0].text)(require, client, client.exports);
const registrations = [];
client.exports.apply({ slots: { inject(_name, setup) { setup(); }, entries() { return []; }, register(spec, component) { registrations.push({ spec, component }); return () => {}; } } });
assert.equal(registrations.length, 1, 'the client registers exactly one slot');
assert.equal(registrations[0].spec.name, 'settings.section', 'only the settings section is contributed');
assert.equal(registrations[0].spec.id, 'model-refresh');
assert.equal(registrations.find(row => row.spec.name === 'settings.models.provider-card'), undefined,
  'the generic provider management entry point must be gone');
assert.equal(registrations[0].component, client.exports.ModelRefreshSettings);
const textOf = node => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.props && node.props.children !== undefined) return textOf(node.props.children);
  if (node.children !== undefined) return textOf(node.children);
  return '';
};
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
let settingsTree;
try {
  const requests = [];
  // The Host still stores capability fields this page no longer shows; a fresh object per
  // request keeps the identity check in the route card meaningful.
  const makeStatus = () => ({
    version: 3, pluginVersion: '0.9.0', settingsRevision: 5, initialized: true, degraded: false, running: false,
    lastRun: '2026-01-02T00:00:00Z', lastError: null, warnings: [],
    settings: { intervalMinutes: 60, proxyUrl: '', removeStale: false, modelsDevFallback: true, officialVerify: false,
      proxyConfigured: false, staleGraceHours: 24, staleConfirmations: 2,
      officialRoutes: {
        openai: { endpoint: 'https://fixture.invalid/v1/models', baseUrl: 'https://fixture.invalid', auth: 'bearer',
          apiKeyEnv: 'PROVIDER_API_KEY', complete: true, protocol: 'openai-completions', contextWindow: 8192,
          maxTokens: 1024, assumeChat: true },
        anthropic: { endpoint: 'https://fixture.invalid/v1/models', auth: 'anthropic' }
      } },
    routes: [
      { route: 'openai', as: 'openai', enabled: true, mirrorRoute: 'refresh-openai', registered: true, keep: [], exclude: [],
        fetchedAt: '2026-01-02T00:00:00Z', installedAt: null, models: 4,
        added: ['m1'], updated: ['m2'], stale: ['m3'], excluded: ['m4'], unverified: ['m5'],
        pending: [{ id: 'm6', reason: '需要升级 pi-ai 或不支持协议' }],
        modelList: [{ id: 'm6', state: 'pending', reason: '需要升级 pi-ai 或不支持协议' }] },
      { route: 'anthropic', enabled: false, mirrorRoute: 'refresh-anthropic', registered: false, keep: [], exclude: [], models: 2 },
      { route: 'local', enabled: false, keep: [], exclude: [], models: 0 }
    ]
  });
  globalThis.fetch = async (url, init) => {
    const method = init?.method ?? 'GET';
    if (method !== 'GET') requests.push({ url, method, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => (method === 'GET' ? makeStatus() : {}) };
  };
  globalThis.window = globalThis;
  await renderer.act(async () => { settingsTree = renderer.create(React.createElement(registrations[0].component)); });
  const rendered = textOf(settingsTree.toJSON());
  // The mirror route and its registration state must be visible without any guessing.
  assert.ok(rendered.includes('源路由 → 镜像路由'), 'the card names the source → mirror relation');
  assert.ok(rendered.includes('openai → refresh-openai'), 'the mirror route of an enabled route is shown');
  assert.ok(rendered.includes('anthropic → refresh-anthropic'), 'the mirror route of a disabled route is shown');
  assert.ok(rendered.includes('镜像 provider 已注册'), 'a registered mirror is reported as registered');
  assert.ok(rendered.includes('镜像 provider 未注册'), 'an unregistered mirror is reported as unregistered');
  assert.ok(rendered.includes('镜像 provider 注册状态未知'), 'a missing registration flag must not be reported as registered');
  assert.ok(rendered.includes('启用动态镜像'), 'the route switch offers the dynamic mirror');
  assert.ok(rendered.includes('未启用动态镜像'), 'a disabled route says the mirror is off');
  // The catalog write / grant / restart / provider-append entry points are gone.
  for (const gone of ['查看授权说明', '目录写入授权说明', '目录写入不可用', '允许同步安装目录', '需要重启后生效', '后端报告目录已变更',
    '从端点获取可用模型', '手动增加模型', '真实已应用', '实际已移除', '同步冲突']) {
    assert.ok(!rendered.includes(gone), `the settings page must not show "${gone}"`);
  }
  // Expanding a route keeps the backend reason text untouched.
  const routeButton = settingsTree.root.findAllByType('button').find(node => textOf(node).includes('openai'));
  await renderer.act(async () => { routeButton.props.onClick(); });
  const expanded = textOf(settingsTree.toJSON());
  assert.ok(expanded.includes('需要升级 pi-ai 或不支持协议'), 'backend reasons are shown as-is');
  assert.ok(expanded.includes('refresh-*'), 'the expanded card explains that the mirror provider is selected in DSH');
  // The official form only collects list evidence; inference capabilities are gone.
  for (const gone of ['推理协议', 'openai-completions', 'openai-responses', 'anthropic-messages', '推理 baseUrl',
    '未知模型上下文默认值', '未知模型输出默认值', '显式默认值是你的配置', '我确认缺少类型元数据的官方新增 ID 可用于文本聊天',
    '默认不猜用途']) {
    assert.ok(!expanded.includes(gone), `the official form must not offer "${gone}"`);
  }
  assert.ok(expanded.includes('清单请求根 URL（不修改推理端点）'), 'the base url field states that it does not change the inference endpoint');
  assert.ok(expanded.includes('官方列表完整 URL') && expanded.includes('凭据环境变量名称'), 'the list source fields stay');
  // The route switch posts the mirror toggle.
  const findOpenaiSection = () => settingsTree.root.findAllByType('section').find(node => textOf(node).includes('openai → refresh-openai'));
  const findOfficialInputs = () => {
    const section = findOpenaiSection();
    const all = section.findAllByType('input');
    const urls = all.filter(node => node.props.type === 'url');
    return { endpoint: urls[0], baseUrl: urls[1], apiKeyEnv: all.find(node => node.props.type === 'text') };
  };
  const openaiSection = findOpenaiSection();
  const toggle = openaiSection.findAllByType('input').find(node => node.props.type === 'checkbox');
  await renderer.act(async () => { toggle.props.onChange({ target: { checked: false } }); });
  const posted = requests.find(row => row.url.endsWith('/route'));
  assert.ok(posted, 'the route switch posts to the route endpoint');
  assert.equal(posted.body.route, 'openai');
  assert.equal(posted.body.enabled, false);
  // Draft protection: an unsaved official edit survives a status refresh and can be discarded.
  await renderer.act(async () => { findOfficialInputs().endpoint.props.onChange({ target: { value: 'https://fixture.invalid/v2/models' } }); });
  const refreshButton = settingsTree.root.findAllByType('button').find(node => textOf(node).includes('立即刷新'));
  await renderer.act(async () => { refreshButton.props.onClick(); });
  assert.equal(findOfficialInputs().endpoint.props.value, 'https://fixture.invalid/v2/models', 'an unsaved official edit is not overwritten by a refresh');
  const discard = findOpenaiSection().findAllByType('button').find(node => textOf(node).includes('放弃草稿'));
  await renderer.act(async () => { discard.props.onClick(); });
  assert.equal(findOfficialInputs().endpoint.props.value, 'https://fixture.invalid/v1/models', 'discarding the draft restores the stored value');
  // Saving keeps the fields this page does not show and does not touch the other routes.
  await renderer.act(async () => { findOfficialInputs().endpoint.props.onChange({ target: { value: 'https://fixture.invalid/v2/models' } }); });
  const saveOfficial = findOpenaiSection().findAllByType('button').find(node => textOf(node).includes('保存此路由官方配置'));
  await renderer.act(async () => { saveOfficial.props.onClick(); });
  const config = requests.find(row => row.url.endsWith('/config'));
  assert.ok(config, 'the official form posts to the config endpoint');
  const openaiConfig = config.body.officialRoutes.openai;
  assert.equal(openaiConfig.endpoint, 'https://fixture.invalid/v2/models', 'the edited list endpoint is submitted');
  assert.equal(openaiConfig.protocol, 'openai-completions', 'a field this page does not show keeps its stored value');
  assert.equal(openaiConfig.contextWindow, 8192, 'the stored context window is preserved');
  assert.equal(openaiConfig.maxTokens, 1024, 'the stored max tokens are preserved');
  assert.equal(openaiConfig.assumeChat, true, 'the stored assumeChat flag is preserved');
  assert.deepEqual(Object.keys(openaiConfig).sort(),
    ['apiKeyEnv', 'assumeChat', 'auth', 'baseUrl', 'complete', 'contextWindow', 'endpoint', 'maxTokens', 'protocol'],
    'the submission neither drops a stored field nor invents a new one');
  assert.deepEqual(config.body.officialRoutes.anthropic, { endpoint: 'https://fixture.invalid/v1/models', auth: 'anthropic' },
    'the official config of the other routes is untouched');
  // Clearing a visible field must not resurrect the stored value.
  await renderer.act(async () => { findOfficialInputs().endpoint.props.onChange({ target: { value: '' } }); });
  const saveCleared = findOpenaiSection().findAllByType('button').find(node => textOf(node).includes('保存此路由官方配置'));
  await renderer.act(async () => { saveCleared.props.onClick(); });
  const cleared = requests.filter(row => row.url.endsWith('/config')).at(-1);
  const clearedOpenai = cleared.body.officialRoutes.openai;
  assert.ok(!('endpoint' in clearedOpenai), 'a cleared field is not submitted with its stored value');
  assert.equal(clearedOpenai.baseUrl, 'https://fixture.invalid', 'the remaining visible fields are still submitted');
  assert.equal(clearedOpenai.complete, true, 'the remaining visible fields keep their value');
  assert.equal(clearedOpenai.protocol, 'openai-completions', 'a hidden legacy field survives a cleared field');
  assert.equal(clearedOpenai.contextWindow, 8192, 'the hidden context window survives a cleared field');
  assert.equal(clearedOpenai.maxTokens, 1024, 'the hidden max tokens survive a cleared field');
  assert.equal(clearedOpenai.assumeChat, true, 'the hidden assumeChat flag survives a cleared field');
  assert.deepEqual(cleared.body.officialRoutes.anthropic, { endpoint: 'https://fixture.invalid/v1/models', auth: 'anthropic' },
    'the official config of the other routes is still untouched');
  renderer.act(() => settingsTree.unmount());
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
}
console.log('CLIENT TESTS PASSED: manual workflows, single settings.section registration, mirror route and registration state, no catalog grant/restart/provider-append entry points, official form limited to list evidence with draft protection');

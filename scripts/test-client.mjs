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
// Exercise the actual keyed provider-card contribution without loading a real DSH page.
const clientBuild = await build({ entryPoints: [fileURLToPath(new URL('../src/client/index.tsx', import.meta.url))], bundle: true, write: false,
  format: 'cjs', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'] });
const client = { exports: {} };
new Function('require', 'module', 'exports', clientBuild.outputFiles[0].text)(require, client, client.exports);
const registrations = [];
client.exports.apply({ slots: { inject(_name, setup) { setup(); }, entries() { return []; }, register(spec, component) { registrations.push({ spec, component }); return () => {}; } } });
const contribution = registrations.find(row => row.spec.name === 'settings.models.provider-card');
assert.equal(contribution.spec.key, 'llm-pi-ai', 'provider-card is a keyed slot, not an id list');
const originalFetch = globalThis.fetch;
let providerTree;
try {
  const requests = [];
  const listing = { route: 'demo', namespace: 'llm-pi-ai', profileHash: 'profile-hash', api: 'anthropic-messages', baseURL: 'https://fixture.invalid',
    endpoint: 'https://fixture.invalid/models', partial: false, fetchedAt: '2026-01-01T00:00:00Z', configured: ['old'],
    candidates: [{ id: 'old', configured: true }, { id: 'new', configured: false, reasoning: true }], filtered: [] };
  let handle = async (url) => url.endsWith('/adopt') ? { adopted: ['new'] } : listing;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body); requests.push({ url, body });
    const value = await handle(url, body);
    return { ok: true, json: async () => value };
  };
  renderer.act(() => { providerTree = renderer.create(React.createElement(contribution.component, { provider: { provider: 'demo', settingsNs: 'llm-pi-ai' } })); });
  const fetchButton = () => providerTree.root.findAllByType('button').find(node => node.children.join('') === '从端点获取可用模型');
  const selectButton = () => providerTree.root.findAllByType('button').find(node => node.children.join('') === '全选未配置');
  const addButton = () => providerTree.root.findAllByType('button').find(node => node.children.join('').startsWith('添加选中'));
  await renderer.act(async () => { await fetchButton().props.onClick(); });
  assert.deepEqual(requests[0].body, { route: 'demo', namespace: 'llm-pi-ai' });
  renderer.act(() => { selectButton().props.onClick(); });
  handle = async url => { if (url.endsWith('/adopt')) return { adopted: ['new'] }; throw new Error('fixture refresh failed'); };
  await renderer.act(async () => { addButton().props.onClick(); });
  const adoption = requests.find(row => row.url.endsWith('/adopt'));
  assert.equal(adoption.body.profileHash, 'profile-hash');
  assert.deepEqual(adoption.body.ids, ['new']);
  assert.ok(JSON.stringify(providerTree.toJSON()).includes('已追加并保存 1 个模型'), 'refresh must not erase the save acknowledgement');
  assert.equal(providerTree.root.findAllByType('table').length, 0, 'failed refresh must not leave stale candidates available for adoption');

  let finish;
  const blocked = new Promise(resolve => { finish = resolve; });
  handle = async () => blocked;
  await renderer.act(async () => { fetchButton().props.onClick(); });
  renderer.act(() => { providerTree.update(React.createElement(contribution.component, { provider: { provider: 'other', settingsNs: 'llm-pi-ai' } })); });
  await renderer.act(async () => { finish(listing); await blocked; });
  assert.equal(providerTree.root.findAllByType('table').length, 0, 'old-route response cannot populate the new route card');
  assert.ok(fetchButton(), 'new route starts idle');
} finally {
  renderer.act(() => { providerTree?.unmount(); });
  globalThis.fetch = originalFetch;
}
console.log('CLIENT TESTS PASSED: manual workflows, keyed provider slot, namespace/fingerprint, save acknowledgement, stale-response isolation');

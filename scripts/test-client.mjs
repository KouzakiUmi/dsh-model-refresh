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
console.log('CLIENT TESTS PASSED: actual React add/save, preview fingerprint, edit conflict, draft retention');

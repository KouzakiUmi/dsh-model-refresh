// 真 fetch + 本地 fixture HTTP + 全部隔离目录；不消费安装树或真实凭据。
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHost } from '../lib/index.js';
const root = await mkdtemp(path.join(tmpdir(), 'refresh-http-integration-'));
const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/upstream') { res.writeHead(503); res.end(JSON.stringify({ error: 'fixture source outage' })); return; }
  res.end(JSON.stringify({ data: [{ id: 'known' }, { id: 'new-chat', mode: 'chat', context_length: 8192, max_output_tokens: 1024 }] }));
});
let host;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dataDir = path.join(root, 'data'); await mkdir(dataDir);
  const statePath = path.join(root, 'state.json');
  await writeFile(path.join(dataDir, 'demo.json'), JSON.stringify({ 'anthropic-messages': {
    known: { id: 'known', name: 'Known', api: 'anthropic-messages', baseUrl: base,
      contextWindow: 4096, maxTokens: 512, input: ['text'] }
  } }));
  await writeFile(path.join(dataDir, '.manifest.json'), JSON.stringify({ generatedAt: 'fixture' }));
  await writeFile(statePath, JSON.stringify({ version: 3, settings: { endpoint: `${base}/upstream`, autoDiscover: false,
    litellmEnabled: false, patchCatalog: true, officialRoutes: { demo: { auth: 'none', endpoint: `${base}/list` } } },
    routes: [{ route: 'demo', enabled: true }], runtime: {} }));
  host = createHost({ on() {}, logger: { info() {} } }, { statePath, dataDir, seedPath: path.join(root, 'none') });
  await host.ready;
  const artifact = JSON.parse(await readFile(path.join(root, 'demo.models.json'), 'utf8'));
  assert.ok(artifact.models.some(m => m.id === 'new-chat' && m.contextWindow === 8192));
  assert.ok(artifact.models.every(m => m.api === undefined));
  const catalog = JSON.parse(await readFile(path.join(dataDir, 'demo.json'), 'utf8'));
  assert.equal(catalog['anthropic-messages']['new-chat'].api, 'anthropic-messages');
  assert.equal(catalog['openai-completions'], undefined);
  assert.match(host.status().lastError, /503/);
  assert.equal(host.status().routes[0].official, 'verified');
  assert.equal(host.status().routes[0].officialComplete, false);
  assert.deepEqual(host.status().routes[0].applied, ['new-chat']);
  await host.dispose();
  console.log('REAL LOCAL HTTP INTEGRATION PASSED');
} finally {
  await host?.dispose();
  await new Promise(resolve => server.close(resolve));
  assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep));
  await rm(root, { recursive: true, force: true });
}

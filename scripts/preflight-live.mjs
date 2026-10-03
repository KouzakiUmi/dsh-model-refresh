// 真实组合预检：用显式指定的 pi-ai catalog 目录 + 正式 state.json 的副本，
// 在隔离 state 目录里跑当前版本的 bootstrap + 首轮刷新（initialRefresh=true）。
// patchCatalog=false ⇒ 不写 pi-ai 目录；state 副本 ⇒ 不动正式状态。
import { cpSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '../lib/index.js';

const dataDir = process.env.DSH_PI_AI_DATA_DIR;
if (!dataDir) throw new Error('DSH_PI_AI_DATA_DIR is required for live preflight; point it at the consuming pi-ai dist/providers/data directory');
const realState = process.argv[2] ?? join(homedir(), '.dsh', 'model-refresh', 'state.json');
const dir = mkdtempSync(join(tmpdir(), 'refresh-live-'));
const stateFile = join(dir, 'state.json');

// Disable catalog writes for the preflight: the real pi-ai tree must not be touched.
cpSync(realState, stateFile);
const doc = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(stateFile, 'utf8')));
doc.settings.patchCatalog = false;
doc.settings.removeStale = false;
doc.settings.intervalMinutes = 60;
await import('node:fs').then((fs) => fs.writeFileSync(stateFile, JSON.stringify(doc)));

const logs = [];
const ctx = {
  logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push('WARN ' + m), error: (m) => logs.push('ERR ' + m) },
  on: () => {},
  inject: () => {},   // no webServer in the preflight; we assert bootstrap, not routing
  get: () => undefined,
  effect: (fn) => { const dispose = fn(); return () => dispose?.(); },
};

const host = createHost(ctx, { statePath: stateFile, dataDir, initialRefresh: true, persist: undefined });
try {
  await host.ready;
  console.log('BOOTSTRAP OK');
} catch (error) {
  console.log('BOOTSTRAP FAILED:', error?.message);
  console.log(logs.join('\n'));
  process.exitCode = 1;
} finally {
  await host.dispose();
}

const s = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(stateFile, 'utf8')));
console.log('state version written :', s.version);
console.log('pluginVersion         :', s.runtime?.pluginVersion ?? s.runtime?.perRoute?.['__']?.pluginVersion ?? '(see logs)');
console.log('lastRun               :', s.runtime.lastRun);
console.log('lastError             :', s.runtime.lastError ? s.runtime.lastError.split('\n').slice(0, 6).join('\n') : null);
console.log('catalogOwned routes   :', Object.keys(s.runtime.catalogOwned ?? {}).length);
console.log('legacyProtected       :', JSON.stringify(s.runtime.legacyProtected ?? null));
const per = s.runtime.perRoute ?? {};
const summary = {};
for (const [route, info] of Object.entries(per)) summary[info.official] = (summary[info.official] ?? 0) + 1;
console.log('perRoute official tally:', JSON.stringify(summary));
console.log('enabled routes        :', Object.values(per).filter((i) => i.enabled).length, '/', Object.keys(per).length);
const sample = ['opencode-go', 'xiaomi-token-plan-cn', 'zai-coding-cn'].filter((r) => per[r]).map((r) => `${r}: models=${per[r].models} official=${per[r].official} src=${per[r].source}`);
console.log('sample                :\n  ' + sample.join('\n  '));
console.log('transactions left     :', existsSync(join(dir, 'transactions')) ? readdirSync(join(dir, 'transactions')) : 'none');
console.log('--- host logs ---');
console.log(logs.slice(0, 25).join('\n'));
rmSync(dir, { recursive: true, force: true });
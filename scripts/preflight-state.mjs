// 只读预检：把正式 state.json 复制到临时目录，验证 v0.6.0 的加载与迁移路径。
// 不触碰正式状态，不发任何网络请求。
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadState, STATE_VERSION } from '../lib/state.mjs';

const real = process.argv[2] ?? 'C:/Users/Fractal/.dsh/model-refresh/state.json';
const dir = mkdtempSync(join(tmpdir(), 'refresh-preflight-'));
try {
  const copy = join(dir, 'state.json');
  cpSync(real, copy);
  const before = JSON.parse(readFileSync(copy, 'utf8'));
  const loaded = await loadState(copy);
  const { settings, routes, runtime, settingsRevision } = loaded;

  console.log('source version       :', before.version);
  console.log('loaded version       :', loaded.version, '(STATE_VERSION =', STATE_VERSION + ')');
  console.log('settingsRevision     :', settingsRevision);
  console.log('file rewritten       :', 'no — loadState never writes; the Host persists on its first commit');
  console.log('routes               :', routes.length);
  console.log('settings.patchCatalog:', settings.patchCatalog, '(v0.6 safe default = false)');
  console.log('settings.autoDiscover:', settings.autoDiscover);
  console.log('settings.removeStale :', settings.removeStale);
  console.log('officialRoutes       :', JSON.stringify(settings.officialRoutes));
  console.log('migrationWarnings    :', JSON.stringify(runtime.migrationWarnings, null, 2));
  console.log('legacyProtected      :', JSON.stringify(runtime.legacyProtected));
  console.log('catalogOwned         :', JSON.stringify(runtime.catalogOwned));
  console.log('legacy removed backup:', JSON.stringify(Object.entries(runtime.catalogRemoved)
    .filter(([, v]) => Object.keys(v).length).map(([k, v]) => [k, Object.keys(v)])));
  console.log('perRoute entries     :', Object.keys(runtime.perRoute).length);
  console.log('lastRun (carried)    :', runtime.lastRun);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
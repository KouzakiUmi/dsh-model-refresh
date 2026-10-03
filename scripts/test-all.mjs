// 默认套件仅离线 fixture / 临时目录，不运行在线 smoke 或事故恢复脚本。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const tests = ['test-merge.mjs', 'test-catalog-patch.mjs', 'test-litellm.mjs', 'test-official.mjs',
  'test-planner.mjs', 'test-store.mjs', 'test-host.mjs', 'test-integration.mjs', 'test-expression.mjs'];
for (const test of tests) {
  console.log(`\n=== ${test} ===`);
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', test)], { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? `${test} failed (${result.status ?? result.signal})`);
    process.exit(result.status || 1);
  }
}
console.log(`\nALL ${tests.length} OFFLINE SUITES PASSED`);

// Reproduce Loader !!js evaluation without writing to the real ~/.dsh directory.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const evaluate = new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }');
let requireAvailable = false;
try { requireAvailable = typeof (0, eval)('require') !== 'undefined'; } catch {}
assert.equal(requireAvailable, false);
const directory = await mkdtemp(path.join(tmpdir(), 'dsh-model-refresh-expression-'));
try {
  const file = path.join(directory, 'fixture.json');
  await writeFile(file, JSON.stringify({ models: [{ id: 'x' }] }), 'utf8');
  const expression = `JSON.parse(process.getBuiltinModule("node:fs").readFileSync(${JSON.stringify(file)}, "utf8")).models`;
  assert.deepEqual(evaluate({}, expression), [{ id: 'x' }]);
  // Match the documented USERPROFILE/backslash-normalization shape using an isolated fake root.
  const fakeProcess = { env: { USERPROFILE: directory }, getBuiltinModule: (name) => process.getBuiltinModule(name) };
  const inline = 'JSON.parse(process.getBuiltinModule("node:fs").readFileSync(process.env.USERPROFILE.replaceAll(String.fromCharCode(92), "/") + "/fixture.json", "utf8")).models';
  assert.deepEqual(evaluate({ process: fakeProcess }, inline), [{ id: 'x' }]);
  console.log('ISOLATED EXPRESSION TESTS PASSED');
} finally {
  assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
  assert.ok(path.basename(directory).startsWith('dsh-model-refresh-expression-'));
  await rm(directory, { recursive: true, force: true });
}

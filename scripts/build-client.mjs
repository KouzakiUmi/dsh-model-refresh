// 用 esbuild 构建 client（CJS bundle，react external），
// 再包进 window.__ModuleLoader__.load wrapper（照 dsh-grok-kit 的产物形态）。
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = dirname(fileURLToPath(import.meta.url))
const cjs = join(lib, '..', 'lib', 'client.cjs')
const out = join(lib, '..', 'lib', 'client.js')

await build({
  entryPoints: [join(lib, '..', 'src', 'client', 'index.tsx')],
  outfile: cjs,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  logLevel: 'info',
  target: ['es2022'],
})

const source = readFileSync(cjs, 'utf8')
writeFileSync(out, `window.__ModuleLoader__.load({
	id: "dsh-model-refresh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${source}
		return module.exports;
	}
});
`)
console.log(`wrapped: ${out}`)

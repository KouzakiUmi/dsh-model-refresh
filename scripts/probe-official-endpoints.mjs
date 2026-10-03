// 可选无凭据诊断：401/403 仅说明请求被拒，绝不证明端点正确。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_OFFICIAL_ROUTES, catalogBaseUrl, parseOfficialModels } from '../lib/official.mjs';
const dataDir = process.env.DSH_PI_AI_DATA_DIR;
if (!process.argv.includes('--live') || !dataDir) {
  console.log('需要明确 --live 和 DSH_PI_AI_DATA_DIR 才进行无凭据网络诊断；默认不发请求。');
  console.log('未通过真实认证清单响应的端点均未核验；401/403 不能证明路径正确。');
} else {
  for (const route of Object.keys(DEFAULT_OFFICIAL_ROUTES)) {
    try {
      const raw = JSON.parse(await readFile(path.join(path.resolve(dataDir), `${route}.json`), 'utf8'));
      const base = catalogBaseUrl(raw);
      if (!base) { console.log(route, 'UNVERIFIED: 缺少唯一 baseUrl'); continue; }
      const root = base.replace(/\/+$/, '');
      const urls = [`${root}/models`, ...(/\/v\d+$/.test(root) ? [] : [`${root}/v1/models`])];
      for (const url of urls) {
        const res = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(12_000) });
        if (!res.ok) {
          await res.body?.cancel?.();
          console.log(route, url, `HTTP ${res.status}: UNVERIFIED（鉴权拒绝不证明路径正确）`);
          if (res.status === 404) continue;
          break;
        }
        const text = await res.text();
        if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('诊断响应过大');
        const ids = parseOfficialModels(JSON.parse(text));
        console.log(route, url, `公开清单返回 ${ids.size} 个 ID；未验证完整性、套餐或推理协议`);
        break;
      }
    } catch (e) { console.log(route, `UNVERIFIED: ${e.message}`); }
  }
}

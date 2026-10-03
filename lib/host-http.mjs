const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** The local Web API never trusts forwarded headers or arbitrary DNS Host names. */
export function validLocalRequest(req, { port, mutate = false } = {}) {
  try {
    const scheme = req.socket?.encrypted ? 'https:' : 'http:';
    const target = new URL(`${scheme}//${req.headers.host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) return false;
    if (port !== undefined && Number(target.port || (scheme === 'https:' ? 443 : 80)) !== Number(port)) return false;
    const origin = req.headers.origin;
    if (mutate && typeof origin !== 'string') return false;
    if (origin !== undefined && (typeof origin !== 'string' || new URL(origin).origin !== target.origin || origin !== new URL(origin).origin)) return false;
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
    return true;
  } catch { return false; }
}

export function readJsonBody(req, { signal, maxBytes = 64 * 1024, timeoutMs = 10_000 } = {}) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return Promise.reject(new HttpError(415, 'application/json required'));
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) return Promise.reject(new HttpError(413, 'request body too large'));
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let done = false;
    const clean = () => {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted);
      signal?.removeEventListener('abort', aborted);
    };
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clean();
      if (error) { req.resume(); reject(error); } else resolve(result);
    };
    const data = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > maxBytes) return finish(new HttpError(413, 'request body too large'));
      chunks.push(bytes);
    };
    const end = () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!object(value)) throw new Error('Expected a JSON object');
        finish(null, value);
      } catch { finish(new HttpError(400, 'expected a valid JSON object')); }
    };
    const error = () => finish(new HttpError(400, 'request body interrupted'));
    const aborted = () => finish(new HttpError(503, 'request aborted'));
    const timer = setTimeout(() => finish(new HttpError(408, 'request body timed out')), timeoutMs);
    timer.unref?.();
    req.on('data', data); req.on('end', end); req.on('error', error); req.on('aborted', aborted);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
  });
}

export function sendJson(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}

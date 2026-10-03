import { mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const writes = new Map();

/** Unique temporary file, flushed before replacement. Same-process writes per path are serialized. */
export function atomicWrite(file, content, { signal } = {}) {
  const absolute = path.resolve(file);
  const previous = writes.get(absolute) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    signal?.throwIfAborted();
    await mkdir(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      signal?.throwIfAborted();
      await rename(temporary, absolute);
    } finally {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  });
  writes.set(absolute, next);
  void next.finally(() => { if (writes.get(absolute) === next) writes.delete(absolute); }).catch(() => {});
  return next;
}

export function atomicWriteJson(file, value, options) {
  // Snapshot before the first await: caller mutations cannot alter a queued write.
  return atomicWrite(file, JSON.stringify(value, null, 2) + '\n', options);
}

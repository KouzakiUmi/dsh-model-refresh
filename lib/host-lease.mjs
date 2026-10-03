import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Fail closed on stale locks: PID liveness alone is not proof of lock ownership. */
export async function acquireStateLease(stateFile) {
  const file = `${stateFile}.lock`;
  await mkdir(path.dirname(file), { recursive: true });
  const token = randomUUID();
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = 'unknown';
    try { owner = JSON.parse(await readFile(file, 'utf8')).pid ?? 'unknown'; } catch {}
    throw new Error(`State lock exists: ${file} (recorded PID ${owner}). Confirm the owning DSH process has exited before moving the stale lock aside and starting again.`);
  }
  try {
    await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');
    await handle.sync();
  } catch (error) { await handle.close(); await unlink(file); throw error; }
  await handle.close();
  let released = false;
  return async () => {
    if (released) return;
    const current = JSON.parse(await readFile(file, 'utf8'));
    if (current.token !== token) throw new Error('State lock ownership changed; not removing another owner\'s lock');
    await unlink(file);
    released = true;
  };
}

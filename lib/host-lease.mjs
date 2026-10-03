import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Fail closed on *live* locks: PID liveness alone is not proof of lock ownership, so an
 * existing lock is never removed while its owner may still be running. A provably dead
 * owner (ESRCH) is a different case — the lock is moved aside to a `.stale-<pid>-<stamp>.bak`
 * backup and re-created, because otherwise every unclean host exit needs manual repair.
 * Unknown owners, unreadable locks and EPERM keep the original failing behaviour.
 */
function ownerLiveness(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown';
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) { return error.code === 'ESRCH' ? 'dead' : 'unknown'; }
}

async function readOwner(file) {
  try {
    const doc = JSON.parse(await readFile(file, 'utf8'));
    return doc !== null && typeof doc === 'object' ? doc : undefined;
  } catch { return undefined; }
}

const stamp = () => new Date().toISOString().slice(0, 19).replace('T', '-').replace(/:/g, '');

/** Move a dead owner's lock aside. `rename` is atomic, so at most one contender wins. */
async function reclaimDeadLock(file, owner) {
  if (ownerLiveness(owner?.pid) !== 'dead') return false;
  try { await rename(file, `${file}.stale-${owner.pid}-${stamp()}.bak`); }
  catch { return false; }
  return true;
}

export async function acquireStateLease(stateFile, options = {}) {
  const file = `${stateFile}.lock`;
  await mkdir(path.dirname(file), { recursive: true });
  const token = randomUUID();
  const attempts = options.reclaimDeadLocks === false ? 1 : 3;
  let handle;
  for (let attempt = 0; attempt < attempts && handle === undefined; attempt++) {
    try { handle = await open(file, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readOwner(file);
      if (attempt + 1 < attempts && await reclaimDeadLock(file, owner)) continue;
      const id = Number.isInteger(owner?.pid) ? owner.pid : owner?.pid ?? 'unknown';
      throw new Error(`State lock exists: ${file} (recorded PID ${id}). Confirm the owning DSH process has exited before moving the stale lock aside and starting again.`);
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');
    await handle.sync();
  } catch (error) { await handle.close(); await unlink(file).catch(() => {}); throw error; }
  await handle.close();
  let released = false;
  // Last-resort cleanup: a host that exits without awaiting Cordis dispose (Electron quit,
  // forced restart) would otherwise leave the lock for the next start to trip over.
  const onExit = () => {
    if (released) return;
    try { if (JSON.parse(readFileSync(file, 'utf8'))?.token === token) unlinkSync(file); } catch {}
  };
  process.once('exit', onExit);
  return async () => {
    if (released) return;
    let current;
    try { current = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      released = true;
      process.removeListener('exit', onExit);
      return;
    }
    if (current?.token !== token) {
      process.removeListener('exit', onExit);
      throw new Error('State lock ownership changed; not removing another owner\'s lock');
    }
    await unlink(file);
    released = true;
    process.removeListener('exit', onExit);
  };
}

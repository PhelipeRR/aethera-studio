import { closeSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/*
 * CORE-03: one Core per data folder (ADR CORE-01 §2.1, rule 3). `core.lock` is created with O_EXCL, so two Cores
 * starting together cannot both win. A lock left by a dead process (crash, power loss) is taken over; a lock whose PID
 * is alive is checked against the owner's /health instance header, so a reused PID never blocks the Core forever.
 */

export const LOCK_FILE = 'core.lock';
const STARTING_GRACE_MS = 15_000;

export const lockContentSchema = z.strictObject({
  pid: z.number().int().positive(),
  port: z.number().int().min(1).max(65_535).nullable(),
  instanceId: z.string().uuid(),
  startedAt: z.string(),
  version: z.string().max(40),
  mode: z.enum(['embedded', 'standalone']),
});
export type LockContent = z.infer<typeof lockContentSchema>;

export interface LockDeps {
  isAlive: (pid: number) => boolean;
  /** Asks the owner's /health whether it answers with this instance id. */
  ownerAnswers: (owner: LockContent) => Promise<boolean>;
}

export type LockResult = { acquired: true; lock: CoreLock } | { acquired: false; owner: LockContent };

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

export function readLock(dataDir: string): LockContent | null {
  try { return lockContentSchema.parse(JSON.parse(readFileSync(join(dataDir, LOCK_FILE), 'utf8'))); } catch { return null; }
}

export class CoreLock {
  private released = false;
  constructor(readonly path: string, private content: LockContent) {}

  get value(): LockContent { return this.content; }

  /** Records the port once listening. Written to a temp file and renamed, so readers never see half a file. */
  update(changes: Partial<Pick<LockContent, 'port'>>): void {
    if (this.released) return;
    this.content = { ...this.content, ...changes };
    const temp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(this.content));
    renameSync(temp, this.path);
  }

  /** Removes the lock only if it is still ours (a successor may have taken over a stale one). */
  release(): void {
    if (this.released) return;
    this.released = true;
    try {
      const current = lockContentSchema.parse(JSON.parse(readFileSync(this.path, 'utf8')));
      if (current.instanceId === this.content.instanceId) rmSync(this.path, { force: true });
    } catch { /* already gone */ }
  }
}

function tryCreate(path: string, content: LockContent): boolean {
  let fd: number;
  try { fd = openSync(path, 'wx'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try { writeSync(fd, JSON.stringify(content)); } finally { closeSync(fd); }
  return true;
}

export async function acquireLock(dataDir: string, content: LockContent, deps: LockDeps): Promise<LockResult> {
  const path = join(dataDir, LOCK_FILE);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (tryCreate(path, content)) return { acquired: true, lock: new CoreLock(path, content) };
    const owner = readLock(dataDir);
    // A file being written right now reads as invalid; give its writer a moment before calling it stale.
    if (!owner) { await new Promise((resolve) => setTimeout(resolve, 100)); if (!readLock(dataDir) && attempt === 0) continue; }
    const current = readLock(dataDir);
    // An owner without a port is still starting: trust it only within the ready timeout, then treat it as stale.
    const starting = current?.port === null && Date.now() - Date.parse(current.startedAt) < STARTING_GRACE_MS;
    if (current && current.pid !== process.pid && deps.isAlive(current.pid) && (starting || (current.port !== null && await deps.ownerAnswers(current)))) return { acquired: false, owner: current };
    // Stale: move it aside atomically; only one contender wins the rename, the others retry the exclusive create.
    try { renameSync(path, `${path}.stale-${process.pid}`); rmSync(`${path}.stale-${process.pid}`, { force: true }); } catch { /* someone else took it over */ }
  }
  const owner = readLock(dataDir);
  if (owner) return { acquired: false, owner };
  throw new Error('Não foi possível obter o core.lock.');
}

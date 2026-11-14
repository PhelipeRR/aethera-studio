import { randomUUID } from 'node:crypto';
import type { DatabaseHandle } from '@neuralbridge/database';

/*
 * CORE-04: one executor per task (ADR CORE-01 §2.2, CORE-02 decision C2-6). Before any step runs, the executor takes
 * the task's lease in a single UPDATE; SQLite serializes writers, so across processes (desktop, embedded Core,
 * standalone Core) at most one acquires it. The holder renews it while running and clears it when the run ends. A lease
 * that is not renewed (crash, power loss) expires and the task can be recovered.
 */

export const LEASE_TTL_MS = 60_000;
export const LEASE_RENEW_MS = 20_000;

/** The whole acquisition is this one statement: free, ours or expired → ours. Parameters: owner, expiry, task, owner, now. */
export const LEASE_ACQUIRE_SQL = 'UPDATE tasks SET owner_instance_id = ?, lease_expires_at = ? WHERE id = ? AND (owner_instance_id IS NULL OR owner_instance_id = ? OR lease_expires_at IS NULL OR lease_expires_at < ?)';

/** Instance ids carry the executor's PID, so a lease left by a dead process is recognised at once, not after the TTL. */
export function newInstanceId(pid: number = process.pid, uuid: string = randomUUID()): string {
  return `${pid}:${uuid}`;
}

export function ownerPid(instanceId: string): number | null {
  const match = /^(\d+):/.exec(instanceId);
  return match ? Number(match[1]) : null;
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

export interface Lease {
  ownerInstanceId: string;
  leaseExpiresAt: string;
}

export class TaskLeases {
  constructor(private readonly handle: DatabaseHandle, readonly instanceId: string, private readonly now: () => Date = () => new Date(), private readonly ttlMs = LEASE_TTL_MS, private readonly isAlive: (pid: number) => boolean = processAlive) {}

  private expiry(): string { return new Date(this.now().getTime() + this.ttlMs).toISOString(); }

  /** True when this instance now holds the lease: it was free, already ours, or expired. */
  acquire(taskId: string): boolean {
    const now = this.now().toISOString();
    const result = this.handle.sqlite.prepare(LEASE_ACQUIRE_SQL).run(this.instanceId, this.expiry(), taskId, this.instanceId, now);
    return result.changes === 1;
  }

  /** Extends our lease; false means it was lost (expired and taken by someone else). */
  renew(taskId: string): boolean {
    return this.handle.sqlite.prepare('UPDATE tasks SET lease_expires_at = ? WHERE id = ? AND owner_instance_id = ?').run(this.expiry(), taskId, this.instanceId).changes === 1;
  }

  release(taskId: string): void {
    this.handle.sqlite.prepare('UPDATE tasks SET owner_instance_id = NULL, lease_expires_at = NULL WHERE id = ? AND owner_instance_id = ?').run(taskId, this.instanceId);
  }

  current(taskId: string): Lease | null {
    const row = this.handle.sqlite.prepare('SELECT owner_instance_id AS ownerInstanceId, lease_expires_at AS leaseExpiresAt FROM tasks WHERE id = ?').get(taskId) as { ownerInstanceId: string | null; leaseExpiresAt: string | null } | undefined;
    return row?.ownerInstanceId && row.leaseExpiresAt ? { ownerInstanceId: row.ownerInstanceId, leaseExpiresAt: row.leaseExpiresAt } : null;
  }

  /**
   * Held by another live executor: not expired, and its process is alive. A lease from this same process but another
   * instance belongs to an engine that no longer exists (one executor per process), so it is not held.
   */
  heldByOther(taskId: string): boolean {
    const lease = this.current(taskId);
    if (!lease || lease.ownerInstanceId === this.instanceId || lease.leaseExpiresAt < this.now().toISOString()) return false;
    const pid = ownerPid(lease.ownerInstanceId);
    if (pid === null) return true;
    return pid !== process.pid && this.isAlive(pid);
  }
}

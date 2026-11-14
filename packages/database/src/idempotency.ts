import { and, eq, lt } from 'drizzle-orm';
import type { DatabaseHandle } from './open.js';
import { idempotencyKeys } from './schema.js';

/*
 * CORE-04: the Idempotency-Key store (CORE-02 decision C2-5). A request first claims its key (one row per scope + key,
 * the primary key makes the claim atomic across processes); a retry with the same body gets the stored response, a
 * retry with another body is a conflict, and a retry while the first is still running is told so. A failed attempt
 * releases its claim, so the client can try again with the same key.
 */

export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

export type IdempotencyClaim =
  | { state: 'new' }
  | { state: 'replay'; statusCode: number; response: unknown }
  | { state: 'conflict' }
  | { state: 'in_progress' };

export class IdempotencyStore {
  constructor(private readonly handle: DatabaseHandle, private readonly now: () => Date = () => new Date()) {}

  /** `scope` names who and what (e.g. "device:<id>:POST /api/v1/tasks"); `fingerprint` is the body hash. */
  claim(scope: string, key: string, fingerprint: string): IdempotencyClaim {
    const at = this.now();
    this.prune(at);
    const inserted = this.handle.sqlite
      .prepare('INSERT INTO idempotency_keys (scope, key, fingerprint, state, created_at, expires_at) VALUES (?, ?, ?, \'in_progress\', ?, ?) ON CONFLICT(scope, key) DO NOTHING')
      .run(scope, key, fingerprint, at.toISOString(), new Date(at.getTime() + IDEMPOTENCY_RETENTION_MS).toISOString());
    if (inserted.changes === 1) return { state: 'new' };
    const row = this.handle.db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))).get();
    if (!row) return this.claim(scope, key, fingerprint);
    if (row.fingerprint !== fingerprint) return { state: 'conflict' };
    if (row.state === 'in_progress') return { state: 'in_progress' };
    return { state: 'replay', statusCode: row.statusCode ?? 200, response: row.response === null ? null : JSON.parse(row.response) as unknown };
  }

  complete(scope: string, key: string, statusCode: number, response: unknown): void {
    this.handle.db.update(idempotencyKeys).set({ state: 'completed', statusCode, response: JSON.stringify(response ?? null) }).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))).run();
  }

  /** The request failed before producing a result: free the key for a retry. */
  release(scope: string, key: string): void {
    this.handle.db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key), eq(idempotencyKeys.state, 'in_progress'))).run();
  }

  prune(at: Date = this.now()): number {
    return this.handle.db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, at.toISOString())).run().changes;
  }
}

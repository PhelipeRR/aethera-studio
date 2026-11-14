import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_RETENTION_MS, IdempotencyStore, openDatabase, tasks, type DatabaseHandle } from '../src/index.js';

const MIGRATIONS = resolve(import.meta.dirname, '../migrations');
let handle: DatabaseHandle;
let file: string;
beforeEach(() => { file = join(mkdtempSync(join(tmpdir(), 'nb-idem-')), 'brain.db'); handle = openDatabase(file, { migrationsFolder: MIGRATIONS }); });
afterEach(() => handle.close());

describe('idempotency keys (CORE-04)', () => {
  const scope = 'device:dev-1:POST /api/v1/tasks';
  const key = '0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10';

  it('claims once, then replays the stored result for the same body', () => {
    const store = new IdempotencyStore(handle);
    expect(store.claim(scope, key, 'hash-a')).toEqual({ state: 'new' });
    expect(store.claim(scope, key, 'hash-a')).toEqual({ state: 'in_progress' });
    store.complete(scope, key, 201, { task: { id: 't1' }, replayed: false });
    expect(store.claim(scope, key, 'hash-a')).toEqual({ state: 'replay', statusCode: 201, response: { task: { id: 't1' }, replayed: false } });
  });

  it('refuses the same key with another body, and keeps keys apart per scope', () => {
    const store = new IdempotencyStore(handle);
    store.claim(scope, key, 'hash-a');
    store.complete(scope, key, 201, { ok: true });
    expect(store.claim(scope, key, 'hash-b')).toEqual({ state: 'conflict' });
    expect(store.claim('device:dev-2:POST /api/v1/tasks', key, 'hash-b')).toEqual({ state: 'new' });
  });

  it('frees the key when the first attempt failed, and forgets keys after the retention period', () => {
    let now = new Date('2026-11-09T12:00:00Z');
    const store = new IdempotencyStore(handle, () => now);
    store.claim(scope, key, 'hash-a');
    store.release(scope, key);
    expect(store.claim(scope, key, 'hash-a')).toEqual({ state: 'new' });
    store.complete(scope, key, 200, null);
    now = new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS + 1);
    expect(store.claim(scope, key, 'hash-z')).toEqual({ state: 'new' });
  });

  it('lets only one of two connections claim the same key', () => {
    const second = openDatabase(file, { migrationsFolder: MIGRATIONS });
    try {
      const claims = [new IdempotencyStore(handle).claim(scope, key, 'h'), new IdempotencyStore(second).claim(scope, key, 'h')];
      expect(claims.filter((claim) => claim.state === 'new')).toHaveLength(1);
    } finally { second.close(); }
  });

  it('enforces one task per external reference at the database level', () => {
    handle.db.insert(tasks).values({ id: 'a', prompt: 'x', projectId: null, mode: 'auto', externalSystem: 'paperclip', externalId: 'ISSUE-1', externalRevision: 0 }).run();
    expect(() => handle.db.insert(tasks).values({ id: 'b', prompt: 'x', projectId: null, mode: 'auto', externalSystem: 'paperclip', externalId: 'ISSUE-1', externalRevision: 1 }).run()).toThrow();
    handle.db.insert(tasks).values({ id: 'c', prompt: 'x', projectId: null, mode: 'auto' }).run();
    handle.db.insert(tasks).values({ id: 'd', prompt: 'x', projectId: null, mode: 'auto' }).run();
    expect(handle.db.select().from(tasks).all()).toHaveLength(3);
  });
});

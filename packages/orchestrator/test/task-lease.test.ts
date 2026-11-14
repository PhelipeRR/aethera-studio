import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openDatabase, projects, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import { LEASE_ACQUIRE_SQL, LEASE_TTL_MS, newInstanceId, ownerPid, TaskLeases } from '../src/task-lease.js';
import { FakeAdapter } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let dbFile: string;

beforeEach(() => {
  dbFile = join(mkdtempSync(join(tmpdir(), 'nb-lease-')), 'brain.db');
  handle = openDatabase(dbFile, { migrationsFolder: MIGRATIONS });
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: mkdtempSync(join(tmpdir(), 'nb-lease-project-')) }).run();
  handle.db.insert(tasks).values({ id: 't1', prompt: 'x', projectId: null, mode: 'auto', status: 'pending' }).run();
});
afterEach(() => handle.close());

const leaseOf = (id: string) => handle.db.select({ owner: tasks.ownerInstanceId, expires: tasks.leaseExpiresAt }).from(tasks).where(eq(tasks.id, id)).get();

describe('task leases (CORE-04)', () => {
  it('lets exactly one of many parallel executors take a task (separate connections, real threads)', async () => {
    const workers = 8;
    const start = new SharedArrayBuffer(4);
    const source = `
      const { workerData, parentPort } = require('node:worker_threads');
      const Database = require(workerData.driver);
      const db = new Database(workerData.file);
      db.pragma('busy_timeout = 5000');
      const statement = db.prepare(workerData.sql);
      Atomics.wait(new Int32Array(workerData.start), 0, 0);
      const now = new Date().toISOString();
      const changes = statement.run(workerData.owner, new Date(Date.now() + 60000).toISOString(), 't1', workerData.owner, now).changes;
      db.close();
      parentPort.postMessage(changes);`;
    const driver = require.resolve('better-sqlite3', { paths: [resolve(import.meta.dirname, '../../database')] });
    const results = Array.from({ length: workers }, (_, index) => new Promise<number>((done, fail) => {
      const worker = new Worker(source, { eval: true, workerData: { driver, file: dbFile, sql: LEASE_ACQUIRE_SQL, owner: newInstanceId(10_000 + index), start } });
      worker.once('message', done);
      worker.once('error', fail);
    }));
    await new Promise((done) => setTimeout(done, 300));
    Atomics.store(new Int32Array(start), 0, 1);
    Atomics.notify(new Int32Array(start), 0);
    const changes = await Promise.all(results);
    expect(changes.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(ownerPid(leaseOf('t1')?.owner ?? '')).toBeGreaterThanOrEqual(10_000);
  });

  it('renews only its own lease, takes over an expired one and releases only its own', () => {
    let now = new Date('2026-11-09T12:00:00Z');
    const a = new TaskLeases(handle, newInstanceId(111), () => now, LEASE_TTL_MS, () => true);
    const b = new TaskLeases(handle, newInstanceId(222), () => now, LEASE_TTL_MS, () => true);
    expect(a.acquire('t1')).toBe(true);
    expect(b.acquire('t1')).toBe(false);
    expect(b.heldByOther('t1')).toBe(true);
    expect(a.renew('t1')).toBe(true);
    b.release('t1');
    expect(leaseOf('t1')?.owner).toBe(a.instanceId);
    now = new Date(now.getTime() + LEASE_TTL_MS + 1);
    expect(b.heldByOther('t1')).toBe(false);
    expect(b.acquire('t1')).toBe(true);
    expect(a.renew('t1')).toBe(false);
    b.release('t1');
    expect(leaseOf('t1')).toEqual({ owner: null, expires: null });
  });

  it('treats a lease from a dead process, or from an earlier engine of this process, as not held', () => {
    const me = new TaskLeases(handle, newInstanceId(), () => new Date(), LEASE_TTL_MS, (pid) => pid === 333);
    handle.db.update(tasks).set({ ownerInstanceId: newInstanceId(444), leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }).where(eq(tasks.id, 't1')).run();
    expect(me.heldByOther('t1')).toBe(false);
    handle.db.update(tasks).set({ ownerInstanceId: newInstanceId(333) }).where(eq(tasks.id, 't1')).run();
    expect(me.heldByOther('t1')).toBe(true);
    handle.db.update(tasks).set({ ownerInstanceId: newInstanceId(process.pid) }).where(eq(tasks.id, 't1')).run();
    expect(me.heldByOther('t1')).toBe(false);
  });
});

describe('TaskEngine with leases and external references (CORE-04)', () => {
  const makeEngine = (codex: FakeAdapter, instanceId?: string) => new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', []), codex }, availability: async () => ({ claude: true, codex: true }), ...(instanceId ? { instanceId } : {}) });

  it('holds the lease while running and clears it when the task ends', async () => {
    const codex = new FakeAdapter('codex', () => ({ delayMs: 150, text: 'ok' }));
    const engine = makeEngine(codex);
    const id = await engine.start({ prompt: 'Explique o projeto', projectId: 'api', mode: 'codex', access: 'read-only' });
    expect(leaseOf(id)?.owner).toBe(engine.leases.instanceId);
    await engine.idle();
    expect(leaseOf(id)).toEqual({ owner: null, expires: null });
  });

  it('never runs a task whose lease another live executor holds, and recovery leaves it alone', async () => {
    const codex = new FakeAdapter('codex', () => ({ text: 'ok' }));
    const engine = makeEngine(codex);
    const other = newInstanceId(process.ppid);
    handle.db.update(tasks).set({ status: 'running', ownerInstanceId: other, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }).where(eq(tasks.id, 't1')).run();
    (engine as unknown as { launch: (id: string, work: () => Promise<void>) => void }).launch('t1', async () => { await codex.run({} as never); });
    await engine.idle();
    expect(codex.requests).toHaveLength(0);
    expect(engine.recover()).toBe(0);
    expect(leaseOf('t1')?.owner).toBe(other);
  });

  it('creates one task per external reference, even when asked twice at the same time', async () => {
    const codex = new FakeAdapter('codex', () => ({ text: 'ok' }));
    const engine = makeEngine(codex);
    const ref = { system: 'paperclip', id: 'ISSUE-42', revision: 1 };
    const [first, second] = await Promise.all([
      engine.start({ prompt: 'Explique', projectId: 'api', mode: 'codex', access: 'read-only', externalRef: ref }),
      engine.start({ prompt: 'Explique', projectId: 'api', mode: 'codex', access: 'read-only', externalRef: ref }),
    ]);
    expect(second).toBe(first);
    const again = await engine.start({ prompt: 'Explique', projectId: 'api', mode: 'codex', access: 'read-only', externalRef: { ...ref, revision: 3 } });
    expect(again).toBe(first);
    await engine.idle();
    expect(codex.requests).toHaveLength(1);
    expect(handle.db.select({ revision: tasks.externalRevision }).from(tasks).where(eq(tasks.id, first)).get()?.revision).toBe(3);
    expect(handle.db.select().from(tasks).where(eq(tasks.externalId, 'ISSUE-42')).all()).toHaveLength(1);
  });
});

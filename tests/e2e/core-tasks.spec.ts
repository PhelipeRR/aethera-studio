import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// CORE-05/06: chat tasks execute in the Singularity Core (the lease owner is the Core's process), the desktop shows them
// exactly as before (events bridged), commands reach the Core, and NB_CORE_TASKS=main keeps the old path.

const Database = createRequire(resolve(import.meta.dirname, '../../packages/database/package.json'))('better-sqlite3') as new (file: string, options?: { readonly?: boolean }) => { prepare(sql: string): { get(...args: unknown[]): unknown }; close(): void };
const lockPid = (dataDir: string): number | null => { try { const lock = JSON.parse(readFileSync(join(dataDir, 'core.lock'), 'utf8')) as { pid: number; port: number | null }; return lock.port ? lock.pid : null; } catch { return null; } };
function taskRow(dataDir: string, id: string): { status: string; owner: string | null } | null {
  const db = new Database(join(dataDir, 'db', 'brain.db'), { readonly: true });
  try { return (db.prepare('SELECT status, owner_instance_id AS owner FROM tasks WHERE id = ?').get(id) as { status: string; owner: string | null } | undefined) ?? null; } finally { db.close(); }
}

test('a chat task runs in the Core, shows live in the desktop and is cancelled through the Core', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  await expect.poll(() => lockPid(dataDir), { timeout: 20_000 }).not.toBeNull();
  const corePid = lockPid(dataDir);
  const mainPid = await app.evaluate(() => process.pid);
  // Give the adapter a moment to receive the ready message with its credentials.
  await page.waitForTimeout(500);
  const { id } = await page.evaluate(() => window.neuralbridge.tasks.start({ prompt: 'Explique o projeto LENTO', projectId: null, mode: 'codex', access: 'read-only' }));
  await expect.poll(() => taskRow(dataDir, id)?.owner ?? null, { timeout: 15_000 }).not.toBeNull();
  const owner = taskRow(dataDir, id)?.owner ?? '';
  expect(owner.split(':')[0]).toBe(String(corePid));
  expect(owner.split(':')[0]).not.toBe(String(mainPid));
  // The desktop sees the running task through the bridged events, as before.
  await expect.poll(async () => (await page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id)).status, { timeout: 15_000 }).toBe('running');
  await page.evaluate((taskId) => window.neuralbridge.tasks.cancel(taskId), id);
  await expect.poll(() => taskRow(dataDir, id)?.status, { timeout: 15_000 }).toBe('cancelled');
  expect(taskRow(dataDir, id)?.owner).toBeNull();
  await app.close();
});

test('a finished Core task reaches the chat screen with its answer', async () => {
  const { app, page, dataDir } = await launchApp(freshDataDir(), { env: FAKE_AGENTS });
  await expect.poll(() => lockPid(dataDir), { timeout: 20_000 }).not.toBeNull();
  await page.waitForTimeout(500);
  const { id } = await page.evaluate(() => window.neuralbridge.tasks.start({ prompt: 'Explique o projeto', projectId: null, mode: 'codex', access: 'read-only' }));
  await expect.poll(async () => (await page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id)).status, { timeout: 30_000 }).toBe('completed');
  const detail = await page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id);
  expect(detail.steps.length).toBeGreaterThan(0);
  expect(detail.summary ?? '').not.toBe('');
  await app.close();
});

test('NB_CORE_TASKS=main keeps chat tasks in the desktop (rollback switch)', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_CORE_TASKS: 'main' } });
  await expect.poll(() => lockPid(dataDir), { timeout: 20_000 }).not.toBeNull();
  const mainPid = await app.evaluate(() => process.pid);
  const { id } = await page.evaluate(() => window.neuralbridge.tasks.start({ prompt: 'Explique o projeto LENTO', projectId: null, mode: 'codex', access: 'read-only' }));
  await expect.poll(() => taskRow(dataDir, id)?.owner ?? null, { timeout: 15_000 }).not.toBeNull();
  expect(taskRow(dataDir, id)?.owner?.split(':')[0]).toBe(String(mainPid));
  await page.evaluate((taskId) => window.neuralbridge.tasks.cancel(taskId), id);
  await expect.poll(() => taskRow(dataDir, id)?.status, { timeout: 15_000 }).toBe('cancelled');
  await app.close();
});

test('reuses the same Core task for a repeated external reference', async () => {
  const { app, page, dataDir } = await launchApp(freshDataDir(), { env: FAKE_AGENTS });
  await expect.poll(() => lockPid(dataDir), { timeout: 20_000 }).not.toBeNull();
  await page.waitForTimeout(500);
  const input = { prompt: 'Explique o projeto LENTO', projectId: null, mode: 'codex' as const, access: 'read-only' as const, externalRef: { system: 'void', id: 'action/e2e-idempotency', revision: 1 } };
  const ids = await page.evaluate((value) => Promise.all([window.neuralbridge.tasks.start(value), window.neuralbridge.tasks.start(value)]), input);
  expect(ids[0]?.id).toBe(ids[1]?.id);
  await page.evaluate((taskId) => window.neuralbridge.tasks.cancel(taskId), ids[0]?.id);
  await expect.poll(() => taskRow(dataDir, ids[0]?.id ?? '')?.status, { timeout: 15_000 }).toBe('cancelled');
  await app.close();
});

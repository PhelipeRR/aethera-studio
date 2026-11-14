import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { autonomousMissions, autonomousMissionTasks, openDatabase } from '@neuralbridge/database';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// Task 1 of the Core expansion plan: the dynamic, read-only inventory. One test installation with the Core running;
// one real entry point of every migrated group is fired and the database says who executed it. Every group must land
// in the Core's process (never the desktop's) with its own external reference system. The inventory is attached to the
// report as JSON. Velix needs a restart to reach its direct path and is proven in core-velix-tasks.spec.ts.

const MIGRATIONS = resolve(import.meta.dirname, '../../packages/database/migrations');
const Database = createRequire(resolve(import.meta.dirname, '../../packages/database/package.json'))('better-sqlite3') as new (file: string, options?: { readonly?: boolean }) => { prepare(sql: string): { all(...args: unknown[]): unknown[] }; close(): void };
type Row = { id: string; status: string; owner: string | null; system: string | null; externalId: string | null };
const lockPid = (dataDir: string): number | null => { try { const lock = JSON.parse(readFileSync(join(dataDir, 'core.lock'), 'utf8')) as { pid: number; port: number | null }; return lock.port ? lock.pid : null; } catch { return null; } };
function tasks(dataDir: string): Row[] {
  const db = new Database(join(dataDir, 'db', 'brain.db'), { readonly: true });
  try { return db.prepare('SELECT id, status, owner_instance_id AS owner, external_system AS system, external_id AS externalId FROM tasks').all() as Row[]; } finally { db.close(); }
}

test('every migrated group executes in the Core process with its own external reference', async () => {
  const testInfo = test.info();
  const dataDir = freshDataDir();
  // A mission left running by a previous session: the app recovers it at boot (its only entry point).
  const seed = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  const now = new Date().toISOString();
  seed.db.insert(autonomousMissions).values({ id: 'mission-inventory', status: 'running', acceptance: 'explicar', maxDurationMs: 600_000, startedAt: now }).run();
  seed.db.insert(autonomousMissionTasks).values({ id: 'mission-task-1', missionId: 'mission-inventory', prompt: 'Explique o projeto LENTO', acceptance: 'explicar' }).run();
  seed.close();

  const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  await expect.poll(() => lockPid(dataDir), { timeout: 20_000 }).not.toBeNull();
  const corePid = String(lockPid(dataDir));
  const mainPid = String(await app.evaluate(() => process.pid));
  await page.waitForTimeout(500);

  // Chat (CORE-06) and the Void's confirmed project edit (CORE-12, same broker call the executor makes).
  await page.evaluate(() => window.neuralbridge.tasks.start({ prompt: 'Explique o projeto LENTO', projectId: null, mode: 'codex', access: 'read-only' }));
  await page.evaluate(() => window.neuralbridge.tasks.start({ prompt: 'Explique o projeto LENTO', projectId: null, mode: 'codex', access: 'read-only', externalRef: { system: 'void', id: 'action/inventory', revision: 1 } }));
  // Workflow agent step (CORE-10; Git automations reach execution only through this path, CORE-11).
  const workflowId = await page.evaluate(() => window.neuralbridge.workflows.save(undefined, { name: 'Inventário', projectId: null, maxParallel: 1, steps: [{ id: 'slow', title: 'Etapa lenta', prompt: 'Explique LENTO', agent: 'claude', mode: 'claude', dependsOn: [], requiresApproval: false }] }).then((result) => result.id));
  await page.evaluate((id) => window.neuralbridge.workflows.run(id, true), workflowId);

  const groups = ['chat', 'void', 'workflow', 'mission'] as const;
  const systemOf = (row: Row) => row.system ?? 'chat';
  await expect.poll(() => groups.filter((group) => tasks(dataDir).some((row) => systemOf(row) === group && row.owner)), { timeout: 20_000 }).toEqual([...groups]);

  const inventory = groups.map((group) => {
    const row = tasks(dataDir).find((item) => systemOf(item) === group && item.owner);
    const ownerPid = row?.owner?.split(':')[0] ?? null;
    return { group, externalId: row?.externalId ?? null, executor: ownerPid === corePid ? 'core' : ownerPid === mainPid ? 'desktop' : 'unknown' };
  });
  const file = testInfo.outputPath('core-dynamic-inventory.json');
  writeFileSync(file, `${JSON.stringify({ corePid, mainPid, inventory }, null, 2)}\n`);
  await testInfo.attach('core-dynamic-inventory', { path: file, contentType: 'application/json' });
  expect(inventory).toEqual([
    { group: 'chat', externalId: null, executor: 'core' },
    { group: 'void', externalId: 'action/inventory', executor: 'core' },
    { group: 'workflow', externalId: expect.stringMatching(/\/slow$/u), executor: 'core' },
    { group: 'mission', externalId: 'mission/mission-task-1', executor: 'core' },
  ]);

  for (const row of tasks(dataDir).filter((item) => item.status === 'running' || item.status === 'queued')) await page.evaluate((id) => window.neuralbridge.tasks.cancel(id), row.id).catch(() => undefined);
  await app.close();
});

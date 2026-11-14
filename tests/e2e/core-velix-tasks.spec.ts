import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { openDatabase, velixProductionStages } from '@neuralbridge/database';
import { FAKE_AGENTS, launchApp } from './app';
import { velixDataDir } from './velix-extension';

// CORE-13: a Velix stage launched by the direct path runs in the Singularity Core (the lease owner is the Core's
// process), carries the stage-attempt external reference, is not duplicated by a repeated resume, is cancelled through
// the Core, and NB_CORE_TASKS=main keeps the same stage on the desktop's TaskEngine (rollback).

const MIGRATIONS = resolve(import.meta.dirname, '../../packages/database/migrations');
const Database = createRequire(resolve(import.meta.dirname, '../../packages/database/package.json'))('better-sqlite3') as new (file: string, options?: { readonly?: boolean }) => { prepare(sql: string): { all(...args: unknown[]): unknown[] }; close(): void };
type TaskRow = { id: string; status: string; owner: string | null; externalId: string | null };
const lockPid = (dataDir: string): number | null => { try { const lock = JSON.parse(readFileSync(join(dataDir, 'core.lock'), 'utf8')) as { pid: number; port: number | null }; return lock.port ? lock.pid : null; } catch { return null; } };
function velixTasks(dataDir: string): TaskRow[] {
  const db = new Database(join(dataDir, 'db', 'brain.db'), { readonly: true });
  try { return db.prepare("SELECT id, status, owner_instance_id AS owner, external_id AS externalId FROM tasks WHERE external_system = 'velix'").all() as TaskRow[]; } finally { db.close(); }
}

/** A production whose research stage was in flight when the app closed: after the restart it is pending and resumable. */
async function interruptedProduction(env: Record<string, string>) {
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const first = await launchApp(dataDir, { env });
  const project = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await first.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const run = await first.page.evaluate((projectId) => window.neuralbridge.video.productionRunCreate({ projectId, brief: { schemaVersion: 1, projectId, format: { id: 'youtube-short', width: 1080, height: 1920, fps: 30, aspectRatio: '9:16', safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }, productionType: 'documentary', topic: 'Core e Velix', targetDurationSeconds: 60, targetWords: 145, language: 'pt-BR', audience: 'geral', tone: 'neutro', narrativeStyle: 'explicativo', researchDepth: 'light', sourceCount: 1, pace: 'standard', budgetUsd: 0 } }), project.id);
  await first.app.close();
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(velixProductionStages).values({ id: 'stage-core', runId: run.run.id, kind: 'research', status: 'running', inputHash: 'h', costEstimateUsd: 0, checkpoint: JSON.stringify({ prompt: 'Explique o projeto LENTO', taskProjectId: project.id }), taskId: 'task-gone' }).run();
  handle.close();
  return { dataDir, runId: run.run.id };
}

test('a Velix stage runs in the Core with its attempt reference, once, and is cancelled through the Core', async () => {
  const { dataDir, runId } = await interruptedProduction(FAKE_AGENTS);
  const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  await expect.poll(() => lockPid(dataDir), { timeout: 20_000 }).not.toBeNull();
  const corePid = lockPid(dataDir);
  const mainPid = await app.evaluate(() => process.pid);
  await page.waitForTimeout(500);
  // Two resumes at once (a double click, a reconnect): one task only.
  await page.evaluate((id) => Promise.all([window.neuralbridge.video.productionRunResume(id), window.neuralbridge.video.productionRunResume(id)]), runId);
  await expect.poll(() => velixTasks(dataDir).at(0)?.owner ?? null, { timeout: 15_000 }).not.toBeNull();
  const tasks = velixTasks(dataDir);
  expect(tasks).toHaveLength(1);
  // The interrupted stage is a retry, so this is attempt 1.
  expect(tasks[0]?.externalId).toBe('stage/stage-core/attempt/1');
  expect(tasks[0]?.owner?.split(':')[0]).toBe(String(corePid));
  expect(tasks[0]?.owner?.split(':')[0]).not.toBe(String(mainPid));
  await page.evaluate((id) => window.neuralbridge.video.productionRunCancel(id), runId);
  await expect.poll(() => velixTasks(dataDir).at(0)?.status, { timeout: 15_000 }).toBe('cancelled');
  expect(velixTasks(dataDir)).toHaveLength(1);
  await app.close();
});

test('NB_CORE_TASKS=main keeps the Velix stage on the desktop TaskEngine (rollback switch)', async () => {
  const env = { ...FAKE_AGENTS, NB_CORE_TASKS: 'main' };
  const { dataDir, runId } = await interruptedProduction(env);
  const { app, page } = await launchApp(dataDir, { env });
  const mainPid = await app.evaluate(() => process.pid);
  await page.evaluate((id) => window.neuralbridge.video.productionRunResume(id), runId);
  // Same reference, now owned by the desktop process: the local engine keeps the idempotency key too.
  await expect.poll(() => velixTasks(dataDir).at(0)?.owner?.split(':')[0] ?? null, { timeout: 15_000 }).toBe(String(mainPid));
  expect(velixTasks(dataDir)).toHaveLength(1);
  expect(velixTasks(dataDir)[0]?.externalId).toBe('stage/stage-core/attempt/1');
  await page.evaluate((id) => window.neuralbridge.video.productionRunCancel(id), runId);
  await app.close();
});

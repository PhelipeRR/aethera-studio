import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDatabase, tasks } from '@neuralbridge/database';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

test('Mission Control lista tarefas reais e filtra sem criar estado paralelo', async () => {
  const { app, page } = await launchApp();
  await page.getByRole('link', { name: 'Mission Control', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mission Control' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Filtros de tarefas' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('failed');
  await expect(page.getByText('Nenhuma tarefa corresponde aos filtros.')).toBeVisible();
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await app.close();
});

test('Mission Control mostra tarefa interrompida após reinicialização do processo', async () => {
  const dataDir = freshDataDir();
  mkdirSync(join(dataDir, 'db'), { recursive: true });
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: resolve(import.meta.dirname, '../../packages/database/migrations') });
  handle.db.insert(tasks).values({ id: 'interrupted-e2e', prompt: 'tarefa interrompida antes do reinício', mode: 'auto', status: 'running' }).run();
  handle.close();
  const { app, page } = await launchApp(dataDir);
  await page.getByRole('link', { name: 'Mission Control', exact: true }).click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('failed');
  await expect(page.getByText('tarefa interrompida antes do reinício')).toBeVisible();
  await app.close();
});

test('Mission Control pausa, retoma e cancela uma tarefa real', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.evaluate(() => window.neuralbridge.tasks.start({ prompt: 'Explique LENTO no Mission Control', projectId: null, mode: 'claude' }));
  await page.getByRole('link', { name: 'Mission Control', exact: true }).click();
  await page.reload();
  const task = page.getByRole('article').filter({ hasText: 'Explique LENTO no Mission Control' });
  await expect(task).toContainText('running');
  await task.getByRole('button', { name: 'Pausar' }).click();
  await expect(task).toContainText('paused');
  await task.getByRole('button', { name: 'Retomar' }).click();
  await expect(task).toContainText('running');
  await task.getByRole('button', { name: 'Cancelar' }).click();
  await expect(task).toContainText('cancelled');
  await app.close();
});

test('Mission Control preserva tarefa pausada após reinício sem reexecutá-la', async () => {
  const dataDir = freshDataDir();
  mkdirSync(join(dataDir, 'db'), { recursive: true });
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: resolve(import.meta.dirname, '../../packages/database/migrations') });
  handle.db.insert(tasks).values({ id: 'paused-e2e', prompt: 'tarefa pausada antes do reinício', mode: 'claude', status: 'paused' }).run();
  handle.close();
  const { app, page } = await launchApp(dataDir);
  await page.getByRole('link', { name: 'Mission Control', exact: true }).click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('paused');
  const task = page.getByRole('article').filter({ hasText: 'tarefa pausada antes do reinício' });
  await expect(task).toContainText('paused');
  await expect(task.getByRole('button', { name: 'Retomar' })).toBeVisible();
  await app.close();
});

test('Mission Control acompanha duas tarefas independentes sem perder estados', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const ids = await page.evaluate(() => Promise.all([
    window.neuralbridge.tasks.start({ prompt: 'tarefa concorrente A', projectId: null, mode: 'claude' }),
    window.neuralbridge.tasks.start({ prompt: 'tarefa concorrente B', projectId: null, mode: 'claude' }),
  ]).then((items) => items.map((item) => item.id)));
  await expect.poll(async () => page.evaluate(async (taskIds) => {
    const statuses = (await window.neuralbridge.tasks.list({})).filter((task) => taskIds.includes(task.id)).map((task) => task.status);
    return statuses.length === 2 && statuses.every((status) => ['completed', 'failed', 'cancelled'].includes(status));
  }, ids), { timeout: 15_000 }).toBe(true);
  await page.getByRole('link', { name: 'Mission Control', exact: true }).click();
  // Tasks were started by the API, outside any page, so the list may still hold its short-lived cache.
  await page.getByRole('button', { name: 'Atualizar' }).click();
  await expect(page.getByText('tarefa concorrente A')).toBeVisible();
  await expect(page.getByText('tarefa concorrente B')).toBeVisible();
  await app.close();
});

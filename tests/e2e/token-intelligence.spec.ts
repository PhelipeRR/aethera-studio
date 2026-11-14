import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// Phase 22: token diagnostics over what the (fake, real-format) agents report, and the per-task budget.

async function run(page: Page, prompt: string, mode: 'claude' | 'codex') {
  const { id } = await page.evaluate((input) => window.neuralbridge.tasks.start(input), { prompt, projectId: null, mode });
  await expect.poll(async () => (await page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id)).status, { timeout: 20_000 }).toBe('completed');
  return id;
}

test('reported usage is broken down by agent and step, and a repeated request raises an alert with a recommendation', async () => {
  const { app, page } = await launchApp(freshDataDir(), { env: FAKE_AGENTS });
  for (let i = 0; i < 3; i++) await run(page, 'Explique o cache de sessão', 'claude');
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();

  // The fake Claude reports 130 in (with cache) and 40 out per run.
  await expect(page.getByText('Informado pelos agentes').locator('..')).toContainText('510');
  await expect(page.getByRole('region', { name: 'Por agente' })).toContainText('Claude Code');
  await expect(page.getByRole('region', { name: 'Por etapa' })).toContainText('Planejamento/análise');
  await expect(page.getByText('Contexto adicionado (estimativa)')).toBeVisible();

  const alert = page.getByTestId('alert-repeated');
  await expect(alert).toContainText('“Explique o cache de sessão” foi pedido 3 vezes no período');
  await expect(alert).toContainText('Continue a conversa existente');
  await expect(alert.getByRole('link', { name: 'Execução 1' })).toHaveAttribute('href', /#\/runs\//);

  // The last 24 hours include the same runs.
  await page.getByRole('button', { name: '24 h' }).click();
  await expect(page.getByTestId('alert-repeated')).toBeVisible();
  await app.close();
});

test('the per-task budget is saved, survives a restart and applies to the next task', async () => {
  const dataDir = freshDataDir();
  let { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  const budget = page.getByLabel('Tokens por tarefa');
  await expect(budget).toHaveValue('2000000');
  await budget.fill('750000');
  await page.getByRole('button', { name: 'Salvar orçamento' }).click();
  await expect(page.getByRole('status')).toHaveText('Orçamento salvo.');

  const id = await run(page, 'Explique o cache', 'claude');
  const recorded = await page.evaluate(async (taskId) => (await window.neuralbridge.tasks.get(taskId)).events.find((event) => event.kind === 'token_budget')?.data, id);
  expect(recorded).toEqual({ configured: 750_000 });
  await app.close();

  ({ app, page } = await launchApp(dataDir, { env: FAKE_AGENTS }));
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByLabel('Tokens por tarefa')).toHaveValue('750000');
  expect(await page.evaluate(() => window.neuralbridge.analytics.budget())).toBe(750_000);
  await app.close();
});

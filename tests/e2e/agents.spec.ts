import { expect, test } from '@playwright/test';
import { launchApp } from './app';

const STATES = /Pronto|Pronto, com avisos|Indisponível/;

test('the dashboard and the agents page show the detected state of both CLIs', async () => {
  const { app, page } = await launchApp();
  // The dashboard's system health: detection finished with a state (not the "checking" warning icon).
  const integrations = page.getByRole('list', { name: 'Integrações' });
  for (const name of ['Claude Code', 'Codex CLI']) {
    await expect(integrations.getByRole('listitem', { name }).getByRole('img', { name: /^(Disponível|Indisponível)$/ })).toBeVisible({ timeout: 20_000 });
  }
  await page.getByRole('link', { name: 'Agentes', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Agentes' })).toBeVisible();
  await page.getByRole('button', { name: 'Verificar novamente' }).click();
  await expect(page.getByRole('listitem', { name: 'Claude Code' }).getByText(STATES)).toBeVisible({ timeout: 30_000 });
  await app.close();
});

import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('the MCPs page shows how to start the server and how to register it in each client', async () => {
  const { app, page } = await launchApp();
  await page.getByRole('link', { name: 'MCPs', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'MCPs' })).toBeVisible();
  await expect(page.getByText(/mcp-server\.js/).first()).toBeVisible();
  for (const name of ['Claude Code', 'Codex CLI']) {
    await expect(page.getByRole('listitem', { name })).toBeVisible();
  }
  await page.getByText('Comandos equivalentes para o terminal').first().click();
  await expect(page.getByText(/^claude mcp add -s user neuralbridge -e ELECTRON_RUN_AS_NODE=1/)).toBeVisible();
  await app.close();
});

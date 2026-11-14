import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';

test('first-success guide offers the local-first path and can be dismissed', async () => {
  const { app, page } = await launchApp();
  const guide = page.locator('section[aria-labelledby="first-success-title"]');
  await expect(guide).toContainText('Escolha um projeto');
  await expect(guide).toContainText('Verifique um agente');
  await expect(guide).toContainText('Envie a primeira tarefa');
  await expect(guide.getByRole('link', { name: /Escolha um projeto/ })).toHaveAttribute('href', '#/projects');
  await guide.getByRole('button', { name: 'Fechar guia de primeiro sucesso' }).click();
  await expect(page.getByText('Primeiro sucesso', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Primeiro sucesso' })).toHaveCount(0);
  await app.close();
});

test('first-success path reaches a completed read-only task from Chat', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const guide = page.locator('section[aria-labelledby="first-success-title"]');
  await guide.getByRole('link', { name: /Envie a primeira tarefa/ }).click();
  await expect(page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  const prompt = 'Explique em uma frase como funciona o workspace local-first';
  await page.getByLabel('Mensagem', { exact: true }).fill(prompt);
  await page.getByLabel('Mensagem', { exact: true }).press('Enter');
  const task = page.getByRole('article', { name: `Tarefa: ${prompt}` });
  await expect(task.getByRole('status')).toHaveText('Concluída', { timeout: 30_000 });
  await expect(task).toContainText('Resposta do agente falso');
  await app.close();
});

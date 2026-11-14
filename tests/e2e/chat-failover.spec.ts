import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

async function openInProject(dataDir: string) {
  const launched = await launchApp(dataDir, { env: FAKE_AGENTS });
  const root = join(dataDir, 'loja');
  mkdirSync(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  const id = await launched.page.evaluate((path) => window.neuralbridge.projects.add(path).then((project) => project.id), root);
  await launched.page.evaluate((projectId) => { window.location.hash = `#/chat?project=${projectId}`; }, id);
  await expect(launched.page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  return launched;
}

async function send(page: Page, prompt: string) {
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill(prompt);
  await box.press('Enter');
}

test('no modo Automático, o limite do Codex passa a tarefa ao Claude, sem perder a conversa', async () => {
  const { app, page } = await openInProject(freshDataDir());
  await send(page, 'Implemente a nota LIMITE-CODEX');
  await expect(page.getByText('Trocou de Codex CLI para Claude Code e continuou de onde parou.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('article', { name: /Tarefa:/ }).getByRole('status')).toHaveText('Concluída', { timeout: 15_000 });
  await app.close();
});

test('com os dois agentes no limite, a tarefa espera, mostra o estado e pode ser cancelada', async () => {
  const { app, page } = await openInProject(freshDataDir());
  await send(page, 'Implemente a nota LIMITE-AMBOS');
  const box = page.getByRole('region', { name: 'Aguardando capacidade' });
  await expect(box).toBeVisible({ timeout: 15_000 });
  await expect(box).toContainText('Codex CLI: limite de uso esgotado');
  await expect(box).toContainText('Claude Code: limite de uso esgotado');
  await expect(box).toContainText('não informou quando volta');
  await box.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.getByLabel('Retomar automaticamente').uncheck();
  await page.getByRole('button', { name: /Parar|Cancelar/ }).first().click();
  await expect(page.getByRole('article', { name: /Tarefa:/ }).getByRole('status')).toHaveText('Cancelada', { timeout: 15_000 });
  await app.close();
});

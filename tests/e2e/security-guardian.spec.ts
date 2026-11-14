import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// Phase 28: the security review of a task's changes. The fake Codex (real exec --json format) writes a
// credential when asked with SEGREDO; the task then waits for the user, who accepts or rejects it.

function project(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-guard-')), 'loja');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'README.md'), '# loja\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  return root;
}

async function send(page: Page, prompt: string) {
  await page.getByRole('complementary', { name: 'Menu' }).getByRole('link', { name: 'Chat', exact: true }).click();
  await page.getByRole('link', { name: 'Nova conversa' }).first().click();
  await expect(page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  await page.getByLabel('Projeto', { exact: true }).selectOption({ label: 'loja' });
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: 'Codex CLI' });
  await page.getByLabel('Mensagem', { exact: true }).fill(prompt);
  await page.getByLabel('Mensagem', { exact: true }).press('Enter');
  return page.getByRole('article', { name: `Tarefa: ${prompt}` });
}

test('a change with a credential waits for the user, who can accept it', async () => {
  const root = project();
  const { app, page } = await launchApp(freshDataDir(), { env: FAKE_AGENTS });
  await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload();
  const card = await send(page, 'Implemente a configuração SEGREDO');
  const review = card.getByRole('alert', { name: 'Revisão de segurança' });
  await expect(review).toContainText('risco alto');
  await expect(review.getByTestId('guardian-secret')).toContainText('config.ts:1 (valor omitido)');
  await expect(card).not.toContainText('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  await expect(card.getByRole('status')).toHaveText('Aguardando aprovação');
  await review.getByRole('button', { name: 'Aceitar alterações' }).click();
  await expect(card.getByRole('status')).toHaveText('Concluída');
  await expect(card.getByRole('region', { name: 'Revisão de segurança' })).toContainText('credencial');
  await app.close();
});

test('rejecting stops the task and keeps the files; an ordinary change completes reviewed', async () => {
  const root = project();
  const { app, page } = await launchApp(freshDataDir(), { env: FAKE_AGENTS });
  await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload();
  const risky = await send(page, 'Implemente o token SEGREDO');
  await risky.getByRole('alert', { name: 'Revisão de segurança' }).getByRole('button', { name: 'Rejeitar' }).click();
  await expect(risky.getByRole('status')).toHaveText('Cancelada');
  await expect(risky).toContainText('rejeitadas na revisão de segurança');
  expect(existsSync(join(root, 'config.ts'))).toBe(true);

  const plain = await send(page, 'Implemente a nota');
  await expect(plain.getByRole('status')).toHaveText('Concluída');
  await expect(plain).toContainText('Revisão de segurança: nada encontrado');
  await app.close();
});

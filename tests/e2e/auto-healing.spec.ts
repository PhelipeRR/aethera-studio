import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// Phase 26: a bounded automatic fix of a failed task. The fake agents speak the real formats; the
// validation is a real `npm test` that passes only when nota.txt contains "corrigido" (spelled in two parts in
// the script: npm prints the script on failure, and that output goes into the next attempt's prompt).

// Each validation is a real npm run (a few seconds); the rollback case runs up to three.
test.setTimeout(150_000);

function project(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-heal-')), 'loja');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'nota.txt'), 'inicial\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'loja', private: true, scripts: { test: "node -e \"process.exit(require('fs').readFileSync('nota.txt','utf8').includes('corr'+'igido')?0:1)\"" } }));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  return root;
}

async function failingTask(page: Page, prompt: string) {
  await page.getByRole('complementary', { name: 'Menu' }).getByRole('link', { name: 'Chat', exact: true }).click();
  await page.getByRole('link', { name: 'Nova conversa' }).first().click();
  await expect(page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  await page.getByLabel('Projeto', { exact: true }).selectOption({ label: 'loja' });
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: 'Codex CLI' });
  await page.getByLabel('Mensagem', { exact: true }).fill(prompt);
  await page.getByLabel('Mensagem', { exact: true }).press('Enter');
  const card = page.getByRole('article', { name: `Tarefa: ${prompt}` });
  await expect(card.getByRole('status')).toHaveText('Falhou');
  return card;
}

test('a failed task is diagnosed from its evidence, fixed after approval, and proven by the real test command', async () => {
  const root = project();
  const { app, page } = await launchApp(freshDataDir(), { env: FAKE_AGENTS });
  await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload();
  const failed = await failingTask(page, 'Implemente a nota FALHAR CORRIGIVEL');
  await failed.getByRole('button', { name: 'Diagnosticar e corrigir' }).click();

  const heal = page.getByRole('article', { name: /Tarefa: Correção automática/ });
  const review = heal.getByRole('alert', { name: 'Correção automática' });
  await expect(review).toContainText('Comando que falhou: npm test (exit 1)');
  await expect(review).toContainText('npm test');
  expect(readFileSync(join(root, 'nota.txt'), 'utf8')).toBe('inicial\n');
  await review.getByRole('button', { name: 'Aplicar correção' }).click();
  await expect(heal.getByRole('status')).toHaveText('Concluída', { timeout: 60_000 });
  await expect(heal.getByTestId('heal-attempt')).toContainText('Tentativa 1: passou');
  expect(readFileSync(join(root, 'nota.txt'), 'utf8')).toContain('corrigido');
  await app.close();
});

test('a fix that never passes is undone, and nothing changes when it is not approved', async () => {
  const root = project();
  const { app, page } = await launchApp(freshDataDir(), { env: FAKE_AGENTS });
  await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload();
  const failed = await failingTask(page, 'Implemente a nota FALHAR');
  await failed.getByRole('button', { name: 'Diagnosticar e corrigir' }).click();
  const heal = page.getByRole('article', { name: /Tarefa: Correção automática/ });
  await heal.getByRole('button', { name: 'Aplicar correção' }).click();
  await expect(heal.getByRole('status')).toHaveText('Falhou', { timeout: 90_000 });
  await expect(heal).toContainText('os arquivos alterados foram restaurados');
  await expect(heal).toContainText('Arquivos restaurados ao estado de antes da correção: nota.txt');
  expect(readFileSync(join(root, 'nota.txt'), 'utf8')).toBe('inicial\n');

  // A new attempt starts from the fix that failed (each card offers it once).
  await heal.getByRole('button', { name: 'Diagnosticar e corrigir' }).click();
  const again = page.getByRole('article', { name: /Tarefa: Correção automática/ }).last();
  await again.getByRole('button', { name: 'Não aplicar' }).click();
  await expect(page.getByText('Correção não aprovada: nada foi alterado.')).toBeVisible();
  expect(readFileSync(join(root, 'nota.txt'), 'utf8')).toBe('inicial\n');
  await app.close();
});

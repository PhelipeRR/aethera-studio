import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// Spec section 1 end to end through the UI, with the real logged-in Claude Code and Codex (uses quota).
// The user's own client logins are used as they are; tasks inject the MCP server per run and never write
// the clients' config files.
test.describe(() => {
  test.skip(process.env['NB_REAL_CLI'] !== '1', 'needs Claude Code and Codex installed and logged in (NB_REAL_CLI=1)');
  test.setTimeout(1_200_000);

  test('a collaborative task typed in the chat is planned, implemented, reviewed and shown with its files', async () => {
    const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-real-')), 'calculadora');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'README.md'), '# Calculadora\n');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'inicial');

    const { app, page } = await launchApp(undefined, { isolateClients: false });
    await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
    await page.reload();
    await page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: 'Chat', exact: true }).click();
    await page.getByLabel('Projeto', { exact: true }).selectOption({ label: 'calculadora' });
    await page.getByRole('combobox', { name: 'Agente', exact: true }).selectOption({ label: 'Colaborativo' });
    const prompt = 'Crie soma.js exportando uma função soma(a, b) em CommonJS, sem dependências.';
    await page.getByLabel('Mensagem', { exact: true }).fill(prompt);
    await page.getByRole('button', { name: 'Enviar' }).click();

    const task = page.getByRole('article', { name: `Tarefa: ${prompt}` });
    await expect(task.getByRole('region', { name: 'Plano' })).toBeVisible({ timeout: 300_000 });
    await expect(task.getByRole('status')).toHaveText(/Concluída|Falhou/, { timeout: 1_100_000 });
    await expect(task.getByRole('status')).toHaveText('Concluída');
    await expect(task.getByRole('region', { name: 'Arquivos alterados' })).toContainText('soma.js');
    expect(existsSync(join(root, 'soma.js'))).toBe(true);
    await app.close();
  });
});

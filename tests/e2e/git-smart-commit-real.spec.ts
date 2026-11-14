import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// Codex by default; NB_REAL_AGENT=claude runs the same check with Claude Code (e.g. when Codex quota is exhausted).
const realAgent: 'claude' | 'codex' = process.env['NB_REAL_AGENT'] === 'claude' ? 'claude' : 'codex';

test.describe('Smart Commit with a real provider', () => {
  test.skip(process.env['NB_REAL_CLI'] !== '1', 'requires an authenticated real Codex CLI and explicit NB_REAL_CLI=1');
  test.setTimeout(300_000);

  test('propõe a partir do staged real, sem criar commit nem tocar no working tree', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-real-smart-commit-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Smart Commit E2E', '-c', 'user.email=smart-commit@example.dev', ...args], { cwd: root, encoding: 'utf8' }).trim();
    writeFileSync(join(root, 'greeting.ts'), 'export function greeting(): string {\n  return "hello";\n}\n');
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'chore: seed greeting');
    const head = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'greeting.ts'), 'export function greeting(): string {\n  return "hello world";\n}\n');
    git('add', 'greeting.ts');
    writeFileSync(join(root, 'nao-staged.ts'), 'export const fora = true;\n');

    const { app, page } = await launchApp(undefined, { isolateClients: false });
    try {
      const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
      await page.reload();
      await page.evaluate(() => { location.hash = '#/git-intelligence'; });
      await page.getByLabel('Selecionar projeto').selectOption(project.id);
      await page.getByRole('tab', { name: 'Commit e PR' }).click();
      const panel = page.getByRole('region', { name: 'Smart Commit e PR Assistant' });
      await panel.getByLabel('Agente do Smart Commit').selectOption(realAgent);
      await panel.getByRole('button', { name: 'Gerar proposta a partir do staged' }).click();
      let taskId = '';
      await expect.poll(async () => {
        const tasks = await page.evaluate((projectId) => window.neuralbridge.tasks.list({ projectId, limit: 20 }), project.id);
        taskId = tasks.find((task) => task.prompt.startsWith('Smart Commit e PR Assistant:'))?.id ?? '';
        return taskId;
      }, { timeout: 30_000 }).not.toBe('');
      await expect.poll(async () => {
        const state = await page.evaluate((id) => window.neuralbridge.tasks.get(id), taskId);
        if (state.status === 'failed') throw new Error(`falhou: ${(state.error ?? '').slice(0, 300)}`);
        return state.status;
      }, { timeout: 240_000, intervals: [2_000] }).toBe('completed');
      const report = await page.evaluate((id) => window.neuralbridge.tasks.smartCommit(id), taskId);
      console.log(`smart commit real: ${JSON.stringify({ agent: realAgent, files: report?.files })}`);
      expect(report?.files).toEqual(['greeting.ts']);
      await expect(panel.getByLabel('Subject Conventional Commit')).not.toHaveValue('');
      expect(git('rev-parse', 'HEAD')).toBe(head);
      expect(git('diff', '--cached', '--name-only')).toBe('greeting.ts');
    } finally {
      await app.close();
    }
  });
});

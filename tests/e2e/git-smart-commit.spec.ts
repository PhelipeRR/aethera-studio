import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';

test.describe('Smart Commit & PR Assistant', () => {
  test.setTimeout(120_000);

  test('gera proposta editável e só cria commit após confirmação explícita', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-smart-commit-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Smart Commit E2E', '-c', 'user.email=smart-commit@example.dev', ...args], { cwd: root, encoding: 'utf8' }).trim();
    writeFileSync(join(root, 'greeting.ts'), 'export function greeting(): string {\n  return "hello";\n}\n');
    git('init', '-q', '-b', 'main');
    git('add', '.');
    git('commit', '-q', '-m', 'chore: seed greeting');
    const headBefore = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'greeting.ts'), 'export function greeting(): string {\n  return "hello world";\n}\n');
    git('add', 'greeting.ts');
    expect(git('diff', '--cached', '--name-only')).toBe('greeting.ts');

    const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
    try {
      const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
      await page.reload();
      await page.evaluate(() => { location.hash = '#/git-intelligence'; });
      await expect(page.getByRole('heading', { name: 'Git Intelligence' })).toBeVisible();
      const skipTour = page.getByRole('button', { name: 'Pular por agora' });
      if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
      await page.getByLabel('Selecionar projeto').selectOption(project.id);
      await page.getByRole('tab', { name: 'Commit e PR' }).click();

      const panel = page.getByRole('region', { name: 'Smart Commit e PR Assistant' });
      await expect(panel).toBeVisible();
      await panel.getByLabel('Agente do Smart Commit').selectOption('codex');
      await panel.getByRole('button', { name: 'Gerar proposta a partir do staged' }).click();

      let taskId: string | null = null;
      await expect.poll(async () => {
        const tasks = await page.evaluate(async (projectId) => window.neuralbridge.tasks.list({ projectId, limit: 20 }), project.id);
        taskId = tasks.find((task) => task.prompt.startsWith('Smart Commit e PR Assistant:'))?.id ?? null;
        return Boolean(taskId);
      }, { timeout: 30_000 }).toBe(true);
      if (!taskId) throw new Error('smart commit task was not created');

      const smartCommitTaskId = taskId;
      await expect.poll(async () => {
        const state = await page.evaluate(async (id) => window.neuralbridge.tasks.get(id), smartCommitTaskId);
        if (state.status === 'failed') throw new Error(`smart commit task failed: ${state.error ?? 'erro não informado'}`);
        return state.status;
      }, { timeout: 90_000 }).toBe('completed');

      await expect(panel.getByLabel('Subject Conventional Commit')).toHaveValue('feat: atualizar saudação');
      await expect(panel.getByLabel('Título da PR')).toHaveValue('Atualiza saudação do módulo');
      const report = await page.evaluate(async (id) => window.neuralbridge.tasks.smartCommit(id), smartCommitTaskId);
      expect(report?.files).toEqual(['greeting.ts']);
      await page.screenshot({ path: 'prints/git-smart-commit-1280.png', fullPage: true });
      await page.setViewportSize({ width: 800, height: 700 });
      await panel.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'prints/git-smart-commit-800.png', fullPage: true });
      expect(git('rev-parse', 'HEAD')).toBe(headBefore);
      expect(git('diff', '--cached', '--name-only')).toBe('greeting.ts');

      const body = await panel.getByLabel('Corpo do commit').inputValue();
      await panel.getByLabel('Corpo do commit').fill('x'.repeat(501));
      await expect(panel.getByRole('button', { name: 'Criar commit explicitamente' })).toBeDisabled();
      await panel.getByLabel('Corpo do commit').fill(body);
      await panel.getByLabel('Título da PR').fill('Atualiza saudação (revisada)');
      let dialogMessage = '';
      page.once('dialog', async (dialog) => { dialogMessage = dialog.message(); await dialog.accept(); });
      await panel.getByRole('button', { name: 'Criar commit explicitamente' }).click();
      await expect.poll(() => dialogMessage).toContain('não fará push nem abrirá PR');
      await expect.poll(() => git('rev-parse', 'HEAD')).not.toBe(headBefore);
      expect(git('log', '-1', '--format=%s')).toBe('feat: atualizar saudação');
      expect(git('status', '--porcelain')).toBe('');
      expect(git('remote')).toBe('');
      expect(readFileSync(join(root, 'greeting.ts'), 'utf8')).toContain('hello world');
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

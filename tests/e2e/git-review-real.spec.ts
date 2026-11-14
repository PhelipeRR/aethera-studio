import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// Codex by default; NB_REAL_AGENT=claude runs the same check with Claude Code (e.g. when Codex quota is exhausted).
const realAgent: 'claude' | 'codex' = process.env['NB_REAL_AGENT'] === 'claude' ? 'claude' : 'codex';

test.describe('AI Code Review with a real provider', () => {
  test.skip(process.env['NB_REAL_CLI'] !== '1', 'requires an authenticated real Claude/Codex CLI and explicit NB_REAL_CLI=1');
  test.setTimeout(180_000);

  test('reviews a real diff, previews and applies an approved patch without committing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-real-git-review-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Review E2E', '-c', 'user.email=review-e2e@example.dev', ...args], { cwd: root, encoding: 'utf8' }).trim();
    writeFileSync(join(root, 'auth.ts'), 'export function isAdmin(role: string): boolean {\n  return role === "admin";\n}\n');
    git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'safe authorization check');
    const head = git('rev-parse', 'HEAD');
    writeFileSync(join(root, 'auth.ts'), 'export function isAdmin(role: string): boolean {\n  return true;\n}\n');

    const { app, page } = await launchApp(undefined, { isolateClients: false });
    try {
      const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
      await page.reload();
      await page.evaluate(() => { location.hash = '#/git-intelligence'; });
      await expect(page.getByRole('heading', { name: 'Git Intelligence' })).toBeVisible();
      const skipTour = page.getByRole('button', { name: 'Pular por agora' });
      if (await skipTour.isVisible().catch(() => false)) await skipTour.click();
      await page.getByLabel('Selecionar projeto').selectOption(project.id);
      // The Git workspace is tabbed; AI Code Review lives in its own tab.
      await page.getByRole('tab', { name: 'Revisão IA' }).click();
      await page.getByLabel('Agente da revisão Git').selectOption(realAgent);
      await page.getByRole('button', { name: 'Revisar working tree' }).click();

      let taskId: string | null = null;
      await expect.poll(async () => {
        taskId = await page.evaluate(async (projectId) => {
          const tasks = await window.neuralbridge.tasks.list({ projectId, limit: 20 });
          return tasks.find((task) => task.prompt.startsWith('Revisão Git:'))?.id ?? null;
        }, project.id);
        return Boolean(taskId);
      }, { timeout: 30_000 }).toBe(true);
      if (!taskId) throw new Error('real review task was not created');

      const reviewTaskId = taskId;
      if (!reviewTaskId) throw new Error('real review task id disappeared');
      type RealReport = { summary: string; findings: Array<{ id: string; file: string | null; patch: string | null }> };
      let finalStatus = '';
      await expect.poll(async () => {
        const state = await page.evaluate(async (id) => window.neuralbridge.tasks.get(id), reviewTaskId);
        finalStatus = state.status;
        if (state.status === 'failed') {
          const textEvent = [...state.events].reverse().find((event) => event.kind === 'text');
          const text = typeof textEvent?.data['text'] === 'string' ? textEvent.data['text'].slice(0, 1_000) : '';
          throw new Error(`real provider task failed: ${state.error ?? 'erro não informado'}${text ? `; final text: ${text}` : ''}`);
        }
        return state.status;
      }, { timeout: 150_000 }).toBe('completed');
      expect(finalStatus).toBe('completed');
      const report = await page.evaluate(async (id) => window.neuralbridge.tasks.gitReview(id), reviewTaskId) as RealReport | null;
      if (!report) throw new Error('real review report was not persisted');
      expect(report.findings.length).toBeGreaterThan(0);
      const finding = report.findings.find((item) => item.patch);
      expect(finding?.file).toBe('auth.ts');
      expect(finding?.patch).toBeTruthy();
      expect(finding?.patch).toContain('diff --git a/auth.ts b/auth.ts');
      expect(finding?.patch).toContain('role === "admin"');
      const preview = page.getByText('Pré-visualizar correção sugerida');
      await expect(preview).toBeVisible();
      await preview.click();
      await preview.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'prints/git-review-real-1280.png', fullPage: true });
      await page.setViewportSize({ width: 800, height: 700 });
      await preview.scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'prints/git-review-real-800.png', fullPage: true });

      let confirmationSeen = false;
      page.once('dialog', async (dialog) => { confirmationSeen = true; expect(dialog.message()).toContain('Nenhum commit será criado'); await dialog.accept(); });
      await page.getByRole('button', { name: 'Aplicar sugestão' }).first().click();
      await expect.poll(() => confirmationSeen).toBe(true);
      await expect.poll(async () => {
        const content = readFileSync(join(root, 'auth.ts'), 'utf8');
        if (content.includes('role === "admin"')) return 'applied';
        const alerts = await page.getByRole('alert').allTextContents();
        return alerts.join(' | ') || 'pending';
      }, { timeout: 10_000 }).toBe('applied');
      expect(git('rev-parse', 'HEAD')).toBe(head);
      expect(git('diff', '--cached')).toBe('');
      expect(git('status', '--porcelain')).toContain('M auth.ts');
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

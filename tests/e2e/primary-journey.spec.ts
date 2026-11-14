import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app.js';

const packagedExe = resolve(import.meta.dirname, '../../dist/win-unpacked/NeuralBridge.exe');

function fixtureProject(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `nb-primary-${label}-`));
  writeFileSync(join(root, 'README.md'), '# primary journey\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=NeuralBridge E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-q', '-m', 'fixture'], { cwd: root });
  return root;
}

async function launchPackaged(label: string, existingDataDir?: string) {
  const dataDir = existingDataDir ?? mkdtempSync(join(tmpdir(), `nb-primary-data-${label}-`));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const app = await electron.launch({
    executablePath: packagedExe,
    env: { ...env, ...FAKE_AGENTS, NB_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: join(dataDir, 'claude'), CODEX_HOME: join(dataDir, 'codex'), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' },
  });
  const page = await mainWindowOf(app);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Pular por agora' }).click({ timeout: 2_000 }).catch(() => undefined);
  return { app, page, dataDir };
}

async function addFixture(page: Page, root: string): Promise<string> {
  return page.evaluate((path) => window.neuralbridge.projects.add(path).then((project) => project.id), root);
}

async function waitForTerminal(page: Page, id: string): Promise<unknown> {
  await expect.poll(async () => page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id), { timeout: 45_000 }).toMatchObject({ status: expect.stringMatching(/^(completed|failed|cancelled)$/) });
  return page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id);
}

test.describe('primary journey — packaged Electron', () => {
  test.skip(!existsSync(packagedExe), 'requires dist/win-unpacked/NeuralBridge.exe');
  test.describe.configure({ mode: 'serial' });

  test('request, approval, execution, validation, evidence and learning survive the journey', async () => {
    const root = fixtureProject('happy');
    const { app, page, dataDir } = await launchPackaged('happy');
    try {
      const projectId = await addFixture(page, root);
      const approval = await page.evaluate((input) => window.neuralbridge.tasks.start(input), { projectId, mode: 'codex', access: 'edit', prompt: 'Explique por que apagar a pasta dist resolve o problema' } as const);
      await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.tasks.get(id), approval.id)).status, { timeout: 20_000 }).toBe('awaiting_approval');
      await page.evaluate((id) => window.neuralbridge.tasks.approve(id), approval.id);
      await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.tasks.get(id), approval.id)).status, { timeout: 45_000 }).toBe('completed');

      const run = await page.evaluate((input) => window.neuralbridge.tasks.start(input), { projectId, mode: 'codex', access: 'edit', prompt: 'Implemente a função de soma na nota de release' } as const);
      const detail = await waitForTerminal(page, run.id);
      expect((detail as { status: string }).status).toBe('completed');
      expect(readFileSync(join(root, 'nota.txt'), 'utf8')).toContain('feito:');
      expect(JSON.stringify(detail)).toMatch(/evidence|validation|npm test/i);
      const learning = await page.evaluate(() => window.neuralbridge.brain.learning());
      expect(Array.isArray(learning)).toBe(true);
      expect(JSON.stringify(learning)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');

      const extensions = await page.evaluate(() => window.neuralbridge.extensions.list());
      expect(Array.isArray(extensions)).toBe(true);
      const status = await page.evaluate(() => window.neuralbridge.app.status());
      expect(status).toBeTruthy();
    } finally {
      await app.close();
      const diagnosticsPath = join(dataDir, 'diagnostics.json');
      execFileSync(process.execPath, ['scripts/export-diagnostics.mjs', '--data-dir', dataDir, '--output', diagnosticsPath], { cwd: resolve(import.meta.dirname, '../..') });
      expect(readFileSync(diagnosticsPath, 'utf8')).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    }
  });

  for (const attempt of [1, 2, 3]) {
    test(`cancel remains recoverable (run ${attempt})`, async () => {
      const root = fixtureProject(`cancel-${attempt}`);
      const { app, page } = await launchPackaged(`cancel-${attempt}`);
      try {
        const projectId = await addFixture(page, root);
        const task = await page.evaluate((input) => window.neuralbridge.tasks.start(input), { projectId, mode: 'codex', access: 'edit', prompt: 'Explique LENTO o cache' } as const);
        await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.tasks.get(id), task.id)).status, { timeout: 15_000 }).toMatch(/running|planning/);
        await page.evaluate((id) => window.neuralbridge.tasks.cancel(id), task.id);
        expect((await waitForTerminal(page, task.id) as { status: string }).status).toBe('cancelled');
      } finally { await app.close(); }
    });
  }

  for (const attempt of [1, 2, 3]) {
    test(`provider timeout is classified for recovery (run ${attempt})`, async () => {
      const root = fixtureProject(`timeout-${attempt}`);
      const { app, page } = await launchPackaged(`timeout-${attempt}`);
      try {
        const projectId = await addFixture(page, root);
        const task = await page.evaluate((input) => window.neuralbridge.tasks.start(input), { projectId, mode: 'codex', access: 'edit', prompt: 'TIMEOUT do provider' } as const);
        const detail = await waitForTerminal(page, task.id) as { status: string; executionSnapshot?: { failureCategory: string } | null };
        expect(detail.status).toBe('failed');
        expect(detail.executionSnapshot?.failureCategory).toBe('timeout');
        expect(existsSync(join(root, 'nota.txt'))).toBe(false);
      } finally { await app.close(); }
    });
  }

  for (const attempt of [1, 2, 3]) {
    test(`provider failure is persisted without duplicate effects (run ${attempt})`, async () => {
      const root = fixtureProject(`failure-${attempt}`);
      const { app, page } = await launchPackaged(`failure-${attempt}`);
      try {
        const projectId = await addFixture(page, root);
        const task = await page.evaluate((input) => window.neuralbridge.tasks.start(input), { projectId, mode: 'codex', access: 'edit', prompt: 'FALHAR a validação' } as const);
        const detail = await waitForTerminal(page, task.id);
        expect((detail as { status: string }).status).toBe('failed');
        expect(existsSync(join(root, 'nota.txt'))).toBe(false);
        const again = await page.evaluate((id) => window.neuralbridge.tasks.get(id), task.id);
        expect(again.status).toBe('failed');
      } finally { await app.close(); }
    });
  }

  for (const attempt of [1, 2, 3]) {
    test(`restart resumes from the persisted snapshot (run ${attempt})`, async () => {
      const root = fixtureProject(`restart-${attempt}`);
      const first = await launchPackaged(`restart-${attempt}`);
      let taskId: string;
      try {
        const projectId = await addFixture(first.page, root);
        const task = await first.page.evaluate((input) => window.neuralbridge.tasks.start(input), { projectId, mode: 'codex', access: 'edit', prompt: 'Implemente a nota de recuperação após reiniciar' } as const);
        taskId = task.id;
        await expect.poll(async () => (await first.page.evaluate((id) => window.neuralbridge.tasks.get(id), task.id)).status, { timeout: 15_000 }).toMatch(/running|planning/);
      } finally { await first.app.close(); }

      const second = await launchPackaged(`restart-${attempt}`, first.dataDir);
      try {
        const persisted = await second.page.evaluate((id) => window.neuralbridge.tasks.get(id), taskId);
        expect(persisted).toBeTruthy();
        expect(JSON.stringify(persisted)).toMatch(/snapshot|recovery|nota de recuperação/i);
        const resumed = await second.page.evaluate((id) => window.neuralbridge.tasks.resume(id, 'Explique por que apagar a pasta dist resolve o problema e implemente a nota de recuperação'), taskId);
        await expect.poll(async () => (await second.page.evaluate((id) => window.neuralbridge.tasks.get(id), resumed.id)).status, { timeout: 20_000 }).toBe('awaiting_approval');
        await second.page.evaluate((id) => window.neuralbridge.tasks.approve(id), resumed.id);
        const detail = await waitForTerminal(second.page, resumed.id);
        expect((detail as { status: string }).status).toBe('completed');
        expect(readFileSync(join(root, 'nota.txt'), 'utf8')).toContain('feito:');
        expect(JSON.stringify(detail)).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
      } finally { await second.app.close(); }
    });
  }
});

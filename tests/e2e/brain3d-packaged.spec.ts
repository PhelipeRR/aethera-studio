import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { litShare } from './brain3d-helpers';
import { mainWindowOf } from './app';

// The 3D brain inside the packaged Windows app (dist/win-unpacked, produced by `npm run dist:win`), with an
// isolated data folder: the installed copy and its memories are never touched. Skipped when no package exists.

const exe = resolve(import.meta.dirname, '../../dist/win-unpacked/NeuralBridge.exe');

test.describe(() => {
  test.skip(!existsSync(exe), 'needs the packaged app (npm run dist:win)');

  test('the packaged app renders the 3D brain under its production CSP', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-packaged-'));
    for (const dir of ['claude-config', 'codex-home']) mkdirSync(join(dataDir, dir));
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env['ELECTRON_RUN_AS_NODE'];
    const app = await electron.launch({
      executablePath: exe,
      env: { ...env, NB_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: join(dataDir, 'claude-config'), CODEX_HOME: join(dataDir, 'codex-home') },
      colorScheme: null,
    });
    const page = await mainWindowOf(app);
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || /Content Security Policy|Refused to/i.test(message.text())) problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => window.neuralbridge.brain.store({ title: 'Memória empacotada', content: 'Ver [[Outra]].', type: 'decision', projectId: null }));
    await page.evaluate(() => (location.hash = '#/memory/brain'));
    const scene = page.getByTestId('brain3d');
    await expect.poll(async () => Number(await scene.getAttribute('data-frames')), { timeout: 30_000 }).toBeGreaterThan(30);
    await expect(page.getByTestId('memory-count')).toHaveText('1');
    expect(Number(await scene.getAttribute('data-impulses'))).toBeGreaterThan(0);
    expect(litShare(await scene.screenshot())).toBeGreaterThan(0.02);
    expect(problems).toEqual([]);
    await app.close();
  });
});

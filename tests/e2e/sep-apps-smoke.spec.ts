import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

const APPS = [
  {
    name: 'Singularity Orchestrator',
    dir: resolve('apps/orchestrator-desktop'),
    expectedText: 'Singularity',
  },
  {
    name: 'Aethera Studio',
    dir: resolve('apps/aethera-desktop'),
    expectedText: 'Aethera',
  },
  {
    name: 'Void',
    dir: resolve('apps/void-desktop'),
    expectedText: 'Void',
  },
] as const;

for (const target of APPS) {
  test(`E2E Electron smoke + Tailwind CSS layout: ${target.name}`, async () => {
    test.setTimeout(60_000);
    const tempHome = mkdtempSync(join(tmpdir(), 'sep-e2e-'));
    const appData = join(tempHome, 'AppData', 'Roaming');
    const localAppData = join(tempHome, 'AppData', 'Local');
    mkdirSync(appData, { recursive: true });
    mkdirSync(localAppData, { recursive: true });
    const electronPath = createRequire(join(target.dir, 'package.json'))('electron') as unknown as string;

    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
    delete env['ELECTRON_RENDERER_URL'];
    delete env['ELECTRON_RUN_AS_NODE'];

    const electronApp = await electron.launch({
      executablePath: electronPath,
      args: [target.dir],
      cwd: target.dir,
      env: {
        ...env,
        ...FAKE_AGENTS,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        USERPROFILE: tempHome,
        HOME: tempHome,
        CLAUDE_CONFIG_DIR: join(tempHome, 'claude-config'),
        CODEX_HOME: join(tempHome, 'codex-home'),
      },
    });

    try {
      const page = await mainWindowOf(electronApp);
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.waitForLoadState('domcontentloaded');
      await page.waitForSelector('aside', { timeout: 20_000 });
      await expect(page.locator('body')).toContainText(target.expectedText, { timeout: 15_000 });

      const layoutMetrics = await page.evaluate(() => {
        const aside = document.querySelector('aside');
        const header = document.querySelector('header');
        const imgs = [...document.querySelectorAll('img')].map((img) => {
          const rect = img.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
        const asideRect = aside?.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        return {
          asideWidth: asideRect?.width ?? 0,
          asideHeight: asideRect?.height ?? 0,
          headerHeight: headerRect?.height ?? 0,
          maxImgWidth: Math.max(0, ...imgs.map((i) => i.width)),
          maxImgHeight: Math.max(0, ...imgs.map((i) => i.height)),
          stylesheetCount: document.styleSheets.length,
        };
      });

      expect(layoutMetrics.stylesheetCount).toBeGreaterThan(0);
      expect(layoutMetrics.asideWidth).toBeGreaterThan(150);
      expect(layoutMetrics.asideWidth).toBeLessThan(360);
      expect(layoutMetrics.headerHeight).toBeGreaterThan(36);
      expect(layoutMetrics.headerHeight).toBeLessThan(120);
      expect(layoutMetrics.maxImgWidth).toBeLessThanOrEqual(80);
      expect(layoutMetrics.maxImgHeight).toBeLessThanOrEqual(80);
      expect(pageErrors).toEqual([]);
    } finally {
      await electronApp.close();
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
}

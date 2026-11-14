import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './app';

const TOUR_STORAGE_KEY = 'nb.guided-tours.2026-11-01.v1';
const routes = [
  { name: 'dashboard', path: '/' },
  { name: 'chat', path: '/chat' },
  { name: 'runs', path: '/runs' },
  { name: 'memory', path: '/memory/explore' },
  { name: 'skills', path: '/skills' },
  { name: 'projects', path: '/projects' },
  { name: 'git-intelligence', path: '/git-intelligence' },
  { name: 'agents', path: '/agents' },
  { name: 'mcps', path: '/mcp' },
  { name: 'analytics', path: '/analytics' },
  { name: 'workflows', path: '/workflows' },
  { name: 'mission-control', path: '/mission-control' },
  { name: 'velix', path: '/video' },
  { name: 'settings', path: '/settings' },
] as const;

const modes = [
  { name: 'dark-desktop', colorScheme: 'dark' as const, reducedMotion: 'no-preference' as const, width: 1280, height: 800 },
  { name: 'light-desktop', colorScheme: 'light' as const, reducedMotion: 'no-preference' as const, width: 1280, height: 800 },
  { name: 'dark-compact-reduced', colorScheme: 'dark' as const, reducedMotion: 'reduce' as const, width: 800, height: 700 },
  { name: 'light-compact-reduced', colorScheme: 'light' as const, reducedMotion: 'reduce' as const, width: 800, height: 700 },
] as const;

async function skipOnboarding(page: Page) {
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ onboarding: 'skipped', tours: {} })), TOUR_STORAGE_KEY);
  await page.reload();
}

async function navigateTo(page: Page, path: string) {
  await page.evaluate((next) => { window.location.hash = `#${next}`; }, path);
  await page.waitForFunction((next) => window.location.hash === `#${next}`, path);
  await expect(page.getByRole('button', { name: /Iniciar tutorial de/ }).first()).toBeVisible();
}

test.describe.configure({ timeout: 60_000 });

for (const route of routes) {
  test(`guided tour visual matrix: ${route.name}`, async ({ page: browserPage }, testInfo) => {
    await expect(browserPage).toBeTruthy();
    const { app, page } = await launchApp(undefined, { guidedTours: true });
    try {
      await skipOnboarding(page);
      await navigateTo(page, route.path);

      for (const mode of modes) {
        await page.emulateMedia({ colorScheme: mode.colorScheme, reducedMotion: mode.reducedMotion });
        await page.setViewportSize({ width: mode.width, height: mode.height });
        await page.evaluate((theme) => window.neuralbridge.theme.set(theme), mode.colorScheme);
        await page.reload();
        await expect(page.getByRole('button', { name: /Iniciar tutorial de/ }).first()).toBeVisible();
        const trigger = page.getByRole('button', { name: /Iniciar tutorial de/ }).first();
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: /.+/ }).last();
        await expect(dialog).toBeVisible();

        await expect.poll(async () => {
          const targetCount = await page.locator('[data-tour-active="true"]').count();
          const fallbackCount = await dialog.getByRole('status').count();
          return targetCount + fallbackCount;
        }, { timeout: 1_500 }).toBeGreaterThan(0);

        const geometry = await dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
        });
        // The page scrolls to the target first, so the dialog settles a few frames after it appears.
        await expect.poll(() => dialog.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight), { timeout: 2_000 }).toBe(true);
        const settled = await dialog.evaluate((element) => { const rect = element.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; });
        expect(settled.top).toBeGreaterThanOrEqual(0);
        expect(geometry.left).toBeGreaterThanOrEqual(0);
        expect(geometry.right).toBeLessThanOrEqual(geometry.width);

        const screenshotPath = testInfo.outputPath(`${route.name}-${mode.name}.png`);
        await page.screenshot({ path: screenshotPath, animations: 'disabled', caret: 'hide' });
        await testInfo.attach(`${route.name}-${mode.name}`, { path: screenshotPath, contentType: 'image/png' });

        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
      }
    } finally {
      await app.close();
    }
  });
}

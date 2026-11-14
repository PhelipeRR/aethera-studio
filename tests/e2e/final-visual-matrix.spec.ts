import { expect, test } from '@playwright/test';
import { launchApp } from './app';

const routes = [
  { name: 'workflows', path: '#/workflows' },
  { name: 'skills', path: '#/skills' },
  { name: 'memory', path: '#/memory' },
  { name: 'analytics', path: '#/analytics' },
  { name: 'git-intelligence', path: '#/git-intelligence' },
  { name: 'settings', path: '#/settings' },
] as const;

test('matriz visual final cobre rotas secundárias em temas e movimento reduzido', async () => {
  const { app, page } = await launchApp();
  for (const theme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' });
    await page.evaluate((nextTheme) => window.neuralbridge.theme.set(nextTheme), theme);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 800, height: 700 }]) {
      await page.setViewportSize(viewport);
      for (const route of routes) {
        await page.goto(`file://${process.cwd().replaceAll('\\', '/')}/apps/desktop/out/renderer/index.html${route.path}`);
        await page.waitForLoadState('domcontentloaded');
        await expect(page.locator('main').first()).toBeVisible();
        // Lazy routes (Task 3.3) show a 'Carregando' placeholder while their chunk loads; capture the real page.
        await expect(page.getByRole('heading', { name: 'Carregando', exact: true })).toHaveCount(0);
        // Entry fades run through Web Animations (motion), which `animations: 'disabled'` does not freeze.
        await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'));
        const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
        await expect(page).toHaveScreenshot(`${route.name}-${theme}-${viewport.width}x${viewport.height}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
      }
    }
  }
  await app.close();
});

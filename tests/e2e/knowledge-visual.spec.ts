import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('Knowledge modules keep a consistent, responsive shell', async () => {
  const { app, page } = await launchApp();
  const routes = [{ name: 'skills', path: '#/skills', heading: 'Skills' }, { name: 'memoria', path: '#/memory', heading: 'Memória' }, { name: 'analytics', path: '#/analytics', heading: 'Analytics' }];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    for (const route of routes) {
      await page.goto(`file://${process.cwd().replaceAll('\\', '/')}/apps/desktop/out/renderer/index.html${route.path}`);
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
      const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
      await expect(page).toHaveScreenshot(`${route.name}-${viewport.width}x${viewport.height}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
    }
  }
  await app.close();
});

import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('keeps startup and heavy-route transitions within the workspace budgets', async () => {
  const startedAt = performance.now();
  const { app, page } = await launchApp();
  const startupMs = performance.now() - startedAt;
  expect(startupMs, 'Electron startup budget').toBeLessThan(10_000);

  const routeStart = await page.evaluate(() => performance.now());
  await page.evaluate(() => { window.location.hash = '#/analytics'; });
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
  const routeMs = await page.evaluate((start) => performance.now() - start, routeStart);
  expect(routeMs, 'lazy route transition budget').toBeLessThan(3_000);
  await app.close();
});

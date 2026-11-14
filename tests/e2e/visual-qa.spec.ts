import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('QA visual reproduzível: dashboard não cria overflow horizontal nas resoluções suportadas', async () => {
  const { app, page } = await launchApp();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.width, `overflow em ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.viewport + 1);
    await expect(page).toHaveScreenshot(`dashboard-${viewport.width}x${viewport.height}.png`, {
      fullPage: true,
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    });
  }
  await app.close();
});

test('na largura mínima real de 960 px a busca do cabeçalho fica em uma linha', async () => {
  const { app, page } = await launchApp();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(960, 600));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(960);
  const search = page.getByRole('button', { name: /Abrir Command Palette/ });
  await expect(search).toBeVisible();
  const label = search.locator('span').first();
  const measure = await label.evaluate((element) => ({ height: element.getBoundingClientRect().height, line: Number.parseFloat(getComputedStyle(element).lineHeight), inside: element.getBoundingClientRect().bottom <= (element.closest('button')?.getBoundingClientRect().bottom ?? 0) }));
  expect(measure.height).toBeLessThanOrEqual(measure.line + 1);
  expect(measure.inside).toBe(true);
  await app.close();
});

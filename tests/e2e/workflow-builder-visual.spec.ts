import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';

test('Workflow Builder Visual 2.0 mantém as três áreas e não cria overflow', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('link', { name: 'Workflows', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Biblioteca de blocos' })).toBeVisible();
    await expect(page.getByRole('application', { name: 'Canvas do workflow' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Propriedades da etapa' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.scrollWidth, `overflow em ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.viewport + 1);
    await expect(page).toHaveScreenshot(`workflow-builder-${viewport.width}x${viewport.height}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  }
  await app.close();
});

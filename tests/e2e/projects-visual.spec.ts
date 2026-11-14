import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('Projects Hub visual não cria overflow e mantém busca acessível', async () => {
  const { app, page } = await launchApp();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('link', { name: 'Projetos', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible();
    // The empty state is the shared EmptyState (role=status), identified by its title.
    const empty = page.getByRole('status').filter({ hasText: 'Nenhum projeto ainda' });
    if (await empty.count() === 0) await expect(page.getByLabel('Buscar projetos')).toBeVisible();
    else await expect(empty).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.scrollWidth, `overflow em ${viewport.width}x${viewport.height}`).toBeLessThanOrEqual(dimensions.viewport + 1);
    await expect(page).toHaveScreenshot(`projects-hub-${viewport.width}x${viewport.height}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  }
  await app.close();
});

test('Projects Hub light mode apresenta um projeto real sem perder contraste', async () => {
  const { app, page } = await launchApp();
  await page.evaluate(async () => {
    await window.neuralbridge.projects.add('C:\\dev\\neuralbridge');
    await window.neuralbridge.theme.set('light');
  });
  await page.reload();
  await page.getByRole('link', { name: 'Projetos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Projetos', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Buscar projetos' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link').first()).toBeVisible();
  await expect(page).toHaveScreenshot('projects-hub-light-real-project-1280x800.png', { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  await app.close();
});

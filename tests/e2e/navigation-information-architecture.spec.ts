import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('preserves primary deep links and groups the workspace navigation', async () => {
  const { app, page } = await launchApp();
  for (const [path, heading] of [['/chat', 'Chat'], ['/runs', 'Execuções'], ['/projects', 'Projetos'], ['/memory', 'Memória'], ['/settings', 'Configurações'], ['/extensions', 'Extensões']] as const) {
    await page.evaluate((next) => { window.location.hash = `#${next}`; }, path);
    await expect(page).toHaveURL(new RegExp(`#${path.replace('/', '\\/')}`));
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toContainText('Trabalho');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toContainText('Conhecimento');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toContainText('Integrações');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toContainText('Configurações');
  await expect(page.getByRole('link', { name: 'Aethera', exact: true })).toHaveCount(0);
  await app.close();
});

for (const viewport of [{ width: 800, height: 700 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }]) {
  test(`keeps navigation usable at ${viewport.width}px`, async () => {
    const { app, page } = await launchApp();
    await page.setViewportSize(viewport);
    await page.evaluate(() => { window.location.hash = '#/extensions'; });
    await expect(page.getByRole('heading', { name: 'Extensões', level: 1 })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
    await app.close();
  });
}

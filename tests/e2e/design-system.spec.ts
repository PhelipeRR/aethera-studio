import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// Lote 50.02: the Singularity design-system review page. It must open, stay inside the window, keep every
// control reachable and named, and render in both themes. Screenshots go to artifacts/singularity for review.
const shots = join(process.cwd(), 'artifacts', 'singularity');

test('a página do design system Singularity abre nos dois temas, sem overflow e acessível por teclado', async () => {
  mkdirSync(shots, { recursive: true });
  const { app, page } = await launchApp();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { window.location.hash = '#/design-system'; });

  await expect(page.getByRole('heading', { name: 'Tipografia de marca' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Singularity' })).toBeVisible();
  // Not in the navigation: it is a review surface, not a product screen.
  await expect(page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name: /design system/i })).toHaveCount(0);

  const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(font).toContain('Inter Variable');

  for (const width of [1440, 1024, 800]) {
    await page.setViewportSize({ width, height: 900 });
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.width, `overflow em ${width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // Every button on the page has an accessible name.
  const unnamed = await page.locator('main button, main [role="button"]').evaluateAll((elements) =>
    elements.filter((element) => !(element.getAttribute('aria-label') || element.textContent?.trim())).length,
  );
  expect(unnamed).toBe(0);

  // Lote 50.03 shell: the page fills the contextual panel and the timeline, with real data only.
  const aside = page.getByRole('complementary', { name: 'Painel de memórias' });
  await expect(aside).toBeVisible();
  await expect(aside.getByText('Memórias no banco local')).toBeVisible();
  await expect(aside.getByText('Nenhuma memória registrada ainda.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tarefas de hoje' })).toBeVisible();
  await expect(page.getByText('Nenhum evento registrado hoje.')).toBeVisible();
  // Hardware meters have no collector yet (lote 50.08): they say so instead of showing a number.
  await expect(page.getByRole('main').getByText('indisponível', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('meter')).toHaveCount(0);

  // Keyboard: a top context tab takes focus, shows the gold focus ring and opens its existing route.
  const tab = page.getByRole('navigation', { name: 'Atalhos de contexto' }).getByRole('link', { name: 'Ir para Agentes' });
  await page.getByRole('link', { name: 'Ir para Orquestrador' }).focus();
  await page.keyboard.press('Tab');
  await expect(tab).toBeFocused();
  const ring = await tab.evaluate((element) => ({ focusVisible: element.matches(':focus-visible'), shadow: getComputedStyle(element).boxShadow }));
  expect(ring.focusVisible).toBe(true);
  expect(ring.shadow).not.toBe('none');

  // No live contrast check on the page reports a failure.
  await expect(page.getByText('falha', { exact: true })).toHaveCount(0);

  // The page scrolls inside the shell, so a tall window captures it whole.
  await page.setViewportSize({ width: 1440, height: 3600 });
  await page.evaluate(() => document.querySelectorAll('*').forEach((element) => { if (element.scrollTop) element.scrollTop = 0; }));
  await page.screenshot({ path: join(shots, 'design-system-dark.png'), animations: 'disabled' });

  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-color-scheme: light)').matches)).toBe(true);
  await expect(page.getByText('falha', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(shots, 'design-system-light.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 });

  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });

  // Below 1280px the contextual panel becomes a drawer: hidden and inert until the header toggle opens it.
  await page.setViewportSize({ width: 1024, height: 768 });
  const openPanel = page.getByRole('button', { name: 'Abrir Painel de memórias' });
  await expect(openPanel).toBeVisible();
  await expect(aside).toHaveAttribute('inert', '');
  await openPanel.click();
  await expect(aside).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: 'Fechar Painel de memórias' })).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: join(shots, 'shell-drawer-1024.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(aside).toHaveAttribute('inert', '');

  // Top tabs open existing routes and mark the current one; pages without slots keep the plain layout.
  await page.setViewportSize({ width: 1440, height: 900 });
  await tab.click();
  await expect(page.getByRole('heading', { name: 'Agentes', exact: true })).toBeVisible();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('complementary', { name: 'Painel de memórias' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Tarefas de hoje' })).toHaveCount(0);

  // The sidebar status is real: the database opened, so it says ok; nothing is a hardware estimate.
  await expect(page.getByRole('link', { name: 'Banco: ok' })).toBeVisible();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.screenshot({ path: join(shots, 'shell-dashboard-dark.png'), animations: 'disabled' });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-color-scheme: light)').matches)).toBe(true);
  await page.screenshot({ path: join(shots, 'shell-dashboard-light.png'), animations: 'disabled' });

  await app.close();
});

import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';
import { registerVelixExtension } from './velix-extension';

test('Velix Studio mantém o fluxo audiovisual legível em janelas menores', async () => {
  const dataDir = freshDataDir();
  registerVelixExtension(dataDir);
  const { app, page } = await launchApp(dataDir);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole('link', { name: 'Aethera', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Aethera', exact: true })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewport + 1);
    await expect(page).toHaveScreenshot(`velix-${viewport.width}x${viewport.height}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  }
  await app.close();
});

test('Aethera: "Novo vídeo" e "Usar template" levam ao conteúdo certo e as abas seguem acessíveis pelo teclado', async () => {
  const dataDir = freshDataDir();
  registerVelixExtension(dataDir);
  const { app, page } = await launchApp(dataDir);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  const start = page.getByRole('region', { name: 'Comece uma produção' });
  await expect(page.getByRole('region', { name: 'Agente de produção' }).getByLabel('Agente das novas produções')).toBeVisible();
  // The tab list has the reference's eight areas; "Novo vídeo" is the card's action, not a tab.
  const tabs = page.getByRole('tablist', { name: 'Áreas do Aethera' }).getByRole('tab');
  await expect(tabs).toHaveText(['Descobrir', 'Ideias', 'Produzir', 'Estúdio', 'Motion', 'Canal', 'Render direto', 'Importar vídeo']);
  await start.getByRole('button', { name: 'Usar template' }).click();
  await expect(page.getByRole('tab', { name: 'Motion' })).toHaveAttribute('aria-selected', 'true');
  // Motion is where the template is chosen; the panel opens and takes the focus (without a project it says to pick one).
  await expect(page.getByRole('tabpanel', { name: 'Motion' })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'Motion' })).toBeFocused();
  await start.getByRole('button', { name: 'Novo vídeo' }).click();
  await expect(page.getByRole('region', { name: 'Criar novo vídeo' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Criar novo vídeo' })).toBeFocused();
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(0);
  // With no tab selected, the first tab still takes the keyboard focus; arrows move between areas.
  await expect(page.getByRole('tab', { name: 'Descobrir' })).toHaveAttribute('tabindex', '0');
  await page.getByRole('tab', { name: 'Descobrir' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Ideias' })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Ideias' })).toHaveAttribute('aria-selected', 'true');
  await app.close();
});

test('Aethera: R6 apresenta os cards Novo vídeo e Ficha do vídeo com resumo editável', async () => {
  const dataDir = freshDataDir();
  registerVelixExtension(dataDir);
  const { app, page } = await launchApp(dataDir);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();

  const form = page.getByRole('region', { name: 'Criar novo vídeo' });
  const sheet = page.getByRole('complementary', { name: 'Ficha do vídeo' });
  await expect(form).toBeVisible();
  await expect(page.locator('section[aria-label="Novo vídeo com o Aethera"] h2')).toHaveText('Novo vídeo');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Ficha do vídeo');
  await expect(sheet.getByRole('button', { name: 'Editar nome do vídeo' })).toBeVisible();

  const name = form.getByRole('textbox', { name: 'Nome do vídeo', exact: true });
  await name.fill('Abertura do produto');
  await expect(sheet).toContainText('Abertura do produto');
  await sheet.getByRole('button', { name: 'Editar nome do vídeo' }).click();
  await expect(name).toBeFocused();
  await app.close();
});

test('Aethera: R7 mantém quatro larguras sem overflow e recolhe a ficha em janelas estreitas', async () => {
  const dataDir = freshDataDir();
  registerVelixExtension(dataDir);
  const { app, page } = await launchApp(dataDir);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 800, height: 700 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(viewport.width);
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.scrollWidth, `overflow em ${viewport.width}px`).toBeLessThanOrEqual(dimensions.viewport + 1);
  }

  await page.setViewportSize({ width: 800, height: 700 });
  const disclosure = page.getByRole('button', { name: 'Mostrar ficha do vídeo' });
  await expect(disclosure).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Ficha do vídeo' })).toBeHidden();
  await disclosure.click();
  await expect(page.getByRole('complementary', { name: 'Ficha do vídeo' })).toBeVisible();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const motion = await page.getByRole('button', { name: 'Novo vídeo' }).evaluate((element) => getComputedStyle(element).transitionDuration);
  const motionSeconds = motion.endsWith('ms') ? Number.parseFloat(motion) / 1_000 : Number.parseFloat(motion);
  expect(motionSeconds).toBeLessThanOrEqual(0.0001);
  await app.close();
});

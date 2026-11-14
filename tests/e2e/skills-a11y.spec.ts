import { expect, test } from '@playwright/test';
import { launchApp } from './app';

for (const theme of ['dark', 'light'] as const) {
  test(`Skills e Skill Studio em tema ${theme}: teclado, nomes acessíveis, movimento reduzido e largura mínima`, async () => {
    const { app, page } = await launchApp();
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(960, 700));
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThanOrEqual(1000);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.evaluate((next) => window.neuralbridge.theme.set(next), theme);
      await page.getByRole('link', { name: 'Skills', exact: true }).click();
      await expect(page.getByRole('heading', { level: 2, name: 'Skill Studio' })).toBeVisible();

      const create = page.getByRole('button', { name: 'Novo rascunho' });
      await create.focus();
      await expect(create).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Nome')).toBeVisible();

      const unnamed = await page.evaluate(() => [...document.querySelectorAll('main button, main input, main select, main textarea')]
        .filter((element) => {
          const control = element as HTMLInputElement;
          return control.type !== 'hidden' && !control.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.textContent?.trim();
        }).map((element) => element.outerHTML.slice(0, 120)));
      expect(unnamed).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } finally {
      await app.close();
    }
  });
}

import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('Skills page loads the isolated discovery result without executing content', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Skills' })).toBeVisible();
    // The list of skills found on this machine, or the empty state: never the load error.
    const outcome = page.getByRole('list', { name: 'Skills instaladas' }).or(page.getByText('Nenhuma skill instalada encontrada.'));
    await expect(outcome).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Não foi possível carregar as skills.')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

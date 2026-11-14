import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('semantic search stays off until the user agrees to download the model', async () => {
  const { app, page, dataDir } = await launchApp();
  await page.getByRole('link', { name: 'Configurações', exact: true }).click();
  const section = page.getByRole('region', { name: 'Busca semântica' });
  await expect(section).toContainText('Desativada.');

  await section.getByRole('button', { name: 'Ativar busca semântica' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Xenova/multilingual-e5-small');
  await expect(dialog).toContainText('cerca de 130 MB');
  await expect(dialog).toContainText('huggingface.co');
  await expect(dialog).toContainText(join(dataDir, 'models'));

  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toBeHidden();
  await expect(section).toContainText('Desativada.');
  expect(existsSync(join(dataDir, 'models'))).toBe(false);

  const bridge = await page.evaluate(() => window.neuralbridge.semantic.status());
  expect(bridge).toMatchObject({ enabled: false, downloaded: false });
  await app.close();
});

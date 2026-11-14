import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('transactional skill preparation blocks an unallowlisted host without writing a destination', async () => {
  const { app, page, dataDir } = await launchApp();
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click();
    await page.getByLabel('Repositório HTTPS da skill').fill('https://not-allowlisted.invalid/example-skill.git');
    await page.getByRole('button', { name: 'Preparar instalação' }).click();
    await expect(page.getByRole('status')).toContainText('skill_source_not_allowlisted');
    expect(existsSync(join(dataDir, 'managed-skills'))).toBe(false);
  } finally {
    await app.close();
  }
});

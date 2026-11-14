import { expect, test } from '@playwright/test';
import { readFile, readdir, rm } from 'node:fs/promises';
import { freshDataDir, launchApp } from './app';
import { startGitHttpsFixture } from '../helpers/git-https-fixture.js';

test('rejects a remote skill whose host is not allowlisted', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click();
    await page.getByLabel('Repositório HTTPS da skill').fill('https://unauthorized.example/skill.git');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Preparar instalação' }).click();
    await expect(page.getByRole('status').filter({ hasText: /não autorizada|allowlist|origem/i })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('cancelling confirmation does not start a remote operation', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click();
    await page.getByLabel('Repositório HTTPS da skill').fill('https://unauthorized.example/skill.git');
    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.getByRole('button', { name: 'Preparar instalação' }).click();
    await expect(page.getByLabel('Repositório HTTPS da skill')).toHaveValue('https://unauthorized.example/skill.git');
    await expect(page.getByRole('status').filter({ hasText: 'instalada/atualizada' })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('installs, updates and rolls back a remote skill over controlled HTTPS', async () => {
  const fixture = await startGitHttpsFixture();
  const dataDir = freshDataDir();
  const skillFile = `${dataDir}/managed-skills/repo/SKILL.md`;
  const { app, page } = await launchApp(dataDir, {
    env: {
      GIT_SSL_CAINFO: fixture.caFile,
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'http.sslBackend',
      GIT_CONFIG_VALUE_0: 'openssl',
      GIT_CONFIG_KEY_1: 'http.sslCAInfo',
      GIT_CONFIG_VALUE_1: fixture.caFile,
    },
  });
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click();
    await page.getByLabel('Host HTTPS autorizado').fill('localhost');
    await page.getByRole('button', { name: 'Autorizar host' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Fonte autorizada salva' })).toBeVisible();

    await page.getByLabel('Repositório HTTPS da skill').fill(fixture.url);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Preparar instalação' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Skill instalada' }).first()).toBeVisible();
    await expect.poll(async () => readFile(skillFile, 'utf8')).toContain('description: Controlled');

    await fixture.publishVersion('---\nname: Remote\ndescription: Controlled v2\n---\nUpdated', 'v2');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Preparar instalação' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'instalada/atualizada' })).toBeVisible();
    await expect.poll(async () => readFile(skillFile, 'utf8')).toContain('Controlled v2');

    fixture.failNextUpdate();
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Preparar instalação' }).click();
    await expect(page.getByRole('status').filter({ hasText: /falha|erro/i })).toBeVisible();
    await expect(readFile(skillFile, 'utf8')).resolves.toContain('Controlled v2');
    await expect.poll(async () => (await readdir(`${dataDir}/managed-skills`)).filter((name) => !name.includes('neuralbridge-backup'))).toEqual(['repo']);
  } finally {
    await app.close();
    await fixture.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

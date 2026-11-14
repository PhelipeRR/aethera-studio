import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test('Skill Studio saves a draft without publishing it', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Skill Studio' })).toBeVisible();
    await page.getByRole('button', { name: 'Novo rascunho' }).click();
    await page.getByLabel('Nome').fill('Studio E2E');
    await page.getByLabel('Descrição').fill('Rascunho de teste do Skill Studio.');
    await page.getByLabel('Instruções (SKILL.md)').fill('# Conteúdo de teste\n\nEste conteúdo permanece inerte.');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rascunho salvo' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Skills instaladas' }).getByText('Studio E2E', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: /Studio E2E/ })).toBeVisible();
    await page.getByRole('button', { name: /Studio E2E/ }).click();
    await expect(page.getByLabel('Nome')).toHaveValue('Studio E2E');
    await page.getByRole('button', { name: 'Validar' }).click();
    await expect(page.getByRole('heading', { name: 'Trust Center' })).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Skill Studio publishes only after validation and exposes the version history', async () => {
  const { app, page } = await launchApp();
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click();
    await page.getByRole('button', { name: 'Novo rascunho' }).click();
    await page.getByLabel('Nome').fill('Studio Publish E2E');
    await page.getByLabel('Descrição').fill('Skill publicada pelo teste isolado.');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await page.getByRole('button', { name: 'Validar' }).click();
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Publicar globalmente' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'publicada' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Skills instaladas' }).getByText('Studio Publish E2E', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Histórico' }).click();
    await expect(page.getByText(/v1 created/)).toBeVisible();
    await page.getByRole('button', { name: 'Exportar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Exportação criada' })).toBeVisible();
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.getByLabel('Instruções (SKILL.md)').fill('# v2\n\nVersão atualizada.');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await page.getByRole('button', { name: 'Validar' }).click();
    await page.getByRole('tab', { name: 'Editor' }).click();
    await page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Publicar globalmente' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Versão 2 publicada' })).toBeVisible();
    await page.getByRole('tab', { name: 'Histórico' }).click();
    await expect(page.getByText(/v2 edited/)).toBeVisible();
    await page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Restaurar' }).last().click();
    await expect(page.getByRole('status').filter({ hasText: 'Versão restaurada' })).toBeVisible();
    await expect(page.getByText(/v3 restored/)).toBeVisible();
  } finally {
    await app.close();
  }
});

test('Skill Studio rejects an unsafe import before creating a draft', async () => {
  const source = mkdtempSync(join(tmpdir(), 'nb-studio-e2e-')); mkdirSync(join(source, '.hidden'), { recursive: true }); writeFileSync(join(source, 'SKILL.md'), '---\nname: Unsafe\ndescription: fixture\n---\n\n# Fixture\n', 'utf8'); writeFileSync(join(source, '.hidden', 'secret.txt'), 'must not be read', 'utf8');
  const { app, page } = await launchApp();
  try {
    await page.getByRole('link', { name: 'Skills', exact: true }).click();
    await page.getByRole('button', { name: 'Novo rascunho' }).click();
    await page.getByLabel('Pasta da skill para importar').fill(source);
    await page.getByRole('button', { name: 'Pré-visualizar' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'studio_hidden_file' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Unsafe/ })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { learningCandidates, memories, openDatabase } from '@neuralbridge/database';
import { launchApp, freshDataDir } from './app';

const migrationsFolder = resolve(import.meta.dirname, '../../packages/database/migrations');

function seed(dataDir: string, candidateTitles: string[] = []): void {
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder });
  for (const title of candidateTitles) {
    handle.db.insert(learningCandidates).values({ id: randomUUID(), title, content: `Conteúdo de ${title}`, type: 'learning', agent: 'codex', tags: '[]', status: 'pending' }).run();
  }
  handle.db.insert(memories).values({ id: randomUUID(), title: 'Memória inicial', content: 'Estado inicial do backup.', type: 'learning', sourceKind: 'user' }).run();
  handle.close();
}

async function openBrainTab(page: Page, name: 'Aprendizados' | 'Configurações'): Promise<void> {
  await page.getByRole('link', { name: 'Memória', exact: true }).click();
  await page.getByRole('navigation', { name: 'Seções da memória' }).getByRole('link', { name, exact: true }).click();
}

test('learning proposals can be approved and discarded with confirmation', async () => {
  const dataDir = freshDataDir();
  seed(dataDir, ['Aprendizado aprovado', 'Aprendizado descartado']);
  const { app, page } = await launchApp(dataDir);
  try {
    await openBrainTab(page, 'Aprendizados');
    await expect(page.getByRole('listitem', { name: 'Proposta: Aprendizado aprovado' })).toBeVisible();
    await page.getByRole('listitem', { name: 'Proposta: Aprendizado aprovado' }).getByRole('button', { name: 'Salvar na memória' }).click();
    await expect(page.getByRole('listitem', { name: 'Proposta: Aprendizado aprovado' })).toHaveCount(0);

    const discarded = page.getByRole('listitem', { name: 'Proposta: Aprendizado descartado' });
    await discarded.getByRole('button', { name: 'Descartar' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Descartar esta proposta?');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(discarded).toBeVisible();
    await discarded.getByRole('button', { name: 'Descartar' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Descartar' }).click();
    await expect(discarded).toHaveCount(0);
    await page.getByRole('tab', { name: 'Descartadas' }).click();
    await expect(page.getByText('Aprendizado descartado')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('settings persist and retention requires destructive confirmation', async () => {
  const { app, page } = await launchApp();
  try {
    await openBrainTab(page, 'Configurações');
    const save = page.getByRole('button', { name: 'Salvar configurações' });
    await expect(save).toBeVisible();
    await page.getByLabel('Frequência').selectOption('6');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('status')).toHaveText('Configurações salvas.');
    await page.getByRole('button', { name: 'Aplicar retenção agora' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Aplicar retenção agora?');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Seções da memória' }).getByRole('link', { name: 'Aprendizados' }).click();
    await page.getByRole('navigation', { name: 'Seções da memória' }).getByRole('link', { name: 'Configurações' }).click();
    await expect(page.getByLabel('Frequência')).toHaveValue('6');
  } finally {
    await app.close();
  }
});

test('backup and restore use the isolated real database', async () => {
  const dataDir = freshDataDir();
  seed(dataDir);
  const { app, page } = await launchApp(dataDir);
  try {
    await openBrainTab(page, 'Configurações');
    await page.getByRole('button', { name: 'Fazer backup agora' }).click();
    await expect(page.getByRole('status')).toHaveText('Backup criado.');
    await expect(page.getByRole('list', { name: 'Backups' })).toBeVisible();
    await page.evaluate(async () => {
      await window.neuralbridge.brain.store({ title: 'Memória posterior', content: 'Deve desaparecer após restaurar.', type: 'learning' });
    });
    await page.getByRole('button', { name: 'Restaurar' }).first().click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Restaurar' }).click();
    await expect(page.getByRole('status')).toContainText('restaurado');
    await app.close();
    const db = new Database(join(dataDir, 'db', 'brain.db'), { readonly: true });
    expect(db.prepare('SELECT title FROM memories WHERE deleted_at IS NULL ORDER BY title').all()).toEqual([{ title: 'Memória inicial' }]);
    db.close();
  } finally {
    if (app) await app.close().catch(() => undefined);
  }
});

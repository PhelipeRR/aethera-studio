import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './app';

async function createMemory(page: Page, title: string, content: string, tags = ''): Promise<void> {
  await page.getByRole('link', { name: 'Nova memória' }).click();
  await page.getByLabel('Título').fill(title);
  await page.getByLabel('Conteúdo (Markdown)').fill(content);
  if (tags) await page.getByLabel('Tags').fill(tags);
  await page.getByRole('button', { name: 'Criar memória' }).click();
  await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
}

test('create, edit, review history, restore, link, search and delete memories from the app', async () => {
  const { app, page, dataDir } = await launchApp();
  await page.getByRole('link', { name: 'Memória', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'O cérebro ainda está vazio' })).toBeVisible();

  // Invalid title: explained before anything is sent.
  await page.getByRole('link', { name: 'Nova memória' }).click();
  await page.getByLabel('Título').fill('Ver [[outra]]');
  await expect(page.getByRole('alert')).toContainText('não pode conter [[ ou ]]');
  await page.getByRole('button', { name: 'Criar memória' }).click();
  await expect(page.getByLabel('Título')).toBeFocused();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Descartar' }).click();

  // Create: the link target does not exist yet, so it is pending.
  await createMemory(page, 'Migrações versionadas', 'Toda mudança de schema passa por migração.\n\nVer [[Pool de conexões]].', 'banco, processo');
  const outgoing = page.getByRole('region', { name: 'Aponta para' });
  await expect(outgoing).toContainText('Pool de conexões (pendente)');
  await expect(page.getByText('v1, ')).toBeVisible();

  // Unsaved edits are not lost by accident: leaving asks first.
  await page.getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Conteúdo (Markdown)').fill('rascunho');
  await page.getByRole('link', { name: 'Visão geral' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('ainda não foi salvo');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByLabel('Conteúdo (Markdown)')).toHaveValue('rascunho');

  // Edit: a new version; the history keeps the old one, which can be viewed and restored.
  await page.getByLabel('Conteúdo (Markdown)').fill('Mudanças de schema só por migração revisada.\n\nVer [[Pool de conexões]].');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('status')).toHaveText('Alterações salvas.');
  const history = page.getByRole('region', { name: 'Histórico de versões' });
  await expect(history.getByRole('button')).toHaveCount(2);
  await history.getByRole('button', { name: /v1/ }).click();
  await expect(page.getByText('Você está vendo a versão 1')).toBeVisible();
  await expect(page.getByText('Toda mudança de schema passa por migração.')).toBeVisible();
  await page.getByRole('button', { name: 'Restaurar esta versão' }).click();
  await expect(page.getByRole('status')).toHaveText('Versão 1 restaurada como versão nova.');
  await expect(history.getByRole('button')).toHaveCount(3);
  await expect(page.getByText('Toda mudança de schema passa por migração.')).toBeVisible();

  // Creating the target resolves the pending link, in both directions.
  await createMemory(page, 'Pool de conexões', 'max 20 conexões.');
  await expect(page.getByRole('region', { name: 'Citada por' }).getByRole('link', { name: 'Migrações versionadas' })).toBeVisible();
  await page.getByRole('region', { name: 'Citada por' }).getByRole('link', { name: 'Migrações versionadas' }).click();
  await page.getByRole('article').getByRole('link', { name: 'Pool de conexões' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Pool de conexões' })).toBeVisible();

  // Explore: keyword search with the reason semantic search is off, and tag filter.
  await page.getByRole('link', { name: 'Explorar', exact: true }).first().click();
  await page.getByRole('searchbox', { name: 'Buscar memórias' }).fill('migração');
  await expect(page.getByRole('link', { name: /Migrações versionadas/ })).toBeVisible();
  await expect(page.getByText('Busca por significado desativada')).toBeVisible();
  await expect(page.locator('mark').first()).toHaveText(/migra/i);
  await page.getByRole('searchbox', { name: 'Buscar memórias' }).fill('');
  await page.getByLabel('Filtrar por tag').selectOption('banco');
  // Result rows are links whose accessible name includes the snippet, so check the result headings.
  await expect(page.getByRole('heading', { level: 3, name: 'Migrações versionadas' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 3, name: 'Pool de conexões' })).toHaveCount(0);

  // Overview counts what is in the database.
  await page.getByRole('link', { name: 'Visão geral' }).click();
  await expect(page.getByText(/^2 memórias \(2 globais\), com 1 link resolvido/)).toBeVisible();

  // Permanent delete: confirm, and the link to it becomes pending again.
  await page.getByRole('link', { name: 'Pool de conexões' }).click();
  await page.getByRole('button', { name: 'Excluir' }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Excluir definitivamente' }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar memórias' })).toBeVisible();
  await page.getByRole('link', { name: /Migrações versionadas/ }).click();
  await expect(page.getByRole('region', { name: 'Aponta para' })).toContainText('Pool de conexões (pendente)');
  await app.close();

  const db = new Database(join(dataDir, 'db', 'brain.db'), { readonly: true });
  expect(db.prepare('SELECT title, version, deleted_at FROM memories ORDER BY seq').all()).toEqual([{ title: 'Migrações versionadas', version: 3, deleted_at: null }]);
  expect(db.prepare('SELECT count(*) AS n FROM memory_versions').get()).toEqual({ n: 3 });
  db.close();
});

test('memory content from agents is shown as text, never as active HTML or remote images', async () => {
  const { app, page } = await launchApp();
  const memory = await page.evaluate(() =>
    window.neuralbridge.brain.store({
      title: 'Conteúdo hostil',
      content: '<img src=x onerror="document.title=\'pwned\'"> <script>document.title="pwned"</script>\n\n![rastreador](https://example.com/pixel.png)\n\n[clique](https://evil.example)',
      type: 'learning',
    }),
  );
  await page.evaluate((id) => (window.location.hash = `#/memory/${id}`), memory.memory.id);
  await expect(page.getByRole('heading', { level: 2, name: 'Conteúdo hostil' })).toBeVisible();
  await expect(page.getByText('[imagem: rastreador]')).toBeVisible();
  expect(await page.title()).toBe('Singularity');
  expect(await page.locator('article img, article script, article a[href^="http"]').count()).toBe(0);
  await app.close();
});

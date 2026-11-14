import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshDataDir, launchApp } from './app';
import { callMcpTool } from './brain3d-helpers';

// Phase 20: memory confidence. An agent records where a memory comes from through the real MCP server; the
// user reviews it in the Inspector; the evidence check marks it stale when its file changes.

function project(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-conf-')), 'loja');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 20;\n');
  const old = new Date('2026-01-01T00:00:00Z');
  utimesSync(join(root, 'src', 'pool.ts'), old, old);
  return root;
}

const panel = (page: Page) => page.getByRole('region', { name: 'Confiança' });

test('an agent cites a file, the user validates the memory, and a change to that file makes it stale', async () => {
  const dataDir = freshDataDir();
  const root = project();
  const { app, page } = await launchApp(dataDir);
  const { id: projectId } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);

  // Written by an agent through the real MCP server, pointing at the file it learned it from.
  const stored = await callMcpTool(dataDir, 'codex', 'brain_store', { title: 'Pool de conexões', content: 'O pool do checkout tem 20 conexões.', type: 'decision', source_ref: 'src/pool.ts:1' }, projectId);
  expect(stored.isError).toBeFalsy();
  const memory = (await page.evaluate(() => window.neuralbridge.brain.list({ limit: 5 }))).items[0];
  await page.evaluate((id) => (location.hash = `#/memory/${id}`), memory?.id);

  await expect(panel(page)).toContainText('Confiança: Não verificada');
  await expect(panel(page).getByRole('list', { name: 'Evidências' })).toContainText('Arquivo');
  await expect(panel(page).getByRole('list', { name: 'Evidências' })).toContainText('src/pool.ts:1');

  // The file is unchanged: the check confirms it, but does not validate the memory on its own.
  await panel(page).getByRole('button', { name: 'Conferir evidências' }).click();
  await expect(panel(page).getByRole('status')).toContainText('As evidências conferem');
  await expect(panel(page).getByRole('list', { name: 'Evidências' })).toContainText('confere');
  await expect(panel(page)).toContainText('Confiança: Não verificada');

  await panel(page).getByRole('button', { name: 'Marcar como validada' }).click();
  await expect(panel(page)).toContainText('Confiança: Validada');

  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 40;\n');
  await panel(page).getByRole('button', { name: 'Conferir evidências' }).click();
  await expect(panel(page).getByRole('status')).toContainText('marcada como desatualizada');
  await expect(panel(page)).toContainText('Confiança: Desatualizada');
  await expect(panel(page).getByRole('list', { name: 'Evidências' })).toContainText('mudou depois da memória');

  // The agent now gets it flagged: marked stale in its search results.
  const search = await callMcpTool(dataDir, 'claude-code', 'brain_search', { query: 'pool checkout' }, projectId);
  expect(search.text).toContain('"confidence":"stale"');

  // And the list says so too.
  await page.getByRole('link', { name: 'Explorar' }).first().click();
  await expect(page.getByText(/Desatualizada/).first()).toBeVisible();
  await app.close();
});

test('the user can mark a memory stale by hand and validate it again', async () => {
  const { app, page } = await launchApp(freshDataDir());
  const { memory } = await page.evaluate(() => window.neuralbridge.brain.store({ title: 'Deploy às sextas', content: 'Não fazemos deploy às sextas.', type: 'decision', projectId: null }));
  await page.evaluate((id) => (location.hash = `#/memory/${id}`), memory.id);
  await expect(panel(page)).toContainText('Sem evidências registradas');
  await expect(panel(page).getByRole('button', { name: 'Conferir evidências' })).toHaveCount(0);

  await panel(page).getByRole('button', { name: 'Marcar como desatualizada' }).click();
  await expect(panel(page)).toContainText('Confiança: Desatualizada');
  await expect(panel(page)).toContainText('aparece depois das outras nas buscas');
  await panel(page).getByRole('button', { name: 'Marcar como validada' }).click();
  await expect(panel(page)).toContainText('Confiança: Validada');
  expect((await page.evaluate((id) => window.neuralbridge.brain.get(id), memory.id))?.confidence).toBe('reviewed');
  await app.close();
});

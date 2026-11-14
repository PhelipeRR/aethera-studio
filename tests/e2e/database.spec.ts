import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';

test('creates the database on first start and keeps its data across restarts', async () => {
  const first = await launchApp();
  const file = join(first.dataDir, 'db', 'brain.db');
  await first.page.getByRole('link', { name: 'Configurações', exact: true }).click();
  await expect(first.page.getByText(file, { exact: true })).toBeVisible();
  await expect(first.page.getByRole('alert')).toHaveCount(0);
  await first.app.close();
  expect(existsSync(file)).toBe(true);

  // Simulate data written by an earlier session (or by the MCP server) while the app was closed.
  const sqlite = new Database(file);
  sqlite.prepare("INSERT INTO projects (id, name, root_path) VALUES ('p1', 'api', 'C:\\src\\api')").run();
  const migrations = sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get();
  sqlite.close();

  const second = await launchApp(first.dataDir);
  await expect(second.page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(second.page.getByRole('alert')).toHaveCount(0);
  await second.app.close();

  const reopened = new Database(file, { readonly: true });
  expect(reopened.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'api' }]);
  expect(reopened.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get()).toEqual(migrations);
  reopened.close();
});

test('a corrupted database leaves the app usable and explains what is wrong', async () => {
  const dataDir = freshDataDir();
  mkdirSync(join(dataDir, 'db'));
  writeFileSync(join(dataDir, 'db', 'brain.db'), 'not a database, only bytes long enough to fill the sqlite header');

  const { app, page } = await launchApp(dataDir);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('O arquivo do banco de dados está corrompido.');
  await expect(alert).toContainText(join(dataDir, 'db', 'brain.db'));

  await page.getByRole('link', { name: 'Memória', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Memória' })).toBeVisible();
  await app.close();
});

test('restores a verified backup from degraded mode without deleting the unusable file', async () => {
  const dataDir = freshDataDir();
  // A healthy backup taken by an earlier session.
  const healthy = await launchApp(dataDir);
  await healthy.app.close();
  const backupsDir = join(dataDir, 'backups', 'brain');
  mkdirSync(backupsDir, { recursive: true });
  const backupName = 'neuralbridge-2026-11-01T10-00-00-000Z-manual.db';
  const source = new Database(join(dataDir, 'db', 'brain.db'));
  source.prepare("INSERT INTO projects (id, name, root_path) VALUES ('p1', 'api', 'C:/src/api')").run();
  source.prepare('VACUUM INTO ?').run(join(backupsDir, backupName));
  source.close();
  writeFileSync(join(dataDir, 'db', 'brain.db'), 'not a database, only bytes long enough to fill the sqlite header');

  const { app, page } = await launchApp(dataDir, { env: { NB_E2E_NO_RELAUNCH: '1' } });
  const alert = page.getByRole('alert').filter({ hasText: 'banco de dados' });
  await expect(alert).toContainText('O arquivo do banco de dados está corrompido.');
  await alert.getByRole('button', { name: 'Restaurar backup' }).click();
  const list = page.getByRole('region', { name: 'Backups disponíveis' });
  await list.getByRole('button', { name: 'Restaurar este' }).click();
  await list.getByRole('button', { name: 'Confirmar restauração' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Backup restaurado' })).toBeVisible();
  await app.close();

  const preserved = join(dataDir, 'db', 'preserved');
  const [folder] = readdirSync(preserved);
  expect(readFileSync(join(preserved, folder ?? '', 'brain.db'), 'utf8')).toContain('not a database');
  const restored = new Database(join(dataDir, 'db', 'brain.db'), { readonly: true });
  expect(restored.prepare('SELECT name FROM projects').all()).toEqual([{ name: 'api' }]);
  restored.close();

  const reopened = await launchApp(dataDir);
  await expect(reopened.page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await expect(reopened.page.getByRole('alert')).toHaveCount(0);
  await reopened.app.close();
});

test('exports redacted diagnostics from degraded mode', async () => {
  const dataDir = freshDataDir();
  mkdirSync(join(dataDir, 'db'));
  writeFileSync(join(dataDir, 'db', 'brain.db'), 'not a database, only bytes long enough to fill the sqlite header');
  const { app, page } = await launchApp(dataDir);
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => undefined; });
  await page.getByRole('alert').filter({ hasText: 'banco de dados' }).getByRole('button', { name: 'Exportar diagnósticos' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Diagnóstico salvo em' })).toBeVisible();
  await app.close();
  const [file] = readdirSync(join(dataDir, 'diagnostics'));
  const report = JSON.parse(readFileSync(join(dataDir, 'diagnostics', file ?? ''), 'utf8')) as { details: { database: { reason: string }; checks: Array<{ id: string }> } };
  expect(report.details.database.reason).toBe('corrupt');
  expect(report.details.checks.map((check) => check.id)).toEqual(expect.arrayContaining(['database', 'migrations', 'agent:claude', 'agent:codex']));
});

test('reports invalid preferences, keeps a copy and still opens', async () => {
  const dataDir = freshDataDir();
  writeFileSync(join(dataDir, 'preferences.json'), '{ "theme": "neon", broken');
  const { app, page } = await launchApp(dataDir);
  await expect(page.getByRole('alert')).toContainText('As preferências salvas estavam inválidas.');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await app.close();
  expect(readdirSync(dataDir).some((name) => name.startsWith('preferences.json.invalid-'))).toBe(true);
});

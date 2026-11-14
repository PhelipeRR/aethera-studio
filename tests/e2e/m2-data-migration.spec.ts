import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electronPath = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
const Database = createRequire(import.meta.url)('better-sqlite3') as new (file: string) => { pragma(value: string): unknown; exec(sql: string): void; prepare(sql: string): { run(...values: unknown[]): void; get(...values: unknown[]): unknown }; close(): void };

test('M2 adia a cópia com banco aberto, migra no início seguinte e mantém rollback', async () => {
  const appData = mkdtempSync(join(tmpdir(), 'nb-m2-e2e-'));
  const legacy = join(appData, 'NeuralBridge');
  const target = join(appData, 'Singularity');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'Local State'), 'safe-storage-marker');
  writeFileSync(join(legacy, 'preferences.json'), JSON.stringify({ theme: 'dark' }));
  writeFileSync(join(legacy, 'migration-marker.txt'), 'legacy-user-data');
  const walProbe = join(legacy, 'wal-probe.db');
  const sourceDb = new Database(walProbe);
  sourceDb.pragma('journal_mode = WAL');
  sourceDb.pragma('wal_autocheckpoint = 0');
  sourceDb.exec('CREATE TABLE probe (value TEXT NOT NULL)');
  sourceDb.prepare('INSERT INTO probe (value) VALUES (?)').run('open-wal');
  expect(existsSync(`${walProbe}-wal`)).toBe(true);
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env['NB_DATA_DIR'];
  delete env['ELECTRON_RENDERER_URL'];
  delete env['ELECTRON_RUN_AS_NODE'];
  const launch = () => electron.launch({
    executablePath: electronPath,
    args: [desktopDir],
    cwd: desktopDir,
    env: { ...env, ...FAKE_AGENTS, APPDATA: appData, LOCALAPPDATA: appData, CLAUDE_CONFIG_DIR: join(appData, 'claude-config'), CODEX_HOME: join(appData, 'codex-home'), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GIT_EDITOR: 'cmd.exe /c exit 0' },
    colorScheme: null,
  });
  const userDataOf = async (app: Awaited<ReturnType<typeof launch>>) => {
    const page = await mainWindowOf(app);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Pular por agora' }).click({ timeout: 2_000 }).catch(() => undefined);
    return app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  };

  // 1. Another process (here this test) still has a database open in the legacy tree: the copy is deferred, so that
  //    process and the app keep writing to the same directory.
  const first = await launch();
  try {
    expect(await userDataOf(first)).toBe(legacy);
    expect(existsSync(target)).toBe(false);
  } finally {
    await first.close();
  }

  // 2. Once it is closed (SQLite checkpoints and removes the WAL), the next start copies, verifies and switches.
  sourceDb.close();
  expect(existsSync(`${walProbe}-wal`)).toBe(false);
  const second = await launch();
  try {
    expect(await userDataOf(second)).toBe(target);
    expect(readFileSync(join(target, 'migration-marker.txt'), 'utf8')).toBe('legacy-user-data');
    // Chromium's Local State (it holds the safeStorage key) arrives byte for byte; the first launch had rewritten it.
    expect(readFileSync(join(target, 'Local State'), 'utf8')).toBe(readFileSync(join(legacy, 'Local State'), 'utf8'));
    const migratedDb = new Database(join(target, 'wal-probe.db'));
    expect(migratedDb.prepare('SELECT value FROM probe').get()).toEqual({ value: 'open-wal' });
    migratedDb.close();
    expect(JSON.parse(readFileSync(join(target, 'migrated-from.json'), 'utf8'))).toMatchObject({ from: legacy });
    // Rollback stays possible: the legacy tree is untouched by the copy.
    expect(readFileSync(join(legacy, 'migration-marker.txt'), 'utf8')).toBe('legacy-user-data');
  } finally {
    await second.close();
  }
});

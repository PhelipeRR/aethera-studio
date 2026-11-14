import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { mainWindowOf } from './app';

const exe = resolve(import.meta.dirname, '../../dist/win-unpacked/NeuralBridge.exe');

test('M2 migrates the legacy tree before the packaged app uses userData', async () => {
  test.skip(!existsSync(exe), 'needs the packaged app (electron-builder --win dir)');
  const appData = mkdtempSync(join(tmpdir(), 'nb-m2-packaged-'));
  const legacy = join(appData, 'NeuralBridge');
  const target = join(appData, 'Singularity');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'Local State'), 'safe-storage-marker');
  writeFileSync(join(legacy, 'migration-marker.txt'), 'packaged-user-data');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env['NB_DATA_DIR'];
  delete env['ELECTRON_RUN_AS_NODE'];
  const app = await electron.launch({ executablePath: exe, env: { ...env, ...{ APPDATA: appData, LOCALAPPDATA: appData, CLAUDE_CONFIG_DIR: join(target, 'claude-config'), CODEX_HOME: join(target, 'codex-home'), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GIT_EDITOR: 'cmd.exe /c exit 0' } }, colorScheme: null });
  try {
    const page = await mainWindowOf(app);
    await page.waitForLoadState('domcontentloaded');
    expect(await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(target);
    expect(readFileSync(join(target, 'migration-marker.txt'), 'utf8')).toBe('packaged-user-data');
    expect(readFileSync(join(legacy, 'Local State'), 'utf8')).toBe('safe-storage-marker');
    expect(JSON.parse(readFileSync(join(target, 'migrated-from.json'), 'utf8'))).toMatchObject({ from: legacy, files: 2 });
  } finally {
    await app.close();
  }
});

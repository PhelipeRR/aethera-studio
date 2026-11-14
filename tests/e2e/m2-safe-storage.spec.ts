import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electronPath = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
const probe = resolve(import.meta.dirname, 'safe-storage-probe.cjs');

function environment(appData: string, dataDir?: string): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  if (dataDir) env['NB_DATA_DIR'] = dataDir; else delete env['NB_DATA_DIR'];
  delete env['ELECTRON_RENDERER_URL'];
  delete env['ELECTRON_RUN_AS_NODE'];
  return { ...env, ...FAKE_AGENTS, APPDATA: appData, LOCALAPPDATA: appData, CLAUDE_CONFIG_DIR: join(appData, 'claude-config'), CODEX_HOME: join(appData, 'codex-home'), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', GIT_EDITOR: 'cmd.exe /c exit 0' };
}

function runProbe(appData: string, dataDir: string, mode: '--write' | '--read'): Promise<void> {
  return new Promise((resolveProbe, rejectProbe) => execFile(electronPath, [probe, '--data-dir', dataDir, mode], { cwd: desktopDir, env: environment(appData, dataDir) }, (error) => error ? rejectProbe(error) : resolveProbe()));
}

test('M2 preserves an Electron safeStorage secret across the data-directory copy', async () => {
  const appData = mkdtempSync(join(tmpdir(), 'nb-m2-safe-storage-'));
  const legacy = join(appData, 'NeuralBridge');
  const target = join(appData, 'Singularity');
  await runProbe(appData, legacy, '--write');
  expect(existsSync(join(legacy, 'safe-probe.bin'))).toBe(true);

  const second = await electron.launch({ executablePath: electronPath, args: [desktopDir], cwd: desktopDir, env: environment(appData), colorScheme: null });
  try {
    await mainWindowOf(second);
    expect(await second.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))).toBe(target);
    expect(existsSync(join(target, 'safe-probe.bin'))).toBe(true);
    expect(readFileSync(join(legacy, 'safe-probe.bin')).byteLength).toBeGreaterThan(0);
  } finally {
    await second.close();
  }
  await runProbe(appData, target, '--read');
  expect(readFileSync(join(target, 'safe-probe-result.txt'), 'utf8')).toBe('m2-safe-storage-probe');
});

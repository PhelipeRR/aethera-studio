import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { healthSchema } from '@neuralbridge/shared/core-api';
import { mainWindowOf } from './app';

// CORE-03 inside the packaged Windows app (dist/win-unpacked, from `npm run dist:win`): core.js runs from app.asar with
// NeuralBridge.exe as Node, answers /health on loopback, ignores test hooks, and stops with the app.

const exe = resolve(import.meta.dirname, '../../dist/win-unpacked/NeuralBridge.exe');

test.describe(() => {
  test.skip(!existsSync(exe), 'needs the packaged app (npm run dist:win)');

  test('the packaged app supervises the Core from app.asar and stops it on quit', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-packaged-'));
    for (const dir of ['claude-config', 'codex-home']) mkdirSync(join(dataDir, dir));
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env['ELECTRON_RUN_AS_NODE'];
    // A packaged build must ignore the crash hook: the Core starts normally.
    const app = await electron.launch({ executablePath: exe, env: { ...env, NB_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: join(dataDir, 'claude-config'), CODEX_HOME: join(dataDir, 'codex-home'), NB_CORE_ALLOW_TEST_HOOKS: '1', NB_CORE_TEST_CRASH: 'startup' }, colorScheme: null });
    await mainWindowOf(app);
    let lock: { pid: number; port: number | null } | null = null;
    await expect.poll(() => { try { lock = JSON.parse(readFileSync(join(dataDir, 'core.lock'), 'utf8')) as { pid: number; port: number | null }; } catch { lock = null; } return lock?.port ? 'ready' : 'waiting'; }, { timeout: 30_000 }).toBe('ready');
    const ready = lock as unknown as { pid: number; port: number };
    const response = await fetch(`http://127.0.0.1:${ready.port}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(healthSchema.parse(await response.json())).toMatchObject({ status: 'ok', mode: 'embedded', coreVersion: await app.evaluate(({ app: electronApp }) => electronApp.getVersion()) });
    await app.close();
    await expect.poll(() => { try { process.kill(ready.pid, 0); return true; } catch { return false; } }, { timeout: 10_000 }).toBe(false);
    await expect.poll(() => existsSync(join(dataDir, 'core.lock')), { timeout: 10_000 }).toBe(false);
  });

  test('the packaged launcher flag starts a standalone Core without opening the app (CORE-08)', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-packaged-'));
    const env: Record<string, string | undefined> = { ...process.env, NB_DATA_DIR: dataDir };
    delete env['ELECTRON_RUN_AS_NODE'];
    const result = spawnSync(exe, ['--singularity-core'], { env, stdio: 'ignore', timeout: 30_000 });
    expect(result.status).toBe(0);
    let lock: { pid: number; port: number | null; mode: string } | null = null;
    await expect.poll(() => { try { lock = JSON.parse(readFileSync(join(dataDir, 'core.lock'), 'utf8')) as { pid: number; port: number | null; mode: string }; } catch { lock = null; } return lock?.port ? lock.mode : 'waiting'; }, { timeout: 30_000 }).toBe('standalone');
    const ready = lock as unknown as { pid: number; port: number };
    try {
      expect((await fetch(`http://127.0.0.1:${ready.port}/api/v1/health`)).status).toBe(200);
    } finally { process.kill(ready.pid); }
  });
});

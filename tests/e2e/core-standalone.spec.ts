import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// CORE-08: the Singularity Core independent of the window. The launcher flag starts a standalone Core (plain Node,
// detached); the desktop attaches to it and runs chat tasks there; quitting the desktop leaves it running; switching the
// mode off stops it and the desktop goes back to an embedded Core. The last test registers a REAL temporary logon task
// (authorized by the user for this lot) and always deletes it.

const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electronPath = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
const schtasks = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'schtasks.exe');
const Database = createRequire(resolve(import.meta.dirname, '../../packages/database/package.json'))('better-sqlite3') as new (file: string, options?: { readonly?: boolean }) => { prepare(sql: string): { get(...args: unknown[]): unknown }; close(): void };

interface Lock { pid: number; port: number | null; mode: string }
const readLock = (dataDir: string): Lock | null => { try { return JSON.parse(readFileSync(join(dataDir, 'core.lock'), 'utf8')) as Lock; } catch { return null; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const healthy = async (port: number) => (await fetch(`http://127.0.0.1:${port}/api/v1/health`).catch(() => null))?.status === 200;
const kill = (pid: number | undefined) => { if (pid && alive(pid)) process.kill(pid); };
const launcher = (dataDir: string) => {
  // The standalone Core inherits the launcher's environment (in real use: the Windows user's, where the CLIs are signed in).
  const env: Record<string, string | undefined> = { ...process.env, ...FAKE_AGENTS, NB_DATA_DIR: dataDir };
  delete env['ELECTRON_RUN_AS_NODE'];
  // No pipes, like the Task Scheduler: the detached Core would otherwise keep spawnSync waiting on inherited handles.
  return spawnSync(electronPath, [desktopDir, '--singularity-core'], { env, timeout: 30_000, stdio: 'ignore' });
};
async function readyLock(dataDir: string, mode: string, notPid?: number): Promise<Lock & { port: number }> {
  let lock: Lock | null = null;
  await expect.poll(() => { lock = readLock(dataDir); return lock?.port && lock.mode === mode && lock.pid !== notPid ? 'ready' : 'waiting'; }, { timeout: 30_000 }).toBe('ready');
  return lock as unknown as Lock & { port: number };
}

test('the launcher starts a standalone Core that outlives the desktop, which attaches and runs tasks on it', async () => {
  test.setTimeout(120_000);
  const dataDir = freshDataDir();
  let standalonePid: number | undefined;
  try {
    const started = Date.now();
    expect(launcher(dataDir).status).toBe(0);
    expect(Date.now() - started).toBeLessThan(25_000);
    const lock = await readyLock(dataDir, 'standalone');
    standalonePid = lock.pid;
    expect(await healthy(lock.port)).toBe(true);
    expect(existsSync(join(dataDir, 'core-desktop.token'))).toBe(true);
    // A second launch does not start another Core.
    expect(launcher(dataDir).status).toBe(0);
    expect(readLock(dataDir)?.pid).toBe(lock.pid);

    const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
    await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.core.runtime())).mode, { timeout: 30_000 }).toBe('standalone');
    const runtime = await page.evaluate(() => window.neuralbridge.core.runtime());
    expect(runtime.pid).toBe(lock.pid);
    expect(runtime.memoryBytes).toBeGreaterThan(0);
    const { id } = await page.evaluate(() => window.neuralbridge.tasks.start({ prompt: 'Explique o projeto', projectId: null, mode: 'codex', access: 'read-only' }));
    await expect.poll(async () => (await page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id)).status, { timeout: 30_000 }).toBe('completed');
    const db = new Database(join(dataDir, 'db', 'brain.db'), { readonly: true });
    const events = db.prepare("SELECT COUNT(*) AS n FROM task_events WHERE task_id = ?").get(id) as { n: number };
    db.close();
    expect(events.n).toBeGreaterThan(0);
    await app.close();

    // The desktop is gone; the standalone Core is not.
    await new Promise((wait) => setTimeout(wait, 1_000));
    expect(alive(lock.pid)).toBe(true);
    expect(await healthy(lock.port)).toBe(true);
  } finally {
    kill(standalonePid);
  }
});

test('switching the mode on hands over to a standalone Core, and off brings the embedded one back (real logon task)', async () => {
  test.setTimeout(150_000);
  const taskName = `Singularity Core (teste e2e ${process.pid})`;
  const dataDir = freshDataDir();
  let standalonePid: number | undefined;
  try {
    const { app, page } = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_CORE_TASK_NAME: taskName } });
    const embedded = await readyLock(dataDir, 'embedded');
    await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.core.runtime())).mode, { timeout: 20_000 }).toBe('embedded');

    const on = await page.evaluate(() => window.neuralbridge.core.setStandalone(true));
    expect(on).toMatchObject({ standaloneEnabled: true, taskRegistered: true });
    const xml = execFileSync(schtasks, ['/Query', '/TN', taskName, '/XML'], { encoding: 'utf8' });
    expect(xml).toContain('<LogonTrigger>');
    // Task Scheduler omits RunLevel when it is the default (least privilege); it must never be elevated.
    expect(xml).not.toContain('HighestAvailable');
    expect(xml).toContain('--singularity-core');
    const standalone = await readyLock(dataDir, 'standalone', embedded.pid);
    standalonePid = standalone.pid;
    expect(alive(embedded.pid)).toBe(false);
    await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.core.runtime())).mode, { timeout: 30_000 }).toBe('standalone');

    // The real task runs the launcher; a Core is already alive, so nothing new starts.
    execFileSync(schtasks, ['/Run', '/TN', taskName]);
    await new Promise((wait) => setTimeout(wait, 3_000));
    expect(readLock(dataDir)?.pid).toBe(standalone.pid);

    const off = await page.evaluate(() => window.neuralbridge.core.setStandalone(false));
    expect(off).toMatchObject({ standaloneEnabled: false, taskRegistered: false });
    expect(spawnSync(schtasks, ['/Query', '/TN', taskName]).status).not.toBe(0);
    await expect.poll(() => alive(standalone.pid), { timeout: 15_000 }).toBe(false);
    const back = await readyLock(dataDir, 'embedded', standalone.pid);
    expect(alive(back.pid)).toBe(true);
    await app.close();
  } finally {
    spawnSync(schtasks, ['/Delete', '/TN', taskName, '/F']);
    kill(standalonePid);
  }
});

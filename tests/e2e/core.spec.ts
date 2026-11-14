import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer, connect, type AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { healthSchema } from '@neuralbridge/shared/core-api';
import { freshDataDir, launchApp } from './app';

// CORE-03: the embedded Singularity Core with the real Electron app. Normal start, loopback only, second instance,
// busy port, quit, unexpected crash with restart, repeated startup failures and the rollback switch.

const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electronPath = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
const coreScript = join(desktopDir, 'out', 'main', 'core.js');

interface Lock { pid: number; port: number | null; instanceId: string; mode: string }
const readLock = (dataDir: string): Lock | null => { try { return JSON.parse(readFileSync(join(dataDir, 'core.lock'), 'utf8')) as Lock; } catch { return null; } };
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const logEvents = (dataDir: string, file: string) => (existsSync(join(dataDir, 'logs', file)) ? readFileSync(join(dataDir, 'logs', file), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as { event: string; [key: string]: unknown }) : []);

async function readyLock(dataDir: string, notPid?: number): Promise<Lock & { port: number }> {
  let lock: Lock | null = null;
  await expect.poll(() => { lock = readLock(dataDir); return lock?.port && lock.pid !== notPid ? 'ready' : 'waiting'; }, { timeout: 20_000 }).toBe('ready');
  return lock as unknown as Lock & { port: number };
}

async function health(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  return { status: response.status, body: await response.json() as unknown, text: JSON.stringify(response.headers) };
}

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address;
  return null;
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, timeout: 1_500 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

test('starts with the desktop on loopback only and serves the contract /health', async () => {
  const { app, page, dataDir } = await launchApp();
  const lock = await readyLock(dataDir);
  const mainPid = await app.evaluate(() => process.pid);
  expect(lock.pid).not.toBe(mainPid);
  expect(lock.mode).toBe('embedded');
  const answer = await health(lock.port);
  expect(answer.status).toBe(200);
  const body = healthSchema.parse(answer.body);
  expect(body).toMatchObject({ status: 'ok', mode: 'embedded', desktopConnected: true, apiVersions: ['v1'], coreVersion: await app.evaluate(({ app: electronApp }) => electronApp.getVersion()) });
  // Nothing sensitive: no paths, pid, user, port or secret in the body.
  for (const leak of [dataDir, String(lock.pid), process.env['USERNAME'] ?? '§', 'NeuralBridge']) expect(JSON.stringify(answer.body)).not.toContain(leak);
  const lan = lanAddress();
  if (lan) expect(await canConnect(lan, lock.port)).toBe(false);
  expect(await canConnect('127.0.0.1', lock.port)).toBe(true);
  // The desktop keeps working as before.
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(logEvents(dataDir, 'core-supervisor.log').map((entry) => entry.event)).toContain('core.ready');

  // A second Core on the same data folder refuses to run and leaves the first one alone.
  const second = spawnSync(electronPath, [coreScript], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: dataDir }, timeout: 15_000 });
  expect(second.status).toBe(3);
  expect(readLock(dataDir)).toMatchObject({ pid: lock.pid, instanceId: lock.instanceId });
  expect((await health(lock.port)).status).toBe(200);

  // Quitting the desktop stops the Core gracefully: process gone and lock released.
  await app.close();
  await expect.poll(() => alive(lock.pid), { timeout: 10_000 }).toBe(false);
  await expect.poll(() => existsSync(join(dataDir, 'core.lock')), { timeout: 10_000 }).toBe(false);
  expect(logEvents(dataDir, 'core.log').map((entry) => entry.event)).toEqual(expect.arrayContaining(['core.ready', 'core.stopping', 'core.stopped']));
});

test('restarts a Core that dies unexpectedly, without touching the desktop', async () => {
  const { app, page, dataDir } = await launchApp();
  const first = await readyLock(dataDir);
  process.kill(first.pid);
  const second = await readyLock(dataDir, first.pid);
  expect(second.instanceId).not.toBe(first.instanceId);
  expect((await health(second.port)).status).toBe(200);
  const events = logEvents(dataDir, 'core-supervisor.log');
  expect(events.some((entry) => entry.event === 'core.unexpected_exit')).toBe(true);
  await page.evaluate(() => { window.location.hash = '#/memory'; });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await app.close();
  await expect.poll(() => alive(second.pid), { timeout: 10_000 }).toBe(false);
});

test('a desktop that dies abruptly leaves no orphan Core, and the next launch takes over the stale lock', async () => {
  const dataDir = freshDataDir();
  const first = await launchApp(dataDir);
  const lock = await readyLock(dataDir);
  const mainPid = await first.app.evaluate(() => process.pid);
  process.kill(mainPid);
  // On Windows libuv puts children in a kill-on-close job, so the Core dies with the desktop; elsewhere it stops on 'disconnect'.
  await expect.poll(() => alive(lock.pid), { timeout: 15_000 }).toBe(false);
  await first.app.close().catch(() => undefined);
  const second = await launchApp(dataDir);
  const next = await readyLock(dataDir, lock.pid);
  expect(next.instanceId).not.toBe(lock.instanceId);
  expect((await health(next.port)).status).toBe(200);
  await second.app.close();
});

test('falls back to a free port when the preferred one is busy', async () => {
  const blocker = createServer();
  await new Promise<void>((done) => blocker.listen(0, '127.0.0.1', done));
  const busy = (blocker.address() as AddressInfo).port;
  const { app, dataDir } = await launchApp(freshDataDir(), { env: { NB_CORE_PORT: String(busy) } });
  const lock = await readyLock(dataDir);
  expect(lock.port).not.toBe(busy);
  expect((await health(lock.port)).status).toBe(200);
  expect(logEvents(dataDir, 'core.log').some((entry) => entry.event === 'core.port_in_use')).toBe(true);
  await app.close();
  await new Promise((done) => blocker.close(done));
});

test('repeated startup failures back off and never take the desktop down', async () => {
  const { app, page, dataDir } = await launchApp(freshDataDir(), { env: { NB_CORE_ALLOW_TEST_HOOKS: '1', NB_CORE_TEST_CRASH: 'startup' } });
  await expect.poll(() => logEvents(dataDir, 'core-supervisor.log').filter((entry) => entry.event === 'core.unexpected_exit').length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  const delays = logEvents(dataDir, 'core-supervisor.log').filter((entry) => entry.event === 'core.unexpected_exit').map((entry) => entry['restartInMs']);
  expect(delays.slice(0, 2)).toEqual([1000, 2000]);
  expect(readLock(dataDir)).toBeNull();
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await app.close();
});

test('NB_CORE_DISABLED=1 keeps the Core off and the desktop unchanged', async () => {
  const { app, page, dataDir } = await launchApp(freshDataDir(), { env: { NB_CORE_DISABLED: '1' } });
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(2_000);
  expect(readLock(dataDir)).toBeNull();
  expect(logEvents(dataDir, 'core-supervisor.log').map((entry) => entry.event)).toContain('core.supervisor_disabled');
  await app.close();
});

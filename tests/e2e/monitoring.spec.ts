import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// Lote 50.08 — real-time monitoring with real Windows data. No fixture: the values come from this machine.
const shots = join(process.cwd(), 'artifacts', 'singularity');

test('monitoring shows real readings, keeps history, honours the interval and stays honest about sensors', async () => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  const { app, page, dataDir } = await launchApp();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(1440, 960));

  // Sidebar meters fill with real values from the shared loop.
  const sidebarMeters = page.getByRole('link', { name: 'Abrir monitoramento' });
  await expect(sidebarMeters.getByRole('meter', { name: 'CPU' })).toBeVisible({ timeout: 30_000 });
  await expect(sidebarMeters.getByRole('meter', { name: 'Memória' })).toBeVisible();

  await page.getByRole('link', { name: 'Monitoramento', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Monitoramento', level: 1 })).toBeVisible();
  const view = page.getByTestId('monitoring');
  await expect.poll(async () => Number(await view.getAttribute('data-samples')), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);

  const snapshot = await page.evaluate(() => window.neuralbridge.monitoring.snapshot());
  const last = snapshot.samples.at(-1);
  expect(last).toBeDefined();
  if (!last) return;
  expect(last.memory.totalBytes).toBe(totalmem());
  expect(last.cpu.utilization).not.toBeNull();
  expect(last.cpu.frequencyMhz ?? 0).toBeGreaterThan(300);
  expect(last.disk.busy).not.toBeNull();
  expect(last.network.downBytesPerSec).not.toBeNull();
  expect(snapshot.static.cpuModel).toBe(cpus()[0]?.model.trim());
  // Every unavailable source carries a reason; nothing unavailable has a number.
  for (const status of Object.values(snapshot.static.sources)) if (!status.available) expect(status.reason).toBeTruthy();
  if (!snapshot.static.sources.gpuTemperature.available) expect(last.gpu.temperatureC).toBeNull();
  if (!snapshot.static.sources.cpuTemperature.available) await expect(page.getByTestId('monitor-cpu').getByText('indisponível', { exact: true })).toBeVisible();
  for (const id of ['monitor-cpu', 'monitor-memory', 'monitor-gpu', 'monitor-vram', 'monitor-disk', 'monitor-network', 'monitor-consumers', 'monitor-overhead']) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId('monitor-consumers').getByText('Claude Code')).toBeVisible();
  await page.waitForTimeout(6_000);
  await page.screenshot({ path: join(shots, 'monitoring-dark-1440.png'), fullPage: false, animations: 'disabled' });

  // Interval: persisted in preferences and applied by the collector.
  await page.getByLabel('Intervalo de atualização').selectOption('1000');
  await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.monitoring.snapshot())).intervalMs).toBe(1000);
  const preferences = JSON.parse(readFileSync(join(dataDir, 'preferences.json'), 'utf8')) as { monitoring: { intervalMs: number } };
  expect(preferences.monitoring.intervalMs).toBe(1000);
  await page.getByLabel('Intervalo de atualização').selectOption('2000');

  // Light theme keeps the gold and petrol identity readable.
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-color-scheme: light)').matches)).toBe(true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, 'monitoring-light-1440.png'), animations: 'disabled' });
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.screenshot({ path: join(shots, 'monitoring-sidebar.png'), clip: { x: 0, y: 500, width: 240, height: 460 }, animations: 'disabled' });
  await app.close();
});

test('cost of monitoring: collector CPU and memory, and the UI never waits on collection', async () => {
  test.setTimeout(150_000);
  const { app, page } = await launchApp();
  await page.getByRole('link', { name: 'Monitoramento', exact: true }).click();
  const view = page.getByTestId('monitoring');
  await expect.poll(async () => Number(await view.getAttribute('data-samples')), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);

  // IPC round trip while collection runs: the handler only reads the in-memory buffer.
  const ipc: number[] = [];
  for (let i = 0; i < 20; i++) ipc.push(await page.evaluate(async () => { const start = performance.now(); await window.neuralbridge.monitoring.snapshot(1e9); return performance.now() - start; }));
  // 30 s of real collection at the default 2 s interval.
  await page.waitForTimeout(30_000);
  const { samples } = await page.evaluate(() => window.neuralbridge.monitoring.snapshot());
  const recent = samples.slice(-15);
  const avg = (values: (number | null)[]) => { const real = values.filter((value): value is number => value !== null); return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null; };
  const main = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics().find((metric) => metric.type === 'Browser'));
  const sortedIpc = [...ipc].sort((a, b) => a - b);
  const result = {
    machine: { cpu: cpus()[0]?.model.trim(), threads: cpus().length, ramGb: Math.round(totalmem() / 1024 ** 3), os: `Windows ${release()}` },
    intervalMs: 2000,
    samples: recent.length,
    collector: { cpuPercentOfMachine: avg(recent.map((sample) => sample.overhead.cpuPercent)), memoryBytes: avg(recent.map((sample) => sample.overhead.memoryBytes)) },
    app: { cpuPercentOfMachine: avg(recent.map((sample) => sample.app.cpuPercent)), memoryBytes: avg(recent.map((sample) => sample.app.memoryBytes)) },
    mainProcess: { cpuPercentOfOneCore: main?.cpu.percentCPUUsage ?? null },
    ipcRoundTripMs: { median: sortedIpc[Math.floor(sortedIpc.length / 2)], max: sortedIpc.at(-1) },
    measuredAt: new Date().toISOString(),
  };
  mkdirSync(join(process.cwd(), 'tests', '.cache'), { recursive: true });
  writeFileSync(join(process.cwd(), 'tests', '.cache', 'monitoring-overhead.json'), JSON.stringify(result, null, 2));
  await app.close();

  expect(result.collector.cpuPercentOfMachine).not.toBeNull();
  expect(result.collector.cpuPercentOfMachine ?? 100).toBeLessThan(1);
  expect(result.collector.memoryBytes ?? Infinity).toBeLessThan(64 * 1024 * 1024);
  expect(result.ipcRoundTripMs.median ?? Infinity).toBeLessThan(20);
});

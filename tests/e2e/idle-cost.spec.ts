import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';
import { seedGalaxy } from './galaxy-helpers';

// Lote 50.11: what the Singularity look costs at rest. CPU per Electron process (% of one core, 10 s averages) on the
// Hub, on the Memory Galaxy with 5,000 stars and on a static screen, with the Void HUD animating all the time.
// Results go to tests/.cache/idle-cost.json; the limits are generous on purpose (shared CI machines vary).

test('the Hub, the galaxy and the Void HUD stay cheap at rest', async () => {
  test.setTimeout(180_000);
  const dataDir = freshDataDir();
  seedGalaxy(dataDir, { count: 5000, withEmbeddings: true });
  const { app, page } = await launchApp(dataDir);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(1280, 820));
  const go = (hash: string) => page.evaluate((target) => { window.location.hash = target; }, hash);
  const sample = async (label: string) => {
    await app.evaluate(({ app: electronApp }) => { electronApp.getAppMetrics(); });
    await page.waitForTimeout(10_000);
    const processes = await app.evaluate(({ app: electronApp, webContents }) => {
      const who: Record<number, string> = {};
      for (const contents of webContents.getAllWebContents()) who[contents.getOSProcessId()] = contents.getURL().includes('companion=hud') ? 'hud' : 'window';
      return electronApp.getAppMetrics().map((metric) => ({ process: who[metric.pid] ?? metric.type, cpu: Math.round(metric.cpu.percentCPUUsage * 10) / 10, memoryMb: Math.round(metric.memory.workingSetSize / 1024) }));
    });
    return { label, processes };
  };
  const results = [];
  await go('#/');
  results.push(await sample('Hub'));
  await go('#/memory/galaxy');
  await expect(page.getByTestId('galaxy')).toHaveAttribute('data-ready-ms', /\d+/, { timeout: 60_000 });
  results.push(await sample('Galáxia com 5.000 estrelas, girando'));
  await go('#/settings');
  results.push(await sample('Configurações (tela estática)'));
  await app.close();

  mkdirSync(join(process.cwd(), 'tests', '.cache'), { recursive: true });
  writeFileSync(join(process.cwd(), 'tests', '.cache', 'idle-cost.json'), JSON.stringify({ machine: { cpu: cpus()[0]?.model.trim(), threads: cpus().length, ramGb: Math.round(totalmem() / 1024 ** 3), os: `Windows ${release()}` }, results, measuredAt: new Date().toISOString() }, null, 2));
  for (const result of results) {
    const of = (name: string) => result.processes.filter((entry) => entry.process === name).reduce((sum, entry) => sum + entry.cpu, 0);
    expect(of('hud'), `${result.label}: HUD`).toBeLessThan(5);
    expect(of('window'), `${result.label}: janela`).toBeLessThan(10);
  }
});

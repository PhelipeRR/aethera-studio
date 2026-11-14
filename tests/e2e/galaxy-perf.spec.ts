import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';
import { seedGalaxy } from './galaxy-helpers';

// Lote 50.06 performance: 5,000 memories with 384-dimension embeddings, the planned ceiling of one snapshot.
// Measured on the GPU and with software rendering (the worst realistic case). Results, with the machine they were
// measured on, go to tests/.cache/galaxy-perf-<renderer>.json and docs/STATUS.md.
// Targets (GPU): at least 30 FPS while rotating, first interaction within 1.5 s of opening the page.

const RENDERERS = [
  { name: 'gpu', args: [] as string[] },
  { name: 'software', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
];

for (const renderer of RENDERERS)
test(`galaxy with 5,000 memories: first interaction and frame rate (${renderer.name})`, async () => {
  test.setTimeout(240_000);
  const dataDir = freshDataDir();
  const seeded = seedGalaxy(dataDir, { count: 5000, withEmbeddings: true });
  const { app, page } = await launchApp(dataDir, { chromiumArgs: renderer.args });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(1280, 820));
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'desconhecida';
  });

  // Warm the app shell once, then measure a cold open of the galaxy route.
  await page.evaluate(() => { window.location.hash = '#/memory'; });
  await expect(page.getByRole('heading', { name: 'Memória', exact: true })).toBeVisible();
  await page.evaluate(() => { window.location.hash = '#/memory/galaxy'; });
  const galaxy = page.getByTestId('galaxy');
  await expect(galaxy).toHaveAttribute('data-ready-ms', /\d+/, { timeout: 60_000 });
  await expect(galaxy).toHaveAttribute('data-stars', String(seeded.ids.length));
  const readyMs = Number(await galaxy.getAttribute('data-ready-ms'));
  const workerMs = Number(await galaxy.getAttribute('data-worker-ms'));

  // Interaction right away: keyboard selection opens real details in the panel.
  const view = page.getByRole('application');
  await view.focus();
  const selectStart = Date.now();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Detalhes da memória' })).toBeVisible();
  const selectMs = Date.now() - selectStart;
  await page.keyboard.press('Escape');
  // Back to the overview: every star in view is the heaviest frame.
  await page.keyboard.press('r');

  // Frame rate while auto-rotating (rotation stays on when nothing is selected).
  await page.waitForTimeout(1_500);
  const samples: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(500);
    samples.push(Number(await galaxy.getAttribute('data-fps')));
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

  const result = {
    renderer: renderer.name,
    gpu,
    cpu: cpus()[0]?.model ?? 'desconhecida',
    cores: cpus().length,
    ramGb: Math.round(totalmem() / 1024 ** 3),
    os: `Windows ${release()}`,
    window: '1280x820',
    memories: seeded.ids.length,
    embeddingDim: 384,
    readyMs,
    workerMs,
    selectMs,
    fps: { median, min: sorted[0] ?? 0, samples },
    measuredAt: new Date().toISOString(),
  };
  mkdirSync(join(process.cwd(), 'tests', '.cache'), { recursive: true });
  writeFileSync(join(process.cwd(), 'tests', '.cache', `galaxy-perf-${renderer.name}.json`), JSON.stringify(result, null, 2));
  await page.screenshot({ path: join(process.cwd(), 'artifacts', 'singularity', `galaxy-5000-${renderer.name}.png`), animations: 'disabled' });
  await app.close();

  if (renderer.name === 'gpu') {
    expect(median, `FPS mediano na GPU (${gpu})`).toBeGreaterThanOrEqual(30);
    expect(readyMs, 'primeira interação (ms desde a abertura da rota)').toBeLessThanOrEqual(1500);
  }
});

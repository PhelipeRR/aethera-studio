import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';
import { seedBrain } from './brain3d-helpers';

// Frame rate of the 3D brain per quality level, measured while the camera rotates and impulses run, at the
// default window size, on the GPU and with software rendering. Results go to tests/.cache/brain3d-perf-*.json
// and docs/PLAN.md records them with the renderer they were measured on. The only hard requirement is fluid
// motion at the lowest level on the GPU.

const RENDERERS = [
  { name: 'gpu', args: [] as string[] },
  // Software rendering: the worst realistic case (no usable GPU driver). Recorded, not required to be fluid.
  { name: 'software', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
];

for (const renderer of RENDERERS)
test(`measures frame rate per quality level while rotating with impulses (${renderer.name})`, async () => {
  test.setTimeout(180_000);
  const { app, page } = await launchApp(undefined, { chromiumArgs: renderer.args });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(1280, 820));
  await seedBrain(page, {
    projects: ['loja'],
    memories: Array.from({ length: 200 }, (_, i) => ({ title: `Memória ${i}`, content: `Ver [[Memória ${(i + 1) % 200}]].`, type: 'decision', project: i % 2 ? 'loja' : null })),
  });
  await page.evaluate(() => (location.hash = '#/memory/brain'));
  const scene = page.getByTestId('brain3d');
  await expect.poll(async () => Number(await scene.getAttribute('data-frames')), { timeout: 20_000 }).toBeGreaterThan(20);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'desconhecida';
  });

  const results: Record<string, { median: number; min: number; samples: number[] }> = {};
  for (const level of ['low', 'medium', 'high'] as const) {
    await page.getByLabel('Qualidade gráfica').selectOption(level);
    await expect.poll(() => scene.getAttribute('data-quality')).toBe(level);
    const rotate = page.getByRole('button', { name: 'Rotação automática' });
    if ((await rotate.getAttribute('aria-pressed')) !== 'true') await rotate.click();
    await page.waitForTimeout(1_500);
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(500);
      samples.push(Number(await scene.getAttribute('data-fps')));
    }
    const sorted = [...samples].sort((a, b) => a - b);
    results[level] = { median: sorted[Math.floor(sorted.length / 2)] ?? 0, min: sorted[0] ?? 0, samples };
    expect(Number(await scene.getAttribute('data-impulses'))).toBeGreaterThan(0);
  }

  const out = resolve(import.meta.dirname, '../.cache');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `brain3d-perf-${renderer.name}.json`), JSON.stringify({ measuredAt: new Date().toISOString(), window: '1280x820', memories: 200, gpu, results }, null, 2));
  console.log('BRAIN3D_PERF', renderer.name, JSON.stringify({ gpu, results }));
  if (renderer.name === 'gpu') expect(results['low']?.median ?? 0).toBeGreaterThanOrEqual(30);
  await app.close();
});

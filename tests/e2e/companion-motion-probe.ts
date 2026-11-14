import type { ElectronApplication, Page } from '@playwright/test';

export interface MascotSample { t: number; x: number; y: number; }

/** Where the mascot is on the screen, frame by frame: a window move and a CSS move count the same here. */
export function sampleMascotPath(page: Page, durationMs: number): Promise<MascotSample[]> {
  return page.evaluate((duration) => new Promise<MascotSample[]>((resolve) => {
    const samples: MascotSample[] = [];
    const start = performance.now();
    const tick = (now: number) => {
      const box = document.querySelector('.companion-mascot')?.getBoundingClientRect();
      if (box) samples.push({ t: now - start, x: window.screenX + box.left, y: window.screenY + box.top });
      if (now - start < duration) requestAnimationFrame(tick); else resolve(samples);
    };
    requestAnimationFrame(tick);
  }), durationMs);
}

export function largestJump(samples: readonly MascotSample[]): number {
  let largest = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const before = samples[index - 1]; const after = samples[index];
    if (before && after) largest = Math.max(largest, Math.hypot(after.x - before.x, after.y - before.y));
  }
  return largest;
}

export function frameTimeP95(samples: readonly MascotSample[]): number {
  const gaps = samples.slice(1).map((sample, index) => sample.t - (samples[index]?.t ?? sample.t)).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length * .95)] ?? 0;
}

/** Average CPU of the HUD renderer over the interval, as a percentage of one core. */
export async function hudCpu(app: ElectronApplication, page: Page, durationMs: number): Promise<number> {
  const pid = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.webContents.getOSProcessId());
  await app.evaluate(({ app: electronApp }) => { electronApp.getAppMetrics(); });
  await page.waitForTimeout(durationMs);
  return app.evaluate(({ app: electronApp }, id) => electronApp.getAppMetrics().find((metric) => metric.pid === id)?.cpu.percentCPUUsage ?? -1, pid);
}

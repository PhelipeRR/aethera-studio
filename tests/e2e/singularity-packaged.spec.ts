import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { mainWindowOf } from './app';
import { seedGalaxy } from './galaxy-helpers';

// Lote 50.12: the Singularity track inside the packaged Windows app (dist/win-unpacked, from `npm run dist:win`), under
// the production CSP and with an isolated data folder. Void artwork, the Memory Galaxy with real embeddings and real
// Windows monitoring (the absolute-path typeperf/PowerShell spawns only exist in this build path). Skipped without a package.

const exe = resolve(import.meta.dirname, '../../dist/win-unpacked/NeuralBridge.exe');

/** Every Void/brand artwork on the page really loads (an asset left out of the package would 404 silently in SVG). */
async function artworkLoads(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const hrefs = [...new Set([...document.querySelectorAll('svg image')].map((image) => image.getAttribute('href') ?? ''))].filter(Boolean);
    const sizes = await Promise.all(hrefs.map(async (href) => { const response = await fetch(href); return response.ok ? (await response.blob()).size : 0; }));
    return sizes.every((size) => size > 1000) ? hrefs.length : -1;
  });
}

test.describe(() => {
  test.skip(!existsSync(exe), 'needs the packaged app (npm run dist:win)');

  test('the packaged app shows Void, the galaxy and real monitoring under its production CSP', async () => {
    test.setTimeout(120_000);
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-packaged-'));
    for (const dir of ['claude-config', 'codex-home']) mkdirSync(join(dataDir, dir));
    seedGalaxy(dataDir, { count: 300, withEmbeddings: true });
    // COMP-01: the Companion is off in a new install; this HUD check stands for an existing install, as in app.ts.
    writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', companionHud: { visible: true, x: null, y: null, mode: 'mascot', alwaysOnTop: true, align: 'right' } }));
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env['ELECTRON_RUN_AS_NODE'];
    const app = await electron.launch({
      executablePath: exe,
      env: { ...env, NB_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: join(dataDir, 'claude-config'), CODEX_HOME: join(dataDir, 'codex-home') },
      colorScheme: null,
    });
    const page = await mainWindowOf(app);
    const problems: string[] = [];
    const watch = (target: Page) => {
      target.on('console', (message) => { if (message.type() === 'error' || /Content Security Policy|Refused to/i.test(message.text())) problems.push(message.text()); });
      target.on('pageerror', (error) => problems.push(error.message));
    };
    watch(page);
    await page.waitForLoadState('domcontentloaded');

    // Void: the HUD mascot and the brand mark load the packaged artwork.
    await expect.poll(() => app.windows().find((window) => window.url().includes('companion=hud')) ?? null, { timeout: 20_000 }).not.toBeNull();
    const hud = app.windows().find((window) => window.url().includes('companion=hud'));
    if (!hud) throw new Error('HUD window not found');
    watch(hud);
    await expect(hud.getByRole('img', { name: /^Void:/ })).toBeVisible({ timeout: 20_000 });
    expect(await artworkLoads(hud)).toBeGreaterThan(0);
    expect(await artworkLoads(page)).toBeGreaterThan(0);

    // Galaxy: the worker lays out every seeded star.
    await page.evaluate(() => (location.hash = '#/memory/galaxy'));
    const galaxy = page.getByTestId('galaxy');
    await expect(galaxy).toHaveAttribute('data-worker', 'ok', { timeout: 30_000 });
    await expect(galaxy).toHaveAttribute('data-stars', '300');

    // Monitoring: real samples from typeperf started by absolute path.
    await page.evaluate(() => (location.hash = '#/monitoring'));
    const view = page.getByTestId('monitoring');
    await expect.poll(async () => Number(await view.getAttribute('data-samples')), { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
    const snapshot = await page.evaluate(() => window.neuralbridge.monitoring.snapshot());
    expect(snapshot.samples.at(-1)?.cpu.utilization).not.toBeNull();
    expect(snapshot.static.sources.cpu.available).toBe(true);

    expect(problems).toEqual([]);
    await app.close();
  });
});

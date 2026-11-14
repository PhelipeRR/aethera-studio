import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { freshDataDir, launchApp } from './app';

// Drives the real Windows cursor, which Playwright's mouse cannot do: these prove what the synthetic specs only imply.
// Opt-in, because it takes over the mouse of whoever is at the machine: set NB_E2E_REAL_MOUSE=1 and keep hands off it.

const user32 = `Add-Type -Name M -Namespace N -MemberDefinition '
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'`;
const LEFT_DOWN = 2; const LEFT_UP = 4;

const win32 = (body: string): string => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${user32}; ${body}`], { encoding: 'utf8' }).trim();
// mouse_event, not SetCursorPos: only injected input passes the low-level hook Electron forwards moves through, as a real mouse does.
const MOVE_ABSOLUTE = 0x8001;
const moveTo = (point: Point) => win32(`[N.M]::mouse_event(${MOVE_ABSOLUTE}, [uint32](${point.x} * 65535 / ([N.M]::GetSystemMetrics(0) - 1)), [uint32](${point.y} * 65535 / ([N.M]::GetSystemMetrics(1) - 1)), 0, [IntPtr]::Zero)`);
const press = (flag: number) => win32(`[N.M]::mouse_event(${flag}, 0, 0, 0, [IntPtr]::Zero)`);

interface Point { x: number; y: number; }
interface Bounds extends Point { width: number; height: number; }

const hudBounds = async (app: ElectronApplication): Promise<Bounds> => {
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.getBounds());
  if (!bounds) throw new Error('HUD window not found');
  return bounds;
};
const mascotAt = (hud: Page): Promise<Point> => hud.locator('.companion-mascot').evaluate((node) => { const box = node.getBoundingClientRect(); return { x: Math.round(window.screenX + box.left), y: Math.round(window.screenY + box.top) }; });
/** Window offsets are DIPs and the cursor API takes physical pixels. */
const toScreen = (app: ElectronApplication, point: Point): Promise<Point> => app.evaluate(({ screen }, dip) => screen.dipToScreenPoint(dip), point);
const preferences = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'preferences.json'), 'utf8')) as { companionHud: { x: number; y: number; mode: string } };

async function launchWithHud() {
  // A fixed spot on the primary monitor, clear of the screen edges, so nothing snaps or clamps by accident.
  const dataDir = freshDataDir();
  writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', companionHud: { visible: true, x: 500, y: 300, mode: 'mascot', alwaysOnTop: true } }));
  const launched = await launchApp(dataDir);
  await expect.poll(() => launched.app.windows().some((page) => page.url().includes('companion=hud'))).toBe(true);
  const hud = launched.app.windows().find((page) => page.url().includes('companion=hud'));
  if (!hud) throw new Error('HUD window not found');
  await expect(hud.locator('[data-mascot-state]')).toBeVisible();
  await launched.app.evaluate(({ BrowserWindow, screen }) => {
    const { x, y } = screen.getPrimaryDisplay().workArea;
    BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setBounds({ x, y, width: 1200, height: 800 });
  });
  return { ...launched, hud };
}

test.describe(() => {
  test.skip(process.platform !== 'win32' || process.env['NB_E2E_REAL_MOUSE'] !== '1', 'set NB_E2E_REAL_MOUSE=1 on Windows; takes over the real cursor');
  test.setTimeout(90_000);
  test.afterEach(() => { press(LEFT_UP); });

  test('the real mouse drags the mascot without opening it, and a real click opens it without taking focus', async () => {
    const { app, page, hud, dataDir } = await launchWithHud();
    await page.bringToFront();
    const start = await mascotAt(hud);
    const foreground = win32('[N.M]::GetForegroundWindow().ToInt64()');
    const grab = { x: start.x + 52, y: start.y + 44 };

    await moveTo(await toScreen(app, grab));
    await moveTo(await toScreen(app, { x: grab.x + 1, y: grab.y + 1 }));
    await page.waitForTimeout(250);
    press(LEFT_DOWN);
    for (let step = 1; step <= 6; step += 1) {
      await moveTo(await toScreen(app, { x: grab.x + step * 40, y: grab.y + step * 25 }));
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(250);
    press(LEFT_UP);

    await expect.poll(async () => (await mascotAt(hud)).x, { timeout: 5_000 }).toBeGreaterThan(start.x + 180);
    await expect.poll(async () => (await mascotAt(hud)).y, { timeout: 5_000 }).toBeGreaterThan(start.y + 110);
    const moved = await mascotAt(hud);
    await expect.poll(() => preferences(dataDir).companionHud.x).toBe(moved.x - 14);
    expect(preferences(dataDir).companionHud.mode).toBe('mascot');
    await expect(hud.getByRole('button', { name: 'Expandir Companion' })).toBeVisible();

    const click = { x: moved.x + 52, y: moved.y + 44 };
    await moveTo(await toScreen(app, click));
    await moveTo(await toScreen(app, { x: click.x + 1, y: click.y }));
    await page.waitForTimeout(250);
    press(LEFT_DOWN);
    press(LEFT_UP);
    await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
    await expect(hud.locator('main')).toHaveClass(/companion-hud--compact/);
    expect(win32('[N.M]::GetForegroundWindow().ToInt64()')).toBe(foreground);
    await app.close();
  });

  test('a real click on a transparent margin reaches the window underneath', async () => {
    const { app, page, hud } = await launchWithHud();
    await page.bringToFront();
    await page.evaluate(() => {
      const state = window as unknown as { realClicks: Point[] };
      state.realClicks = [];
      window.addEventListener('mousedown', (event) => state.realClicks.push({ x: event.screenX, y: event.screenY }), true);
    });
    await hud.evaluate(() => {
      const state = window as unknown as { hudClicks: number };
      state.hudClicks = 0;
      window.addEventListener('mousedown', () => { state.hudClicks += 1; }, true);
    });
    const bounds = await hudBounds(app);
    const margin = { x: bounds.x + 4, y: bounds.y + 4 };
    await moveTo(await toScreen(app, margin));
    await moveTo(await toScreen(app, { x: margin.x + 1, y: margin.y }));
    await page.waitForTimeout(300);
    press(LEFT_DOWN);
    press(LEFT_UP);

    await expect.poll(() => page.evaluate(() => (window as unknown as { realClicks: Point[] }).realClicks.length)).toBe(1);
    expect(await hud.evaluate(() => (window as unknown as { hudClicks: number }).hudClicks)).toBe(0);
    await expect(hud.getByRole('button', { name: 'Expandir Companion' })).toBeVisible();
    await app.close();
  });
});

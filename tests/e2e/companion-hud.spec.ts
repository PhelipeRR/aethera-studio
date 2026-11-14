import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { CompanionSession } from '@neuralbridge/shared/companion';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

const shots = resolve('artifacts');
mkdirSync(shots, { recursive: true });
const shot = (hud: Page, name: string) => hud.screenshot({ path: join(shots, `companion-hud-${name}.png`), omitBackground: true });

async function findHud(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((page) => page.url().includes('companion=hud'))).toBe(true);
  const hud = app.windows().find((page) => page.url().includes('companion=hud'));
  if (!hud) throw new Error('HUD window not found');
  await expect(hud.getByRole('main', { name: 'Singularity Companion' })).toBeVisible();
  return hud;
}

const hudBounds = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.getBounds());
/** Mascot position on the screen: the window is a fixed stage, so this is what the old per-mode bounds used to tell. */
const mascotAt = (hud: Page) => hud.locator('.companion-mascot').evaluate((node) => { const box = node.getBoundingClientRect(); return { x: Math.round(window.screenX + box.left), y: Math.round(window.screenY + box.top) }; });
const hudFlags = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().includes('companion=hud')); return { visible: window?.isVisible(), focused: window?.isFocused(), focusable: window?.isFocusable(), onTop: window?.isAlwaysOnTop() }; });
const preferences = (dataDir: string) => JSON.parse(readFileSync(join(dataDir, 'preferences.json'), 'utf8')) as { companionHud: { visible: boolean; x: number | null; y: number | null; mode: string; alwaysOnTop: boolean } };
const mascot = (hud: Page) => hud.locator('[data-mascot-state]');
const expectState = (hud: Page, state: string) => expect(mascot(hud)).toHaveAttribute('data-mascot-state', state, { timeout: 15_000 });

async function startTask(page: Page, prompt: string): Promise<string> {
  const projectRoot = mkdtempSync(join(tmpdir(), 'nb-companion-project-'));
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), projectRoot);
  const task = await page.evaluate(({ prompt, projectId }) => window.neuralbridge.tasks.start({ prompt, projectId, mode: 'claude', model: null, skillIds: [] }), { prompt, projectId: project.id });
  return task.id;
}

/**
 * No adapter produces these states before 42.4 and the app holds the database exclusively, so the real session is
 * altered at the IPC boundary of the main process. Everything from there to the pixels is the production path.
 */
async function serveSessionAs(app: ElectronApplication, session: CompanionSession, status: string, connection: string): Promise<void> {
  await app.evaluate(({ ipcMain }, item) => {
    ipcMain.removeHandler('companion:sessions');
    ipcMain.handle('companion:sessions', () => ({ items: [item], nextOffset: null }));
  }, { ...session, status, connection });
}

test('walks the three modes inside one fixed window', async () => {
  const { app, page, dataDir } = await launchApp();
  const hud = await findHud(app);
  await expect(hud.getByRole('img', { name: /Void/ })).toBeVisible();
  await expectState(hud, 'idle');
  expect(await hudBounds(app)).toMatchObject({ width: 820, height: 440 });
  await expect.poll(() => hud.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect((await hudFlags(app)).focusable).toBe(false);
  const anchor = await mascotAt(hud);
  const stage = await hudBounds(app);
  await shot(hud, 'mascot');

  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByText('Nenhum agente ativo', { exact: true })).toBeVisible();
  expect(await hudBounds(app)).toEqual(stage);
  await hud.waitForTimeout(320);
  await shot(hud, 'capsule');

  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByText('O Companion está observando o TaskEngine.')).toBeVisible();
  expect(await hudBounds(app)).toEqual(stage);
  await expect.poll(async () => (await hudFlags(app)).focusable).toBe(true);
  await hud.waitForTimeout(320);
  await shot(hud, 'expanded');
  await shot(hud, 'empty');
  await expect.poll(() => preferences(dataDir).companionHud.mode).toBe('expanded');

  await hud.keyboard.press('Escape');
  await hud.getByRole('button', { name: 'Recolher para o mascote' }).click();
  await expect.poll(() => mascotAt(hud)).toEqual(anchor);

  await page.evaluate(() => window.neuralbridge.companion.setHudPinned(false));
  expect((await hudFlags(app)).onTop).toBe(false);
  await app.close();
  expect(preferences(dataDir).companionHud).toMatchObject({ visible: true, alwaysOnTop: false, mode: 'mascot' });
});

test('drags, snaps and restores the position after a restart', async () => {
  const first = await launchApp();
  const hud = await findHud(first.app);
  const before = await hudBounds(first.app);
  if (!before) throw new Error('no bounds');
  // Playwright's mouse does not move the OS cursor, and the main process reads the OS cursor by design.
  const moveCursor = (x: number, y: number) => first.app.evaluate(({ screen }, point) => { screen.getCursorScreenPoint = () => point; }, { x, y });
  const stage = hud.getByRole('button', { name: 'Expandir Companion' });
  const box = await stage.boundingBox();
  if (!box) throw new Error('no mascot');
  const anchor = await mascotAt(hud);
  const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
  await moveCursor(anchor.x + 60, anchor.y + 60);
  await hud.mouse.move(cx, cy);
  await hud.mouse.down();
  await hud.mouse.move(cx - 20, cy - 20);
  await moveCursor(anchor.x - 240, anchor.y - 180);
  await hud.mouse.move(cx - 30, cy - 30);
  await expect.poll(() => mascotAt(hud)).toEqual({ x: anchor.x - 300, y: anchor.y - 240 });
  await hud.mouse.up();
  // The preference keeps naming the corner of the mascot's box, 14 and 12 px outside the button.
  await expect.poll(() => preferences(first.dataDir).companionHud.x).toBe(anchor.x - 14 - 300);
  await expect.poll(() => mascotAt(hud)).toEqual({ x: anchor.x - 300, y: anchor.y - 240 });
  // A drag is not a click: the mascot stays a mascot.
  await expect(hud.getByRole('button', { name: 'Expandir Companion' })).toBeVisible();
  await first.app.close();

  const second = await launchApp(first.dataDir);
  expect(await mascotAt(await findHud(second.app))).toEqual({ x: anchor.x - 300, y: anchor.y - 240 });
  await second.app.close();
});

test('reports only real sessions, with the live reactions of real runs', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const hud = await findHud(app);
  await expectState(hud, 'idle');
  await shot(hud, 'state-idle');

  const running = await startTask(page, 'LENTO responda com uma palavra');
  await expectState(hud, 'running');
  await shot(hud, 'state-running');
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByText('Executando', { exact: false }).first()).toBeVisible();
  await expect(hud.getByText('Claude Code')).toBeVisible();
  await hud.waitForTimeout(320);
  await shot(hud, 'capsule-running');
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('heading', { name: 'Claude Code' })).toBeVisible();
  await expect(hud.getByText('LENTO responda com uma palavra')).toBeVisible();
  await expect(hud.getByText('Execução iniciada')).toBeVisible();
  const clock = hud.locator('.companion-detail__task time');
  const firstTick = await clock.textContent();
  await expect.poll(() => clock.textContent()).not.toBe(firstTick);
  await hud.waitForTimeout(320);
  await shot(hud, 'expanded-running');
  await hud.keyboard.press('Escape');
  await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
  await hud.getByRole('button', { name: 'Recolher para o mascote' }).click();
  await expect(hud.locator('main')).toHaveClass(/companion-hud--mascot/);

  await page.evaluate((id) => window.neuralbridge.tasks.cancel(id), running);
  await expectState(hud, 'idle');

  await startTask(page, 'Responda com uma palavra');
  await expectState(hud, 'success');
  await hud.waitForTimeout(1_400);
  await shot(hud, 'state-success');
  await expectState(hud, 'idle');

  const failing = await page.evaluate(async () => {
    const project = (await window.neuralbridge.projects.list())[0];
    return (await window.neuralbridge.tasks.start({ prompt: 'FALHAR agora', projectId: project?.id ?? null, mode: 'codex', model: null, skillIds: [] })).id;
  });
  await expectState(hud, 'error');
  await hud.waitForTimeout(1_200);
  await shot(hud, 'state-error');
  await expectState(hud, 'idle');
  expect(failing).toBeTruthy();

  // Reopening must not replay old outcomes.
  await hud.reload();
  await expectState(hud, 'idle');

  const { items: [session] } = await page.evaluate(() => window.neuralbridge.companion.listSessions({ newestFirst: true, limit: 1 }));
  if (!session) throw new Error('no session');
  for (const [status, connection, state] of [['waiting_input', 'connected', 'waiting'], ['discovering', 'connected', 'thinking'], ['paused', 'connected', 'resting'], ['running', 'degraded', 'degraded'], ['running', 'disconnected', 'disconnected']] as const) {
    await serveSessionAs(app, session, status, connection);
    await hud.reload();
    await expectState(hud, state);
    await hud.waitForTimeout(500);
    await shot(hud, `state-${state}`);
  }
  await app.close();
});

test('never takes focus, and motion stops when reduced or hidden', async () => {
  const { app, page } = await launchApp();
  const hud = await findHud(app);
  await page.bringToFront();
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.locator('main')).toHaveClass(/companion-hud--compact/);
  expect((await hudFlags(app)).focused).toBe(false);

  const animated = () => hud.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length);
  await expect.poll(animated).toBeGreaterThan(0);
  await hud.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(animated).toBe(0);
  await hud.emulateMedia({ reducedMotion: 'no-preference' });

  await page.evaluate(() => window.neuralbridge.companion.setHudVisibility(false));
  await expect.poll(async () => (await hudFlags(app)).visible).toBe(false);
  await expect(hud.locator('.companion-hud--suspended')).toHaveCount(1);
  await page.evaluate(() => window.neuralbridge.companion.setHudVisibility(true));
  await expect.poll(async () => (await hudFlags(app)).visible).toBe(true);
  await expect(hud.locator('.companion-hud--suspended')).toHaveCount(0);
  await app.close();
});

test('keeps positioning to the HUD and survives repeated cycles without leaking', async () => {
  test.setTimeout(60_000);
  const { app, page } = await launchApp();
  const hud = await findHud(app);
  for (const call of [
    () => window.neuralbridge.companion.dragHud('start'),
    () => window.neuralbridge.companion.setHudInteractive(true),
    () => window.neuralbridge.companion.setHudMode('expanded'),
    () => window.neuralbridge.companion.openSettings(),
  ]) await expect(page.evaluate(call)).rejects.toThrow(/Untrusted sender/);
  await expect(hud.evaluate(() => window.neuralbridge.companion.setHudMode('invalid' as 'mascot'))).rejects.toThrow();
  await expect(hud.evaluate(() => (window.neuralbridge.companion as unknown as { dragHud(input: unknown): Promise<unknown> }).dragHud({ x: 1, y: 2 }))).rejects.toThrow();
  const api = await hud.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require, process: typeof (window as unknown as { process?: unknown }).process, publish: 'publish' in window.neuralbridge.companion }));
  expect(api).toEqual({ node: 'undefined', process: 'undefined', publish: false });

  const listeners = () => app.evaluate(({ app: electronApp, screen }) => ({ display: screen.listenerCount('display-metrics-changed'), quit: electronApp.listenerCount('before-quit') }));
  const baseline = await listeners();
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await hud.getByRole('button', { name: 'Expandir Companion' }).click();
    await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
    await hud.getByRole('button', { name: 'Recolher para o mascote' }).click();
    await expect(hud.locator('main')).toHaveClass(/companion-hud--mascot/);
    await hud.reload();
    await expect(hud.getByRole('main', { name: 'Singularity Companion' })).toBeVisible();
  }
  expect(await listeners()).toEqual(baseline);
  await app.close();
});

test('Settings brings back a hidden HUD, and the next launch does too', async () => {
  const first = await launchApp();
  const hud = await findHud(first.app);
  await first.page.evaluate(() => window.neuralbridge.companion.setHudVisibility(false));
  await expect.poll(async () => (await hudFlags(first.app)).visible).toBe(false);
  await first.page.evaluate(() => { window.location.hash = '#/settings'; });
  const toggle = first.page.getByRole('checkbox', { name: 'Mostrar na área de trabalho' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect.poll(async () => (await hudFlags(first.app)).visible).toBe(true);
  await first.page.getByRole('button', { name: 'Abrir painel' }).click();
  await expect(hud.getByRole('heading', { name: 'Eventos recentes' })).toBeVisible();

  const shownAt = await hudBounds(first.app);
  await first.page.evaluate(() => window.neuralbridge.companion.setHudVisibility(false));
  await first.app.close();
  expect(preferences(first.dataDir).companionHud.visible).toBe(false);

  const second = await launchApp(first.dataDir);
  await findHud(second.app);
  await expect.poll(async () => (await hudFlags(second.app)).visible).toBe(true);
  expect(await hudBounds(second.app)).toEqual(shownAt);
  expect(preferences(first.dataDir).companionHud.visible).toBe(true);
  await second.app.close();
});

test('follows the light theme with the same structure', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const hud = await findHud(app);
  await page.evaluate(() => window.neuralbridge.theme.set('light'));
  await expect.poll(() => hud.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches)).toBe(true);
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('heading', { name: 'Eventos recentes' })).toBeVisible();
  await hud.waitForTimeout(320);
  await shot(hud, 'expanded-light');
  await app.close();
});

test('keeps its shape at 150% display scaling', async () => {
  const { app } = await launchApp(freshDataDir(), { chromiumArgs: ['--force-device-scale-factor=1.5'] });
  const hud = await findHud(app);
  expect(await hud.evaluate(() => window.devicePixelRatio)).toBe(1.5);
  expect(await hudBounds(app)).toMatchObject({ width: 820, height: 440 });
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.locator('main')).toHaveClass(/companion-hud--expanded/);
  await hud.waitForTimeout(700);
  const clipped = await hud.evaluate(() => {
    const shell = document.querySelector('.companion-shell')?.getBoundingClientRect();
    return !shell || shell.right > window.innerWidth || shell.bottom > window.innerHeight;
  });
  expect(clipped).toBe(false);
  await shot(hud, 'expanded-150');
  await app.close();
});

test('the native window lets clicks through its margins and never activates outside the panel', async () => {
  test.skip(process.platform !== 'win32', 'reads Win32 window styles');
  const { app } = await launchApp();
  const hud = await findHud(app);
  const WS_EX_TRANSPARENT = 0x20; const WS_EX_NOACTIVATE = 0x08000000;
  const handle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.getNativeWindowHandle().readBigUInt64LE().toString());
  const exStyle = () => {
    const script = `Add-Type -Name W -Namespace N -MemberDefinition '[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);'; [N.W]::GetWindowLong([IntPtr]::new(${handle}), -20)`;
    return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim());
  };
  expect(exStyle() & WS_EX_TRANSPARENT).toBe(WS_EX_TRANSPARENT);
  expect(exStyle() & WS_EX_NOACTIVATE).toBe(WS_EX_NOACTIVATE);

  const button = await hud.locator('.companion-mascot').boundingBox();
  if (!button) throw new Error('no mascot');
  await hud.mouse.move(button.x + 50, button.y + 45);
  await expect.poll(() => exStyle() & WS_EX_TRANSPARENT).toBe(0);
  await hud.mouse.move(2, 2);
  await expect.poll(() => exStyle() & WS_EX_TRANSPARENT).toBe(WS_EX_TRANSPARENT);

  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect.poll(() => exStyle() & WS_EX_NOACTIVATE).toBe(0);
  await app.close();
});

test('reopens on the secondary monitor, inside it in every mode', async () => {
  const first = await launchApp();
  await findHud(first.app);
  const displays = await first.app.evaluate(({ screen }) => ({ primary: screen.getPrimaryDisplay().id, all: screen.getAllDisplays().map((display) => ({ id: display.id, area: display.workArea })) }));
  await first.app.close();
  const secondary = displays.all.find((display) => display.id !== displays.primary);
  test.skip(!secondary, 'needs a second monitor');
  if (!secondary) return;
  const anchor = { x: secondary.area.x + secondary.area.width - 200, y: secondary.area.y + 300 };
  const file = join(first.dataDir, 'preferences.json');
  writeFileSync(file, JSON.stringify({ theme: 'dark', companionHud: { visible: true, ...anchor, mode: 'mascot', alwaysOnTop: true } }));

  const second = await launchApp(first.dataDir);
  const hud = await findHud(second.app);
  const shown = { x: anchor.x + 14, y: anchor.y + 12 };
  await expect.poll(() => mascotAt(hud)).toEqual(shown);
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('heading', { name: 'Eventos recentes' })).toBeVisible();
  const expanded = await hudBounds(second.app);
  expect(expanded?.x).toBeGreaterThanOrEqual(secondary.area.x);
  expect((expanded?.x ?? 0) + 820).toBeLessThanOrEqual(secondary.area.x + secondary.area.width);
  await hud.keyboard.press('Escape');
  await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
  await hud.getByRole('button', { name: 'Recolher para o mascote' }).click();
  await expect.poll(() => mascotAt(hud)).toEqual(shown);
  await second.app.close();

  // The monitor is unplugged: the saved position no longer exists anywhere.
  const moved = preferences(first.dataDir);
  writeFileSync(file, JSON.stringify({ ...moved, companionHud: { ...moved.companionHud, x: -50_000, y: 300 } }));
  const third = await launchApp(first.dataDir);
  await findHud(third.app);
  const recovered = await hudBounds(third.app);
  const onSomeMonitor = displays.all.some(({ area }) => (recovered?.x ?? 0) >= area.x && (recovered?.x ?? 0) + 132 <= area.x + area.width);
  expect(onSomeMonitor).toBe(true);
  await third.app.close();
});

test('closing the HUD leaves a running task alone, and it comes back on demand', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const hud = await findHud(app);
  const taskId = await startTask(page, 'LENTO continue depois do HUD');
  await expectState(hud, 'running');

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.close(); });
  await expect.poll(() => app.windows().some((window) => window.url().includes('companion=hud'))).toBe(false);
  expect((await page.evaluate((id) => window.neuralbridge.tasks.get(id), taskId)).status).toBe('running');
  expect((await page.evaluate(() => window.neuralbridge.companion.getHudState())).visible).toBe(false);
  await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.companion.listSessions({ activeOnly: true }))).items.length).toBe(1);

  await page.evaluate(() => window.neuralbridge.companion.setHudVisibility(true));
  const reopened = await findHud(app);
  await expectState(reopened, 'running');
  await page.evaluate((id) => window.neuralbridge.tasks.cancel(id), taskId);
  await app.close();
});

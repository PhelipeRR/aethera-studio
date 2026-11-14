import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpus } from 'node:os';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { freshDataDir, launchApp } from './app';
import { frameTimeP95, hudCpu, largestJump, sampleMascotPath } from './companion-motion-probe';

/** A measurement, not a check: NB_MOTION_LABEL names the run, and the same matrix runs before and after the phase. */
const label = process.env['NB_MOTION_LABEL'];
const FFMPEG = 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const out = resolve('test-results', `motion-${label}`);

async function findHud(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((page) => page.url().includes('companion=hud'))).toBe(true);
  const hud = app.windows().find((page) => page.url().includes('companion=hud'));
  if (!hud) throw new Error('HUD window not found');
  await expect(hud.getByRole('main', { name: 'Singularity Companion' })).toBeVisible();
  return hud;
}

const seed = (anchor: { x: number; y: number } | null) => {
  const dataDir = freshDataDir();
  writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', companionHud: { visible: true, x: anchor?.x ?? null, y: anchor?.y ?? null, mode: 'mascot', alwaysOnTop: true } }));
  return dataDir;
};

for (const [name, anchor, scale] of [['default-100', null, 1], ['roomy-100', { x: 200, y: 200 }, 1], ['default-150', null, 1.5], ['roomy-150', { x: 200, y: 200 }, 1.5]] as const) {
  test(`measures ${name}`, async () => {
    test.skip(!label, 'set NB_MOTION_LABEL to measure');
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    const { app } = await launchApp(seed(anchor), { chromiumArgs: [`--force-device-scale-factor=${scale}`] });
    const hud = await findHud(app);
    const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
    const recording = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'gdigrab', '-framerate', '60', '-offset_x', String(area.x), '-offset_y', String(area.y), '-video_size', `${Math.round(area.width * scale) & ~1}x${Math.round(area.height * scale) & ~1}`, '-i', 'desktop', '-t', '9', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(out, `${name}.mp4`)], { stdio: ['pipe', 'ignore', 'ignore'] });
    await hud.waitForTimeout(800);
    const steps: Array<[string, () => Promise<void>]> = [
      ['mascot>compact', () => hud.locator('.companion-mascot').click()],
      ['compact>expanded', () => hud.getByRole('button', { name: 'Expandir Companion' }).click()],
      ['expanded>compact', () => hud.keyboard.press('Escape')],
      ['compact>mascot', () => hud.locator('.companion-mascot').click()],
    ];
    const lines: string[] = [];
    for (const [step, act] of steps) {
      const path = sampleMascotPath(hud, 900);
      await act();
      const samples = await path;
      lines.push(`${name} ${step}: jump=${largestJump(samples).toFixed(1)}px p95=${frameTimeP95(samples).toFixed(1)}ms`);
    }
    await new Promise<void>((done) => { if (recording.exitCode !== null) { done(); return; } recording.once('exit', () => done()); recording.stdin.write('q'); });
    const idle = await hudCpu(app, hud, 30_000);
    lines.push(`${name} idle cpu=${idle.toFixed(2)}%`);
    appendFileSync(join(out, 'results.txt'), `${lines.join('\n')}\n`);
    await app.close();
  });
}

/** Task 1 gate: the shipped mascot mode, held in a panel-sized window. The OS behaviour is what is on trial here. */
test('stage window gate', async () => {
  test.skip(label !== 'gate', 'set NB_MOTION_LABEL=gate');
  test.setTimeout(120_000);
  mkdirSync(out, { recursive: true });
  const { app } = await launchApp(seed({ x: 200, y: 200 }));
  const hud = await findHud(app);
  const tight = await hudCpu(app, hud, 20_000);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.setBounds({ x: 200, y: 200, width: 820, height: 440 }); });
  const handle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.getNativeWindowHandle().readBigUInt64LE().toString());
  const exStyle = () => Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -Name W -Namespace N -MemberDefinition '[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);'; [N.W]::GetWindowLong([IntPtr]::new(${handle}), -20)`], { encoding: 'utf8' }).trim());
  const WS_EX_TRANSPARENT = 0x20;
  expect(exStyle() & WS_EX_TRANSPARENT).toBe(WS_EX_TRANSPARENT);
  await hud.mouse.move(60, 55);
  await expect.poll(() => exStyle() & WS_EX_TRANSPARENT).toBe(0);
  await hud.mouse.move(700, 400);
  await expect.poll(() => exStyle() & WS_EX_TRANSPARENT).toBe(WS_EX_TRANSPARENT);
  const onTop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.isAlwaysOnTop());
  const staged = await hudCpu(app, hud, 20_000);
  const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().length);
  appendFileSync(join(out, 'results.txt'), `tight cpu=${tight.toFixed(2)}% stage cpu=${staged.toFixed(2)}% onTop=${onTop} displays=${displays}\n`);
  await app.close();
});

/** Busy processes stand in for agents at work: the HUD has to stay smooth on a machine that is not idle. */
test('long tasks and response under load', async () => {
  test.skip(label !== 'load', 'set NB_MOTION_LABEL=load');
  test.setTimeout(120_000);
  mkdirSync(out, { recursive: true });
  const busy: ChildProcess[] = [];
  try {
    for (const load of ['idle-machine', 'busy-machine'] as const) {
      if (load === 'busy-machine') for (let core = 0; core < cpus().length; core += 1) busy.push(spawn(process.execPath, ['-e', 'for (;;);'], { stdio: 'ignore' }));
      const { app } = await launchApp(seed(null));
      const hud = await findHud(app);
      await hud.evaluate(() => {
        const memo = window as unknown as { longTasks: number[] };
        memo.longTasks = [];
        new PerformanceObserver((list) => { for (const entry of list.getEntries()) memo.longTasks.push(entry.duration); }).observe({ entryTypes: ['longtask'] });
      });
      await hud.waitForTimeout(1500);
      const latency: number[] = []; let worst = 0; let p95 = 0;
      for (let cycle = 0; cycle < 6; cycle += 1) {
        const started = Date.now();
        await hud.evaluate(() => (document.querySelector('.companion-mascot') as HTMLElement).click());
        latency.push(Date.now() - started);
        const samples = await sampleMascotPath(hud, 600);
        worst = Math.max(worst, largestJump(samples)); p95 = Math.max(p95, frameTimeP95(samples));
        await hud.evaluate(() => (document.querySelector('.companion-mascot') as HTMLElement).click());
        await hud.waitForTimeout(500);
      }
      const longTasks = await hud.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
      appendFileSync(join(out, 'results.txt'), `${load}: longTasks=${longTasks.length} max=${Math.max(0, ...longTasks).toFixed(0)}ms frameP95=${p95.toFixed(1)}ms jump=${worst.toFixed(1)}px clickMax=${Math.max(...latency)}ms\n`);
      await app.close();
    }
  } finally { for (const child of busy) child.kill(); }
});

/**
 * Stands in for the cursor, as the HUD spec does. Runs on the packaged app, because the development electron.exe reports
 * every monitor at 100%: only the real executable sees a mixed DPI desk.
 */
for (const start of ['primary', 'secondary'] as const) {
  test(`crossing monitors from the ${start} keeps the stage`, async () => {
    test.skip(label !== 'monitors', 'set NB_MOTION_LABEL=monitors');
    const exe = resolve('dist/win-unpacked/NeuralBridge.exe');
    test.skip(!existsSync(exe), 'needs the packaged app (npm run dist:win)');
    test.setTimeout(60_000);
    mkdirSync(out, { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env['ELECTRON_RUN_AS_NODE'];
    const probeDir = freshDataDir();
    const probe = await electron.launch({ executablePath: exe, env: { ...env, NB_DATA_DIR: probeDir } });
    const displays = await probe.evaluate(({ screen }) => screen.getAllDisplays().map((display) => ({ area: display.workArea, scale: display.scaleFactor, primary: display.id === screen.getPrimaryDisplay().id })));
    await probe.close();
    const home = displays.find((display) => display.primary === (start === 'primary'));
    const away = displays.find((display) => display.primary !== (start === 'primary'));
    test.skip(!home || !away, 'needs a second monitor');
    if (!home || !away) return;
    const anchor = { x: home.area.x + 100, y: home.area.y + 100 };
    const app = await electron.launch({ executablePath: exe, env: { ...env, NB_DATA_DIR: seed(anchor) } });
    const hud = await findHud(app);
    await hud.waitForTimeout(800);
    const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.getBounds());
    const moveCursor = (x: number, y: number) => app.evaluate(({ screen }, point) => { screen.getCursorScreenPoint = () => point; }, { x, y });
    const box = await hud.locator('.companion-mascot').boundingBox();
    if (!box) throw new Error('no mascot');
    const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
    const from = { x: anchor.x + 64, y: anchor.y + 57 };
    const target = { x: Math.round(away.area.x + away.area.width / 2), y: away.area.y + 200 };
    await moveCursor(from.x, from.y);
    await hud.mouse.move(cx, cy);
    await hud.mouse.down();
    await hud.mouse.move(cx + 10, cy + 10);
    const sizes: string[] = [];
    for (let step = 1; step <= 20; step += 1) {
      await moveCursor(Math.round(from.x + (target.x - from.x) * step / 20), Math.round(from.y + (target.y - from.y) * step / 20));
      await hud.mouse.move(cx + 10 + step, cy + 10);
      await hud.waitForTimeout(40);
      const now = await bounds();
      // At a fractional scale the bounds read back rounded through physical pixels, a pixel either way.
      sizes.push(`${Math.abs((now?.width ?? 0) - 820) <= 1 ? 820 : now?.width}x${Math.abs((now?.height ?? 0) - 440) <= 1 ? 440 : now?.height}`);
    }
    await hud.mouse.up();
    await hud.waitForTimeout(800);
    const final = await bounds();
    const view = await hud.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, ratio: window.devicePixelRatio }));
    await hud.locator('.companion-mascot').click();
    await hud.waitForTimeout(700);
    await hud.locator('.companion-capsule__toggle').click();
    await hud.waitForTimeout(700);
    const panel = await hud.evaluate(() => { const shell = document.querySelector('.companion-shell')?.getBoundingClientRect(); return { right: shell?.right, bottom: shell?.bottom, width: window.innerWidth, height: window.innerHeight }; });
    await hud.screenshot({ path: resolve(`artifacts/motion/dpi-from-${start}.png`), omitBackground: true });
    appendFileSync(join(out, 'results.txt'), `${start} home=${home.scale} away=${away.scale} sizes=${[...new Set(sizes)].join(',')} final=${JSON.stringify(final)} view=${JSON.stringify(view)} panel=${JSON.stringify(panel)}\n`);
    await app.close();
    expect(new Set(sizes)).toEqual(new Set(['820x440']));
    expect(view).toMatchObject({ width: 820, height: 440, ratio: away.scale });
    expect(panel.right ?? 999).toBeLessThanOrEqual(panel.width);
    expect(panel.bottom ?? 999).toBeLessThanOrEqual(panel.height);
  });
}

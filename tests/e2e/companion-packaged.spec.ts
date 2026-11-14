import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

// The Companion HUD inside the packaged Windows app (dist/win-unpacked), under the production CSP and with an isolated
// data folder. Skipped when no package exists.

const exe = resolve(import.meta.dirname, '../../dist/win-unpacked/NeuralBridge.exe');

test.describe(() => {
  test.skip(!existsSync(exe), 'needs the packaged app (npm run dist:win)');

  test('the packaged app opens the transparent HUD and walks its three modes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-e2e-packaged-'));
    for (const dir of ['claude-config', 'codex-home']) mkdirSync(join(dataDir, dir));
    // COMP-01: the Companion is off in a new install; this HUD check stands for an existing install, as in app.ts.
    writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', companionHud: { visible: true, x: null, y: null, mode: 'mascot', alwaysOnTop: true, align: 'right' } }));
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env['ELECTRON_RUN_AS_NODE'];
    const app = await electron.launch({
      executablePath: exe,
      env: { ...env, NB_DATA_DIR: dataDir, CLAUDE_CONFIG_DIR: join(dataDir, 'claude-config'), CODEX_HOME: join(dataDir, 'codex-home') },
      colorScheme: null,
    });
    await app.firstWindow();
    await expect.poll(() => app.windows().some((page) => page.url().includes('companion=hud'))).toBe(true);
    const hud = app.windows().find((page) => page.url().includes('companion=hud'));
    if (!hud) throw new Error('HUD window not found');
    const problems: string[] = [];
    hud.on('console', (message) => { if (message.type() === 'error' || /Content Security Policy|Refused to/i.test(message.text())) problems.push(message.text()); });
    hud.on('pageerror', (error) => problems.push(error.message));
    const width = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.getBounds().width);

    await expect(hud.locator('[data-mascot-state]')).toHaveAttribute('data-mascot-state', 'idle');
    expect(await hud.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    await hud.getByRole('button', { name: 'Expandir Companion' }).click();
    await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
    await expect(hud.locator('main')).toHaveClass(/companion-hud--compact/);
    await hud.getByRole('button', { name: 'Expandir Companion' }).click();
    await expect(hud.getByRole('heading', { name: 'Eventos recentes' })).toBeVisible();
    await expect(hud.locator('main')).toHaveClass(/companion-hud--expanded/);
    expect(await width()).toBe(820);
    await hud.waitForTimeout(700);
    await hud.screenshot({ path: resolve('artifacts/companion-hud-packaged.png'), omitBackground: true });
    expect(await hud.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    // The Neura voice arrives as inline audio, which the production CSP has to let through.
    const voice = await hud.evaluate(() => new Promise<string>((done) => {
      const header = [82, 73, 70, 70, 38, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 128, 62, 0, 0, 2, 0, 16, 0, 100, 97, 116, 97, 2, 0, 0, 0, 0, 0];
      const audio = new Audio(`data:audio/wav;base64,${btoa(String.fromCharCode(...header))}`);
      audio.onloadedmetadata = () => done('loaded');
      audio.onerror = () => done(audio.error?.message ?? 'error');
    }));
    expect(voice).toBe('loaded');
    expect(problems).toEqual([]);
    await app.close();
  });
});

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchApp } from './app';

// The desktop app's own version (what an installed copy reports), never Electron's.
const APP_VERSION = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../apps/desktop/package.json'), 'utf8')) as { version: string }).version;

const PAGES = ['Dashboard', 'Chat', 'Execuções', 'Memória', 'Skills', 'Projetos', 'Agentes', 'MCPs', 'Analytics', 'Configurações'];

test('opens on the dashboard with the main navigation', async () => {
  const { app, page } = await launchApp();
  await expect(page).toHaveTitle('Singularity');
  await expect(page.getByRole('navigation', { name: 'Navegação principal' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await app.close();
});

test('opens the command palette with Ctrl+K and navigates by keyboard', async () => {
  const { app, page } = await launchApp();
  await page.getByRole('button', { name: 'Abrir Command Palette' }).click();
  await expect(page.getByRole('dialog', { name: 'Command Palette' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Buscar módulos e comandos' });
  await expect(input).toBeFocused();
  await input.fill('Projetos');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Projetos' })).toBeVisible();
  await app.close();
});

test('sidebar collapse persists and keeps navigation available by label', async () => {
  const { app, page, dataDir } = await launchApp();
  const toggle = page.getByRole('button', { name: 'Recolher menu' });
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Expandir menu' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await app.close();
  const second = await launchApp(dataDir);
  await expect(second.page.getByRole('button', { name: 'Expandir menu' })).toBeVisible();
  await second.app.close();
});

test('every sidebar entry opens its page', async () => {
  const { app, page } = await launchApp();
  const nav = page.getByRole('complementary');
  for (const name of PAGES) {
    await nav.getByRole('link', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await app.close();
});

test('pages without data show no sample data', async () => {
  const { app, page } = await launchApp();
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ainda não há tokens reportados' })).toBeVisible();
  await expect(page.getByText('Nada é estimado no lugar delas')).toBeVisible();
  await app.close();
});

test('the renderer is isolated from Node and Electron', async () => {
  const { app, page } = await launchApp();
  const surface = await page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (globalThis as { process?: unknown }).process,
    bridge: Object.keys(window.neuralbridge).sort(),
  }));
  expect(surface).toEqual({ require: 'undefined', process: 'undefined', bridge: ['agents', 'analytics', 'app', 'azureDevOps', 'brain', 'companion', 'core', 'databaseRecovery', 'extensions', 'historySync', 'importedConversations', 'mcp', 'monitoring', 'neura', 'projects', 'semantic', 'skills', 'spotify', 'tasks', 'theme', 'video', 'workflows'] });

  const webPreferences = await app.evaluate(({ BrowserWindow }) => {
    // Present at runtime but missing from Electron 44's type definitions.
    const contents = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.webContents as unknown as { getLastWebPreferences(): Electron.WebPreferences } | undefined;
    const prefs = contents?.getLastWebPreferences();
    return { contextIsolation: prefs?.contextIsolation, nodeIntegration: prefs?.nodeIntegration, sandbox: prefs?.sandbox };
  });
  expect(webPreferences).toEqual({ contextIsolation: true, nodeIntegration: false, sandbox: true });
  await app.close();
});

test('production build ships a strict content security policy', async () => {
  const { app, page } = await launchApp();
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("script-src 'self';");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  await app.close();
});

test('navigation away from the app and new windows are blocked', async () => {
  const { app, page } = await launchApp();
  const before = page.url();
  await page.evaluate(() => {
    window.location.href = 'https://example.com/';
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => window.open('https://example.com/') === null)).toBe(true);
  expect(app.windows().filter((window) => !window.url().includes('companion=hud'))).toHaveLength(1);
  await app.close();
});

test('the main process rejects invalid IPC payloads', async () => {
  const { app, page } = await launchApp();
  const outcome = await page.evaluate(() =>
    window.neuralbridge.theme.set('neon' as never).then(
      () => 'accepted',
      (error: unknown) => String(error),
    ),
  );
  expect(outcome).toMatch(/Invalid payload/);
  await app.close();
});

test('settings show the app version, not the Electron version', async () => {
  const { app, page } = await launchApp();
  await page.getByRole('link', { name: 'Configurações', exact: true }).click();
  const about = page.getByRole('region', { name: 'Sobre' });
  await expect(about.getByText(APP_VERSION, { exact: true })).toBeVisible();
  await app.close();
});

test('the chosen theme applies immediately and survives a restart', async () => {
  const first = await launchApp();
  const background = () => first.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // Singularity tokens (lote 50.02): petrol #041417 in dark, parchment #f3f0e7 in light.
  expect(await background()).toBe('rgb(4, 20, 23)');

  await first.page.getByRole('link', { name: 'Configurações', exact: true }).click();
  await first.page.getByRole('radio', { name: 'Claro' }).click();
  await expect.poll(background).toBe('rgb(243, 240, 231)');
  await first.app.close();

  const second = await launchApp(first.dataDir);
  await expect.poll(() => second.page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(243, 240, 231)');
  await second.page.getByRole('link', { name: 'Configurações', exact: true }).click();
  await expect(second.page.getByRole('radio', { name: 'Claro' })).toBeChecked();
  await second.app.close();
});

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

function manifest(version: string, options: { id?: string; minCoreVersion?: string; marker?: string } = {}) {
  const files: Array<[string, string]> = [['main.js', 'export default {}']];
  if (options.marker) files.push(['marker.txt', options.marker]);
  const checksum = createHash('sha256').update(files.map(([path, content]) => `${path}\0${content}`).join('')).digest('hex');
  return { schemaVersion: 1, id: options.id ?? 'neura', name: 'Neura', version, minCoreVersion: options.minCoreVersion ?? '0.1.0', capabilities: ['navigation'], permissions: ['tasks.read'], entrypoints: { main: 'main.js', ...(options.marker ? { renderer: 'marker.txt' } : {}) }, checksum: `sha256:${checksum}`, signature: { algorithm: 'sha256', value: checksum }, updateChannel: 'local' };
}

function writeExtension(version: string, options: { id?: string; minCoreVersion?: string; marker?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'neuralbridge-e2e-extension-'));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'extension.json'), JSON.stringify(manifest(version, options)));
  writeFileSync(join(root, 'main.js'), 'export default {}');
  if (options.marker) writeFileSync(join(root, 'marker.txt'), options.marker);
  return root;
}

test('installs, disables, updates and rolls back a local extension through the preload seam', async () => {
  const first = writeExtension('1.0.0');
  const second = writeExtension('1.1.0');
  const { app, page } = await launchApp();
  const result = await page.evaluate(async ({ firstPath, secondPath }) => {
    const installed = await window.neuralbridge.extensions.install(firstPath);
    const disabled = await window.neuralbridge.extensions.disable(installed.manifest.id);
    const updated = await window.neuralbridge.extensions.update(secondPath);
    const rolledBack = await window.neuralbridge.extensions.rollback(updated.manifest.id);
    return { installed: installed.manifest.version, disabled: disabled.state, updated: updated.manifest.version, rolledBack: rolledBack.manifest.version };
  }, { firstPath: first, secondPath: second });
  expect(result).toEqual({ installed: '1.0.0', disabled: 'disabled', updated: '1.1.0', rolledBack: '1.0.0' });
  await app.close();
});

test('keeps Neura and Velix absent by default and rejects incompatible Core packages', async () => {
  const incompatible = writeExtension('9.0.0', { id: 'velix', minCoreVersion: '99.0.0', marker: 'must-not-install' });
  const { app, page } = await launchApp(undefined, { freshInstall: true });
  try {
    const before = await page.evaluate(() => window.neuralbridge.extensions.list());
    expect(before.map((item) => item.manifest.id)).not.toEqual(expect.arrayContaining(['neura', 'velix']));
    expect(before.find((item) => item.manifest.id === 'companion')?.state).toBe('disabled');
    expect(before.find((item) => item.manifest.id === 'spotify')?.state).toBe('enabled');
    await page.evaluate(() => { window.location.hash = '#/video'; });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Aethera indisponível', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir Extensões', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Renderizar MP4' })).toHaveCount(0);
    await expect(page.evaluate((path) => window.neuralbridge.extensions.install(path), incompatible)).rejects.toThrow(/compat|versão|Core/i);
    const after = await page.evaluate(() => window.neuralbridge.extensions.list());
    expect(after.map((item) => item.manifest.id)).toEqual(expect.arrayContaining(['companion', 'spotify']));
  } finally { await app.close(); }
});

test('enables and disables Companion independently of Spotify on a new install', async () => {
  const { app, page } = await launchApp(undefined, { freshInstall: true });
  try {
    await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.extensions.list())).find((item) => item.manifest.id === 'companion')?.state).toBe('disabled');
    expect(app.windows().some((window) => window.url().includes('companion=hud'))).toBe(false);
    await page.evaluate(() => window.neuralbridge.extensions.enable('companion'));
    await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.extensions.list())).find((item) => item.manifest.id === 'companion')?.state).toBe('enabled');
    await expect.poll(() => app.windows().some((window) => window.url().includes('companion=hud'))).toBe(true);
    expect((await page.evaluate(() => window.neuralbridge.extensions.list())).find((item) => item.manifest.id === 'spotify')?.state).toBe('enabled');
    await page.evaluate(() => window.neuralbridge.extensions.disable('companion'));
    await expect.poll(() => app.windows().some((window) => window.url().includes('companion=hud'))).toBe(false);
    expect((await page.evaluate(() => window.neuralbridge.extensions.list())).find((item) => item.manifest.id === 'spotify')?.state).toBe('enabled');
  } finally { await app.close(); }
});

test('opens the deep link with an explicit disabled-extension state', async () => {
  const source = writeExtension('1.0.0', { id: 'velix' });
  const { app, page } = await launchApp();
  try {
    const installed = await page.evaluate((path) => window.neuralbridge.extensions.install(path), source);
    await page.evaluate((id) => window.neuralbridge.extensions.disable(id), installed.manifest.id);
    await page.reload();
    await page.evaluate(() => { window.location.hash = '#/video'; });
    await expect(page.getByRole('heading', { name: 'Aethera indisponível', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir Extensões', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Renderizar MP4' })).toHaveCount(0);
  } finally { await app.close(); }
});

test('opens the Velix flow through the deep link only after explicit installation and enablement', async () => {
  const source = writeExtension('1.0.0', { id: 'velix' });
  const { app, page } = await launchApp();
  try {
    await page.evaluate((path) => window.neuralbridge.extensions.install(path), source);
    await page.reload();
    await page.evaluate(() => { window.location.hash = '#/video'; });
    await expect(page.getByRole('heading', { name: 'Aethera', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Render direto' })).toBeVisible();
    // AET-02: the stored manifest keeps its old name; the screen shows the new identity by extension id.
    await page.evaluate(() => { window.location.hash = '#/extensions'; });
    await expect(page.getByRole('heading', { name: 'Aethera', level: 3 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Aethera', exact: true })).toBeVisible();
  } finally { await app.close(); }
});

test('preserves extension payload data across update and rollback', async () => {
  const first = writeExtension('1.0.0', { marker: 'durable-v1' });
  const second = writeExtension('1.1.0', { marker: 'durable-v2' });
  const { app, page, dataDir } = await launchApp();
  try {
    const installed = await page.evaluate((path) => window.neuralbridge.extensions.install(path), first);
    const updated = await page.evaluate((path) => window.neuralbridge.extensions.update(path), second);
    const rolledBack = await page.evaluate((id) => window.neuralbridge.extensions.rollback(id), installed.manifest.id);
    expect(updated.manifest.version).toBe('1.1.0');
    expect(rolledBack.manifest.version).toBe('1.0.0');
    expect(readFileSync(join(dataDir, 'extensions', 'neura', '1.0.0', 'marker.txt'), 'utf8')).toBe('durable-v1');
    expect(existsSync(join(dataDir, 'extensions', 'neura', '1.1.0', 'marker.txt'))).toBe(true);
  } finally { await app.close(); }
});

test('installs the shipped Aethera package from the Extensions screen and shows it in the menu', async () => {
  // The folder `npm run extension:pack -- velix` produces: the manifest plus only its entrypoint.
  const source = join(import.meta.dirname, '../../packages/extensions-velix');
  const root = mkdtempSync(join(tmpdir(), 'neuralbridge-e2e-aethera-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'extension.json'), readFileSync(join(source, 'extension.json')));
  writeFileSync(join(root, 'src', 'index.ts'), readFileSync(join(source, 'src', 'index.ts')));
  const { app, page } = await launchApp();
  await expect(page.getByRole('link', { name: 'Aethera', exact: true })).toHaveCount(0);
  await page.goto(`${page.url().split('#')[0]}#/extensions`);
  await page.getByLabel('Pasta da extensão').fill(root);
  await page.getByRole('region', { name: 'Adicionar uma extensão local' }).getByRole('button', { name: 'Instalar', exact: true }).click();
  await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.extensions.list())).find((item) => item.manifest.id === 'velix')?.manifest.name).toBe('Aethera');
  const installed = (await page.evaluate(() => window.neuralbridge.extensions.list())).find((item) => item.manifest.id === 'velix');
  if (installed?.state !== 'enabled') await page.evaluate(() => window.neuralbridge.extensions.enable('velix'));
  await expect(page.getByRole('link', { name: 'Aethera', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Aethera', exact: true })).toBeVisible();
  await app.close();
});

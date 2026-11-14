import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { SPOTIFY_REDIRECT_URI } from '@neuralbridge/shared/spotify';
import { launchApp } from './app';

// The real Electron app against a local stand-in for accounts.spotify.com and api.spotify.com. It proves the app's side
// of the protocol, including PKCE, but says nothing about how Spotify itself answers.

const CLIENT_ID = 'c'.repeat(32);
// A 1x1 orange PNG, so the cover goes through the real fetch and data URL path.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

interface FakeSpotify {
  server: Server; base: string; host: string; requests: string[];
  player: { isPlaying: boolean; trackId: string; name: string; volume: number };
  grantedScope: string; verified: boolean;
}

function startFake(): Promise<FakeSpotify> {
  const fake: FakeSpotify = { server: null as unknown as Server, base: '', host: '', requests: [], player: { isPlaying: true, trackId: 'track-1', name: 'Primeira faixa', volume: 40 }, grantedScope: '', verified: false };
  let challenge = '';
  fake.server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', fake.base);
    fake.requests.push(`${request.method} ${url.pathname}`);
    const send = (status: number, body?: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(body === undefined ? undefined : JSON.stringify(body)); };
    if (url.pathname === '/image.png') { response.writeHead(200, { 'content-type': 'image/png' }); response.end(PIXEL); return; }
    if (url.pathname === '/api/token') {
      let body = '';
      request.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      request.on('end', () => {
        const form = new URLSearchParams(body);
        if (form.get('grant_type') === 'authorization_code') {
          fake.verified = form.get('client_id') === CLIENT_ID && !form.has('client_secret') && form.get('redirect_uri') === SPOTIFY_REDIRECT_URI && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === challenge;
          if (!fake.verified) { send(400, { error: 'invalid_grant' }); return; }
        }
        send(200, { access_token: 'fake-access', refresh_token: 'fake-refresh-secret', expires_in: 3600, scope: fake.grantedScope });
      });
      return;
    }
    if (request.headers.authorization !== 'Bearer fake-access') { send(401, {}); return; }
    if (url.pathname === '/v1/me/player' && request.method === 'GET') {
      send(200, { is_playing: fake.player.isPlaying, progress_ms: 30_000, device: { name: 'Computador de teste', volume_percent: fake.player.volume, supports_volume: true, is_restricted: false }, actions: { disallows: {} }, item: { id: fake.player.trackId, name: fake.player.name, duration_ms: 200_000, artists: [{ name: 'Artista de teste' }], album: { images: [{ url: `${fake.base}/image.png`, width: 300 }] }, external_urls: { spotify: `https://open.spotify.com/track/${fake.player.trackId}` } } });
      return;
    }
    if (url.pathname === '/v1/me/player/pause') fake.player.isPlaying = false;
    if (url.pathname === '/v1/me/player/play') fake.player.isPlaying = true;
    if (url.pathname === '/v1/me/player/next') { fake.player.trackId = 'track-2'; fake.player.name = 'Segunda faixa'; }
    if (url.pathname === '/v1/me/player/volume') fake.player.volume = Number(url.searchParams.get('volume_percent'));
    send(204);
  });
  return new Promise((done) => fake.server.listen(0, '127.0.0.1', () => {
    const { port } = fake.server.address() as AddressInfo;
    fake.base = `http://127.0.0.1:${port}`;
    fake.host = `127.0.0.1:${port}`;
    challenge = '';
    fake.server.on('request', (request) => { const value = new URL(request.url ?? '/', fake.base).searchParams.get('code_challenge'); if (value) challenge = value; });
    done(fake);
  }));
}

/** Stands in for the browser: follows the authorize URL's redirect the way Spotify would after the user agrees. */
async function stubBrowser(app: ElectronApplication, fake: FakeSpotify): Promise<void> {
  await app.evaluate(({ shell }, fakeBase) => {
    const opened: string[] = [];
    (globalThis as unknown as { opened: string[] }).opened = opened;
    shell.openExternal = async (url: string) => {
      opened.push(url);
      if (!url.includes('/authorize')) return;
      const authorize = new URL(url);
      await fetch(`${fakeBase}/authorize${authorize.search}`).catch(() => undefined);
      await fetch(`${authorize.searchParams.get('redirect_uri') ?? ''}?code=fake-code&state=${encodeURIComponent(authorize.searchParams.get('state') ?? '')}`);
    };
  }, fake.base);
  fake.grantedScope = 'user-read-playback-state user-read-currently-playing user-modify-playback-state';
}

async function findHud(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((page) => page.url().includes('companion=hud'))).toBe(true);
  const hud = app.windows().find((page) => page.url().includes('companion=hud'));
  if (!hud) throw new Error('HUD window not found');
  await expect(hud.locator('[data-mascot-state]')).toBeVisible();
  return hud;
}

const env = (fake: FakeSpotify) => ({ NB_SPOTIFY_ACCOUNTS_URL: fake.base, NB_SPOTIFY_API_URL: fake.base, NB_SPOTIFY_IMAGE_HOST: fake.host });
const shot = (hud: Page, name: string) => hud.screenshot({ path: resolve(`artifacts/companion-hud-${name}.png`), omitBackground: true });

test('off by default: nothing on the network and no player in the HUD', async () => {
  const fake = await startFake();
  const { app, page } = await launchApp(undefined, { env: env(fake) });
  const hud = await findHud(app);
  await page.waitForTimeout(800);
  expect(fake.requests).toEqual([]);
  expect((await page.evaluate(() => window.neuralbridge.spotify.status())).connection).toBe('disabled');
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('button', { name: 'Recolher para o mascote' })).toBeVisible();
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByRole('heading', { name: 'Eventos recentes' })).toBeVisible();
  await expect(hud.getByRole('region', { name: 'Spotify' })).toHaveCount(0);
  await app.close();
  fake.server.close();
});

test('connects with PKCE from Settings, plays in all three modes and obeys real controls', async () => {
  test.setTimeout(60_000);
  const fake = await startFake();
  const { app, page, dataDir } = await launchApp(undefined, { env: env(fake) });
  const hud = await findHud(app);
  await stubBrowser(app, fake);

  await page.evaluate(() => { window.location.hash = '#/settings'; });
  // Settings has other "Salvar" buttons; the one that matters is the Spotify section's.
  const spotifySection = page.getByRole('region', { name: 'Spotify' });
  await page.getByRole('checkbox', { name: 'Ativar integração com o Spotify' }).click();
  await expect(page.getByRole('checkbox', { name: 'Ativar integração com o Spotify' })).toBeChecked();
  await page.getByLabel('Client ID').fill('curto');
  await expect(spotifySection.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  await page.getByLabel('Client ID').fill(CLIENT_ID);
  await spotifySection.getByRole('button', { name: 'Salvar' }).click();
  await page.getByRole('checkbox', { name: 'Permitir controlar a reprodução pelo Companion' }).click();
  await expect(page.getByRole('checkbox', { name: 'Permitir controlar a reprodução pelo Companion' })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Conectar', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Conectar', exact: true }).click();
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
  expect(fake.verified).toBe(true);

  // The renderer never holds a token, and neither does any readable file.
  const status = await page.evaluate(() => window.neuralbridge.spotify.status());
  expect(JSON.stringify(status)).not.toContain('fake-refresh-secret');
  expect(JSON.stringify(status)).not.toContain('fake-access');
  for (const name of readdirSync(dataDir)) if (/spotify|preferences/.test(name)) expect(readFileSync(join(dataDir, name)).toString('latin1')).not.toContain('fake-refresh-secret');

  await expect(hud.locator('[data-mascot-state]')).toHaveAttribute('data-mascot-state', 'listening', { timeout: 10_000 });
  await hud.waitForTimeout(450);
  await shot(hud, 'state-listening');
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  await expect(hud.getByText('Primeira faixa')).toBeVisible();
  await expect(hud.getByText('Artista de teste')).toBeVisible();
  await hud.waitForTimeout(320);
  await shot(hud, 'capsule-spotify');
  await hud.getByRole('button', { name: 'Expandir Companion' }).click();
  const player = hud.getByRole('region', { name: 'Spotify' });
  await expect(player).toBeVisible();
  await expect(player.getByRole('progressbar', { name: 'Progresso da faixa' })).toBeVisible();
  await expect.poll(() => player.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
  await hud.waitForTimeout(320);
  await shot(hud, 'expanded-spotify');

  const marked = () => hud.evaluate(() => { const memo = window as unknown as { nodes: Element[] }; return memo.nodes.every((node) => node.isConnected); });
  await hud.evaluate(() => { (window as unknown as { nodes: Element[] }).nodes = [document.querySelector('.companion-player'), document.querySelector('.companion-player__volume input')].filter((node): node is Element => node !== null); });
  await player.getByRole('button', { name: 'Próxima faixa' }).click();
  await expect(player.getByText('Segunda faixa')).toBeVisible({ timeout: 10_000 });
  await expect(player.getByText('Primeira faixa')).toHaveCount(0);
  await expect(hud.locator('.companion-player__art img')).toHaveCount(1);
  expect(await marked()).toBe(true);
  fake.player.volume = 70;
  // The service polls every 5 s while playing and every 15 s when idle (spotify/service.ts), so wait past one idle poll.
  await expect.poll(() => hud.locator('.companion-player__volume input').inputValue(), { timeout: 20_000 }).toBe('70');
  expect(await marked()).toBe(true);
  await player.getByRole('button', { name: 'Pausar' }).click();
  await expect(player.getByRole('button', { name: 'Tocar' })).toBeVisible({ timeout: 10_000 });
  await expect(hud.locator('[data-mascot-state]')).toHaveAttribute('data-mascot-state', 'musicPaused');
  await hud.waitForTimeout(200);
  await shot(hud, 'expanded-spotify-paused');

  await player.getByRole('button', { name: 'Abrir no Spotify' }).click();
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened.at(-1))).toBe('https://open.spotify.com/track/track-2');
  await app.close();

  // Connected across a restart: the encrypted tokens are read back, with no new browser step.
  const second = await launchApp(dataDir, { env: env(fake) });
  await findHud(second.app);
  await expect.poll(async () => (await second.page.evaluate(() => window.neuralbridge.spotify.status())).connection).toBe('connected');

  await second.page.evaluate(() => window.neuralbridge.spotify.disconnect());
  const seen = fake.requests.length;
  await second.page.waitForTimeout(1_000);
  expect(fake.requests.length).toBe(seen);
  await second.app.close();
  fake.server.close();
});

test('hiding the HUD stops the polling', async () => {
  const fake = await startFake();
  const { app, page } = await launchApp(undefined, { env: env(fake) });
  await findHud(app);
  await stubBrowser(app, fake);
  await page.evaluate((clientId) => window.neuralbridge.spotify.configure({ enabled: true, clientId }), CLIENT_ID);
  await page.evaluate(() => window.neuralbridge.spotify.connect());
  await expect.poll(() => fake.requests.filter((request) => request === 'GET /v1/me/player').length).toBeGreaterThan(0);
  await page.evaluate(() => window.neuralbridge.companion.setHudVisibility(false));
  await page.waitForTimeout(300);
  const seen = fake.requests.length;
  await page.waitForTimeout(6_000);
  expect(fake.requests.length).toBe(seen);
  await app.close();
  fake.server.close();
});

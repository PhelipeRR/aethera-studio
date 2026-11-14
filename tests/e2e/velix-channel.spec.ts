import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';
import { velixDataDir } from './velix-extension';

// The real Electron app against a local stand-in for Google OAuth and the YouTube Data/upload APIs. It proves the app's
// side of the protocol (PKCE, incremental scope, resumable upload, approval before every write, agenda after a restart),
// not how YouTube itself answers: that is the private-upload homologation of 47.8.

const READ = 'https://www.googleapis.com/auth/youtube.readonly';
const WRITE = 'https://www.googleapis.com/auth/youtube';
const SECRETS = ['fake-client-secret', 'fake-access-secret', 'fake-refresh-secret'];
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

interface FakeVideo { id: string; title: string; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null; }
interface FakeYouTube {
  server: Server; base: string; writes: string[]; scope: string; challenge: string; verified: boolean; issued: number;
  failure: 'quota' | 'drop' | 'stall' | null; stalledClosed: boolean; revokes: string[]; revokeStatus: number; bannerUpload: Buffer | null; watermarkUpload: string | null;
  branding: unknown; videos: FakeVideo[]; uploadRanges: string[]; thumbnails: number; pendingMetadata: { snippet?: { title?: string }; status?: { privacyStatus?: FakeVideo['privacy']; publishAt?: string } } | null;
}

const body = (request: IncomingMessage) => new Promise<Buffer>((done) => { const chunks: Buffer[] = []; request.on('data', (chunk: Buffer) => chunks.push(chunk)); request.on('end', () => done(Buffer.concat(chunks))); });

function startFake(): Promise<FakeYouTube> {
  const fake: FakeYouTube = { server: null as unknown as Server, base: '', writes: [], scope: '', challenge: '', verified: false, issued: 0, failure: null, stalledClosed: false, revokes: [], revokeStatus: 200, bannerUpload: null, watermarkUpload: null, branding: { channel: { description: 'Descrição existente', keywords: 'ciência tecnologia' } }, videos: [], uploadRanges: [], thumbnails: 0, pendingMetadata: null };
  fake.server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', fake.base);
      const payload = await body(request);
      const send = (status: number, value?: unknown, headers: Record<string, string> = {}) => { response.writeHead(status, { 'content-type': 'application/json', ...headers }); response.end(value === undefined ? undefined : JSON.stringify(value)); };
      if (url.pathname === '/authorize') { fake.scope = url.searchParams.get('scope') ?? ''; fake.challenge = url.searchParams.get('code_challenge') ?? ''; send(200, {}); return; }
      if (url.pathname === '/token') {
        const form = new URLSearchParams(payload.toString());
        if (form.get('grant_type') === 'authorization_code') {
          fake.verified = form.get('client_secret') === 'fake-client-secret' && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === fake.challenge;
          if (!fake.verified) { send(400, { error: 'invalid_grant' }); return; }
        }
        fake.issued += 1;
        send(200, { access_token: `fake-access-secret-${fake.issued}`, refresh_token: 'fake-refresh-secret', expires_in: 3600, scope: fake.scope, token_type: 'Bearer' });
        return;
      }
      if (url.pathname === '/revoke') { fake.revokes.push(new URLSearchParams(payload.toString()).get('token') ?? ''); send(fake.revokeStatus, {}); return; }
      if (!request.headers.authorization?.startsWith('Bearer fake-access-secret-')) { send(401, {}); return; }
      const write = request.method !== 'GET';
      if (write) {
        fake.writes.push(`${request.method} ${url.pathname}`);
        if (!fake.scope.split(' ').includes(WRITE)) { send(403, { error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } }); return; }
      }
      if (url.pathname === '/youtube/v3/channels' && request.method === 'GET') { send(200, { kind: 'youtube#channelListResponse', etag: 'e', items: [{ kind: 'youtube#channel', etag: 'e', id: 'UCfake', snippet: { title: 'Canal de Teste', customUrl: '@canaldeteste' }, brandingSettings: fake.branding }] }); return; }
      if (url.pathname === '/youtube/v3/channels' && request.method === 'PUT') { fake.branding = (JSON.parse(payload.toString()) as { brandingSettings: unknown }).brandingSettings; send(200, {}); return; }
      if (url.pathname === '/upload/youtube/v3/videos' && request.method === 'POST' && url.searchParams.get('uploadType') === 'resumable' && !url.searchParams.has('upload_id')) {
        if (fake.failure === 'quota') { send(403, { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] } }); return; }
        if (fake.failure === 'drop') { request.socket.destroy(); return; }
        fake.pendingMetadata = JSON.parse(payload.toString()) as FakeYouTube['pendingMetadata'];
        send(200, {}, { location: `${fake.base}/upload/youtube/v3/videos?uploadType=resumable&upload_id=fake-session` });
        return;
      }
      if (url.pathname === '/upload/youtube/v3/videos' && request.method === 'PUT' && url.searchParams.get('upload_id') === 'fake-session') {
        // Holds the bytes without answering, like a stalled connection, until the client gives up.
        if (fake.failure === 'stall') { response.on('close', () => { fake.stalledClosed = true; }); return; }
        const range = request.headers['content-range'] ?? '';
        fake.uploadRanges.push(range);
        // The first PUT is only half received, as after a dropped connection; the client must continue from there.
        if (fake.uploadRanges.length === 1) { const half = Math.floor(payload.byteLength / 2); response.writeHead(308, { range: `bytes=0-${half - 1}` }); response.end(); return; }
        const video: FakeVideo = { id: 'fake-video-1', title: fake.pendingMetadata?.snippet?.title ?? '', privacy: fake.pendingMetadata?.status?.privacyStatus ?? 'private', publishAt: fake.pendingMetadata?.status?.publishAt ?? null };
        fake.videos.push(video);
        send(200, { id: video.id });
        return;
      }
      if (url.pathname === '/upload/youtube/v3/channelBanners/insert' && request.method === 'POST') { fake.bannerUpload = payload; send(200, { kind: 'youtube#channelBannerResource', url: 'https://yt3.googleusercontent.com/fake-banner' }); return; }
      if (url.pathname === '/upload/youtube/v3/watermarks/set' && request.method === 'POST' && url.searchParams.get('channelId') === 'UCfake') { fake.watermarkUpload = payload.toString('latin1'); send(204); return; }
      if (url.pathname === '/upload/youtube/v3/thumbnails/set' && request.method === 'POST') { fake.thumbnails += 1; send(200, {}); return; }
      if (url.pathname === '/youtube/v3/search' && url.searchParams.get('forMine') === 'true') { send(200, { items: fake.videos.map((video) => ({ id: { videoId: video.id }, snippet: { title: video.title } })) }); return; }
      if (url.pathname === '/youtube/v3/videos' && request.method === 'GET') { const ids = (url.searchParams.get('id') ?? '').split(','); send(200, { items: fake.videos.filter((video) => ids.includes(video.id)).map((video) => ({ id: video.id, snippet: { title: video.title }, status: { privacyStatus: video.privacy, publishAt: video.publishAt } })) }); return; }
      if (url.pathname === '/youtube/v3/videos' && request.method === 'PUT') { const update = JSON.parse(payload.toString()) as { id: string; status: { publishAt?: string | null } }; const video = fake.videos.find((item) => item.id === update.id); if (!video) { send(404, {}); return; } video.publishAt = update.status.publishAt ?? null; send(200, {}); return; }
      send(404, { error: `rota falsa ausente: ${request.method} ${url.pathname}` });
    })();
  });
  return new Promise((done) => fake.server.listen(0, '127.0.0.1', () => { fake.base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`; done(fake); }));
}

function freePort(): Promise<number> {
  return new Promise((done) => { const probe = createServer(); probe.listen(0, '127.0.0.1', () => { const { port } = probe.address() as AddressInfo; probe.close(() => done(port)); }); });
}

/** Stands in for the file pickers, the system browser (Google redirects back after consent) and the native approval dialog. */
async function stubDesktop(app: ElectronApplication, fake: FakeYouTube, clientFile: string, saveDir: string): Promise<void> {
  await app.evaluate(({ dialog, shell }, input) => {
    const state = globalThis as unknown as { approve: boolean; approvals: string[] };
    state.approve = false; state.approvals = [];
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [input.clientFile] })) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async (...args: unknown[]) => { const options = (args.length > 1 ? args[1] : args[0]) as { defaultPath?: string }; const name = (options.defaultPath ?? 'arquivo').split(/[\\/]/u).pop() ?? 'arquivo'; return { canceled: false, filePath: `${input.saveDir}/${name}` }; }) as typeof dialog.showSaveDialog;
    dialog.showMessageBox = (async (...args: unknown[]) => { const options = (args.length > 1 ? args[1] : args[0]) as { message: string; detail?: string }; state.approvals.push(`${options.message}\n${options.detail ?? ''}`); return { response: state.approve ? 1 : 0, checkboxChecked: false }; }) as typeof dialog.showMessageBox;
    shell.openExternal = async (url: string) => {
      const authorize = new URL(url);
      if (!url.startsWith(`${input.base}/authorize`)) return;
      await fetch(`${input.base}/authorize${authorize.search}`);
      await fetch(`${authorize.searchParams.get('redirect_uri') ?? ''}?code=fake-code&state=${encodeURIComponent(authorize.searchParams.get('state') ?? '')}`);
    };
  }, { base: fake.base, clientFile, saveDir });
}

const setApproval = (app: ElectronApplication, approve: boolean) => app.evaluate((_electron, value) => { (globalThis as unknown as { approve: boolean }).approve = value; }, approve);
const approvals = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { approvals: string[] }).approvals.slice());

const env = (fake: FakeYouTube) => ({ ...FAKE_AGENTS, NB_YOUTUBE_CHANNEL_API_URL: `${fake.base}/youtube/v3`, NB_YOUTUBE_UPLOAD_URL: `${fake.base}/upload/youtube/v3`, NB_GOOGLE_REVOKE_URL: `${fake.base}/revoke` });

type Panel = ReturnType<Page['getByRole']>;
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(`artifacts/velix-channel-${name}.png`), fullPage: true });
async function openChannel(page: Page, projectId: string): Promise<Panel> {
  await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), projectId);
  await page.evaluate(() => { window.location.hash = '#/video'; });
  await page.getByRole('tab', { name: 'Canal', exact: true }).click();
  return page.getByRole('region', { name: 'Canal Aethera' });
}
const openTab = (panel: Panel, name: 'Publicar vídeo' | 'Calendário' | 'Identidade visual' | 'Configuração') => panel.getByRole('tablist', { name: 'Áreas do Canal' }).getByRole('tab', { name }).click();

const localInput = (date: Date) => { const pad = (value: number) => String(value).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; };

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => { const path = join(root, name); return statSync(path).isDirectory() ? filesUnder(path) : [path]; });
}

function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): { width: number; height: number } {
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  let offset = 2;
  while (offset + 9 < bytes.byteLength) {
    const marker = bytes[offset + 1] ?? 0;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error('JPEG sem quadro');
}

function setup(fake: FakeYouTube, port: number) {
  const outside = mkdtempSync(join(tmpdir(), 'nb-e2e-client-'));
  const clientFile = join(outside, 'client_secret.json');
  writeFileSync(clientFile, JSON.stringify({ installed: { client_id: 'fake-client.apps.googleusercontent.com', client_secret: 'fake-client-secret', auth_uri: `${fake.base}/authorize`, token_uri: `${fake.base}/token`, redirect_uris: [`http://127.0.0.1:${port}/callback`] } }));
  const saveDir = mkdtempSync(join(tmpdir(), 'nb-e2e-saved-'));
  const dataDir = velixDataDir();
  const root = join(dataDir, 'Video'); mkdirSync(join(root, 'renders'), { recursive: true }); mkdirSync(join(root, 'channel-assets'), { recursive: true });
  return { clientFile, saveDir, dataDir, root };
}

async function connectForReading(panel: Panel) {
  await openTab(panel, 'Configuração');
  await panel.getByRole('button', { name: 'Importar client_secret.json' }).click();
  await expect(panel).toContainText('configurado (fake-client.apps.googleusercontent.com)');
  await panel.getByRole('button', { name: 'Conectar YouTube' }).click();
  await expect(panel).toContainText('conectado só para leitura');
}

test('canal: sub-abas, prévias e salvar no PC; escopo incremental, branding e envio agendado só com aprovação, com progresso, e a agenda sobrevive ao reinício', async () => {
  test.setTimeout(150_000);
  const fake = await startFake();
  const { clientFile, saveDir, dataDir, root } = setup(fake, await freePort());
  const mp4 = Buffer.alloc(64 * 1024, 7);
  writeFileSync(join(root, 'renders', 'video.mp4'), mp4);
  writeFileSync(join(root, 'renders', 'video.mp4.part.mp4'), 'intermediário');
  writeFileSync(join(root, 'channel-assets', 'thumb.png'), PIXEL);

  const { app, page } = await launchApp(dataDir, { env: env(fake) });
  await stubDesktop(app, fake, clientFile, saveDir);
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  const panel = await openChannel(page, project.id);

  // Not connected yet: the tab opens on Configuração.
  await expect(panel.getByRole('tab', { name: 'Configuração' })).toHaveAttribute('aria-selected', 'true');
  await connectForReading(panel);
  expect(fake.verified).toBe(true);
  expect(fake.scope).toBe(READ);
  await expect(panel).toContainText('Canal de Teste');

  // Publicar vídeo: the Velix MP4s are listed (not the intermediate file), previewed and saved to the PC.
  await openTab(panel, 'Publicar vídeo');
  const videos = panel.getByRole('region', { name: 'Vídeos do Aethera' });
  await expect(videos.getByRole('button', { name: /^Selecionar / })).toHaveCount(1);
  await videos.getByRole('button', { name: 'Selecionar renders/video.mp4' }).click();
  await expect(panel.getByLabel('Prévia de renders/video.mp4')).toHaveAttribute('src', /^data:video\/mp4;base64,/);
  await panel.getByRole('button', { name: 'Salvar no PC' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Vídeo salvo no computador.' })).toBeVisible();
  expect(readFileSync(join(saveDir, 'video.mp4')).equals(mp4)).toBe(true);
  await panel.getByLabel('Título da publicação').fill('Vídeo de teste');
  await expect(panel.getByRole('note').filter({ hasText: 'autorize o envio' })).toBeVisible();
  await expect(panel.getByRole('note').filter({ hasText: 'aprove uma identidade visual' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Enviar publicação' })).toBeDisabled();
  await shot(page, 'publicar');

  // Widen the grant only when writing is wanted.
  await openTab(panel, 'Configuração');
  await panel.getByRole('button', { name: 'Permitir envio e edição' }).click();
  await expect(panel).toContainText('conectado, com envio e edição');
  expect(fake.scope.split(' ')).toEqual([READ, WRITE]);

  // Identidade visual: pick a direction, edit it, see every piece and save one as a real PNG at YouTube's size.
  await openTab(panel, 'Identidade visual');
  await panel.getByLabel('Nicho da identidade').fill('ciência e tecnologia');
  await panel.getByRole('button', { name: 'Gerar direções' }).click();
  await panel.locator('button[aria-pressed]').first().click();
  await expect(panel.getByLabel('Nome do canal na identidade')).toHaveValue('Canal de Teste');
  await panel.getByLabel('Tagline da identidade').fill('Ferramentas & automação');
  for (const alt of ['Prévia do banner 2560×1440', 'Prévia da foto de perfil', "Prévia da marca d'água", 'Prévia do logo', 'Prévia do logo para fundo claro', 'Prévia da thumbnail base']) await expect(panel.getByAltText(alt, { exact: true })).toBeVisible();
  expect(decodeURIComponent((await panel.getByAltText('Prévia do banner 2560×1440').getAttribute('src')) ?? '')).toContain('Ferramentas &amp; automação');
  await shot(page, 'identidade');
  await panel.getByRole('button', { name: 'Salvar Banner em PNG no PC' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'PNG salvo.' })).toBeVisible();
  expect(pngSize(join(saveDir, 'banner-2560x1440.png'))).toEqual({ width: 2560, height: 1440 });
  await panel.getByRole('button', { name: 'Aprovar e salvar identidade' }).click();
  await expect(panel).toContainText('Identidade aprovada: Canal de Teste');
  for (const kind of ['banner', 'avatar', 'logo', 'watermark', 'thumbnail']) expect(readFileSync(join(root, 'channel-assets', `${kind}.svg`), 'utf8')).toContain('<svg');

  // Branding: refused on the native dialog → nothing reaches YouTube; approved → the whole brandingSettings goes.
  await openTab(panel, 'Configuração');
  await panel.getByText('Avançado: branding do canal (JSON)').click();
  await panel.getByLabel('Branding do canal').fill(JSON.stringify({ channel: { description: 'Descrição existente', keywords: 'ciência tecnologia' }, watermark: { position: 'bottom-right' } }));
  await setApproval(app, false);
  await panel.getByRole('button', { name: 'Aplicar branding com aprovação' }).click();
  await expect(panel.getByRole('alert').filter({ hasText: 'não foi aprovada' })).toBeVisible();
  expect(fake.writes).toEqual([]);
  await setApproval(app, true);
  await panel.getByRole('button', { name: 'Aplicar branding com aprovação' }).click();
  await expect.poll(() => fake.writes).toEqual(['PUT /youtube/v3/channels']);
  expect(fake.branding).toMatchObject({ channel: { description: 'Descrição existente', keywords: 'ciência tecnologia' } });
  expect((await approvals(app)).at(-1)).toContain('substitui o brandingSettings inteiro');

  // Publish scheduled with a thumbnail: the dialog shows what is sent; the upload survives a half-received PUT; the bar ends at 100%.
  await openTab(panel, 'Publicar vídeo');
  await panel.getByRole('button', { name: 'Selecionar renders/video.mp4' }).click();
  await panel.getByLabel('Título da publicação').fill('Vídeo de teste');
  const publishAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); publishAt.setSeconds(0, 0);
  // Thumbnail generated in the approved identity with the video's title, then used in this publication.
  const thumbnailMaker = panel.getByRole('region', { name: 'Gerador de thumbnail' });
  // The headline wraps over lines, so the words are checked one by one.
  const thumbnailSvg = decodeURIComponent((await thumbnailMaker.getByAltText('Prévia da thumbnail do vídeo').getAttribute('src')) ?? '');
  for (const word of ['Vídeo', 'teste']) expect(thumbnailSvg).toContain(word);
  await thumbnailMaker.getByRole('button', { name: 'Usar nesta publicação' }).click();
  await expect(thumbnailMaker.getByRole('status').filter({ hasText: 'Thumbnail pronta' })).toBeVisible();
  await thumbnailMaker.screenshot({ path: resolve('artifacts/velix-channel-thumbnail.png') });
  const thumbnailPath = await panel.getByLabel('Thumbnail da publicação').inputValue();
  expect(thumbnailPath).toMatch(/^channel-assets\/thumbnails\/video-de-teste-[a-z0-9]+\.jpg$/u);
  expect(jpegSize(readFileSync(join(root, ...thumbnailPath.split('/'))))).toEqual({ width: 1280, height: 720 });
  await panel.getByLabel('Data de publicação').fill(localInput(publishAt));
  await setApproval(app, false);
  await panel.getByRole('button', { name: 'Enviar e agendar' }).click();
  await expect(panel.getByRole('alert').filter({ hasText: 'não foi aprovada' })).toBeVisible();
  expect(fake.writes).toEqual(['PUT /youtube/v3/channels']);
  await setApproval(app, true);
  await panel.getByRole('button', { name: 'Enviar e agendar' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Enviado · 100%' })).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('progressbar', { name: /^Envio para o YouTube/ })).toHaveAttribute('aria-valuenow', '100');
  const lastApproval = (await approvals(app)).at(-1) ?? '';
  expect(lastApproval).toContain('Título: Vídeo de teste');
  expect(lastApproval).toContain('Privacidade: private');
  expect(fake.uploadRanges).toEqual([`bytes 0-${mp4.byteLength - 1}/${mp4.byteLength}`, `bytes ${mp4.byteLength / 2}-${mp4.byteLength - 1}/${mp4.byteLength}`]);
  expect(fake.thumbnails).toBe(1);
  expect(fake.videos).toEqual([{ id: 'fake-video-1', title: 'Vídeo de teste', privacy: 'private', publishAt: publishAt.toISOString() }]);

  // Calendário: the scheduled video shows; rescheduling asks again, once.
  await openTab(panel, 'Calendário');
  const agenda = panel.getByRole('region', { name: 'Agenda do canal' });
  await expect(agenda.getByLabel('Nova data de Vídeo de teste')).toBeVisible();
  const moved = new Date(publishAt.getTime() + 24 * 60 * 60 * 1000);
  const promptsBefore = (await approvals(app)).length;
  await agenda.getByLabel('Nova data de Vídeo de teste').fill(localInput(moved));
  await agenda.getByRole('button', { name: 'Reagendar' }).click();
  await expect.poll(() => fake.videos[0]?.publishAt).toBe(moved.toISOString());
  expect((await approvals(app)).length).toBe(promptsBefore + 1);
  await shot(page, 'calendario');

  // Identidade visual → evaluate and upload: banner and watermark go up with one approval; the banner is set on the channel.
  await openTab(panel, 'Identidade visual');
  const applyRegion = panel.getByRole('region', { name: 'Aplicar no canal' });
  await expect(applyRegion.getByRole('region', { name: 'Avaliação da identidade' })).toContainText('Leitura do texto');
  await expect(applyRegion.getByAltText('Banner novo')).toBeVisible();
  await applyRegion.screenshot({ path: resolve('artifacts/velix-channel-subir.png') });
  const writesBefore = fake.writes.length;
  await applyRegion.getByRole('button', { name: 'Subir para o YouTube (2 mudanças)' }).click();
  await expect(applyRegion.getByRole('status').filter({ hasText: 'Identidade aplicada no canal' })).toBeVisible({ timeout: 20_000 });
  await expect(applyRegion.getByRole('progressbar', { name: /^Aplicando no canal/ })).toHaveAttribute('aria-valuenow', '100');
  expect(fake.writes.slice(writesBefore)).toEqual(['POST /upload/youtube/v3/channelBanners/insert', 'POST /upload/youtube/v3/watermarks/set', 'PUT /youtube/v3/channels']);
  const bannerPng = fake.bannerUpload ?? Buffer.alloc(0);
  // Full-bleed art goes up as JPEG: its texture would pass YouTube's 6 MB limit as PNG.
  expect(jpegSize(bannerPng)).toEqual({ width: 2560, height: 1440 });
  expect(bannerPng.byteLength).toBeLessThan(6 * 1024 * 1024);
  expect(fake.watermarkUpload).toContain('"cornerPosition":"bottomRight"');
  expect(fake.watermarkUpload).toContain('\u0089PNG');
  expect(fake.branding).toMatchObject({ channel: { description: 'Descrição existente', keywords: 'ciência tecnologia' }, image: { bannerExternalUrl: 'https://yt3.googleusercontent.com/fake-banner' } });
  expect((await approvals(app)).at(-1)).toContain('Banner novo do canal');
  expect(jpegSize(readFileSync(join(root, 'channel-assets', 'banner.jpg')))).toEqual({ width: 2560, height: 1440 });
  await app.close();

  // After a restart: opens on Publicar vídeo, still connected with write access, agenda read back, no second OAuth round.
  const issued = fake.issued;
  const restarted = await launchApp(dataDir, { env: env(fake) });
  const again = await openChannel(restarted.page, project.id);
  await expect(again.getByRole('tab', { name: 'Publicar vídeo' })).toHaveAttribute('aria-selected', 'true');
  await openTab(again, 'Configuração');
  await expect(again).toContainText('conectado, com envio e edição');
  await shot(restarted.page, 'configuracao');
  await expect(again).toContainText('Canal de Teste');
  await openTab(again, 'Calendário');
  await expect(again.getByRole('region', { name: 'Agenda do canal' })).toContainText('Vídeo de teste');
  await expect(again.getByRole('region', { name: 'Histórico de publicações' })).toContainText('agendado');
  expect(fake.issued).toBe(issued);

  // No secret in the renderer or anywhere in the data directory in clear text.
  const rendered = await restarted.page.evaluate(async () => JSON.stringify([document.body.innerText, await window.neuralbridge.video.channelOAuthStatus(), await window.neuralbridge.video.channelProfile()]));
  for (const secret of SECRETS) expect(rendered).not.toContain(secret);
  await restarted.app.close();
  fake.server.close();
  // Read once the app has let go of its files (Windows locks the open database and caches).
  const scanned = filesUnder(dataDir);
  expect(scanned.some((file) => file.endsWith('velix-channel-oauth.bin'))).toBe(true);
  for (const file of scanned) {
    const content = readFileSync(file);
    for (const secret of SECRETS) expect(content.includes(secret), `${secret} em ${file}`).toBe(false);
  }
});

test('canal: cota esgotada, rede caída e cancelamento falham com mensagem clara, e desconectar revoga no Google', async () => {
  test.setTimeout(120_000);
  const fake = await startFake();
  const { clientFile, saveDir, dataDir, root } = setup(fake, await freePort());
  writeFileSync(join(root, 'renders', 'video.mp4'), Buffer.alloc(64 * 1024, 7));
  const { app, page } = await launchApp(dataDir, { env: env(fake) });
  await stubDesktop(app, fake, clientFile, saveDir);
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  const panel = await openChannel(page, project.id);
  await connectForReading(panel);
  await panel.getByRole('button', { name: 'Permitir envio e edição' }).click();
  await expect(panel).toContainText('conectado, com envio e edição');
  await setApproval(app, true);

  await openTab(panel, 'Publicar vídeo');
  await panel.getByRole('button', { name: 'Selecionar renders/video.mp4' }).click();
  const publishOnce = async (failure: FakeYouTube['failure']) => {
    fake.failure = failure;
    await panel.getByLabel('Título da publicação').fill(`Falha ${failure ?? ''}`);
    await panel.getByRole('button', { name: 'Enviar publicação' }).click();
  };
  const jobLine = panel.getByRole('status').filter({ hasText: /^(Na fila|Enviando|Enviado|Falhou|Cancelado|Pausado) · / });

  // Quota: the job fails with the reason, not Google's free text, and nothing is created.
  await publishOnce('quota');
  await expect(jobLine).toContainText('a cota diária da API do YouTube acabou', { timeout: 15_000 });
  await expect(jobLine).toContainText('Falhou');
  await expect(jobLine).not.toContainText('exceeded your quota');

  // Network: the connection drops on the session request.
  await publishOnce('drop');
  await expect(jobLine).toContainText('sem conexão com o YouTube', { timeout: 15_000 });
  await expect(jobLine).toContainText('Falhou');

  // Cancel: the upload stalls; the person cancels; the request is closed and the job ends cancelled.
  await publishOnce('stall');
  await panel.getByRole('button', { name: 'Cancelar upload' }).click({ timeout: 15_000 });
  await expect(jobLine).toContainText('Cancelado', { timeout: 15_000 });
  await expect.poll(() => fake.stalledClosed).toBe(true);
  expect(fake.videos).toEqual([]);
  const saved = await page.evaluate((id) => window.neuralbridge.video.channelPublications(id), project.id);
  expect(saved.map((item) => item.status).sort()).toEqual(['cancelled', 'failed', 'failed']);

  // Disconnect with Google unreachable: local access ends anyway and the person gets the manual revocation link.
  await openTab(panel, 'Configuração');
  fake.revokeStatus = 503;
  await panel.getByRole('button', { name: 'Desconectar' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'myaccount.google.com/permissions' })).toBeVisible();
  await expect(panel).toContainText('Canal: desconectado');
  expect(fake.revokes).toEqual(['fake-refresh-secret']);
  await expect(page.evaluate(() => window.neuralbridge.video.channelProfile())).rejects.toThrow(/auth_required/);

  // Reconnect and disconnect normally: the grant is revoked at Google.
  fake.revokeStatus = 200;
  await panel.getByRole('button', { name: 'Conectar YouTube' }).click();
  await expect(panel).toContainText('conectado só para leitura');
  await panel.getByRole('button', { name: 'Desconectar' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'acesso revogado no Google' })).toBeVisible();
  expect(fake.revokes).toEqual(['fake-refresh-secret', 'fake-refresh-secret']);
  await app.close();
  fake.server.close();
});

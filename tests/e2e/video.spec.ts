import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { extensions, openDatabase, videoRenderJobs } from '@neuralbridge/database';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// A stand-in for the user's kit: the real one needs Chromium, and is covered by the manual render check.
function fakeKit(dataDir: string): string {
  const kit = join(dataDir, 'kit');
  mkdirSync(join(kit, 'engine'), { recursive: true });
  mkdirSync(join(kit, 'templates', 'exemplos'), { recursive: true });
  writeFileSync(join(kit, 'SKILL.md'), '# MotionVelix v9.9.9: teste\n');
  writeFileSync(join(kit, 'templates', 'logo-reveal.html'), '<html></html>');
  writeFileSync(join(kit, 'templates', 'exemplos', 'logo.json'), '{"brand":"Fixture"}');
  writeFileSync(join(kit, 'engine', 'render.mjs'), `
import fs from 'node:fs';
const args = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(args[args.indexOf('--data') + 1], 'utf8'));
if (args.includes('--preview')) {
  for (const t of args[args.indexOf('--preview') + 1].split(',').map(Number)) fs.writeFileSync(args[1].replace(/\\.png$/, '') + '_t' + t.toFixed(2) + '.png', 'png');
  process.exit(0);
}
if (data.hang) { setInterval(() => undefined, 1000); await new Promise(() => undefined); }
fs.writeFileSync(args[1], 'mp4');
`);
  return kit;
}

function hybridKit(dataDir: string): string {
  const kit = fakeKit(dataDir);
  writeFileSync(join(kit, 'templates', 'kinetic-explainer.html'), '<html></html>');
  writeFileSync(join(kit, 'engine', 'render.mjs'), String.raw`
import { execFileSync } from 'node:child_process';
const args = process.argv.slice(2);
const out = args[1];
if (args.includes('--preview')) { for (const t of args[args.indexOf('--preview') + 1].split(',').map(Number)) execFileSync('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y','-v','error','-f','lavfi','-i','color=c=0x7c3aed:s=1280x720:d=1','-frames:v','1',out.replace(/\\.png$/, '') + '_t' + t.toFixed(2) + '.png']); process.exit(0); }
execFileSync('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y','-v','error','-f','lavfi','-i','color=c=0x7c3aed:s=1280x720:d=2','-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',out]);
`);
  return kit;
}

function writeVelixExtension(dataDir: string): string {
  const root = join(dataDir, 'velix-extension');
  const content = 'export default {}';
  const checksum = createHash('sha256').update('main.js').update('\0').update(content).digest('hex');
  const manifest = { schemaVersion: 1, id: 'velix', name: 'Velix', version: '1.0.0', minCoreVersion: '0.1.0', capabilities: ['navigation'], permissions: ['navigation'], entrypoints: { main: 'main.js' }, checksum: `sha256:${checksum}`, signature: { algorithm: 'sha256', value: checksum }, updateChannel: 'local' };
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'extension.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'main.js'), content);
  return root;
}

function registerVelixExtension(dataDir: string): void {
  const source = writeVelixExtension(dataDir);
  const manifest = JSON.parse(readFileSync(join(source, 'extension.json'), 'utf8')) as { id: string; [key: string]: unknown };
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: resolve(import.meta.dirname, '../../packages/database/migrations') });
  const now = new Date().toISOString();
  handle.db.insert(extensions).values({ id: manifest.id, manifest: JSON.stringify(manifest), state: 'enabled', installedAt: now, updatedAt: now, previousManifest: null }).onConflictDoNothing().run();
  handle.close();
}

async function launchVelix(dataDir: string, options: Parameters<typeof launchApp>[1] = {}) {
  registerVelixExtension(dataDir);
  return launchApp(dataDir, { ...options, env: { NB_PYTHON: process.execPath, ...options.env } });
}

const showTab = (page: Page, name: string) => page.getByRole('tab', { name }).click();

const chooseVideoProject = async (page: Page, dataDir: string) => {
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  return { folder };
};

const openVelix = async (dataDir: string) => {
  const launched = await launchVelix(dataDir, { env: { NB_VELIX_DIR: fakeKit(dataDir) } });
  const video = await chooseVideoProject(launched.page, dataDir);
  await launched.page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await expect(launched.page.getByRole('heading', { name: 'Aethera', exact: true })).toBeVisible();
  return { ...launched, video };
};

test('Velix avisa quando o kit não está instalado', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchApp(dataDir, { env: { NB_VELIX_DIR: join(dataDir, 'sem-kit') } });
  try {
    await page.evaluate(() => { window.location.hash = '#/video'; });
    await expect(page.getByRole('heading', { name: 'Aethera indisponível', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir Extensões', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Renderizar MP4' })).toHaveCount(0);
  } finally { await app.close(); }
});

test('Velix gera prévia e renderiza MP4 com um modelo do kit', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await openVelix(dataDir);
  await showTab(page, 'Render direto');
  await expect(page.getByText('MotionVelix v9.9.9.')).toBeVisible();
  await expect(page.getByLabel('Dados da cena')).toHaveValue('{"brand":"Fixture"}');
  await page.getByRole('button', { name: 'Gerar prévia' }).click();
  await expect(page.getByTestId('velix-frames').getByRole('img')).toHaveCount(3);
  await page.getByRole('button', { name: 'Renderizar MP4' }).click();
  await expect(page.getByText(/Renderização: completed/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('velix-output')).toHaveAttribute('src', /^data:video\/mp4;base64,/, { timeout: 15_000 });
  await app.close();
});

test('Colagem editorial exige duas aprovações e registra o B-roll gerado', async () => {
  test.setTimeout(120_000);
  const dataDir = freshDataDir();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const mp4Path = join(dataDir, 'fake-gemini.mp4');
  execFileSync('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xf59e0b:s=320x180:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', mp4Path]);
  const mp4 = readFileSync(mp4Path);
  const server = createServer((request, response) => { let body = ''; request.on('data', (chunk) => { body += chunk; }); request.on('end', () => { const image = request.url?.includes('gemini-3.1-flash-image') ?? false; const video = body.includes('Gere um clipe'); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(image ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] } : video ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'video/mp4', data: mp4.toString('base64') } }] } }] } : { candidates: [{ content: { parts: [{ text: 'Uma ponte de papel editorial' }] } }] })); }); });
  await new Promise<void>((resolveServer) => server.listen(0, '127.0.0.1', resolveServer));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('fake Gemini não abriu a porta');
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_GEMINI_API_URL: `http://127.0.0.1:${address.port}/v1beta`, NB_VELIX_DIR: fakeKit(dataDir) } });
  try {
    await chooseVideoProject(page, dataDir);
    const job = await page.evaluate(async () => {
      await window.neuralbridge.video.collageKeySave('fake-key');
      const created = await window.neuralbridge.video.collageCreate({ projectId: 'video', prompt: 'uma ponte de papel', durationSeconds: 2, aspectRatio: '16:9' });
      const still = await window.neuralbridge.video.collageApproveMetaphor(created.id);
      const approved = await window.neuralbridge.video.collageApproveStill(created.id);
      const generated = await window.neuralbridge.video.collageGenerate(created.id);
      return { created, still, approved, generated };
    });
    expect(job.created.status).toBe('draft');
    expect(job.still.status).toBe('metaphor_approved');
    expect(job.approved.status).toBe('still_approved');
    expect(job.generated.status).toBe('completed');
    expect(job.generated.rightsReferenceId).toBeTruthy();
  } finally { await app.close(); await new Promise<void>((resolveServer) => server.close(() => resolveServer())); }
});

test('Velix orienta a instalar o yt-dlp quando ele falta', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { NB_VELIX_DIR: fakeKit(dataDir), NB_PYTHON: join(dataDir, 'sem-python.exe') } });
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await showTab(page, 'Importar vídeo');
  await expect(page.getByRole('region', { name: 'Importar vídeo' })).toContainText('O yt-dlp não foi encontrado');
  await app.close();
});

test('Velix cancela um render em andamento', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await openVelix(dataDir);
  await showTab(page, 'Render direto');
  await page.getByLabel('Dados da cena').fill('{"hang":true}');
  await page.getByRole('button', { name: 'Renderizar MP4' }).click();
  await page.getByRole('button', { name: 'Cancelar renderização' }).click();
  await expect(page.getByText(/Renderização: cancelled/)).toBeVisible({ timeout: 15_000 });
  await app.close();
});

test('render iniciado pelo Chat preserva origem e agente no job auditado', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { NB_VELIX_DIR: fakeKit(dataDir) } });
  await chooseVideoProject(page, dataDir);
  await page.evaluate(() => { window.location.hash = '#/video?instruction=gerar%20abertura&origin=chat&agent=codex'; });
  await expect(page.getByText('Instrução recebida do Chat:')).toBeVisible();
  await expect(page.getByLabel('Sua ideia')).toHaveValue('gerar abertura');
  await page.getByText('90 s', { exact: true }).click();
  await expect(page.getByRole('radio', { name: '90 s' })).toBeChecked();
  await page.getByText('Trilha', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Trilha' })).toBeChecked();
  await page.getByLabel('Para quem é').fill('iniciantes');
  await page.getByLabel('Como termina').fill('comenta GUIA');
  await showTab(page, 'Render direto');
  await page.getByRole('button', { name: 'Renderizar MP4' }).click();
  await expect.poll(async () => page.locator('body').innerText(), { timeout: 15_000 }).toContain('Renderização: completed · origem chat · agente codex');
  await app.close();
});

test('Velix pede o projeto Video e lembra a escolha', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { NB_VELIX_DIR: fakeKit(dataDir) } });
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await showTab(page, 'Render direto');
  await expect(page.getByRole('button', { name: 'Renderizar MP4' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Projeto Video' }).selectOption(project.id);
  await expect(page.getByRole('region', { name: 'Projeto Video' })).toContainText(folder);
  await expect(page.getByRole('button', { name: 'Renderizar MP4' })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Projeto Video' })).toHaveValue(project.id);
  await app.close();
});

test('Velix cria a pasta do vídeo e exige um projeto no modo projeto', async () => {
  const dataDir = freshDataDir();
  const { app, page, video } = await openVelix(dataDir);
  await page.getByText('Fazer vídeo para um projeto', { exact: true }).click();
  await expect(page.getByLabel('Projeto do vídeo').getByRole('option', { name: 'Video' })).toHaveCount(0);
  await page.getByLabel('Sua ideia').fill('apresentar o app');
  await page.getByRole('textbox', { name: 'Nome do vídeo', exact: true }).fill('Minha Loja');
  await expect(page.getByRole('button', { name: 'Gerar roteiro' })).toBeDisabled();
  await page.evaluate(() => window.neuralbridge.video.prepare({ name: 'Minha Loja', kind: 'projeto' }));
  expect(existsSync(join(video.folder, 'minha-loja', 'prints'))).toBe(true);
  await app.close();
});

test('Narração ElevenLabs avisa do passo manual na ficha do vídeo', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await openVelix(dataDir);
  const sheet = page.getByRole('complementary', { name: 'Ficha do vídeo' });
  await expect(sheet).not.toContainText('narracao/voz.mp3');
  await page.getByText('Narração ElevenLabs', { exact: true }).click();
  await expect(sheet).toContainText('narracao/voz.mp3');
  await app.close();
});

test('Velix explica por que sugerir temas está bloqueado', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { NB_VELIX_DIR: fakeKit(dataDir) } });
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await page.getByLabel('Nicho').fill('Política');
  await expect(page.getByRole('button', { name: 'Sugerir temas' })).toBeDisabled();
  await expect(page.getByText('Escolha o projeto Video no topo da página para sugerir temas.')).toBeVisible();
  await app.close();
});

test('Velix sugere temas pelo nicho e preenche a ideia', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_VELIX_DIR: fakeKit(dataDir) } });
  await chooseVideoProject(page, dataDir);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sugerir temas' })).toBeDisabled();
  await page.getByRole('button', { name: 'Finanças' }).click();
  await expect(page.getByLabel('Nicho')).toHaveValue('Finanças');
  await page.getByRole('button', { name: 'Sugerir temas' }).click();
  await page.getByRole('list', { name: 'Temas sugeridos' }).getByRole('button', { name: 'Erro um do nicho' }).click();
  await expect(page.getByLabel('Sua ideia')).toHaveValue('Erro um do nicho');
  await expect(page.getByRole('textbox', { name: 'Nome do vídeo', exact: true })).toHaveValue('Erro um do nicho');
  await expect(page.getByRole('complementary', { name: 'Ficha do vídeo' })).toContainText('Finanças');
  await app.close();
});

test('Velix só usa as referências que o usuário aprovou', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_VELIX_DIR: fakeKit(dataDir) } });
  const { folder } = await chooseVideoProject(page, dataDir);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  const sheet = page.getByRole('complementary', { name: 'Ficha do vídeo' });
  await expect(page.getByRole('button', { name: 'Pesquisar referências' })).toBeDisabled();
  await page.getByLabel('Sua ideia').fill('juros para iniciantes');
  await page.getByRole('button', { name: 'Pesquisar referências' }).click();
  const found = page.getByRole('list', { name: 'Referências encontradas' });
  await expect(found).toContainText('Selic em 2025');
  await expect(sheet.getByText('Referências').locator('..')).toContainText('0');
  await found.getByRole('checkbox').check();
  await expect(sheet.getByText('Referências').locator('..')).toContainText('1');
  const items = [{ kind: 'dado' as const, title: 'Selic em 2025', url: 'https://example.com/selic', license: 'citação', note: 'série anual' }];
  await page.evaluate((list) => window.neuralbridge.video.saveResearch({ name: 'Juros', kind: 'tema', items: list }), items);
  expect(readFileSync(join(folder, 'juros', 'pesquisa', 'fontes.md'), 'utf8')).toContain('Selic em 2025');
  await app.close();
});

test('Velix só captura depois de confirmar e exige revisar os prints', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_VELIX_DIR: fakeKit(dataDir) } });
  const { folder } = await chooseVideoProject(page, dataDir);
  const loja = join(dataDir, 'Loja');
  mkdirSync(loja);
  writeFileSync(join(loja, 'server.mjs'), `import http from 'node:http';\nhttp.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<h1 style="color:red">' + process.env.NB_DEMO + q.url + '</h1>'); }).listen(4599, '127.0.0.1');\n`);
  await page.evaluate((path) => window.neuralbridge.projects.add(path), loja);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await page.getByText('Fazer vídeo para um projeto', { exact: true }).click();
  await page.getByLabel('Projeto do vídeo').selectOption({ label: 'Loja' });
  await page.getByLabel('Sua ideia').fill('apresentar a loja');
  const panel = page.getByRole('region', { name: 'Prints do app' });
  await panel.getByRole('button', { name: 'Preparar captura' }).click();
  await expect(panel.getByLabel('Comando para abrir o app')).toHaveValue('node server.mjs');
  const capture = panel.getByRole('button', { name: 'Capturar telas' });
  await expect(capture).toBeDisabled();
  await panel.getByRole('checkbox').check();
  await capture.click();
  const list = panel.getByRole('list', { name: 'Prints capturados' });
  await expect(list.getByRole('img')).toHaveCount(2, { timeout: 25_000 });
  const png = readFileSync(join(folder, 'loja', 'prints', '02-vendas.png'));
  expect(png.readUInt32BE(16)).toBe(1080);
  expect(png.readUInt32BE(20)).toBe(1920);
  await expect(page.getByRole('button', { name: 'Gerar roteiro' })).toBeDisabled();
  await expect(page.getByRole('complementary', { name: 'Ficha do vídeo' })).toContainText('Revise os prints capturados');
  await list.getByRole('button', { name: 'Remover 01-inicio.png' }).click();
  await expect(list.getByRole('img')).toHaveCount(1);
  await panel.getByRole('checkbox', { name: /Revisei os prints/ }).check();
  await expect(page.getByRole('button', { name: 'Gerar roteiro' })).toBeEnabled();
  await app.close();
});

test('Velix monta o vídeo no Estúdio, sem ir para o Chat', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_VELIX_DIR: fakeKit(dataDir) } });
  const { folder } = await chooseVideoProject(page, dataDir);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome do vídeo', exact: true }).fill('Meu Dossiê');
  await page.getByLabel('Sua ideia').fill('explicar as listas');
  await page.getByRole('button', { name: 'Gerar roteiro' }).click();
  const studio = page.getByRole('region', { name: 'Estúdio' });
  await expect(studio.getByLabel('Texto da narração')).toHaveValue(/Uma pergunta simples/);
  await expect(page).toHaveURL(/#\/video/);
  expect(existsSync(join(folder, 'meu-dossie', 'motion', 'dossie.html'))).toBe(true);
  await expect(studio.getByRole('status').first()).toContainText('meu-dossie/narracao/voz.mp3');
  await expect(studio.getByRole('button', { name: 'Sincronizar cenas com a voz' })).toBeDisabled();
  await studio.getByLabel('Nome da série').fill('Dados na mesa');
  await studio.getByRole('article', { name: 'Cena 2' }).getByLabel('Texto', { exact: true }).fill('O líder mudou');
  await studio.getByRole('button', { name: 'Gerar prévia' }).click();
  await expect(studio.getByAltText(/Prévia em/)).toBeVisible();
  await studio.getByRole('button', { name: 'Renderizar vídeo' }).click();
  await expect(studio.getByTestId('velix-studio-output')).toHaveAttribute('src', /^data:video\/mp4;base64,/, { timeout: 15_000 });
  expect(JSON.parse(readFileSync(join(folder, 'meu-dossie', 'motion', 'roteiro.json'), 'utf8'))).toMatchObject({ serie: 'Dados na mesa' });
  expect(existsSync(join(folder, 'meu-dossie', 'renders', 'meu-dossie.mp4'))).toBe(true);
  await app.close();
});

test('Velix mostra o limite do Claude e não começa acima dele', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_FAKE_LIMIT: '97', NB_VELIX_DIR: fakeKit(dataDir) } });
  await chooseVideoProject(page, dataDir);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  const limits = page.getByRole('region', { name: 'Limite do Claude' });
  await expect(limits).toContainText('Sessão atual');
  await expect(limits).toContainText('97% usado');
  await expect(limits).toContainText('Esta semana');
  await expect(limits).toContainText('Espere reiniciar');
  await page.getByRole('textbox', { name: 'Nome do vídeo', exact: true }).fill('Bloqueado');
  await page.getByLabel('Sua ideia').fill('qualquer ideia');
  await page.getByLabel('Nicho').fill('Finanças');
  await expect(page.getByRole('button', { name: 'Gerar roteiro' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sugerir temas' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pesquisar referências' })).toBeDisabled();
  const refused = await page.evaluate(() => window.neuralbridge.video.studioGenerate({ name: 'Bloqueado', kind: 'tema', brief: 'x', seconds: 60 }).then(() => 'ok', (error: Error) => error.message));
  expect(refused).toContain('Espere reiniciar');
  await app.close();
});

test('o card do agente mostra o limite do agente escolhido, lido da própria CLI', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_FAKE_LIMIT: '30', NB_FAKE_CODEX_LIMIT: '64', NB_VELIX_DIR: fakeKit(dataDir) } });
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  const card = page.getByRole('region', { name: 'Agente de produção' });
  await expect(card.getByRole('region', { name: 'Limite do Claude' })).toContainText('30% usado');
  await card.getByLabel('Agente das novas produções').selectOption('codex');
  const codex = card.getByRole('region', { name: 'Limite do Codex' });
  await expect(codex).toContainText('Sessão atual');
  await expect(codex).toContainText('64% usado');
  await expect(codex).toContainText('Esta semana');
  await expect(codex).toContainText('12% usado');
  await expect(card.getByRole('region', { name: 'Limite do Claude' })).toHaveCount(0);
  await card.getByLabel('Agente das novas produções').selectOption('claude');
  await expect(card.getByRole('region', { name: 'Limite do Claude' })).toContainText('30% usado');
  await app.close();
});

test('Importar vídeo diz o que falta para liberar o botão', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await launchVelix(dataDir, { env: { NB_VELIX_DIR: fakeKit(dataDir), NB_PYTHON: process.env['NB_PYTHON'] ?? 'python' } });
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await showTab(page, 'Importar vídeo');
  const panel = page.getByRole('region', { name: 'Importar vídeo' });
  test.skip(await panel.getByText('O yt-dlp não foi encontrado').isVisible(), 'yt-dlp não instalado nesta máquina');
  const button = panel.getByRole('button', { name: 'Importar' });
  await expect(button).toBeDisabled();
  await expect(panel).toContainText('Escolha o projeto Video');
  await expect(panel).toContainText('Cole o link do vídeo');
  await expect(panel).toContainText('Confirme que você pode usar este vídeo');
  await chooseVideoProject(page, dataDir);
  await page.reload();
  await showTab(page, 'Importar vídeo');
  await panel.getByLabel('Link do vídeo').fill('https://example.com/video.mp4');
  await panel.getByRole('checkbox').check();
  await expect(button).toBeEnabled();
  await app.close();
});

test('Velix rola só a área da página, sem esticar a janela', async () => {
  const dataDir = freshDataDir();
  const { app, page } = await openVelix(dataDir);
  await expect(page.getByLabel('Sua ideia')).toBeVisible();
  const overflow = await page.evaluate(() => { const root = document.documentElement; return root.scrollHeight - root.clientHeight; });
  expect(overflow).toBe(0);
  await app.close();
});

test('Velix mostra job interrompido após reinício', async () => {
  const dataDir = freshDataDir();
  mkdirSync(join(dataDir, 'db'), { recursive: true });
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: resolve(import.meta.dirname, '../../packages/database/migrations') });
  handle.db.insert(videoRenderJobs).values({ id: 'render-interrupted', status: 'running', error: null }).run();
  handle.close();
  const { app, page } = await openVelix(dataDir);
  await showTab(page, 'Render direto');
  await expect(page.getByRole('region', { name: 'Jobs de renderização' })).toContainText('failed');
  await expect(page.getByText(/Interrompida após reinício/)).toBeVisible();
  await app.close();
});

test('Velix escolhe o estilo no começo, mostra a prévia do estilo no Estúdio, renderiza nele e guarda a escolha do vídeo', async () => {
  const dataDir = freshDataDir();
  // This kit also carries the explainer template, which the chosen style renders with.
  const kit = fakeKit(dataDir); writeFileSync(join(kit, 'templates', 'kinetic-explainer.html'), '<html></html>');
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_VELIX_DIR: kit } });
  const { folder } = await chooseVideoProject(page, dataDir);
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  const gallery = page.getByRole('radiogroup', { name: 'Estilo do vídeo' });
  await expect(gallery.getByRole('radio', { name: /Dossiê com dados/ })).toHaveAttribute('aria-checked', 'true');
  // Stings (logo reveal, showreel…) and overlays are not whole-video styles.
  await expect(gallery.getByRole('radio', { name: /Logo reveal/ })).toHaveCount(0);
  await gallery.getByRole('radio', { name: /Explicativo animado/ }).click();
  await expect(page.getByRole('complementary', { name: 'Ficha do vídeo' })).toContainText('Explicativo animado');
  await page.getByRole('textbox', { name: 'Nome do vídeo', exact: true }).fill('Com Estilo');
  await page.getByLabel('Sua ideia').fill('explicar as listas');
  await page.getByRole('button', { name: 'Gerar roteiro' }).click();
  const studio = page.getByRole('region', { name: 'Estúdio' });
  await expect(studio.getByLabel('Texto da narração')).toHaveValue(/Uma pergunta simples/);
  await studio.getByText('Estilo do vídeo: Explicativo animado').click();
  await studio.getByRole('button', { name: 'Ver "Explicativo animado" com o meu roteiro' }).click();
  await expect(studio.getByRole('region', { name: 'Prévia do estilo' }).getByRole('img')).toHaveCount(3, { timeout: 20_000 });
  await studio.getByRole('button', { name: 'Renderizar vídeo' }).click();
  await expect(studio.getByTestId('velix-studio-output')).toHaveAttribute('src', /^data:video\/mp4;base64,/, { timeout: 15_000 });
  // The kit received the explainer's data (beats), not the raw Dossiê script.
  const dataFiles = readdirSync(join(folder, '.velix')).filter((file) => file.endsWith('.json')).map((file) => JSON.parse(readFileSync(join(folder, '.velix', file), 'utf8')) as Record<string, unknown>);
  expect(dataFiles.some((data) => Array.isArray(data['beats']))).toBe(true);
  const projectId = await page.evaluate(async () => (await window.neuralbridge.video.settings()).projectId ?? '');
  expect(await page.evaluate((id) => window.neuralbridge.video.styleLoad({ projectId: id, video: 'com-estilo' }), projectId)).toMatchObject({ own: true, choice: { styleId: 'explicativo' } });
  await app.close();
  const restarted = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_VELIX_DIR: kit } });
  expect(await restarted.page.evaluate((id) => window.neuralbridge.video.styleLoad({ projectId: id, video: 'com-estilo' }), projectId)).toMatchObject({ own: true, choice: { styleId: 'explicativo' } });
  await restarted.app.close();
});

test('Velix renderiza uma mistura kit + Remotion por cena e valida o MP4 final', async () => {
  test.setTimeout(120_000);
  const dataDir = freshDataDir();
  const kit = hybridKit(dataDir);
  const browser = process.env['NB_MOTION_BROWSER'];
  if (!browser) { test.skip(true, 'requer o navegador Remotion instalado'); return; }
  const { app, page } = await launchVelix(dataDir, { env: { ...FAKE_AGENTS, NB_VELIX_DIR: kit, NB_MOTION_BROWSER: browser } });
  const { folder } = await chooseVideoProject(page, dataDir);
  await page.evaluate(() => window.neuralbridge.video.prepare({ name: 'Mistura híbrida', kind: 'projeto' }));
  const projectId = await page.evaluate(async () => (await window.neuralbridge.video.settings()).projectId ?? '');
  const data = JSON.stringify({ duracao: 4, serie: 'E2E', cenas: [{ at: 0, capitulo: { titulo: 'Kit' }, blocos: [{ tipo: 'texto', texto: 'Primeiro trecho' }] }, { at: 2, capitulo: { titulo: 'Remotion' }, blocos: [{ tipo: 'grande', texto: 'Segundo trecho' }] }] });
  await page.evaluate(async ({ projectId, data }) => {
    await window.neuralbridge.video.styleSave({ projectId, video: 'Mistura híbrida', choice: { schemaVersion: 1, styleId: 'explicativo', styleVersion: 1, treatmentId: null, options: {}, scenes: { 'cena-2': { styleId: 'motion-cenas-base' } } } });
    await window.neuralbridge.video.studioSave({ name: 'Mistura híbrida', data, narration: 'Primeiro trecho. Segundo trecho.' });
  }, { projectId, data });
  await expect.poll(() => page.evaluate((id) => window.neuralbridge.video.styleLoad({ projectId: id, video: 'Mistura híbrida' }), projectId)).toMatchObject({ choice: { scenes: { 'cena-2': { styleId: 'motion-cenas-base' } } } });
  const job = await page.evaluate(({ data }) => window.neuralbridge.video.studioRender({ name: 'Mistura híbrida', data, quality: 'final' }), { data });
  await expect.poll(async () => page.evaluate((id) => window.neuralbridge.video.renderStatus(id), job.id), { timeout: 100_000 }).toMatchObject({ status: 'completed' });
  const output = join(folder, 'mistura-hibrida', 'renders', 'mistura-hibrida.mp4');
  expect(existsSync(output)).toBe(true);
  const ffprobe = process.env['FFPROBE_PATH'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe';
  const probe = { stdout: execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', output]).toString() };
  expect(probe.stdout).toContain('video');
  expect(Number(JSON.parse(probe.stdout).format.duration)).toBeGreaterThan(3.5);
  await app.close();
});

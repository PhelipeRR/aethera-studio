import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';
import { velixDataDir } from './velix-extension';

const exec = promisify(execFile);
const FFMPEG = process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE = process.env['FFPROBE_PATH'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe';

// With NB_REAL_JOURNEY=1 the feed, Codex ideas and Investigar are real and spend Codex quota. NB_REAL_JOURNEY_CLAUDE=1
// also makes the script real, spending Claude quota behind the app's own lock. Without it Claude is simulated and the
// run is not Claude homologation. Set NB_ELEVENLABS_AUDIO, NB_ELEVENLABS_TEXT and NB_VELIX_OWN_VIDEO to validate
// the same journey with a real ElevenLabs file and a user-owned video; otherwise the bounded fixtures are used.
const realParts = process.env['NB_REAL_JOURNEY'] === '1';
const realClaude = realParts && process.env['NB_REAL_JOURNEY_CLAUDE'] === '1';
const realAudio = process.env['NB_ELEVENLABS_AUDIO'];
const realAudioText = process.env['NB_ELEVENLABS_TEXT'];
const realOwnVideo = process.env['NB_VELIX_OWN_VIDEO'];
const realMedia = Boolean(realAudio && realAudioText && realOwnVideo);
const FEED = process.env['NB_PUBLIC_FEED_URL'] ?? 'https://www.nasa.gov/feed/';

function fakeKit(dataDir: string): string {
  const kit = join(dataDir, 'kit');
  mkdirSync(join(kit, 'engine'), { recursive: true });
  mkdirSync(join(kit, 'templates', 'exemplos'), { recursive: true });
  writeFileSync(join(kit, 'SKILL.md'), '# MotionVelix v9.9.9: teste\n');
  writeFileSync(join(kit, 'templates', 'logo-reveal.html'), '<html></html>');
  writeFileSync(join(kit, 'templates', 'exemplos', 'logo.json'), '{"brand":"Fixture"}');
  writeFileSync(join(kit, 'engine', 'render.mjs'), 'process.exit(0);\n');
  return kit;
}

test('jornada Velix: fonte, ideia, revisão, roteiro aprovado, MP4 válido e persistência após reiniciar', async () => {
  test.setTimeout(realClaude ? 900_000 : realParts ? 540_000 : 120_000);
  const dataDir = velixDataDir();
  const env = { NB_YOUTUBE_API_KEY: '', ...(realMedia ? {} : { NB_VELIX_DIR: fakeKit(dataDir) }), ...(realClaude ? {} : { NB_CLAUDE_CLI: FAKE_AGENTS['NB_CLAUDE_CLI'] ?? '' }), ...(realParts ? {} : { NB_CODEX_CLI: FAKE_AGENTS['NB_CODEX_CLI'] ?? '' }) };
  const launchOptions = { env, ...(realParts ? { isolateClients: false } : {}) };
  const { app, page } = await launchApp(dataDir, launchOptions);
  const root = join(dataDir, 'Video'); mkdirSync(root, { recursive: true });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  if (!realParts) await app.evaluate(() => { const real = globalThis.fetch; globalThis.fetch = (async (url: string, init?: RequestInit) => (String(url).includes('nasa.gov/feed') ? new Response('<rss><channel><language>pt-BR</language><item><title>Fonte fixture</title><link>https://fixture.example/a</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>') : real(url, init))) as typeof fetch; });
  await page.evaluate(() => { window.location.hash = '#/video'; });

  // Steps 1-2: project and real search.
  await page.getByRole('tab', { name: 'Descobrir' }).click();
  await page.getByLabel('Fonte de pesquisa').selectOption('rss');
  await page.getByLabel('Consulta de descoberta').fill('ciência');
  await page.getByLabel('URL do feed').fill(FEED);
  await page.getByRole('button', { name: 'Pesquisar fontes reais' }).click();
  await expect(page.getByRole('list', { name: 'Resultados da pesquisa' }).getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
  const feedCount = ((await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.id)).references as unknown[]).length;

  // Steps 3-5: idea, Investigar and human review. Nothing found by the agent is authorized by itself.
  await page.getByRole('tab', { name: 'Ideias' }).click();
  const region = page.getByRole('region', { name: 'Ideias Aethera' });
  await page.getByLabel('Agente das ideias').selectOption('codex');
  await page.getByLabel('Pauta das ideias').fill('ciência do cotidiano');
  await page.getByRole('button', { name: 'Gerar ideias' }).click();
  const card = region.getByRole('article').first();
  await expect(card).toBeVisible({ timeout: 240_000 });
  await card.getByRole('button', { name: 'Investigar' }).click();
  await expect(card.getByRole('status')).toContainText('Codex encontrou', { timeout: 280_000 });
  const pending = (await page.evaluate((id) => window.neuralbridge.video.ideaList(id), project.id))[0]?.pendingReferences ?? [];
  expect(pending.length).toBeGreaterThan(0);
  expect(((await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.id)).references as unknown[]).length).toBe(feedCount);
  const [approvedSource, rejectedSource] = pending;
  if (!approvedSource) throw new Error('fonte ausente');
  await card.getByRole('button', { name: `Aprovar fonte ${approvedSource.title}` }).click();
  if (rejectedSource) await card.getByRole('button', { name: `Rejeitar fonte ${rejectedSource.title}` }).click();
  await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.video.ideaList(id), project.id))[0]?.referenceUrls).toContain(approvedSource.url);

  // Steps 9-11 inputs: a synthetic clip and voice, authorized as the user's own file.
  if (realOwnVideo) copyFileSync(realOwnVideo, join(root, 'source.mp4'));
  else await exec(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'source.mp4')]);
  await page.evaluate(() => window.neuralbridge.video.prepare({ name: 'Jornada', kind: 'tema' }));
  if (realAudio && realAudioText) {
    copyFileSync(realAudio, join(root, 'jornada', 'narracao', 'voz.mp3'));
    copyFileSync(realAudioText, join(root, 'jornada', 'narracao', 'elevenlabs.txt'));
  } else await exec(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'aac', join(root, 'jornada', 'narracao', 'voz.m4a')]);
  await page.getByRole('tab', { name: 'Descobrir' }).click();
  await page.getByRole('tab', { name: 'Clip Hunter' }).click();
  await page.getByLabel('Arquivo local').fill('source.mp4');
  await page.getByLabel('Evidência da mídia local').fill('fixture própria sintética');
  await page.getByRole('button', { name: 'Analisar mídia autorizada' }).click();
  const approveCut = page.getByRole('checkbox', { name: /^Aprovar corte / }).first();
  await expect(approveCut).toBeVisible({ timeout: 20_000 });
  await approveCut.click(); // Controlled by the saved state, so it turns on after the update comes back.
  await expect(approveCut).toBeChecked();

  // Steps 6-8: brief and script stay unapproved until a person says so.
  await page.getByRole('tab', { name: 'Produzir' }).click();
  await page.getByRole('button', { name: 'Noticiário Verificável' }).click();
  const production = page.getByRole('region', { name: 'Produção Aethera' });
  await expect(production.getByRole('link', { name: approvedSource.title }).first()).toBeVisible();
  if (rejectedSource) await expect(production.getByRole('link', { name: rejectedSource.title })).toHaveCount(0);
  await production.getByLabel('Tema da produção').fill('Resumo de ciência');
  await production.getByLabel('Título da produção').fill('Jornada');
  await production.getByRole('button', { name: 'Montar brief verificável' }).click();
  await expect(production.getByText('não verificado:').first()).toBeVisible();
  await expect(production.getByRole('button', { name: 'Gerar e salvar roteiro' })).toBeDisabled();
  await production.getByRole('checkbox', { name: 'Aprovo este brief para gerar o roteiro no Estúdio.' }).check();
  await production.getByRole('button', { name: 'Gerar e salvar roteiro' }).click();
  await expect(production.getByRole('status')).toContainText('Roteiro gerado', { timeout: realClaude ? 420_000 : 60_000 });
  await expect(production.getByRole('button', { name: 'Renderizar versão aprovada' })).toBeDisabled();
  await production.getByRole('button', { name: 'Aprovar roteiro gerado' }).click();

  // Steps 12-13: the real FFmpeg pipeline, checked from outside the app.
  await production.getByRole('button', { name: 'Renderizar versão aprovada' }).click();
  const output = join(root, 'jornada', 'renders', 'jornada.mp4');
  await expect.poll(async () => { try { return (await exec(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', output])).stdout; } catch { return ''; } }, { timeout: 60_000 }).toMatch(/video[\s\S]*audio|audio[\s\S]*video/);
  const duration = Number((await exec(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output])).stdout.trim());
  expect(duration).toBeGreaterThan(0);
  if (realMedia) {
    // The Studio works on dossiê videos, so the real voice is synced on one created from an idea.
    await page.reload();
    await page.getByRole('link', { name: 'Aethera', exact: true }).click();
    await page.getByRole('textbox', { name: 'Nome do vídeo', exact: true }).fill('Voz real');
    await page.getByLabel('Sua ideia').fill('explicar por que o céu é azul');
    await page.getByRole('button', { name: 'Gerar roteiro' }).click();
    const studio = page.getByRole('region', { name: 'Estúdio' });
    await expect(studio.getByLabel('Texto da narração')).not.toHaveValue('', { timeout: realClaude ? 420_000 : 60_000 });
    copyFileSync(realAudio ?? '', join(root, 'voz-real', 'narracao', 'voz.mp3'));
    copyFileSync(realAudioText ?? '', join(root, 'voz-real', 'narracao', 'elevenlabs.txt'));
    await page.reload();
    await page.getByRole('tab', { name: 'Estúdio' }).click();
    await studio.getByLabel('Vídeo').selectOption('voz-real');
    await expect(studio.getByRole('status').first()).toContainText('Áudio encontrado', { timeout: 30_000 });
    await studio.getByRole('button', { name: 'Sincronizar cenas com a voz' }).click();
    await expect(studio.getByRole('status').first()).toContainText('sincronizadas', { timeout: 300_000 });
    await studio.getByRole('button', { name: 'Renderizar vídeo' }).click();
    const voiced = join(root, 'voz-real', 'renders', 'voz-real.mp4');
    await expect.poll(async () => { try { return (await exec(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', voiced])).stdout; } catch { return ''; } }, { timeout: 300_000, intervals: [2_000] }).toMatch(/video[\s\S]*audio|audio[\s\S]*video/);
    const voicedDuration = Number((await exec(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', voiced])).stdout.trim());
    const audioDuration = Number((await exec(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', realAudio ?? ''])).stdout.trim());
    console.log(`journey real media: voz=${audioDuration}s video=${voicedDuration}s`);
    expect(voicedDuration).toBeGreaterThan(audioDuration * 0.9);
  }
  const versions = (await page.evaluate((id) => window.neuralbridge.video.productionEditorialList(id), project.id)).versions as Array<{ id: string; kind: string; approved: boolean }>;
  const script = (versions as Array<{ kind: string; agent?: string | null; model?: string | null; executionId?: string | null }>).find((version) => version.kind === 'script');
  console.log(`journey: real=${realParts} realClaude=${realClaude} feed=${feedCount} pending=${pending.length} mp4=${duration}s script=${JSON.stringify({ agent: script?.agent, model: script?.model, executionId: script?.executionId })}`);
  if (realClaude) expect(script).toMatchObject({ agent: 'claude', executionId: expect.any(String) });
  await app.close();

  // Steps 14-15: everything is read back from disk by a new process.
  const restarted = await launchApp(dataDir, launchOptions);
  const [idea] = await restarted.page.evaluate((id) => window.neuralbridge.video.ideaList(id), project.id);
  expect(idea?.referenceUrls).toContain(approvedSource.url);
  if (rejectedSource) expect(idea?.referenceUrls).not.toContain(rejectedSource.url);
  const discovery = await restarted.page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.id);
  const urls = (discovery.references as Array<{ url: string }>).map((item) => item.url);
  expect(urls).toContain(approvedSource.url);
  if (rejectedSource) expect(urls).not.toContain(rejectedSource.url);
  const after = (await restarted.page.evaluate((id) => window.neuralbridge.video.productionEditorialList(id), project.id)).versions as Array<{ id: string; kind: string; approved: boolean }>;
  expect(after).toEqual(expect.arrayContaining(versions.filter((version) => version.approved).map((version) => expect.objectContaining({ id: version.id, approved: true }))));
  expect(after.filter((version) => version.approved).map((version) => version.kind).sort()).toEqual(['brief', 'script']);
  expect(readFileSync(output).length).toBeGreaterThan(0);
  await restarted.app.close();
});

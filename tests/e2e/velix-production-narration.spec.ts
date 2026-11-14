import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';
import { velixDataDir } from './velix-extension';

// Phase E of the autonomous Velix production through the real app: a local stand-in for VoiceStudio answers with real
// WAV audio (FFmpeg), the app joins and measures it with FFmpeg/FFprobe, and a stand-in for the kit's transcriber returns
// the spoken words. The storyboard then runs on the measured clock, and that survives a restart.

const FFMPEG = process.env['NB_FFMPEG'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const SECONDS_PER_WORD = 0.3;

/** The fake VoiceStudio: the contract the app checks (/health 0.5, models, voices) and real WAV for every request. */
function startVoiceStudio(log: string): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    const json = (value: unknown) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); };
    if (request.url === '/health') return json({ version: '0.5.0', status: 'ok' });
    if (request.url === '/models') return json({ models: [{ id: 'kitten', name: 'Kitten', installed: true }] });
    if (request.url === '/v1/audio/voices') return json({ voices: [{ id: 'voz-1', name: 'Voz 1', source: 'local' }] });
    if (request.method === 'POST' && request.url === '/v1/audio/speech') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const { input } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { input: string };
        const spoken = existsSync(log) ? (JSON.parse(readFileSync(log, 'utf8')) as string[]) : [];
        writeFileSync(log, JSON.stringify([...spoken, input]));
        const out = join(mkdtempSync(join(tmpdir(), 'nb-fake-voice-')), 'fala.wav');
        execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${(input.split(/\s+/).length * SECONDS_PER_WORD).toFixed(2)}`, '-ar', '24000', '-ac', '1', out]);
        response.setHeader('content-type', 'audio/wav');
        response.end(readFileSync(out));
      });
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

/** The kit's transcriber, run by Node: times every spoken word inside its block, using the manifest next to the audio. */
function fakeKit(dataDir: string, log: string): string {
  const kit = join(dataDir, 'kit');
  mkdirSync(join(kit, 'scripts'), { recursive: true });
  writeFileSync(join(kit, 'SKILL.md'), '# MotionVelix v9.9.9: teste\n');
  writeFileSync(join(kit, 'scripts', 'transcrever.py'), `
const fs = require('node:fs');
const path = require('node:path');
const [audio, out] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(audio), 'manifesto.json'), 'utf8'));
const spoken = JSON.parse(fs.readFileSync(${JSON.stringify(log)}, 'utf8'));
let offset = 0;
const words = [];
for (const block of manifest.blocks) {
  const text = spoken.slice().reverse().find((item) => block.key.endsWith('-' + item.length)) || '';
  text.split(/\\s+/).forEach((w, i) => words.push({ w: w.replace(/[.,]/g, ''), s: offset + i * ${SECONDS_PER_WORD}, e: offset + (i + 0.9) * ${SECONDS_PER_WORD} }));
  offset += block.durationMs / 1000;
}
fs.appendFileSync(${JSON.stringify(log)} + '.asr', 'x');
fs.writeFileSync(out, JSON.stringify({ words }));
`);
  return kit;
}

const openProduce = async (page: Page) => {
  await page.getByRole('link', { name: 'Aethera', exact: true }).click();
  await page.getByRole('tab', { name: 'Produzir' }).click();
  return page.getByRole('region', { name: 'Produções persistidas' });
};

test.skip(!existsSync(FFMPEG), 'needs FFmpeg at C:\\ffmpeg\\bin or NB_FFMPEG');

test('narração em blocos e sincronização colocam o storyboard no tempo real e sobrevivem ao reinício', async () => {
  test.setTimeout(180_000);
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const log = join(dataDir, 'falas.json');
  const voice = await startVoiceStudio(log);
  const env = { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '', NB_VOICESTUDIO_URL: voice.url, NB_VELIX_DIR: fakeKit(dataDir, log), NB_PYTHON: process.execPath };
  const first = await launchApp(dataDir, { env });
  const project = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await first.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const runs = await openProduce(first.page);
  await runs.getByLabel('Tema da nova produção').fill('Listas e líderes');
  await runs.getByLabel('Duração em minutos').fill('1');
  await runs.getByRole('button', { name: 'Nova produção' }).click();
  await runs.getByRole('button', { name: 'Gerar roteiro' }).click();
  await expect(runs.getByLabel('Roteiro consolidado')).toContainText('formato Dossiê v1', { timeout: 60_000 });
  const storyboard = runs.getByLabel('Storyboard da produção');
  await storyboard.getByRole('button', { name: 'Gerar storyboard' }).click();
  await expect(storyboard.getByRole('status', { name: 'Situação do storyboard' })).toContainText('Tempos estimados pelo ritmo.', { timeout: 60_000 });

  const panel = runs.getByLabel('Narração e sincronização');
  const speak = panel.getByRole('button', { name: 'Gerar narração' });
  await expect(speak).toBeDisabled();
  for (const label of ['Revisei os termos do VoiceStudio', 'Revisei a licença do modelo de voz', 'Revisei a licença da voz', 'Posso publicar o áudio gerado', 'Confirmo as revisões acima para esta produção']) await panel.getByLabel(label).check();
  await speak.click();
  await expect(panel).toContainText(/Narração de \d+\.\d s em 1 bloco\(s\), voz voz-1 \(kitten\), medida pelo FFprobe\./, { timeout: 60_000 });
  await panel.getByRole('button', { name: 'Sincronizar com a narração' }).click();
  const report = panel.getByLabel('Relatório da sincronização');
  await expect(report).toContainText('(100%)', { timeout: 60_000 });
  await expect(storyboard.getByRole('status', { name: 'Situação do storyboard' })).toContainText('Tempos medidos da narração.');

  // Splitting the scene cuts the already measured audio, so the narration stays valid without speaking again.
  const [run] = await first.page.evaluate((id) => window.neuralbridge.video.productionRunList(id), project.id);
  if (!run) throw new Error('a produção criada não foi listada');
  const current = () => first.page.evaluate((id) => window.neuralbridge.video.storyboardGet(id), run.id);
  await storyboard.getByRole('button', { name: 'Dividir cena 1' }).click();
  await expect(storyboard.getByRole('status', { name: 'Situação do storyboard' })).toContainText('Tempos medidos da narração.');
  await expect(panel.getByText('O storyboard mudou o que é falado')).toHaveCount(0);
  // The split itself is an edit that keeps the measured clock (read before syncing again, so this is not a race).
  await expect.poll(async () => { const value = await current(); return { timing: value?.timing, source: value?.source, scenes: value?.scenes.length }; }).toEqual({ timing: 'measured', source: 'edit', scenes: 2 });
  const splitVersion = (await current())?.version ?? 0;
  await panel.getByRole('button', { name: 'Sincronizar com a narração' }).click();
  // The status already read "measured" before this sync, so wait for the new sync version instead of the text.
  await expect.poll(async () => { const value = await current(); return (value?.version ?? 0) > splitVersion ? value?.source : null; }, { timeout: 60_000 }).toBe('sync');
  const measured = await current();
  const narration = await first.page.evaluate((id) => window.neuralbridge.video.productionNarrationGet(id), run.id);
  expect(measured).toMatchObject({ timing: 'measured', source: 'sync' });
  expect(measured?.scenes).toHaveLength(2);
  expect(measured?.scenes[0]?.startMs).toBe(0);
  expect(measured?.scenes.at(-1)?.endMs).toBe(narration.manifest?.durationMs);
  expect(measured?.scenes[1]?.startMs).toBe(measured?.scenes[0]?.endMs);
  expect(existsSync(join(folder, narration.manifest?.relativePath ?? 'x'))).toBe(true);
  await first.app.close();

  const restarted = await launchApp(dataDir, { env });
  const again = await openProduce(restarted.page);
  await expect(again.getByLabel('Storyboard da produção').getByRole('status', { name: 'Situação do storyboard' })).toContainText('Tempos medidos da narração.');
  await expect(again.getByLabel('Relatório da sincronização')).toContainText('(100%)');
  expect(await restarted.page.evaluate((id) => window.neuralbridge.video.storyboardGet(id), run.id)).toEqual(measured);
  await restarted.app.close();
  voice.server.close();
});

const MOTION_BROWSER = process.env['NB_MOTION_BROWSER'] ?? join(process.cwd(), '.motion-runtime', 'node_modules', '.remotion', 'chrome-headless-shell', 'win64', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');

test('render real (Remotion + FFmpeg) por formato, qualidade e exportação liberada só com checks verdes', async () => {
  test.skip(!existsSync(MOTION_BROWSER), 'requer o navegador Remotion instalado (NB_MOTION_BROWSER)');
  test.setTimeout(300_000);
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const log = join(dataDir, 'falas.json');
  const voice = await startVoiceStudio(log);
  const env = { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '', NB_VOICESTUDIO_URL: voice.url, NB_VELIX_DIR: fakeKit(dataDir, log), NB_PYTHON: process.execPath, NB_MOTION_BROWSER: MOTION_BROWSER };
  const first = await launchApp(dataDir, { env });
  const project = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await first.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const runs = await openProduce(first.page);
  await runs.getByLabel('Tema da nova produção').fill('Derivados completos');
  await runs.getByLabel('Duração em minutos').fill('1');
  await runs.getByRole('button', { name: 'Nova produção' }).click();
  await runs.getByRole('button', { name: 'Gerar roteiro' }).click();
  await expect(runs.getByLabel('Roteiro consolidado')).toContainText('formato Dossiê v1', { timeout: 60_000 });
  await runs.getByLabel('Storyboard da produção').getByRole('button', { name: 'Gerar storyboard' }).click();
  const panel = runs.getByLabel('Narração e sincronização');
  for (const label of ['Revisei os termos do VoiceStudio', 'Revisei a licença do modelo de voz', 'Revisei a licença da voz', 'Posso publicar o áudio gerado', 'Confirmo as revisões acima para esta produção']) await panel.getByLabel(label).check();
  await panel.getByRole('button', { name: 'Gerar narração' }).click();
  await expect(panel).toContainText('medida pelo FFprobe', { timeout: 60_000 });
  await panel.getByRole('button', { name: 'Sincronizar com a narração' }).click();
  await expect(panel.getByLabel('Relatório da sincronização')).toContainText('(100%)', { timeout: 60_000 });

  const [parentRun] = await first.page.evaluate((id) => window.neuralbridge.video.productionRunList(id), project.id);
  if (!parentRun) throw new Error('a produção criada não foi listada');
  let derivatives = runs.getByLabel('Derivados para Shorts');
  await derivatives.getByRole('button', { name: 'Gerar sugestões' }).click();
  const candidate = derivatives.locator('article').first();
  await expect(candidate).toContainText('YouTube Short', { timeout: 60_000 });
  await candidate.getByRole('button', { name: 'Aprovar' }).click();
  await candidate.getByRole('button', { name: 'Criar produção' }).click();
  await expect(candidate).toContainText('Produção criada', { timeout: 60_000 });
  await derivatives.getByRole('button', { name: 'Renderizar aprovados' }).click();
  await expect.poll(async () => {
    const item = (await first.page.evaluate((id) => window.neuralbridge.video.productionDerivatives(id), parentRun.id)).find((entry) => entry.status === 'created');
    if (!item?.childRunId) return 'sem filha';
    if (item.exportable) return 'true';
    const state = await first.page.evaluate((id) => window.neuralbridge.video.productionRunState(id), item.childRunId);
    return JSON.stringify({ exportable: item.exportable, run: state.run.status, stages: state.stages.map((stage) => ({ kind: stage.kind, status: stage.status, error: stage.error })) });
  }, { timeout: 180_000, message: 'o render da produção filha não ficou exportável' }).toBe('true');
  await first.page.reload();
  const refreshedRuns = await openProduce(first.page);
  await refreshedRuns.getByLabel('Produção selecionada').selectOption(parentRun.id);
  derivatives = refreshedRuns.getByLabel('Derivados para Shorts');
  const refreshedCandidate = derivatives.locator('article').first();
  await expect(refreshedCandidate).toContainText('Pronto para exportar', { timeout: 60_000 });
  await derivatives.getByRole('button', { name: 'Exportar prontos' }).click();
  await expect.poll(async () => {
    const item = (await first.page.evaluate((id) => window.neuralbridge.video.productionDerivatives(id), parentRun.id)).find((entry) => entry.status === 'created');
    return item?.exported ? 'true' : 'false';
  }, { timeout: 60_000, message: 'a exportação do derivado não terminou' }).toBe('true');
  await first.page.reload();
  const exportedRuns = await openProduce(first.page);
  await exportedRuns.getByLabel('Produção selecionada').selectOption(parentRun.id);
  await expect.poll(async () => {
    const item = (await first.page.evaluate((id) => window.neuralbridge.video.productionDerivatives(id), parentRun.id)).find((entry) => entry.status === 'created');
    return item?.exported ? 'true' : 'false';
  }, { timeout: 60_000, message: 'a exportação do derivado não ficou persistida' }).toBe('true');

  const render = runs.getByLabel('Render e qualidade');
  const list = render.getByRole('list', { name: 'Renders da produção' });
  for (const [formatId, size] of [['youtube-long', '1920x1080'], ['youtube-short', '1080x1920']] as const) {
    await render.getByLabel('Formato do render').selectOption(formatId);
    await render.getByRole('button', { name: 'Renderizar' }).click();
    await expect(list.getByRole('listitem').filter({ hasText: size }).first()).toBeVisible({ timeout: 180_000 });
  }
  const run = parentRun;
  const view = await first.page.evaluate((id) => window.neuralbridge.video.productionRenders(id), run.id);
  const narration = await first.page.evaluate((id) => window.neuralbridge.video.productionNarrationGet(id), run.id);
  expect(view.renders.map((item) => [item.formatId, item.width, item.height])).toEqual([['youtube-short', 1080, 1920], ['youtube-long', 1920, 1080]]);
  for (const item of view.renders) {
    const failed = item.checks.filter((check) => check.severity === 'blocking' && !check.passed).map((check) => `${check.id}: ${check.evidence ?? ''}`);
    expect(failed).toEqual([]);
    expect(item.exportable).toBe(true);
    expect(Math.abs(item.durationMs - (narration.manifest?.durationMs ?? 0))).toBeLessThanOrEqual(250);
    expect(existsSync(join(folder, item.relativePath))).toBe(true);
    expect(existsSync(join(folder, item.relativePath.replace(/\.mp4$/, '.srt')))).toBe(true);
  }
  const short = list.getByRole('listitem').filter({ hasText: '1080x1920' }).first();
  await expect(short).toContainText('Pode ser exportado');
  await short.getByRole('button', { name: 'Exportar' }).click();
  await expect(short).toContainText('Exportado com legendas, créditos e manifesto', { timeout: 60_000 });
  const exported = (await first.page.evaluate((id) => window.neuralbridge.video.productionRenders(id), run.id)).renders[0]?.exported ?? '';
  expect(existsSync(join(folder, exported))).toBe(true);
  await first.app.close();

  const restarted = await launchApp(dataDir, { env });
  const restartedRuns = await openProduce(restarted.page);
  await restartedRuns.getByLabel('Produção selecionada').selectOption(parentRun.id);
  const again = restartedRuns.getByLabel('Render e qualidade');
  await expect(again.getByRole('list', { name: 'Renders da produção' }).getByRole('listitem', { name: /^Render / })).toHaveCount(2);
  await expect(again).toContainText('Exportado com legendas');
  expect((await restarted.page.evaluate((id) => window.neuralbridge.video.productionRunState(id), run.id)).run.status).toBe('completed');
  await restarted.app.close();
  voice.server.close();
});

test('linha do tempo: dividir, mover e bloquear pelo teclado mantêm a narração medida, prévia rascunho e versão restaurada', async () => {
  test.skip(!existsSync(MOTION_BROWSER), 'requer o navegador Remotion instalado (NB_MOTION_BROWSER)');
  test.setTimeout(300_000);
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const log = join(dataDir, 'falas.json');
  const voice = await startVoiceStudio(log);
  const env = { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '', NB_VOICESTUDIO_URL: voice.url, NB_VELIX_DIR: fakeKit(dataDir, log), NB_PYTHON: process.execPath, NB_MOTION_BROWSER: MOTION_BROWSER };
  const { app, page } = await launchApp(dataDir, { env });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const runs = await openProduce(page);
  await runs.getByLabel('Tema da nova produção').fill('Listas e líderes');
  await runs.getByLabel('Duração em minutos').fill('1');
  await runs.getByRole('button', { name: 'Nova produção' }).click();
  await runs.getByRole('button', { name: 'Gerar roteiro' }).click();
  await expect(runs.getByLabel('Roteiro consolidado')).toContainText('formato Dossiê v1', { timeout: 60_000 });
  await runs.getByLabel('Storyboard da produção').getByRole('button', { name: 'Gerar storyboard' }).click();
  const narration = runs.getByLabel('Narração e sincronização');
  for (const label of ['Revisei os termos do VoiceStudio', 'Revisei a licença do modelo de voz', 'Revisei a licença da voz', 'Posso publicar o áudio gerado', 'Confirmo as revisões acima para esta produção']) await narration.getByLabel(label).check();
  await narration.getByRole('button', { name: 'Gerar narração' }).click();
  await expect(narration).toContainText('medida pelo FFprobe', { timeout: 60_000 });
  await narration.getByRole('button', { name: 'Sincronizar com a narração' }).click();
  await expect(narration.getByLabel('Relatório da sincronização')).toContainText('(100%)', { timeout: 60_000 });
  const spokenOnce = (JSON.parse(readFileSync(log, 'utf8')) as string[]).length;
  const transcribedOnce = readFileSync(`${log}.asr`, 'utf8').length;

  const timeline = runs.getByLabel('Linha do tempo', { exact: true });
  await expect(timeline).toContainText('tempos medidos da narração');
  const lane = timeline.getByRole('listbox', { name: 'Cenas na linha do tempo' });
  await expect(lane.getByRole('option')).toHaveCount(1);
  await lane.getByRole('option').first().focus();
  await page.keyboard.press('s');
  await expect(lane.getByRole('option')).toHaveCount(2);
  await expect(timeline).toContainText('tempos medidos da narração');
  await expect(timeline.getByText('Cena 1 dividida em duas.')).toBeAttached();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(timeline.getByText('Cena 1 movida para a posição 2.')).toBeAttached();
  await expect(timeline.getByLabel('Cena selecionada')).toContainText('Cena 2');
  await expect(timeline.getByLabel('Cena selecionada')).toContainText('Uma pergunta simples.');
  await page.keyboard.press('l');
  await expect(lane.getByRole('option', { name: /^Cena 2/ })).toHaveAccessibleName(/Bloqueada/);
  await expect(timeline).toContainText('tempos medidos da narração');

  await timeline.getByRole('button', { name: 'Prévia rascunho' }).click();
  await expect(timeline.getByLabel(/^Prévia rascunho da versão/)).toBeVisible({ timeout: 180_000 });
  const render = runs.getByLabel('Render e qualidade');
  await render.getByRole('button', { name: 'Renderizar' }).click();
  const item = render.getByRole('list', { name: 'Renders da produção' }).getByRole('listitem', { name: /^Render / }).first();
  await expect(item).toContainText('Pode ser exportado', { timeout: 180_000 });
  const [run] = await page.evaluate((id) => window.neuralbridge.video.productionRunList(id), project.id);
  if (!run) throw new Error('a produção criada não foi listada');
  const final = (await page.evaluate((id) => window.neuralbridge.video.productionRenders(id), run.id)).renders[0];
  expect(final?.checks.filter((check) => check.severity === 'blocking' && !check.passed)).toEqual([]);
  expect((JSON.parse(readFileSync(log, 'utf8')) as string[]).length).toBe(spokenOnce);
  expect(readFileSync(`${log}.asr`, 'utf8').length).toBe(transcribedOnce);

  await timeline.locator('summary').filter({ hasText: 'Versões' }).click();
  const versions = timeline.getByRole('list', { name: 'Versões do storyboard' });
  await versions.getByRole('button', { name: 'Restaurar versão 2' }).click();
  await expect(timeline.getByText(/Versão 2 restaurada como versão \d+\./)).toBeAttached();
  await expect(lane.getByRole('option')).toHaveCount(1);
  await expect(timeline).toContainText('tempos medidos da narração');
  await app.close();
  voice.server.close();
});

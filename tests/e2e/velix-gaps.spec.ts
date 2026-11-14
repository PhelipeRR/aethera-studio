import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';
import { velixDataDir } from './velix-extension';

const exec = promisify(execFile);
const FFMPEG = process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FEED = 'https://fixture.example/feed.xml';

async function velix(fetchMode: 'ok' | 'offline' | 'limited' | 'slow') {
  const dataDir = velixDataDir();
  const launched = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' } });
  const root = join(dataDir, 'Video'); mkdirSync(root, { recursive: true });
  const project = await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await launched.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  await stubFetch(launched.app, fetchMode);
  await launched.page.evaluate(() => { window.location.hash = '#/video'; });
  await launched.page.getByRole('tab', { name: 'Descobrir' }).click();
  return { ...launched, root, projectId: project.id };
}

async function stubFetch(app: ElectronApplication, mode: string) {
  await app.evaluate((_electron, stubMode) => {
    const real = globalThis.fetch;
    const state = globalThis as unknown as { feedCalls: number };
    state.feedCalls = 0;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (!String(url).includes('fixture.example')) return real(url, init);
      state.feedCalls += 1;
      if (stubMode === 'offline') throw new TypeError('fetch failed');
      if (stubMode === 'limited') return new Response('', { status: 429, headers: { 'retry-after': '60' } });
      if (stubMode === 'slow') await new Promise((resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
      return new Response('<rss><channel><item><title>Fonte fixture</title><link>https://fixture.example/a</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>');
    }) as typeof fetch;
  }, mode);
}

async function searchFeed(page: Awaited<ReturnType<typeof velix>>['page']) {
  await page.getByLabel('Fonte de pesquisa').selectOption('rss');
  await page.getByLabel('Consulta de descoberta').fill('ciência');
  await page.getByLabel('URL do feed').fill(FEED);
  await page.getByRole('button', { name: 'Pesquisar fontes reais' }).click();
}

test('sem rede a pesquisa diz que está offline e não inventa resultado', async () => {
  const { app, page, projectId } = await velix('offline');
  await searchFeed(page);
  await expect(page.getByText('Não foi possível conectar à fonte de notícias.')).toBeVisible();
  expect((await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId)).references).toEqual([]);
  await app.close();
});

test('limite da fonte aparece como limite, com a espera informada', async () => {
  const { app, page } = await velix('limited');
  await searchFeed(page);
  await expect(page.getByText(/limitou as consultas; tente de novo em 60 s/)).toBeVisible();
  await app.close();
});

test('repetir a pesquisa usa o cache e não consulta a fonte de novo', async () => {
  const { app, page, projectId } = await velix('ok');
  await searchFeed(page);
  await expect(page.getByRole('list', { name: 'Resultados da pesquisa' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Pesquisar fontes reais' }).click();
  await expect(page.getByText(/Resultado em cache/)).toBeVisible();
  expect(await app.evaluate(() => (globalThis as unknown as { feedCalls: number }).feedCalls)).toBe(1);
  expect((await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId)).references).toHaveLength(1);
  await app.close();
});

test('cancelar a pesquisa encerra a consulta sem salvar', async () => {
  const { app, page, projectId } = await velix('slow');
  await searchFeed(page);
  await page.getByRole('button', { name: 'Cancelar pesquisa' }).click();
  await expect(page.getByText('Pesquisa cancelada.')).toBeVisible();
  expect((await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId)).references).toEqual([]);
  await app.close();
});

test('direito condicional exige crédito, fica no histórico e não libera render; revogar bloqueia o que estava autorizado', async () => {
  const { app, page, root, projectId } = await velix('ok');
  await exec(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'source.mp4')]);
  await page.getByRole('tab', { name: 'Clip Hunter' }).click();
  await page.getByLabel('Arquivo local').fill('source.mp4');
  await page.getByLabel('Evidência da mídia local').fill('fixture própria');
  await page.getByRole('button', { name: 'Analisar mídia autorizada' }).click();
  const cut = page.getByRole('checkbox', { name: /^Aprovar corte / }).first();
  await expect(cut).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('img', { name: 'Forma de onda da energia de áudio' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Quadro em / }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Favoritar corte / }).first().click();
  await expect(page.getByRole('button', { name: /^Favoritar corte / }).first()).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('checkbox', { name: 'Mostrar só favoritos' }).check();
  await expect(cut).toBeVisible();
  await cut.click();
  await expect(cut).toBeChecked();

  await page.getByRole('tab', { name: 'Rights Manager' }).click();
  const card = page.getByRole('article').filter({ hasText: 'source.mp4' });
  await expect(card.getByRole('button', { name: 'Marcar como condicional' })).toBeDisabled();
  await card.getByLabel('Crédito para source.mp4').fill('Autoria própria');
  await card.getByRole('button', { name: 'Marcar como condicional' }).click();
  await expect(card).toContainText('status: conditional');
  await card.getByText(/Histórico de direitos \(2\)/).click();
  await expect(card.getByRole('list', { name: 'Histórico de source.mp4' }).getByRole('listitem')).toHaveCount(2);

  const brief = await page.evaluate((id) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'brief', content: 'brief' }), projectId);
  await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: projectId, versionId: brief.id });
  const data = JSON.stringify({ serie: 'x', duracao: 1, cenas: [{ at: 0, blocos: [{ tipo: 'texto', texto: 'x' }] }] });
  const script = await page.evaluate(({ id, sourceVersionId, content }) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'script', sourceVersionId, content }), { id: projectId, sourceVersionId: brief.id, content: data });
  await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: projectId, versionId: script.id });
  await page.evaluate(() => window.neuralbridge.video.prepare({ name: 'Video', kind: 'tema' }));
  const clips = (await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId)).clips as Array<{ id: string }>;
  const render = (clipId: string) => page.evaluate(({ id, versionId, content, clip }) => window.neuralbridge.video.productionRender({ projectId: id, name: 'Video', scriptVersionId: versionId, data: content, quality: 'final', mode: 'news', sourceRelativePath: 'source.mp4', clipIds: [clip] }), { id: projectId, versionId: script.id, content: data, clip: clipId });
  const clipId = clips[0]?.id; if (!clipId) throw new Error('corte ausente');
  await expect(render(clipId)).rejects.toThrow(/direitos verificados vigentes/);

  await card.getByLabel('Evidência para source.mp4').fill('licença reconferida');
  await card.getByLabel('Crédito para source.mp4').fill('Autoria própria');
  await card.getByRole('button', { name: 'Marcar autorização verificada' }).click();
  await expect(card).toContainText('status: verified_allowed');
  await render(clipId);
  expect(readFileSync(join(root, 'video', 'renders', 'creditos.txt'), 'utf8')).toContain('Autoria própria');

  await card.getByRole('button', { name: 'Bloquear' }).click();
  await expect(card).toContainText('status: blocked');
  await expect(render(clipId)).rejects.toThrow(/direitos verificados vigentes/);
  await app.close();
});

test('Compilação pela interface: ranking, classificação, prévia, montagem com música autorizada e log do render', async () => {
  test.setTimeout(90_000);
  const { app, page, root, projectId } = await velix('ok');
  await searchFeed(page);
  await expect(page.getByRole('list', { name: 'Resultados da pesquisa' }).getByRole('listitem')).toHaveCount(1);
  await exec(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'source.mp4')]);
  await exec(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=1320:duration=1', '-c:a', 'aac', join(root, 'musica.m4a')]);
  await page.evaluate(() => window.neuralbridge.video.prepare({ name: 'Compilacao', kind: 'tema' }));
  await page.getByRole('tab', { name: 'Clip Hunter' }).click();
  await page.getByLabel('Arquivo local').fill('source.mp4');
  await page.getByLabel('Evidência da mídia local').fill('fixture própria');
  await page.getByRole('button', { name: 'Analisar mídia autorizada' }).click();
  const cut = page.getByRole('checkbox', { name: /^Aprovar corte / }).first();
  await expect(cut).toBeVisible({ timeout: 20_000 });
  await cut.click();
  await expect(cut).toBeChecked();

  await page.getByRole('tab', { name: 'Produzir' }).click();
  const production = page.getByRole('region', { name: 'Produção Aethera' });
  await production.getByRole('button', { name: 'Noticiário Verificável' }).click();
  await production.getByLabel('Classificação de Fonte fixture').selectOption('allegation');
  await production.getByLabel('Tema da produção').fill('Pauta');
  await production.getByRole('button', { name: 'Montar brief verificável' }).click();
  await expect(production).toContainText('alegação: Fonte fixture');
  await expect(production).not.toContainText('source.mp4');

  await production.getByRole('button', { name: 'Compilação Comentada' }).click();
  await production.getByLabel('Critério do ranking').fill('maior virada');
  await production.getByRole('button', { name: 'Montar brief verificável' }).click();
  await expect(production).toContainText('Ranking por: maior virada');
  await production.getByLabel('Título da produção').fill('Compilacao');
  await production.getByRole('checkbox', { name: 'Aprovo este brief para gerar o roteiro no Estúdio.' }).check();
  await production.getByRole('button', { name: 'Gerar e salvar roteiro' }).click();
  await expect(production.getByRole('status')).toContainText('Roteiro gerado');
  await production.getByRole('button', { name: 'Aprovar roteiro gerado' }).click();
  await production.getByText('Montagem', { exact: true }).click();
  await production.getByLabel('Transição').selectOption('fade');
  await production.getByRole('checkbox', { name: 'Cartões de posição' }).check();
  await production.getByLabel('Música', { exact: true }).fill('musica.m4a');
  await production.getByLabel('Evidência da música').fill('licença da fixture');
  await production.getByLabel('Titular da música').fill('Autoria própria');
  await production.getByLabel('Licença da música').fill('própria');
  await production.getByLabel('Crédito da música').fill('Música: fixture');
  await production.getByRole('button', { name: 'Registrar autorização da música' }).click();
  await expect(production.getByText('Música com autorização registrada.')).toBeVisible();
  await production.getByRole('button', { name: 'Prévia do primeiro corte' }).click();
  await expect(production.getByLabel('Prévia do corte')).toBeVisible({ timeout: 15_000 });
  await production.getByRole('button', { name: 'Renderizar versão aprovada' }).click();
  await expect(production.getByText('MP4 renderizado.')).toBeVisible({ timeout: 30_000 });
  await expect(production.getByRole('list', { name: 'Log do render' })).toContainText('MP4 validado pelo FFprobe');
  expect(readFileSync(join(root, 'compilacao', 'renders', 'creditos.txt'), 'utf8')).toContain('Música: fixture');
  const probe = await exec(FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', join(root, 'compilacao', 'renders', 'compilacao.mp4')]);
  expect(probe.stdout).toMatch(/video[\s\S]*audio|audio[\s\S]*video/);
  expect(await page.evaluate((id) => window.neuralbridge.video.productionCancel(id), projectId)).toEqual({ cancelled: false });
  await app.close();
});

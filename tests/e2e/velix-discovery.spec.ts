import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { FAKE_AGENTS, launchApp } from './app';
import { velixDataDir } from './velix-extension';
const exec = promisify(execFile);

async function openDiscovery(dataDir: string) {
  const launched = await launchApp(dataDir, { env: { NB_YOUTUBE_API_KEY: '' } });
  const folder = join(dataDir, 'Video'); mkdirSync(folder, { recursive: true });
  const project = await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await launched.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  await launched.page.evaluate(() => { window.location.hash = '#/video'; });
  await expect(launched.page.getByRole('heading', { name: 'Aethera', exact: true })).toBeVisible();
  await launched.page.getByRole('tab', { name: 'Descobrir' }).click();
  return launched;
}

test('Descobrir exibe indisponibilidade real quando falta credencial do YouTube', async () => {
  const dataDir = velixDataDir(); const { app, page } = await openDiscovery(dataDir);
  await page.getByLabel('Consulta de descoberta').fill('jogos');
  await page.getByRole('button', { name: 'Pesquisar fontes reais' }).click();
  await expect(page.getByText(/API oficial do YouTube requer credencial/)).toBeVisible();
  await app.close();
});

// Reads a public feed over the network, so it stays out of the default run.
test.describe(() => {
  const feedUrl = process.env['NB_PUBLIC_FEED_URL'] ?? 'https://feeds.bbci.co.uk/news/rss.xml';
  test.skip(process.env['NB_REAL_FEEDS'] !== '1', 'needs network access to a public RSS/Atom feed (NB_REAL_FEEDS=1)');
  test.setTimeout(120_000);

  test('referências de um feed público reaparecem após reiniciar e chegam ao brief do Noticiário', async () => {
    const dataDir = velixDataDir(); const first = await openDiscovery(dataDir);
    await first.page.getByLabel('Fonte de pesquisa').selectOption('rss');
    await first.page.getByLabel('Consulta de descoberta').fill('homologação editorial');
    await first.page.getByLabel('URL do feed').fill(feedUrl);
    await first.page.getByRole('button', { name: 'Pesquisar fontes reais' }).click();
    const list = first.page.getByRole('list', { name: 'Resultados da pesquisa' });
    await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
    await expect(list).not.toContainText('CDATA');
    const settings = await first.page.evaluate(() => window.neuralbridge.video.settings()); const projectId = settings.projectId; if (!projectId) throw new Error('projeto ausente');
    const saved = await first.page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId);
    const references = saved.references as Array<{ id: string; url: string; title: string; publisher: string; publishedAt: string | null }>;
    expect(references.length).toBeGreaterThan(0);
    expect(saved.searches).toEqual([expect.objectContaining({ provider: 'rss', status: 'ok' })]);
    expect(new Set(references.map((item) => item.url)).size).toBe(references.length);
    await first.page.getByRole('button', { name: 'Pesquisar fontes reais' }).click();
    await expect.poll(async () => ((await first.page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId)).searches as unknown[]).length).toBe(2);
    const again = await first.page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId);
    const urls = (again.references as Array<{ url: string }>).map((item) => item.url);
    expect(new Set(urls).size).toBe(urls.length);
    await first.app.close();

    const restarted = await launchApp(dataDir, { env: { NB_YOUTUBE_API_KEY: '' } });
    const recovered = await restarted.page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId);
    const urlsAfter = (recovered.references as Array<{ url: string }>).map((item) => item.url);
    expect(urlsAfter).toEqual(expect.arrayContaining(references.map((item) => item.url)));
    await restarted.page.evaluate(() => { window.location.hash = '#/video'; });
    await restarted.page.getByRole('tab', { name: 'Produzir' }).click();
    await restarted.page.getByRole('button', { name: 'Noticiário Verificável' }).click();
    const firstReference = references[0]; if (!firstReference) throw new Error('referência ausente');
    const production = restarted.page.getByRole('region', { name: 'Produção Aethera' });
    await expect(production.getByRole('link', { name: firstReference.title }).first()).toHaveAttribute('href', firstReference.url);
    await production.getByLabel('Tema da produção').fill('Resumo do dia');
    await production.getByRole('button', { name: 'Montar brief verificável' }).click();
    await expect(production.getByText('não verificado:').first()).toBeVisible({ timeout: 15_000 });
    await expect(production).toContainText(firstReference.title);
    await expect(production).not.toContainText('fato confirmado');
    await expect.poll(async () => (await restarted.page.evaluate((id) => window.neuralbridge.video.productionEditorialList(id), projectId)).versions.length).toBe(1);
    const editorial = await restarted.page.evaluate((id) => window.neuralbridge.video.productionEditorialList(id), projectId);
    expect(editorial.versions[0]).toMatchObject({ kind: 'brief', approved: false });
    expect(JSON.stringify(editorial.versions[0])).toContain(firstReference.url);
    await restarted.app.close();
  });
});

// Spends real quota: the logged-in Claude Code writes a script, and the version keeps what the provider reported.
test.describe(() => {
  test.skip(process.env['NB_REAL_CLI'] !== '1' || process.env['NB_REAL_FEEDS'] !== '1', 'needs a logged-in Claude Code and a public feed (NB_REAL_CLI=1, NB_REAL_FEEDS=1)');
  test.setTimeout(600_000);

  test('roteiro real do Claude guarda agente, modelo e execução na versão editorial', async () => {
    const dataDir = velixDataDir();
    const { app, page } = await launchApp(dataDir, { isolateClients: false, env: { NB_YOUTUBE_API_KEY: '' } });
    const folder = join(dataDir, 'Video'); mkdirSync(folder, { recursive: true });
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
    await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
    await page.evaluate(() => { window.location.hash = '#/video'; });
    await page.getByRole('tab', { name: 'Descobrir' }).click();
    await page.getByLabel('Fonte de pesquisa').selectOption('rss');
    await page.getByLabel('Consulta de descoberta').fill('ciência');
    await page.getByLabel('URL do feed').fill(process.env['NB_PUBLIC_FEED_URL'] ?? 'https://www.nasa.gov/feed/');
    await page.getByRole('button', { name: 'Pesquisar fontes reais' }).click();
    await expect(page.getByRole('list', { name: 'Resultados da pesquisa' }).getByRole('listitem').first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole('tab', { name: 'Produzir' }).click();
    await page.getByRole('button', { name: 'Noticiário Verificável' }).click();
    const production = page.getByRole('region', { name: 'Produção Aethera' });
    await production.getByLabel('Tema da produção').fill('Resumo de ciência');
    await production.getByLabel('Título da produção').fill('Homologacao');
    await production.getByRole('button', { name: 'Montar brief verificável' }).click();
    await expect(production.getByText('não verificado:').first()).toBeVisible({ timeout: 15_000 });
    await production.getByRole('checkbox', { name: 'Aprovo este brief para gerar o roteiro no Estúdio.' }).check();
    await production.getByRole('button', { name: 'Gerar e salvar roteiro' }).click();
    await expect(production.getByRole('status').or(production.getByRole('alert')).first()).toContainText(/Roteiro gerado/, { timeout: 500_000 });
    await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.video.productionEditorialList(id), project.id)).versions.length).toBe(2);
    const { versions } = await page.evaluate((id) => window.neuralbridge.video.productionEditorialList(id), project.id);
    const script = (versions as Array<{ kind: string; agent: string | null; model: string | null; executionId: string | null; generatedAt: string | null; approved: boolean }>).find((version) => version.kind === 'script'); if (!script) throw new Error('versão de roteiro ausente');
    console.log(`provider metadata: agent=${script.agent} model=${script.model} executionId=${script.executionId} generatedAt=${script.generatedAt}`);
    expect(script).toMatchObject({ agent: 'claude', approved: false, executionId: expect.any(String), generatedAt: expect.any(String) });
    await app.close();
  });
});

test('ideia gerada é salva, investigada, convertida em vídeo e sobrevive ao reinício', async () => {
  const dataDir = velixDataDir(); const { app, page } = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' } });
  const folder = join(dataDir, 'Video'); mkdirSync(folder, { recursive: true });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  await app.evaluate(() => { const real = globalThis.fetch; globalThis.fetch = (async (url: string, init?: RequestInit) => (String(url).includes('fixture.example') ? new Response('<rss><channel><language>pt-BR</language><item><title>Fonte fixture</title><link>https://fixture.example/a</link><pubDate>Fri, 30 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>') : real(url, init))) as typeof fetch; });
  await page.evaluate(() => { window.location.hash = '#/video'; });
  await page.getByRole('tab', { name: 'Descobrir' }).click();
  await page.getByLabel('Fonte de pesquisa').selectOption('rss');
  await page.getByLabel('Consulta de descoberta').fill('ciência');
  await page.getByLabel('URL do feed').fill('https://fixture.example/feed.xml');
  await page.getByRole('button', { name: 'Pesquisar fontes reais' }).click();
  await expect(page.getByRole('list', { name: 'Resultados da pesquisa' }).getByRole('listitem')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Ideias' }).click();
  await page.getByLabel('Pauta das ideias').fill('ciência');
  await expect(page.getByRole('button', { name: 'Gerar mais' })).toBeDisabled();
  await page.getByRole('button', { name: 'Gerar ideias' }).click();
  const card = page.getByRole('article', { name: 'Ideia: Primeira ideia do nicho' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Sugestão editorial, não tendência medida');
  await expect(card).toContainText('Hipótese: Fato sem fonte válida');
  await expect(card).toContainText('Fato: Fato com fonte');
  await expect(card.getByRole('list', { name: 'Referências da ideia' }).getByRole('link')).toHaveCount(1);
  await expect(card).not.toContainText('inventada.example');
  await page.getByRole('button', { name: 'Gerar mais' }).click();
  await expect(page.getByRole('article', { name: 'Ideia: Outra ideia do nicho' })).toBeVisible();
  await card.getByRole('button', { name: 'Salvar' }).click();
  await expect(card).toContainText('salva');
  await card.getByRole('button', { name: 'Investigar' }).click();
  await expect(card.getByRole('status')).toContainText('1 fonte(s) nova(s) para revisar');
  const pending = card.getByRole('list', { name: 'Fontes aguardando revisão' });
  await expect(pending).toContainText('Selic em 2025');
  await expect(card.getByRole('list', { name: 'Referências da ideia' }).getByRole('link')).toHaveCount(1);
  await expect.poll(async () => ((await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.id)).references as unknown[]).length).toBe(1);
  await pending.getByRole('button', { name: 'Aprovar fonte Selic em 2025' }).click();
  await expect(card.getByRole('list', { name: 'Referências da ideia' }).getByRole('link')).toHaveCount(2);
  await card.getByLabel('Nome do vídeo para Primeira ideia do nicho').fill('Ideia Real');
  await card.getByRole('button', { name: 'Criar projeto Video' }).click();
  await expect(card.getByRole('status')).toContainText('2 referência(s)');
  await expect(card).toContainText('convertida em vídeo');
  await app.close();
  const restarted = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' } });
  const ideas = await restarted.page.evaluate((id) => window.neuralbridge.video.ideaList(id), project.id);
  expect(ideas.find((idea) => idea.title === 'Primeira ideia do nicho')).toMatchObject({ status: 'converted', generation: { agent: 'claude', executionId: expect.any(String) }, referenceUrls: ['https://fixture.example/a', 'https://example.com/selic'] });
  const editorial = await restarted.page.evaluate((id) => window.neuralbridge.video.productionEditorialList(id), project.id);
  expect(editorial.versions).toEqual([expect.objectContaining({ kind: 'brief', approved: false, agent: 'claude' })]);
  expect(readFileSync(join(folder, 'ideia-real', 'pesquisa', 'fontes.md'), 'utf8')).toContain('https://fixture.example/a');
  await restarted.app.close();
});

async function ideasPage(env: Record<string, string> = {}) {
  const dataDir = velixDataDir(); const launched = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '', ...env } });
  const folder = join(dataDir, 'Video'); mkdirSync(folder, { recursive: true });
  const project = await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await launched.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  await launched.page.evaluate(() => { window.location.hash = '#/video'; });
  await launched.page.getByRole('tab', { name: 'Ideias' }).click();
  return { ...launched, projectId: project.id };
}

test('a quota do Claude bloqueia só o Claude, sem failover para o Codex', async () => {
  const { app, page, projectId } = await ideasPage({ NB_FAKE_LIMIT: '97' });
  await page.getByLabel('Pauta das ideias').fill('ciência');
  await page.getByRole('button', { name: 'Gerar ideias' }).click();
  await expect(page.getByRole('region', { name: 'Ideias Aethera' }).getByRole('alert')).toContainText(/limite/i);
  expect(await page.evaluate((id) => window.neuralbridge.video.ideaList(id), projectId)).toEqual([]);
  await page.getByLabel('Agente das ideias').selectOption('codex');
  await page.getByRole('button', { name: 'Gerar ideias' }).click();
  const card = page.getByRole('article', { name: 'Ideia: Ideia do Codex' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('codex');
  const [idea] = await page.evaluate((id) => window.neuralbridge.video.ideaList(id), projectId);
  expect(idea?.generation).toMatchObject({ agent: 'codex', model: null, executionId: expect.any(String) });
  await app.close();
});

test('resposta do Codex fora do contrato não vira ideia', async () => {
  const { app, page, projectId } = await ideasPage();
  await page.getByLabel('Agente das ideias').selectOption('codex');
  await page.getByLabel('Pauta das ideias').fill('CHAVES-PROPRIAS');
  await page.getByRole('button', { name: 'Gerar ideias' }).click();
  await expect(page.getByRole('region', { name: 'Ideias Aethera' }).getByRole('alert')).toContainText('fora do contrato');
  expect(await page.evaluate((id) => window.neuralbridge.video.ideaList(id), projectId)).toEqual([]);
  await app.close();
});

test('Investigar com Codex deixa fontes pendentes até a revisão e recupera após reiniciar', async () => {
  const { app, page, projectId, dataDir } = await ideasPage();
  await page.getByLabel('Agente das ideias').selectOption('codex');
  await page.getByLabel('Pauta das ideias').fill('ciência');
  await page.getByRole('button', { name: 'Gerar ideias' }).click();
  const card = page.getByRole('article', { name: 'Ideia: Ideia do Codex' });
  await card.getByRole('button', { name: 'Investigar' }).click();
  await expect(card.getByRole('status')).toContainText('Codex encontrou 1 fonte(s) nova(s) para revisar e 1 fora do contrato');
  await app.close();
  const restarted = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' } });
  const [idea] = await restarted.page.evaluate((id) => window.neuralbridge.video.ideaList(id), projectId);
  expect(idea?.pendingReferences).toEqual([expect.objectContaining({ url: 'https://example.org/codex', agent: 'codex', executionId: expect.any(String) })]);
  expect(idea?.referenceUrls).toEqual([]);
  const discovery = await restarted.page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId);
  expect(discovery.references).toEqual([]);
  const pendingId = idea?.pendingReferences[0]?.id; if (!pendingId) throw new Error('pendência ausente');
  await restarted.page.evaluate(({ id, reference }) => window.neuralbridge.video.ideaReference({ projectId: id, id: reference, decision: 'rejected' }), { id: projectId, reference: pendingId });
  const [after] = await restarted.page.evaluate((id) => window.neuralbridge.video.ideaList(id), projectId);
  expect(after).toMatchObject({ pendingReferences: [], referenceUrls: [] });
  await restarted.app.close();
});

test('Cancelar interrompe a geração sem salvar ideia', async () => {
  const { app, page, projectId } = await ideasPage();
  await page.getByLabel('Pauta das ideias').fill('LENTO');
  await page.getByRole('button', { name: 'Gerar ideias' }).click();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('region', { name: 'Ideias Aethera' }).getByRole('alert')).toContainText('cancelada');
  expect(await page.evaluate((id) => window.neuralbridge.video.ideaList(id), projectId)).toEqual([]);
  await app.close();
});

// Spends Codex quota only: Claude is never selected here, so its weekly lock stays out of it.
test.describe(() => {
  test.skip(process.env['NB_REAL_CLI'] !== '1' || process.env['NB_REAL_CODEX_ONLY'] !== '1', 'needs a logged-in Codex (NB_REAL_CLI=1, NB_REAL_CODEX_ONLY=1)');
  test.setTimeout(600_000);

  test('Investigar real com Codex traz fontes pendentes e sobrevive ao reinício', async () => {
    const dataDir = velixDataDir();
    const { app, page } = await launchApp(dataDir, { isolateClients: false, env: { NB_YOUTUBE_API_KEY: '' } });
    const folder = join(dataDir, 'Video'); mkdirSync(folder, { recursive: true });
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
    await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
    await page.evaluate(() => { window.location.hash = '#/video'; });
    await page.getByRole('tab', { name: 'Ideias' }).click();
    const region = page.getByRole('region', { name: 'Ideias Aethera' });
    await page.getByLabel('Agente das ideias').selectOption('codex');
    await page.getByLabel('Pauta das ideias').fill('ciência do cotidiano');
    await page.getByRole('button', { name: 'Gerar ideias' }).click();
    const card = region.getByRole('article').first();
    await expect(card).toBeVisible({ timeout: 240_000 });
    await card.getByRole('button', { name: 'Investigar' }).click();
    await expect(card.getByRole('status').or(card.getByRole('alert')).first()).toContainText(/Codex encontrou/, { timeout: 280_000 });
    const [idea] = await page.evaluate((id) => window.neuralbridge.video.ideaList(id), project.id);
    if (!idea) throw new Error('ideia ausente');
    console.log(`provider metadata: ${JSON.stringify(idea.generation)} pending=${idea.pendingReferences.length} executions=${JSON.stringify([...new Set(idea.pendingReferences.map((item) => item.executionId))])}`);
    expect(idea.generation).toMatchObject({ agent: 'codex', model: null, executionId: expect.any(String) });
    expect(idea.pendingReferences.length).toBeGreaterThan(0);
    expect(idea.pendingReferences.every((item) => item.agent === 'codex' && item.url.startsWith('https://') && item.executionId)).toBe(true);
    expect(idea.referenceUrls).toEqual([]);
    await app.close();
    const restarted = await launchApp(dataDir, { isolateClients: false, env: { NB_YOUTUBE_API_KEY: '' } });
    const [recovered] = await restarted.page.evaluate((id) => window.neuralbridge.video.ideaList(id), project.id);
    expect(recovered?.pendingReferences).toEqual(idea.pendingReferences);
    const first = idea.pendingReferences[0]; if (!first) throw new Error('fonte ausente');
    await restarted.page.evaluate(({ id, reference }) => window.neuralbridge.video.ideaReference({ projectId: id, id: reference, decision: 'approved' }), { id: project.id, reference: first.id });
    const [approved] = await restarted.page.evaluate((id) => window.neuralbridge.video.ideaList(id), project.id);
    expect(approved?.referenceUrls).toEqual([first.url]);
    await restarted.app.close();
  });
});

test('Clip Hunter mantém análise real e não simula resultado para arquivo inexistente', async () => {
  const dataDir = velixDataDir(); const { app, page } = await openDiscovery(dataDir);
  await page.getByRole('tab', { name: 'Clip Hunter' }).click();
  await page.getByLabel('Arquivo local').fill('imports/inexistente.mp4');
  await page.getByLabel('Evidência da mídia local').fill('arquivo próprio');
  await page.getByRole('button', { name: 'Analisar mídia autorizada' }).click();
  await expect(page.getByText(/arquivo inválido|inexistente|falhou/i)).toBeVisible({ timeout: 10_000 });
  await app.close();
});

test('Clip Hunter aprova um corte e exporta MP4 real', async () => {
  const dataDir = velixDataDir(); const { app, page } = await openDiscovery(dataDir);
  const source = join(dataDir, 'Video', 'source.mp4');
  await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-pix_fmt', 'yuv420p', source]);
  const project = await page.evaluate(() => window.neuralbridge.video.settings());
  if (!project.projectId) throw new Error('projeto Video não selecionado'); const projectId = project.projectId;
  const analysis = await page.evaluate(({ projectId: id }) => window.neuralbridge.video.clipAnalyze({ projectId: id, relativePath: 'source.mp4', evidence: 'arquivo próprio' }), { projectId });
  await expect.poll(async () => page.evaluate((id) => window.neuralbridge.video.clipStatus(id), analysis.id), { timeout: 15_000 }).toMatchObject({ status: 'completed' });
  const discovery = await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), projectId);
  const clip = (discovery.clips as Array<{ id: string; start: number; end: number }>)[0]; expect(clip).toBeTruthy();
  if (!clip) throw new Error('a análise não gerou uma sugestão de corte');
  await page.evaluate(({ projectId: id, clipId }) => window.neuralbridge.video.clipUpdate({ projectId: id, id: clipId, accepted: true }), { projectId, clipId: clip.id });
  const render = await page.evaluate(({ projectId: id, start, end }) => window.neuralbridge.video.clipRender({ projectId: id, sourceRelativePath: 'source.mp4', clips: [{ start, end }], evidence: 'arquivo próprio' }), { projectId, start: clip.start, end: clip.end });
  await expect.poll(async () => page.evaluate((id) => window.neuralbridge.video.clipStatus(id), render.id), { timeout: 15_000 }).toMatchObject({ status: 'completed' });
  const job = await page.evaluate((id) => window.neuralbridge.video.clipStatus(id), render.id);
  const output = (job?.analysis as { outputPath: string }).outputPath;
  const probe = await exec(process.env['FFPROBE_PATH'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', join(dataDir, 'Video', output)]);
  expect(Number(probe.stdout.trim())).toBeGreaterThan(0);
  await app.close();
});

test('Clip Hunter envia cortes aprovados ao Estúdio e recupera roteiro persistido', async () => {
  const dataDir = velixDataDir(); const { app, page } = await openDiscovery(dataDir);
  const root = join(dataDir, 'Video'); const source = join(root, 'source.mp4');
  await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', source]);
  const project = await page.evaluate(() => window.neuralbridge.video.settings()); if (!project.projectId) throw new Error('projeto Video não selecionado');
  await page.evaluate(() => window.neuralbridge.video.prepare({ name: 'Video', kind: 'tema' }));
  const job = await page.evaluate((id) => window.neuralbridge.video.clipAnalyze({ projectId: id, relativePath: 'source.mp4', evidence: 'arquivo próprio' }), project.projectId);
  await expect.poll(async () => page.evaluate((id) => window.neuralbridge.video.clipStatus(id), job.id), { timeout: 15_000 }).toMatchObject({ status: 'completed' });
  const discovery = await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.projectId);
  const clips = discovery.clips as Array<{ id: string; start: number; end: number }>;
  expect(clips.length).toBeGreaterThan(0);
  const firstClip = clips[0]; if (!firstClip) throw new Error('corte ausente');
  await page.evaluate(({ projectId, id }) => window.neuralbridge.video.clipUpdate({ projectId, id, accepted: true }), { projectId: project.projectId, id: firstClip.id });
  const sent = await page.evaluate((id) => window.neuralbridge.video.clipSendToStudio({ projectId: id, sourceRelativePath: 'source.mp4' }), project.projectId);
  expect(sent.added).toBeGreaterThan(0);
  const state = await page.evaluate((name) => window.neuralbridge.video.studioLoad(name), 'Video');
  const roteiro = JSON.parse(state.data) as { cenas: Array<{ at?: number; fonte?: string; blocos?: Array<{ tipo?: string; src?: string; in?: number; out?: number; rights?: string }> }> };
  expect(roteiro.cenas.length).toBeGreaterThan(0);
  const block = roteiro.cenas.at(-1)?.blocos?.[0];
  expect(block).toMatchObject({ tipo: 'video', src: 'source.mp4', rights: 'verified_allowed' });
  expect(block?.out).toBeGreaterThan(block?.in ?? 0);
  await app.close();
});

async function approveAndRenderProduction(page: Page, root: string, projectId: string, mode: 'commentary' | 'news', videoName: string, clipId: string, clip: { start: number; end: number }) {
  const brief = await page.evaluate(({ mode, clip }) => window.neuralbridge.video.productionBrief(mode === 'commentary' ? { mode, topic: 'fixture local', style: 'documental', clips: [{ source: 'source.mp4', start: clip.start, end: clip.end, rights: 'verified_allowed' }] } : { mode, topic: 'fixture jornalístico', items: [{ title: 'Boletim de teste', url: 'https://news.example.test/item', publisher: 'Fonte fixture', publishedAt: '2026-10-31T00:00:00.000Z', claimType: 'confirmed' }] }), { mode, clip });
  const savedBrief = await page.evaluate(({ projectId, content }) => window.neuralbridge.video.productionEditorialVersion({ projectId, kind: 'brief', content }), { projectId, content: brief.brief });
  await page.evaluate(({ projectId, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId, versionId, decision: 'approved' }), { projectId, versionId: savedBrief.id });
  const script = JSON.stringify({ serie: videoName, rodape: 'fixture', duracao: 1, cenas: [{ at: 0, blocos: [{ tipo: 'texto', texto: mode === 'commentary' ? 'Comentário do trecho' : 'Notícia com fonte verificável', at: 0 }] }] });
  const savedScript = await page.evaluate(({ projectId, sourceVersionId, content }) => window.neuralbridge.video.productionEditorialVersion({ projectId, kind: 'script', sourceVersionId, content }), { projectId, sourceVersionId: savedBrief.id, content: script });
  await expect(page.evaluate(({ projectId, name, scriptVersionId, data, mode, clipId }) => window.neuralbridge.video.productionRender({ projectId, name, scriptVersionId, data, quality: 'final', mode, sourceRelativePath: 'source.mp4', clipIds: [clipId] }), { projectId, name: videoName, scriptVersionId: savedScript.id, data: script, mode, clipId })).rejects.toThrow(/aprovado/i);
  await page.evaluate(({ projectId, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId, versionId, decision: 'approved' }), { projectId, versionId: savedScript.id });
  const renderResult = await page.evaluate(({ projectId, name, scriptVersionId, data, mode, clipId }) => window.neuralbridge.video.productionRender({ projectId, name, scriptVersionId, data, quality: 'final', mode, sourceRelativePath: 'source.mp4', clipIds: [clipId] }), { projectId, name: videoName, scriptVersionId: savedScript.id, data: script, mode, clipId });
  expect(renderResult).toMatchObject({ editorialVersionId: savedScript.id });
  return { savedScript, output: join(root, videoName.toLowerCase(), 'renders', `${videoName.toLowerCase()}.mp4`) };
}

async function meanBand(file: string, frequency: number): Promise<number> {
  const result = await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-v', 'info', '-i', file, '-af', `bandpass=f=${frequency}:width_type=h:w=80,volumedetect`, '-f', 'null', '-']);
  const match = result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
  return Number(match?.[1] ?? '-99');
}

test('Compilação Comentada percorre aprovação editorial até MP4 real', async () => {
  const dataDir = velixDataDir(); const { app, page } = await openDiscovery(dataDir); const root = join(dataDir, 'Video'); const source = join(root, 'source.mp4');
  await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', source]);
  const project = await page.evaluate(() => window.neuralbridge.video.settings()); if (!project.projectId) throw new Error('projeto ausente'); await page.evaluate(() => window.neuralbridge.video.prepare({ name: 'Compilacao', kind: 'tema' })); await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'aac', join(root, 'compilacao', 'narracao', 'voz.m4a')]);
  const analysis = await page.evaluate((projectId) => window.neuralbridge.video.clipAnalyze({ projectId, relativePath: 'source.mp4', evidence: 'fixture próprio autorizado' }), project.projectId); await expect.poll(() => page.evaluate((id) => window.neuralbridge.video.clipStatus(id), analysis.id), { timeout: 15_000 }).toMatchObject({ status: 'completed' });
  const clips = await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.projectId); const clip = (clips.clips as Array<{ id: string; start: number; end: number }>)[0]; if (!clip) throw new Error('corte ausente'); await page.evaluate(({ projectId, id }) => window.neuralbridge.video.clipUpdate({ projectId, id, accepted: true }), { projectId: project.projectId, id: clip.id });
  const result = await approveAndRenderProduction(page, root, project.projectId, 'commentary', 'Compilacao', clip.id, clip); const probe = await exec(process.env['FFPROBE_PATH'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type', '-of', 'json', result.output]); const parsed = JSON.parse(probe.stdout) as { format: { duration: string }; streams: Array<{ codec_type: string }> }; expect(Number(parsed.format.duration)).toBeGreaterThan(0); expect(parsed.streams.map((stream) => stream.codec_type)).toEqual(expect.arrayContaining(['video', 'audio'])); expect(await meanBand(result.output, 440)).toBeGreaterThan(-45); expect(await meanBand(result.output, 880)).toBeGreaterThan(-45); await app.close();
});

test('Noticiário Verificável exige seleção explícita e produz MP4 real com referência fixture', async () => {
  const dataDir = velixDataDir(); const { app, page } = await openDiscovery(dataDir); const root = join(dataDir, 'Video'); const source = join(root, 'source.mp4');
  await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=2', '-shortest', '-pix_fmt', 'yuv420p', source]);
  const project = await page.evaluate(() => window.neuralbridge.video.settings()); if (!project.projectId) throw new Error('projeto ausente'); await page.evaluate(() => window.neuralbridge.video.prepare({ name: 'Noticiario', kind: 'tema' })); await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'sine=frequency=990:duration=1', '-c:a', 'aac', join(root, 'noticiario', 'narracao', 'voz.m4a')]); const analysis = await page.evaluate((projectId) => window.neuralbridge.video.clipAnalyze({ projectId, relativePath: 'source.mp4', evidence: 'fixture próprio autorizado' }), project.projectId); await expect.poll(() => page.evaluate((id) => window.neuralbridge.video.clipStatus(id), analysis.id), { timeout: 15_000 }).toMatchObject({ status: 'completed' }); const clips = await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.projectId); const clip = (clips.clips as Array<{ id: string; start: number; end: number }>)[0]; if (!clip) throw new Error('corte ausente'); await page.evaluate(({ projectId, id }) => window.neuralbridge.video.clipUpdate({ projectId, id, accepted: true }), { projectId: project.projectId, id: clip.id }); const result = await approveAndRenderProduction(page, root, project.projectId, 'news', 'Noticiario', clip.id, clip); const probe = await exec(process.env['FFPROBE_PATH'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type', '-of', 'json', result.output]); const parsed = JSON.parse(probe.stdout) as { format: { duration: string }; streams: Array<{ codec_type: string }> }; expect(Number(parsed.format.duration)).toBeGreaterThan(0); expect(parsed.streams.map((stream) => stream.codec_type)).toEqual(expect.arrayContaining(['video', 'audio'])); expect(await meanBand(result.output, 660)).toBeGreaterThan(-45); expect(await meanBand(result.output, 990)).toBeGreaterThan(-45); await app.close();
});

test('projetos Velix recuperam estado editorial após reinicialização e permanecem isolados', async () => {
  const dataDir = velixDataDir(); const first = await openDiscovery(dataDir); const firstSettings = await first.page.evaluate(() => window.neuralbridge.video.settings()); if (!firstSettings.projectId) throw new Error('projeto A ausente');
  const brief = await first.page.evaluate((projectId) => window.neuralbridge.video.productionEditorialVersion({ projectId, kind: 'brief', content: 'brief persistido A' }), firstSettings.projectId); await first.page.evaluate(({ projectId, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId, versionId, decision: 'approved' }), { projectId: firstSettings.projectId, versionId: brief.id }); const script = JSON.stringify({ serie: 'A', duracao: 1, cenas: [{ at: 0, blocos: [{ tipo: 'texto', texto: 'A' }] }] }); const scriptVersion = await first.page.evaluate(({ projectId, sourceVersionId, content }) => window.neuralbridge.video.productionEditorialVersion({ projectId, sourceVersionId, kind: 'script', content }), { projectId: firstSettings.projectId, sourceVersionId: brief.id, content: script }); await first.page.evaluate(({ projectId, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId, versionId, decision: 'approved' }), { projectId: firstSettings.projectId, versionId: scriptVersion.id });
  const otherPath = join(dataDir, 'Other'); mkdirSync(otherPath, { recursive: true }); const other = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), otherPath); const otherEditorial = await first.page.evaluate((projectId) => window.neuralbridge.video.productionEditorialList(projectId), other.id); expect(otherEditorial.versions).toEqual([]); await expect(first.page.evaluate(({ projectId, scriptVersionId, data }) => window.neuralbridge.video.productionRender({ projectId, name: 'Other', scriptVersionId, data, quality: 'final', mode: 'commentary', clipIds: [] }), { projectId: other.id, scriptVersionId: scriptVersion.id, data: script })).rejects.toThrow(/roteiro aprovado|projeto/i); await first.app.close();
  const restarted = await launchApp(dataDir, { env: { NB_YOUTUBE_API_KEY: '' } }); const recovered = await restarted.page.evaluate(() => window.neuralbridge.video.settings()); expect(recovered.projectId).toBe(firstSettings.projectId); const recoveredEditorial = await restarted.page.evaluate((projectId) => window.neuralbridge.video.productionEditorialList(projectId), firstSettings.projectId); expect(recoveredEditorial.versions).toEqual(expect.arrayContaining([expect.objectContaining({ id: brief.id, approved: true }), expect.objectContaining({ id: scriptVersion.id, approved: true })])); const otherRecovered = await restarted.page.evaluate((projectId) => window.neuralbridge.video.productionEditorialList(projectId), other.id); expect(otherRecovered.versions).toEqual([]); await restarted.app.close();
});

import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openDatabase, velixMediaReferences, velixMediaRights, velixProductionStages } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { FAKE_AGENTS, launchApp } from './app';
import { velixDataDir } from './velix-extension';

// Phase A of the autonomous Velix production: a run created in the UI persists, and a stage that was in flight when
// the app closed comes back as pending (same stage, nothing duplicated) after the restart, ready to resume.

const MIGRATIONS = resolve(import.meta.dirname, '../../packages/database/migrations');

const openProduce = async (page: Page) => {
  await page.getByRole('link', { name: 'Aethera Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Produzir' }).click();
  return page.getByRole('region', { name: 'Produções persistidas' });
};

test('produção persistida sobrevive ao reinício e a etapa interrompida volta como pendente', async () => {
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const env = { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' };
  const first = await launchApp(dataDir, { env });
  const project = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await first.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const runs = await openProduce(first.page);
  await runs.getByLabel('Tema da nova produção').fill('Energia solar no Brasil');
  await runs.getByLabel('Formato').selectOption('youtube-short');
  await runs.getByLabel('Duração em minutos').fill('1');
  await expect(runs).toContainText('cerca de 145 palavras');
  await runs.getByRole('button', { name: 'Nova produção' }).click();
  await expect(runs.getByText('Rascunho', { exact: true })).toBeVisible();
  await expect(runs).toContainText('Nenhuma etapa agendada ainda.');
  // R3: the header's flow follows this production; with no stage yet every phase is pending and none is current.
  const flow = first.page.getByRole('region', { name: 'Fluxo do Aethera' });
  await expect(flow).toContainText('Fluxo da produção “Energia solar no Brasil”');
  await expect(flow.locator('[data-phase]')).toHaveCount(4);
  await expect(flow.locator('[data-status="pending"]')).toHaveCount(4);
  const [listed] = await first.page.evaluate((id) => window.neuralbridge.video.productionRunList(id), project.id);
  if (!listed) throw new Error('a produção criada não foi listada');
  const run = listed;
  expect(run).toMatchObject({ topic: 'Energia solar no Brasil', formatId: 'youtube-short', status: 'draft' });
  // A path outside the project cannot be smuggled into the brief's project.
  await expect(first.page.evaluate((id) => window.neuralbridge.video.productionRunCreate({ projectId: id, brief: { schemaVersion: 1, projectId: 'outro', format: { id: 'square', width: 1080, height: 1080, fps: 30, aspectRatio: '1:1', safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }, productionType: 'x', topic: 'x', targetDurationSeconds: 10, language: 'pt-BR', audience: 'x', tone: 'x', narrativeStyle: 'x', researchDepth: 'light', sourceCount: 0, pace: 'standard', budgetUsd: 0 } }), project.id)).rejects.toThrow(/outro projeto/);
  await first.app.close();

  // The app closed while a research stage ran: its task never finished.
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(velixProductionStages).values({ id: 'stage-interrupted', runId: run.id, kind: 'research', status: 'running', inputHash: 'h', costEstimateUsd: 0.4, checkpoint: JSON.stringify({ prompt: 'Pesquise', taskProjectId: project.id }), taskId: 'task-gone' }).run();
  handle.close();

  const restarted = await launchApp(dataDir, { env });
  const again = await openProduce(restarted.page);
  const stages = again.getByRole('list', { name: 'Etapas da produção' });
  await expect(stages.getByRole('listitem')).toHaveCount(1);
  await expect(stages).toContainText('Pesquisa');
  await expect(stages).toContainText('Pendente');
  await expect(stages).toContainText('Interrompida');
  await expect(again.getByText('Pausada', { exact: true })).toBeVisible();
  const flowAgain = restarted.page.getByRole('region', { name: 'Fluxo do Aethera' });
  await expect(flowAgain.locator('[data-phase="descobrir"]')).toHaveAttribute('data-status', 'paused');
  await expect(flowAgain.locator('[data-phase="descobrir"]')).toContainText('Pausada');
  await expect(flowAgain.locator('[data-phase="planejar"]')).toHaveAttribute('data-status', 'pending');
  const state = await restarted.page.evaluate((id) => window.neuralbridge.video.productionRunState(id), run.id);
  expect(state.stages).toHaveLength(1);
  expect(state.stages[0]).toMatchObject({ id: 'stage-interrupted', status: 'pending', taskId: null, error: { code: 'interrupted', retryable: true } });
  expect(state.budget.reserveUsd).toBe(0);
  await again.getByRole('button', { name: 'Cancelar' }).click();
  await expect(again.getByText('Cancelada', { exact: true })).toBeVisible();
  await restarted.app.close();
  const check = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  expect(check.db.select().from(velixProductionStages).where(eq(velixProductionStages.runId, run.id)).all().map((stage) => stage.status)).toEqual(['cancelled']);
  check.close();
});

test('AS-10 exibe o gate de evidências e preserva o bloqueio sem envelope', async () => {
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const env = { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' };
  const first = await launchApp(dataDir, { env });
  const project = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await first.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const runs = await openProduce(first.page);
  await runs.getByLabel('Tema da nova produção').fill('Validação AS-10');
  await runs.getByRole('button', { name: 'Nova produção' }).click();
  const [run] = await first.page.evaluate((id) => window.neuralbridge.video.productionRunList(id), project.id);
  if (!run) throw new Error('a produção criada não foi listada');
  await first.app.close();

  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(velixProductionStages).values({ id: 'stage-aethera-validation', runId: run.id, kind: 'game_research', status: 'pending', inputHash: 'h', costEstimateUsd: 0, checkpoint: JSON.stringify({}), taskId: null }).run();
  handle.close();

  const reopened = await launchApp(dataDir, { env });
  const panel = await openProduce(reopened.page);
  const validation = panel.getByLabel('Validação AS-10');
  await expect(validation).toBeVisible();
  await validation.getByLabel('Pasta de referência AS-10').fill(dataDir);
  await validation.getByRole('button', { name: 'Verificar evidências' }).click();
  const result = validation.getByRole('status', { name: 'Resultado da validação AS-10' });
  await expect(result).toContainText('Bloqueado');
  await expect(validation.getByLabel('Bloqueios AS-10')).toContainText('evidence-file');
  await reopened.app.close();
});

test('roteiro longo é escrito em lotes pela interface, consolidado sem repetição e reaberto após reiniciar', async () => {
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const env = { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' };
  const first = await launchApp(dataDir, { env });
  const project = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await first.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const runs = await openProduce(first.page);
  await runs.getByLabel('Tema da nova produção').fill('Energia solar no Brasil');
  await runs.getByLabel('Tipo de produção').selectOption('documentary');
  await runs.getByLabel('Duração em minutos').fill('22');
  await expect(runs).toContainText('Roteiro longo: 5 capítulos escritos em lotes.');
  await runs.getByRole('button', { name: 'Nova produção' }).click();
  await runs.getByRole('button', { name: 'Gerar roteiro' }).click();
  const script = runs.getByLabel('Roteiro consolidado');
  await expect(script).toBeVisible({ timeout: 60_000 });
  await expect(script).toContainText('5 capítulos · 1 repetição(ões) removida(s)');
  const [run] = await first.page.evaluate((id) => window.neuralbridge.video.productionRunList(id), project.id);
  if (!run) throw new Error('a produção criada não foi listada');
  const saved = await first.page.evaluate((id) => window.neuralbridge.video.productionRunScriptRead(id), run.id);
  expect(saved).toMatchObject({ mode: 'chapters', targetWords: 3190 });
  expect(saved?.words).toBeGreaterThanOrEqual(3_000);
  expect(saved?.narration.split('A frase repetida entre os dois primeiros capítulos do roteiro longo.')).toHaveLength(2);
  expect(existsSync(join(folder, 'producoes', run.id, 'roteiro', 'capitulo-05.json'))).toBe(true);
  const state = await first.page.evaluate((id) => window.neuralbridge.video.productionRunState(id), run.id);
  expect(state.stages.map((stage) => [stage.kind, stage.status])).toEqual([['script', 'completed']]);
  expect(state.artifacts.map((artifact) => artifact.kind)).toEqual(['script-outline', 'script-chapter', 'script-chapter', 'script-chapter', 'script-chapter', 'script-chapter', 'script']);
  await first.app.close();

  const restarted = await launchApp(dataDir, { env });
  const again = await openProduce(restarted.page);
  await expect(again.getByLabel('Roteiro consolidado')).toContainText('5 capítulos');
  await expect(again.getByRole('button', { name: 'Gerar roteiro' })).toHaveCount(0);
  await restarted.app.close();
});

test('evidências: encontrado fica separado de autorizado e o fato só passa com evidência aprovada', async () => {
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const env = { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' };
  const first = await launchApp(dataDir, { env });
  const project = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await first.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const runs = await openProduce(first.page);
  await runs.getByLabel('Tema da nova produção').fill('Listas e líderes');
  await runs.getByLabel('Duração em minutos').fill('1');
  await runs.getByRole('button', { name: 'Nova produção' }).click();
  await runs.getByRole('button', { name: 'Gerar roteiro' }).click();
  await expect(runs.getByLabel('Roteiro consolidado')).toContainText('formato Dossiê v1', { timeout: 60_000 });
  await first.app.close();

  // A source a person already approved in Discovery.
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(velixMediaReferences).values({ id: 'ref-approved', projectId: project.id, url: 'https://fonte.exemplo.org/lista', kind: 'article', title: 'Lista oficial', publisher: 'Fonte aprovada', publishedAt: '2025-01-10', reviewStatus: 'approved', retrievedAt: '2025-01-11' }).run();
  handle.close();

  const restarted = await launchApp(dataDir, { env });
  const again = await openProduce(restarted.page);
  const evidence = again.getByLabel('Evidências do roteiro');
  await evidence.getByRole('button', { name: 'Verificar evidências' }).click();
  const claims = evidence.getByRole('list', { name: 'Afirmações do roteiro' });
  await expect(claims.getByRole('listitem').filter({ hasText: 'Na primeira lista' }).first()).toBeVisible({ timeout: 60_000 });
  const status = evidence.getByRole('status', { name: 'Situação das evidências' });
  await expect(status).toContainText('1 de 1 afirmação(ões) factual(is) sem evidência aprovada');
  await expect(evidence).toContainText('Encontrada, não autorizada');
  await expect(evidence).toContainText('2 fonte(s) ou mídia(s) encontrada(s) aguardam revisão na Descoberta');
  // Only the approved reference can be approved; the blog post has no approve button.
  await expect(evidence.getByRole('button', { name: 'Aprovar evidência' })).toHaveCount(1);
  await evidence.getByRole('button', { name: 'Aprovar evidência' }).click();
  await expect(status).toContainText('Todas as 1 afirmação(ões) factual(is) têm evidência aprovada.');
  await evidence.getByLabel('Tipo da afirmação: Uma pergunta simples.').selectOption('estimate');
  await expect(evidence.getByLabel('Tipo da afirmação: Uma pergunta simples.')).toHaveValue('estimate');
  const [run] = await restarted.page.evaluate((id) => window.neuralbridge.video.productionRunList(id), project.id);
  if (!run) throw new Error('a produção criada não foi listada');
  const state = await restarted.page.evaluate((id) => window.neuralbridge.video.productionRunState(id), run.id);
  expect(state.qualityReports.map((report) => report.exportable)).toEqual([false, true, true]);
  expect(existsSync(join(folder, 'producoes', run.id, 'pesquisa', 'afirmacoes.json'))).toBe(true);
  await restarted.app.close();

  const check = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  expect(check.db.select().from(velixMediaReferences).all().filter((row) => row.reviewStatus === 'pending').map((row) => row.url).sort()).toEqual(['https://blog.exemplo.com/lista', 'https://video.exemplo.com/lista']);
  expect(check.db.select().from(velixMediaRights).all()).toHaveLength(0);
  check.close();
});

test('storyboard: editar, dividir, reordenar, trocar e bloquear sobrevivem ao reinício exatamente', async () => {
  const dataDir = velixDataDir();
  const folder = join(dataDir, 'Video');
  mkdirSync(folder, { recursive: true });
  const env = { ...FAKE_AGENTS, NB_YOUTUBE_API_KEY: '' };
  const first = await launchApp(dataDir, { env });
  const project = await first.page.evaluate((path) => window.neuralbridge.projects.add(path), folder);
  await first.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const runs = await openProduce(first.page);
  await runs.getByLabel('Tema da nova produção').fill('Listas e líderes');
  await runs.getByLabel('Duração em minutos').fill('1');
  await runs.getByRole('button', { name: 'Nova produção' }).click();
  await runs.getByRole('button', { name: 'Gerar roteiro' }).click();
  await expect(runs.getByLabel('Roteiro consolidado')).toContainText('formato Dossiê v1', { timeout: 60_000 });
  await first.app.close();

  // One video with verified rights and one found but still pending review.
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(velixMediaReferences).values([
    { id: 'ref-lista', projectId: project.id, url: 'https://acervo.exemplo/lista', kind: 'video', title: 'Primeira lista do líder', publisher: 'Acervo', publishedAt: '2025-01-10', reviewStatus: 'approved', retrievedAt: '2025-01-11' },
    { id: 'ref-pendente', projectId: project.id, url: 'https://blog.exemplo/lista', kind: 'video', title: 'Lista do líder no blog', publisher: 'Blog', publishedAt: null, reviewStatus: 'pending', retrievedAt: '2025-01-11' },
  ]).run();
  handle.db.insert(velixMediaRights).values({ id: 'rights-lista', projectId: project.id, referenceId: 'ref-lista', owner: 'Acervo', sourceUrl: 'https://acervo.exemplo/lista', license: 'CC BY 4.0', evidence: 'licença no site', verifiedAt: '2025-01-11', credit: 'Acervo', status: 'verified_allowed' }).run();
  handle.close();

  const second = await launchApp(dataDir, { env });
  let panel = (await openProduce(second.page)).getByLabel('Storyboard da produção');
  await panel.getByRole('button', { name: 'Gerar storyboard' }).click();
  const status = panel.getByRole('status', { name: 'Situação do storyboard' });
  await expect(status).toContainText('1 cena(s), todas com mídia autorizada ou fallback declarado.', { timeout: 60_000 });
  await expect(panel.getByRole('listitem', { name: 'Cena 1', exact: true })).toContainText('Vídeo: Primeira lista do líder');
  await panel.getByRole('button', { name: 'Dividir cena 1' }).click();
  await expect(panel.getByRole('list', { name: 'Cenas do storyboard' }).getByRole('listitem')).toHaveCount(2);
  await expect(panel.getByRole('listitem', { name: 'Cena 2', exact: true })).toContainText('Na primeira lista');
  await panel.getByRole('button', { name: 'Mover cena 2 para cima' }).click();
  await expect(panel.getByRole('listitem', { name: 'Cena 1', exact: true })).toContainText('Na primeira lista');
  await expect(panel.getByText('Cena 2 movida para a posição 1.')).toBeAttached();
  await panel.getByLabel('Texto na tela da cena 1').fill('Quem liderava?');
  await panel.getByLabel('Texto na tela da cena 1').blur();
  await expect(panel).toContainText('versão 4');
  await panel.getByRole('listitem', { name: 'Cena 2', exact: true }).getByRole('button', { name: 'Trocar mídia' }).click();
  const options = panel.getByLabel('Mídias para a cena 2');
  await expect(options.getByRole('button', { name: 'Usar Lista do líder no blog na cena 2' })).toBeDisabled();
  await expect(options).toContainText('Encontrada, aguardando revisão');
  await options.getByRole('button', { name: 'Documento' }).click();
  await expect(panel.getByRole('listitem', { name: 'Cena 2', exact: true })).toContainText('Fallback: Documento');
  await panel.getByRole('button', { name: 'Bloquear cena 1' }).click();
  await expect(panel.getByRole('button', { name: 'Desbloquear cena 1' })).toHaveAttribute('aria-pressed', 'true');
  const [run] = await second.page.evaluate((id) => window.neuralbridge.video.productionRunList(id), project.id);
  if (!run) throw new Error('a produção criada não foi listada');
  const before = await second.page.evaluate((id) => window.neuralbridge.video.storyboardGet(id), run.id);
  expect(before).toMatchObject({ version: 6, renderable: true });
  await second.app.close();

  const third = await launchApp(dataDir, { env });
  panel = (await openProduce(third.page)).getByLabel('Storyboard da produção');
  await expect(panel).toContainText('versão 6');
  await expect(panel.getByLabel('Texto na tela da cena 1')).toHaveValue('Quem liderava?');
  await expect(panel.getByRole('button', { name: 'Desbloquear cena 1' })).toBeVisible();
  await expect(panel.getByRole('listitem', { name: 'Cena 2', exact: true })).toContainText('Fallback: Documento');
  const after = await third.page.evaluate((id) => window.neuralbridge.video.storyboardGet(id), run.id);
  expect(after).toEqual(before);
  await third.app.close();
});

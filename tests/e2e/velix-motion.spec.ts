import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';
import { velixDataDir } from './velix-extension';

const exec = promisify(execFile);

async function motion() {
  const dataDir = velixDataDir();
  const launched = await launchApp(dataDir, { env: FAKE_AGENTS });
  const root = join(dataDir, 'Video'); mkdirSync(root, { recursive: true });
  const project = await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await launched.page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  await launched.page.evaluate(() => { window.location.hash = '#/video'; });
  await launched.page.getByRole('tab', { name: 'Motion' }).click();
  return { ...launched, root, projectId: project.id, dataDir };
}

async function approvedScript(page: Awaited<ReturnType<typeof motion>>['page'], projectId: string) {
  const brief = await page.evaluate((id) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'brief', content: 'brief' }), projectId);
  await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: projectId, versionId: brief.id });
  const script = await page.evaluate(({ id, sourceVersionId }) => window.neuralbridge.video.productionEditorialVersion({ projectId: id, kind: 'script', sourceVersionId, content: 'Roteiro aprovado' }), { id: projectId, sourceVersionId: brief.id });
  return script.id;
}

test('compõe com prévia, valida legendas, salva e recupera após reiniciar', async () => {
  const { app, page, projectId, dataDir } = await motion();
  const panel = page.getByRole('region', { name: 'Motion Aethera' });
  await expect(panel.getByRole('region', { name: 'Prévia Motion' })).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel('Texto de abertura').fill('Abertura editada');
  await panel.getByRole('button', { name: 'Cartão' }).click();
  await panel.getByLabel('Legendas', { exact: true }).fill('sem tempo');
  await panel.getByRole('button', { name: 'Importar legendas' }).click();
  await expect(panel.getByRole('alert')).toContainText('bloco 1');
  await panel.getByLabel('Legendas', { exact: true }).fill('1\n00:00:00,000 --> 00:00:01,000\nOlá');
  await panel.getByRole('button', { name: 'Importar legendas' }).click();
  await expect(panel).toContainText('1 legenda(s) na composição.');
  await panel.getByRole('button', { name: 'Salvar composição' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Composição salva.' })).toBeVisible();
  await app.close();
  const restarted = await launchApp(dataDir, { env: FAKE_AGENTS });
  const saved = await restarted.page.evaluate((id) => window.neuralbridge.video.motionLoad(id), projectId);
  expect(saved?.scenes).toHaveLength(2);
  expect(saved?.scenes[0]).toMatchObject({ kind: 'title', text: 'Abertura editada' });
  expect(saved?.captions).toHaveLength(1);
  await restarted.app.close();
});

test('o contrato recusa dados que não são cena, e o render exige roteiro aprovado', async () => {
  const { app, page, projectId } = await motion();
  const base = { schemaVersion: 1 as const, templateId: 'velix-base' as const, templateVersion: 1 as const, width: 640, height: 360, fps: 15, captions: [] };
  await expect(page.evaluate(({ id, project }) => window.neuralbridge.video.motionSave({ projectId: id, project: { ...project, scenes: [{ id: 'x', kind: 'script', durationInFrames: 1, transition: 'cut' }] } as never }), { id: projectId, project: base })).rejects.toThrow();
  await page.evaluate(({ id, project }) => window.neuralbridge.video.motionSave({ projectId: id, project: { ...project, scenes: [{ id: 't', kind: 'title', text: 'Oi', durationInFrames: 10, transition: 'cut' }] } }), { id: projectId, project: base });
  await expect(page.evaluate((id) => window.neuralbridge.video.motionRender({ projectId: id, scriptVersionId: 'nao-existe' }), projectId)).rejects.toThrow(/aprovado/i);
  const scriptId = await approvedScript(page, projectId);
  await expect(page.evaluate(({ id, version }) => window.neuralbridge.video.motionRender({ projectId: id, scriptVersionId: version }), { id: projectId, version: scriptId })).rejects.toThrow(/aprovado/i);
  await app.close();
});

test('sugestão do agente só entra na composição depois de aplicada por uma pessoa, e o render real passa no FFprobe', async () => {
  test.skip(process.env['NB_MOTION'] !== '1', 'renders with the Remotion browser (NB_MOTION=1, after npm run build:motion)');
  test.setTimeout(240_000);
  const { app, page, projectId, root } = await motion();
  const scriptId = await approvedScript(page, projectId);
  await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: projectId, versionId: scriptId });
  await page.reload();
  await page.evaluate(() => { window.location.hash = '#/video'; });
  await page.getByRole('tab', { name: 'Motion' }).click();
  const panel = page.getByRole('region', { name: 'Motion Aethera' });
  await panel.getByLabel('Roteiro aprovado da composição').selectOption(scriptId);
  await panel.getByRole('button', { name: 'Gerar motions do roteiro' }).click();
  await expect(panel.getByRole('list', { name: 'Sugestão de cenas' })).toContainText('Abertura sugerida');
  await expect(panel.getByLabel('Texto de abertura')).toBeVisible();
  await panel.getByRole('button', { name: 'Aplicar todas' }).click();
  await expect(panel.getByLabel('Texto de sugestao-1')).toHaveValue('Abertura sugerida');
  await panel.getByRole('button', { name: 'Renderizar Motion' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'completed' })).toBeVisible({ timeout: 200_000 });
  const text = await panel.getByRole('status').filter({ hasText: 'completed' }).innerText();
  const output = /renders\/motion-[\w-]+\.mp4/.exec(text)?.[0]; if (!output) throw new Error('saída ausente');
  expect(existsSync(join(root, output))).toBe(true);
  const probe = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', join(root, output)]);
  expect(probe.stdout).toContain('video');
  const manifest = JSON.parse(readFileSync(join(root, output.replace('.mp4', '.json')), 'utf8')) as { editorialVersionId: string; scriptHash: string; compositionHash: string };
  expect(manifest).toMatchObject({ editorialVersionId: scriptId, scriptHash: expect.stringMatching(/^[0-9a-f]{64}$/), compositionHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  await app.close();
});

test('template, número com fonte, legenda JSON e ajuste entram na composição; sem pixels fora da janela', async () => {
  const { app, page, projectId } = await motion();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(800, 700));
  const panel = page.getByRole('region', { name: 'Motion Aethera' });
  await expect(panel.getByRole('region', { name: 'Prévia Motion' })).toBeVisible({ timeout: 15_000 });
  await panel.getByLabel('Template Motion').selectOption('velix-editorial');
  await panel.getByRole('button', { name: 'Número' }).click();
  await panel.getByLabel('Legendas', { exact: true }).fill('[{"text":"Oi","startMs":100,"endMs":900,"timestampMs":null,"confidence":null}]');
  await panel.getByRole('button', { name: 'Importar legendas' }).click();
  await panel.getByLabel('Ajuste das legendas').fill('200');
  await panel.getByRole('button', { name: 'Aplicar ajuste' }).click();
  await panel.getByRole('button', { name: 'Salvar composição' }).click();
  await expect(panel.getByRole('status').filter({ hasText: 'Composição salva.' })).toBeVisible();
  const saved = await page.evaluate((id) => window.neuralbridge.video.motionLoad(id), projectId);
  expect(saved).toMatchObject({ templateId: 'velix-editorial', captions: [{ startMs: 300, endMs: 1100 }] });
  expect(saved?.scenes.at(-1)).toMatchObject({ kind: 'stat' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await app.close();
});


test('com movimento reduzido a prévia abre a composição sem erro', async () => {
  const { app, page } = await motion();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.evaluate(() => { window.location.hash = '#/video'; });
  await page.getByRole('tab', { name: 'Motion' }).click();
  await expect(page.getByRole('region', { name: 'Prévia Motion' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('region', { name: 'Motion Aethera' }).getByRole('alert')).toHaveCount(0);
  await app.close();
});

test('o render respeita a flag de desativação', async () => {
  const dataDir = velixDataDir();
  const { app, page } = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_MOTION_DISABLED: '1' } });
  const root = join(dataDir, 'Video'); mkdirSync(root, { recursive: true });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  await expect(page.evaluate((id) => window.neuralbridge.video.motionRender({ projectId: id, scriptVersionId: 'x' }), project.id)).rejects.toThrow(/desativado/);
  await app.close();
});

test('a tela Motion não cria rolagem horizontal nas larguras suportadas', async () => {
  const { app, page } = await motion();
  await expect(page.getByRole('region', { name: 'Prévia Motion' })).toBeVisible({ timeout: 15_000 });
  // The window cannot go below 960 px wide, so that is the smallest real size.
  for (const { width, height } of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 960, height: 600 }]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(size.width, size.height), { width, height });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
    const measured = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, width: window.innerWidth }));
    console.log(`motion responsive: pedido ${width} real ${measured.width} excesso ${measured.overflow}`);
    expect(measured.overflow).toBeLessThanOrEqual(1);
  }
  await app.close();
});

test('com a quota do Claude bloqueada a sugestão recusa o Claude e não cria tarefa, mas o Codex segue', async () => {
  const dataDir = velixDataDir();
  const { app, page } = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_FAKE_LIMIT: '97' } });
  const root = join(dataDir, 'Video'); mkdirSync(root, { recursive: true });
  const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
  const scriptId = await approvedScript(page, project.id);
  await page.evaluate(({ id, versionId }) => window.neuralbridge.video.productionEditorialDecision({ projectId: id, versionId, decision: 'approved' }), { id: project.id, versionId: scriptId });
  const suggest = (agent: 'claude' | 'codex') => page.evaluate(({ id, version, who }) => window.neuralbridge.video.motionSuggest({ projectId: id, scriptVersionId: version, agent: who }), { id: project.id, version: scriptId, who: agent });
  await expect(suggest('claude')).rejects.toThrow(/limite/i);
  expect(await page.evaluate((id) => window.neuralbridge.tasks.list({ projectId: id, limit: 20 }), project.id)).toEqual([]);
  expect((await suggest('codex')).agent).toBe('codex');
  await app.close();
});

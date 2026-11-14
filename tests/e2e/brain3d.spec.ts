import { join } from 'node:path';
import Database from 'better-sqlite3';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';
import { changedShare, litShare, recallThroughMcp, seedBrain } from './brain3d-helpers';

// Phase 19: the 3D Neural Brain, against the real app, real database, real MCP server and the fake agent
// (which speaks the real CLI formats). Rendering checks use screenshots; behaviour details are unit-tested
// in apps/desktop/test/brain3d-*.test.ts.

const scene = (page: Page) => page.getByTestId('brain3d');
const stat = async (page: Page, name: string) => Number(await scene(page).getAttribute(`data-${name}`));

const MEMORIES = [
  ...Array.from({ length: 8 }, (_, i) => ({ title: `Loja decisão ${i}`, content: `Checkout e carrinho. Ver [[Loja decisão ${(i + 1) % 8}]].`, type: 'decision', project: 'loja' })),
  ...Array.from({ length: 5 }, (_, i) => ({ title: `API bug ${i}`, content: `Timeout no pool de conexões ${i}.`, type: 'bug_fix', project: 'api' })),
  { title: 'Convenção global', content: 'Commits em inglês. Ver [[Retry com backoff]].', type: 'preference', project: null },
  { title: 'Retry com backoff', content: 'Três tentativas com espera exponencial.', type: 'code_pattern', project: null },
];

async function openBrain(options: { seed?: boolean; dataDir?: string; env?: Record<string, string>; chromiumArgs?: string[] } = {}) {
  const launched = await launchApp(options.dataDir ?? freshDataDir(), { ...(options.env ? { env: options.env } : {}), ...(options.chromiumArgs ? { chromiumArgs: options.chromiumArgs } : {}) });
  await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(1280, 820));
  const projects = options.seed === false ? {} : await seedBrain(launched.page, { projects: ['loja', 'api'], memories: MEMORIES });
  await launched.page.evaluate(() => (location.hash = '#/memory/brain'));
  return { ...launched, projects };
}

async function waitForFrames(page: Page, atLeast = 20) {
  await expect.poll(() => stat(page, 'frames'), { timeout: 20_000 }).toBeGreaterThanOrEqual(atLeast);
}

/**
 * Waits on the scene's own state. Stats arrive every 500 ms, so only a new frame count is a new sample: the first
 * one may predate the action, and the camera has settled when two later samples agree with no flight running.
 */
async function settledCamera(page: Page): Promise<string> {
  let frames = await stat(page, 'frames');
  let samples: string[] = [];
  await expect.poll(async () => {
    const current = await stat(page, 'frames');
    if (current === frames) return false;
    frames = current;
    samples = (await stat(page, 'flying')) === 0 ? [...samples, await scene(page).getAttribute('data-camera') ?? ''] : [];
    const [, previous, last] = samples.slice(-3);
    return samples.length >= 3 && previous === last;
  }, { timeout: 20_000, intervals: [100] }).toBe(true);
  return samples.at(-1) ?? '';
}

async function stillCamera(page: Page) {
  const rotate = page.getByRole('button', { name: 'Rotação automática' });
  if ((await rotate.getAttribute('aria-pressed')) === 'true') await rotate.click();
}

test('a real three-dimensional brain of glowing particles that keeps moving', async () => {
  const { app, page } = await openBrain();
  await waitForFrames(page);
  expect(await stat(page, 'particles')).toBeGreaterThanOrEqual(8_000);
  expect(await stat(page, 'connections')).toBeGreaterThan(1_000);
  await stillCamera(page);
  const box = scene(page);
  const first = await box.screenshot();
  expect(litShare(first)).toBeGreaterThan(0.02);
  await expect.poll(() => stat(page, 'impulses')).toBeGreaterThan(3);
  await page.waitForTimeout(1_200);
  // Same camera: the change comes from impulses, twinkle and lit nodes.
  expect(changedShare(first, await box.screenshot())).toBeGreaterThan(0.002);
  await app.close();
});

test('rotate, zoom, pan, keyboard and reset move the camera', async () => {
  const { app, page } = await openBrain();
  await waitForFrames(page);
  await stillCamera(page);
  // Without ambient effects the picture only changes when the camera moves, so differences measure the camera.
  await page.getByLabel('Intensidade dos efeitos').selectOption('off');
  await expect.poll(() => stat(page, 'impulses'), { timeout: 15_000 }).toBe(0);
  const box = scene(page);
  const bounds = await box.boundingBox();
  if (!bounds) throw new Error('scene not visible');
  const cx = bounds.x + bounds.width * 0.35;
  const cy = bounds.y + bounds.height * 0.5;
  await page.getByRole('button', { name: 'Centralizar' }).click();
  const homeCamera = await settledCamera(page);
  const home = await box.screenshot();

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 220, cy + 40, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const rotated = await box.screenshot();
  const rotation = changedShare(home, rotated);
  expect(rotation).toBeGreaterThan(0.05);

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(600);
  expect(changedShare(rotated, await box.screenshot())).toBeGreaterThan(0.05);

  const beforePan = await box.screenshot();
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 120, cy + 60, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(600);
  expect(changedShare(beforePan, await box.screenshot())).toBeGreaterThan(0.05);

  await box.focus();
  const beforeKeys = await box.screenshot();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  expect(changedShare(beforeKeys, await box.screenshot())).toBeGreaterThan(0.05);

  await page.getByRole('button', { name: 'Centralizar' }).click();
  expect(await settledCamera(page)).toBe(homeCamera);
  const back = changedShare(home, await box.screenshot());
  expect(back).toBeLessThan(rotation / 2);
  await app.close();
});

test('memory nodes are the real memories: counts, filters, search, click selection and connections match the database', async () => {
  const { app, page, projects } = await openBrain();
  await waitForFrames(page);
  await expect(page.getByTestId('memory-count')).toHaveText(String(MEMORIES.length));
  // Links resolved in the database: 8 in the Loja ring and 1 between the globals.
  const resolved = await page.evaluate(async () => (await window.neuralbridge.brain.graph3d()).links.length);
  expect(resolved).toBe(9);
  await expect(page.getByTestId('link-count')).toHaveText('9');

  await page.getByLabel('Filtrar por projeto').selectOption(projects['api'] ?? '');
  await expect(page.getByTestId('memory-count')).toHaveText('5');
  await expect(page.getByTestId('link-count')).toHaveText('0');
  await page.getByLabel('Filtrar por projeto').selectOption({ label: 'Só globais' });
  await expect(page.getByTestId('memory-count')).toHaveText('2');
  await page.getByLabel('Filtrar por projeto').selectOption({ label: 'Todos os projetos' });
  await page.getByLabel('Filtrar por tipo').selectOption({ label: 'Bug resolvido' });
  await expect(page.getByTestId('memory-count')).toHaveText('5');
  await page.getByLabel('Filtrar por tipo').selectOption({ label: 'Todos os tipos' });

  await stillCamera(page);
  const search = page.getByLabel('Buscar memória no cérebro');
  await search.fill('decisão 3');
  await page.getByRole('list', { name: 'Memórias encontradas' }).getByRole('button', { name: 'Loja decisão 3' }).click();
  const details = page.getByRole('region', { name: 'Memória selecionada' });
  await expect(details.getByRole('heading', { name: 'Loja decisão 3' })).toBeVisible();
  await expect(details).toContainText('Decisão');
  await expect(details).toContainText('loja');
  await expect(details.getByRole('list', { name: 'Conexões' })).toContainText('Loja decisão 4');
  await expect(details.getByRole('list', { name: 'Conexões' })).toContainText('Loja decisão 2');

  // "Localizar" centres the camera on the memory; a click there selects it again after clearing.
  await page.waitForTimeout(1_400);
  await scene(page).focus();
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  const bounds = await scene(page).boundingBox();
  if (!bounds) throw new Error('scene not visible');
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.getByRole('region', { name: 'Memória selecionada' }).getByRole('heading')).toHaveText('Loja decisão 3');

  // Creating a memory appears in the scene; deleting it removes it.
  const created = await page.evaluate(() => window.neuralbridge.brain.store({ title: 'Nova memória 3D', content: 'x', type: 'learning', projectId: null }));
  await page.reload();
  await expect(page.getByTestId('memory-count')).toHaveText(String(MEMORIES.length + 1));
  await page.evaluate((id) => window.neuralbridge.brain.delete(id, false), created.memory.id);
  await page.reload();
  await expect(page.getByTestId('memory-count')).toHaveText(String(MEMORIES.length));
  await app.close();
});

test('real retrievals light the brain: an agent via MCP and a task’s RAG context, never without an event', async () => {
  const dataDir = freshDataDir();
  const { app, page, projects } = await openBrain({ dataDir, env: FAKE_AGENTS });
  await waitForFrames(page);
  const activity = page.getByRole('region', { name: 'Atividade real' });
  await expect(page.getByRole('status', { name: 'Sem atividade real agora' })).toBeVisible();
  for (let i = 0; i < 4; i++) {
    expect(await stat(page, 'real-impulses')).toBe(0);
    await page.waitForTimeout(500);
  }
  await expect(activity).toContainText('Nenhuma recuperação');

  // Claude Code, through the MCP server process, reads a global memory.
  await recallThroughMcp(dataDir, 'claude-code', 'Retry com backoff');
  await expect(activity).toContainText('Retry com backoff', { timeout: 8_000 });
  await expect(activity).toContainText('Claude Code');
  await expect(page.getByRole('status', { name: 'Atividade real agora' })).toBeVisible();
  await expect.poll(() => stat(page, 'real-impulses'), { timeout: 4_000 }).toBeGreaterThan(0);

  // A task in the Loja project gets memories as RAG context; those memories light up too.
  await page.evaluate((projectId) => window.neuralbridge.tasks.start({ prompt: 'Explique o checkout e o carrinho da loja', projectId, mode: 'claude' }), projects['loja'] ?? null);
  await expect(activity).toContainText('contexto da tarefa', { timeout: 15_000 });
  await expect(activity).toContainText('Loja decisão');
  await app.close();
});

test('effects and quality are under the user’s control and remembered; reduced motion stops ambient motion', async () => {
  const dataDir = freshDataDir();
  let { app, page } = await openBrain({ dataDir });
  await waitForFrames(page);
  await page.getByLabel('Qualidade gráfica').selectOption('low');
  await expect.poll(() => stat(page, 'particles')).toBe(8_000);
  await page.getByLabel('Qualidade gráfica').selectOption('high');
  await expect.poll(() => stat(page, 'particles')).toBe(40_000);
  const geometriesAtHigh = await stat(page, 'geometries');
  // Switching back and forth must not pile up GPU geometries.
  for (const level of ['low', 'medium', 'high', 'low', 'high']) {
    await page.getByLabel('Qualidade gráfica').selectOption(level);
    await expect.poll(() => scene(page).getAttribute('data-quality')).toBe(level);
  }
  await expect.poll(() => stat(page, 'geometries')).toBe(geometriesAtHigh);

  await page.getByLabel('Intensidade dos efeitos').selectOption('off');
  await expect.poll(() => stat(page, 'impulses'), { timeout: 15_000 }).toBe(0);
  await app.close();

  ({ app, page } = await launchApp(dataDir));
  await page.evaluate(() => (location.hash = '#/memory/brain'));
  await expect(page.getByLabel('Intensidade dos efeitos')).toHaveValue('off');
  await expect(page.getByLabel('Qualidade gráfica')).toHaveValue('high');
  await page.getByLabel('Intensidade dos efeitos').selectOption('normal');
  await waitForFrames(page);
  await expect.poll(() => stat(page, 'impulses')).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.getByRole('button', { name: 'Rotação automática' })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Legenda' })).toContainText('(pausada)');
  await expect.poll(() => stat(page, 'impulses'), { timeout: 15_000 }).toBe(0);
  await app.close();
});

test('the 2D graph stays one click away, and the page explains an empty brain', async () => {
  const { app, page } = await openBrain({ seed: false });
  await waitForFrames(page);
  await expect(page.getByText('Nenhuma memória ainda.', { exact: false })).toBeVisible();
  await expect(page.getByTestId('memory-count')).toHaveText('0');
  await page.getByRole('link', { name: 'Ver em 2D' }).click();
  await expect(page).toHaveURL(/#\/memory\/graph/);
  await app.close();
});

test('without WebGL the page offers the 2D graph and the memory list instead of a blank screen', async () => {
  const { app, page } = await openBrain({ chromiumArgs: ['--disable-gpu', '--disable-software-rasterizer'] });
  await expect(page.getByRole('alert')).toContainText('WebGL');
  await expect(page.getByRole('link', { name: 'Abrir o grafo 2D' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Memórias' }).getByRole('listitem')).toHaveCount(MEMORIES.length);
  await app.close();
});

test('opening and leaving the 3D brain many times keeps it rendering, without exhausting WebGL contexts', async () => {
  const { app, page } = await openBrain({ seed: false });
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (/WebGL|context/i.test(message.text())) warnings.push(message.text());
  });
  await waitForFrames(page);
  for (let i = 0; i < 18; i++) {
    await page.evaluate(() => (location.hash = '#/memory/graph'));
    await expect(scene(page)).toHaveCount(0);
    await page.evaluate(() => (location.hash = '#/memory/brain'));
    await waitForFrames(page, 2);
  }
  await waitForFrames(page, 20);
  expect(warnings.filter((text) => /too many active webgl contexts|context lost/i.test(text))).toEqual([]);
  await app.close();
});

test('a large brain: five thousand memories load, stay interactive and keep animating', async () => {
  test.setTimeout(120_000);
  const dataDir = freshDataDir();
  const { app, page } = await openBrain({ dataDir, seed: false });
  await waitForFrames(page);
  // Bulk rows straight into the database (WAL allows a second writer); the app reads them on reload.
  const db = new Database(join(dataDir, 'db', 'brain.db'));
  const insert = db.prepare("INSERT INTO memories (id, title, content, type, source_kind) VALUES (?, ?, ?, 'learning', 'user')");
  db.transaction(() => {
    for (let i = 0; i < 5_000; i++) insert.run(`BULK${String(i).padStart(22, '0')}`, `Memória em massa ${i}`, `conteúdo ${i}`);
  })();
  db.close();
  await page.reload();
  await expect(page.getByTestId('memory-count')).toHaveText('5000', { timeout: 20_000 });
  const frames = await stat(page, 'frames');
  await page.waitForTimeout(2_000);
  expect(await stat(page, 'frames')).toBeGreaterThan(frames + 20);
  expect(await stat(page, 'fps')).toBeGreaterThan(15);
  await page.getByLabel('Buscar memória no cérebro').fill('massa 4321');
  await expect(page.getByRole('list', { name: 'Memórias encontradas' }).getByRole('button', { name: 'Memória em massa 4321' })).toBeVisible();
  await app.close();
});

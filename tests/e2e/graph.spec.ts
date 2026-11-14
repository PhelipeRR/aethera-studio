import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp } from './app';

const store = (page: Page, input: { title: string; content: string; type: string; tags?: string[] }) =>
  page.evaluate((value) => window.neuralbridge.brain.store(value as never), input);

async function openGraph(page: Page, timeout = 5_000): Promise<void> {
  await page.getByRole('link', { name: 'Memória', exact: true }).click();
  await page.getByRole('link', { name: 'Grafo' }).click();
  await expect(page.getByRole('img', { name: /^Grafo com/ })).toBeVisible({ timeout });
}

test('the graph shows real memories and links, and lets you navigate, trace paths and create pending memories', async () => {
  const { app, page } = await launchApp();
  await store(page, { title: 'Arquitetura', content: 'Ver [[Banco]] e [[Fantasma]].', type: 'decision', tags: ['core'] });
  await store(page, { title: 'Banco', content: 'Ver [[Cache]].', type: 'documentation', tags: ['core'] });
  await store(page, { title: 'Cache', content: 'Redis.', type: 'learning' });
  await store(page, { title: 'Isolada', content: 'Sem links.', type: 'preference' });

  await openGraph(page);
  const panel = page.getByRole('complementary', { name: 'Painel do grafo' });
  await expect(panel).toContainText('4 memórias, 2 links, 1 pendente.');

  // Keyboard-reachable navigation: find a node, see its neighbours, follow one.
  await panel.getByRole('searchbox', { name: 'Encontrar memória no grafo' }).fill('arqu');
  await panel.getByRole('button', { name: 'Arquitetura' }).click();
  const selected = panel.getByRole('region', { name: 'Nó selecionado' });
  await expect(selected.getByRole('heading', { name: 'Arquitetura' })).toBeVisible();
  await expect(selected).toContainText('Decisão');
  await expect(page).toHaveURL(/node=/);

  // Shortest path between two memories, and none to an isolated one.
  await selected.getByLabel('Caminho até').selectOption({ label: 'Cache' });
  await expect(selected.getByRole('status')).toHaveText('Arquitetura → Banco → Cache');
  await selected.getByLabel('Caminho até').selectOption({ label: 'Isolada' });
  await expect(selected.getByRole('status')).toHaveText('Não há caminho entre essas memórias.');

  // A pending node can be turned into a memory, which resolves the link.
  await selected.getByRole('button', { name: 'Fantasma' }).click();
  await expect(selected).toContainText('Pendente: ainda não existe uma memória com este título.');
  await selected.getByRole('link', { name: 'Criar esta memória' }).click();
  await expect(page.getByLabel('Título')).toHaveValue('Fantasma');
  await page.getByRole('button', { name: 'Criar memória' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Fantasma' })).toBeVisible();
  await page.getByRole('link', { name: 'Grafo' }).click();
  await expect(panel).toContainText('5 memórias, 3 links, 0 pendentes.');

  // Filters and grouping.
  await panel.getByLabel('Filtrar grafo por tag').selectOption('core');
  await expect(panel).toContainText('2 memórias, 1 link, 0 pendentes.');
  await panel.getByLabel('Agrupar por tipo').check();
  await expect(page.getByRole('img', { name: /^Grafo com 2 memórias/ })).toBeVisible();
  await app.close();
});

test('2,000 memories lay out and stay responsive', { tag: '@slow' }, async () => {
  test.setTimeout(240_000);
  const { app, page } = await launchApp();
  // Chains of linked memories plus cross links, written through the same IPC the UI uses.
  await page.evaluate(async () => {
    for (let i = 0; i < 2000; i++) {
      const links = [i > 0 ? `[[Nota ${i - 1}]]` : '', i % 7 === 0 && i > 20 ? `[[Nota ${i - 20}]]` : '', i % 50 === 0 ? `[[Ainda não ${i}]]` : ''].join(' ');
      await window.neuralbridge.brain.store({ title: `Nota ${i}`, content: `Conteúdo ${i} ${links}`, type: (['decision', 'learning', 'bug_fix', 'code_pattern'] as const)[i % 4] ?? 'decision' });
    }
  });

  const started = Date.now();
  await openGraph(page, 120_000);
  const panel = page.getByRole('complementary', { name: 'Painel do grafo' });
  await expect(panel).toContainText('2000 memórias', { timeout: 120_000 });
  const ready = Date.now() - started;
  const layoutMs = Number(await panel.locator('[data-layout-ms]').getAttribute('data-layout-ms'));

  // Interaction: zoom, fit and a drag-pan must each return quickly (the main thread is not blocked).
  const canvas = page.getByRole('img', { name: /^Grafo com/ });
  const box = await canvas.boundingBox();
  const timings: number[] = [];
  for (const action of [
    () => page.getByRole('button', { name: 'Aproximar' }).click(),
    () => page.getByRole('button', { name: 'Enquadrar tudo' }).click(),
    async () => {
      if (!box) return;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 6 });
      await page.mouse.up();
    },
  ]) {
    const t = Date.now();
    await action();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    timings.push(Date.now() - t);
  }
  const result = { nodes: 2000, layoutMs, timeToReadyMs: ready, interactionMs: timings };
  mkdirSync(resolve(import.meta.dirname, '../.cache'), { recursive: true });
  writeFileSync(resolve(import.meta.dirname, '../.cache/graph-perf.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));

  // fcose measured ~270 ms here; plain cose took ~37 s. The bound catches a regression to the slow layout.
  expect(layoutMs).toBeLessThan(3_000);
  for (const ms of timings) expect(ms).toBeLessThan(1_000);
  await app.close();
});

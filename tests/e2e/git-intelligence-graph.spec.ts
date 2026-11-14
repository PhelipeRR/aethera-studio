import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';

function fixture(extraCommits = 0) {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-graph-')), 'repo');
  mkdirSync(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Graph Tester', '-c', 'user.email=graph@example.dev', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'README.md'), 'base\n'); git('add', '.'); git('commit', '-q', '-m', 'Base commit');
  writeFileSync(join(root, 'README.md'), 'base\nmain change\n'); git('commit', '-q', '-am', 'Main change');
  git('checkout', '-q', '-b', 'feature/graph');
  writeFileSync(join(root, 'feature.txt'), 'feature\n'); git('add', '.'); git('commit', '-q', '-m', 'Feature change');
  git('tag', 'v1.0');
  git('checkout', '-q', 'main');
  for (let index = 0; index < extraCommits; index++) {
    writeFileSync(join(root, 'README.md'), `base\nmain change\nlarge history ${index}\n`);
    git('commit', '-q', '-am', `History ${index}`);
  }
  return root;
}

function emptyRepository() {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-empty-')), 'repo');
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  return root;
}

function mergeRepository() {
  const root = fixture();
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Graph Tester', '-c', 'user.email=graph@example.dev', ...args], { cwd: root, encoding: 'utf8' });
  git('checkout', '-q', 'feature/graph');
  writeFileSync(join(root, 'feature.txt'), 'feature\nsecond\n');
  git('commit', '-q', '-am', 'Feature second change');
  git('checkout', '-q', 'main');
  writeFileSync(join(root, 'main.txt'), 'main\n');
  git('add', '.'); git('commit', '-q', '-m', 'Main diverges');
  git('merge', '--no-ff', '-q', 'feature/graph', '-m', 'Merge feature graph');
  return root;
}

test('Git Graph uses real refs, selection, comparison, diff and persisted density', async () => {
  test.setTimeout(90_000);
  const root = fixture();
  const dataDir = freshDataDir();
  const { app, page } = await launchApp(dataDir);
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload();
  await page.evaluate((projectId) => { location.hash = '#/git-intelligence'; void projectId; }, id);
  await expect(page.getByRole('heading', { name: 'Git Intelligence' })).toBeVisible();
  await page.getByLabel('Selecionar projeto').selectOption(id);

  const graph = page.getByLabel('Grafo de commits');
  await expect(graph.getByRole('button', { name: /Main change/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: 'C:/dev/neuralbridge/prints/git-intelligence-graph-1280.png', fullPage: true });
  await graph.getByRole('button', { name: /Main change/ }).click();
  await expect(page.getByRole('heading', { name: 'Detalhes do commit' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver diff' }).click();
  await expect(page.locator('pre')).toContainText('+main change');

  await page.getByLabel('Referência inicial').selectOption('main');
  await page.getByLabel('Referência final').selectOption('feature/graph');
  await expect(page.getByText(/feature\.txt/)).toBeVisible();
  await page.getByLabel('Modo de comparação').selectOption('merge-base');
  await expect(page.getByText(/base [0-9a-f]{8}/)).toBeVisible();
  await page.getByLabel('Buscar commits').fill('termo que não existe');
  await expect(page.getByText('Nenhum commit corresponde à busca.')).toBeVisible();
  await page.getByLabel('Buscar commits').fill('');
  await page.getByRole('button', { name: 'Expandido' }).click();
  await expect(page.getByRole('button', { name: 'Compacto' })).toBeVisible();
  await page.setViewportSize({ width: 800, height: 700 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight + 1)).toBe(true);
  await page.screenshot({ path: 'C:/dev/neuralbridge/prints/git-intelligence-graph-800.png', fullPage: true });
  await app.close();

  const reopened = await launchApp(dataDir);
  await reopened.page.evaluate(() => { location.hash = '#/git-intelligence'; });
  await reopened.page.getByLabel('Selecionar projeto').selectOption(id);
  await expect(reopened.page.getByRole('button', { name: 'Compacto' })).toBeVisible();
  await reopened.app.close();
});

test('Git Graph loads an extensive real history incrementally and keeps keyboard focus', async () => {
  test.setTimeout(90_000);
  const { app, page } = await launchApp(freshDataDir());
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), fixture(205));
  await page.reload();
  await page.evaluate(() => { location.hash = '#/git-intelligence'; });
  await page.getByLabel('Selecionar projeto').selectOption(id);
  const graph = page.getByLabel('Grafo de commits');
  await expect.poll(() => graph.getByRole('button').count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Carregar commits anteriores' })).toBeVisible();
  const beforeHeight = await graph.evaluate((element) => element.scrollHeight);
  await graph.getByRole('button').first().focus();
  await expect(graph.getByRole('button').first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Arquivos alterados')).toBeVisible();
  await page.getByRole('button', { name: 'Carregar commits anteriores' }).click();
  await expect.poll(() => graph.evaluate((element) => element.scrollHeight)).toBeGreaterThan(beforeHeight);
  await app.close();
});

test('Git Intelligence exposes deterministic empty and unavailable repository states', async () => {
  const { app, page } = await launchApp(freshDataDir());
  const empty = await page.evaluate((path) => window.neuralbridge.projects.add(path), emptyRepository());
  await page.reload();
  await page.evaluate(() => { location.hash = '#/git-intelligence'; });
  await page.getByLabel('Selecionar projeto').selectOption(empty.id);
  await expect(page.getByText('Este repositório ainda não possui commits.')).toBeVisible();

  const missingRoot = join(mkdtempSync(join(tmpdir(), 'nb-e2e-missing-')), 'repo');
  mkdirSync(missingRoot);
  const missing = await page.evaluate((path) => window.neuralbridge.projects.add(path), missingRoot);
  rmSync(missingRoot, { recursive: true, force: true });
  await page.reload();
  await page.evaluate(() => { location.hash = '#/git-intelligence'; });
  await page.getByLabel('Selecionar projeto').selectOption(missing.id);
  await expect(page.getByRole('alert')).toContainText('não é um repositório Git válido');
  await app.close();
});

test('Git Graph preserves real merge edges and reports page continuity', async () => {
  const { app, page } = await launchApp(freshDataDir());
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), mergeRepository());
  await page.reload();
  await page.evaluate(() => { location.hash = '#/git-intelligence'; });
  await page.getByLabel('Selecionar projeto').selectOption(id);
  const graph = page.getByLabel('Grafo de commits');
  await expect(graph.getByRole('button', { name: /Merge feature graph/ })).toBeVisible();
  const edgeData = await graph.locator('path[data-from][data-to]').evaluateAll((paths) => paths.map((path) => ({ from: path.getAttribute('data-from'), to: path.getAttribute('data-to') })));
  const commitHashes = new Set(await graph.locator('[data-commit-hash]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-commit-hash'))));
  expect(edgeData.length).toBeGreaterThanOrEqual(2);
  expect(edgeData.every((edge) => edge.from && edge.to && commitHashes.has(edge.from) && commitHashes.has(edge.to))).toBe(true);
  await expect(page.getByText('A continuidade segue para uma página anterior do histórico.')).toHaveCount(0);
  await app.close();
});

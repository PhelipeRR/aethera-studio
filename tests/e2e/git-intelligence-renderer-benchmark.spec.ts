import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';

function largeRepository(commitCount: number) {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-renderer-')), 'repo');
  mkdirSync(root, { recursive: true });
  const lines = ['blob', 'mark :1', 'data 10', 'benchmark\n'];
  for (let index = 0; index < commitCount; index++) {
    const mark = index + 2;
    lines.push('commit refs/heads/main', `mark :${mark}`, 'author Benchmark <benchmark@example.dev> 1700000000 +0000', 'committer Benchmark <benchmark@example.dev> 1700000000 +0000', `data ${String(`Benchmark ${index}`).length}`, `Benchmark ${index}`);
    if (index > 0) lines.push(`from :${mark - 1}`);
    lines.push('M 100644 :1 README.md', '');
  }
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['fast-import'], { cwd: root, input: `${lines.join('\n')}\n`, encoding: 'utf8' });
  return root;
}

test('Git Graph renderer benchmark keeps mounted elements bounded by virtualization', async () => {
  test.setTimeout(120_000);
  const { app, page } = await launchApp(freshDataDir());
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), largeRepository(5_000));
  await page.reload();
  await page.evaluate(() => { location.hash = '#/git-intelligence'; });
  await page.getByLabel('Selecionar projeto').selectOption(id);
  const graph = page.getByLabel('Grafo de commits');
  const started = Date.now();
  await expect.poll(() => graph.getByRole('button').count(), { timeout: 60_000 }).toBeGreaterThan(0);
  const initialRenderMs = Date.now() - started;
  const metrics = await graph.evaluate((element) => ({
    dom: element.querySelectorAll('*').length,
    svg: element.querySelectorAll('svg, path').length,
    commitsMounted: element.querySelectorAll('button').length,
    scrollHeight: element.scrollHeight,
    viewportHeight: element.clientHeight,
  }));
  const selectionStarted = Date.now();
  await graph.getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Detalhes do commit' })).toBeVisible();
  const selectionMs = Date.now() - selectionStarted;
  const scrollStarted = Date.now();
  await graph.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(0);
  const scrollMs = Date.now() - scrollStarted;
  console.log(JSON.stringify({ commitCount: 5_000, initialRenderMs, selectionMs, scrollMs, ...metrics }));
  expect(metrics.commitsMounted).toBeLessThan(60);
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.viewportHeight);
  await app.close();
});

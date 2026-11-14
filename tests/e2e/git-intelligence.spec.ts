import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshDataDir, launchApp } from './app';
import { callMcpTool } from './brain3d-helpers';

// Phase 25: the project's Git history, indexed read-only and by delta, searched from the project page and
// by agents through the real MCP server, related to the memories about the same files.

function repo(): { root: string; git: (...args: string[]) => string } {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-git-')), 'loja');
  mkdirSync(join(root, 'src'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Ana Dev', '-c', 'user.email=ana@exemplo.dev', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 5;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Cria o pool');
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 20;\nexport const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
  git('commit', '-q', '-am', 'Corrige timeout no checkout aumentando o pool');
  return { root, git };
}

const section = (page: Page) => page.getByRole('region', { name: 'Histórico Git' });

test('the history is indexed by delta and searched with commit, file and line, without secrets', async () => {
  const dataDir = freshDataDir();
  const { root, git } = repo();
  const { app, page } = await launchApp(dataDir);
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.evaluate(({ projectId }) => window.neuralbridge.brain.store({ title: 'Pool do checkout', content: 'Pool com 20 conexões.', type: 'bug_fix', projectId, sourceRef: 'src/pool.ts:1' }), { projectId: id });
  await page.evaluate((projectId) => (location.hash = `#/projects/${projectId}`), id);

  await section(page).getByRole('button', { name: 'Indexar histórico' }).click();
  await expect(section(page).getByTestId('git-index-report')).toHaveText('2 commits novos indexados (2 alterações de arquivo) em 1 branch.');
  await section(page).getByRole('button', { name: 'Indexar histórico' }).click();
  await expect(section(page).getByTestId('git-index-report')).toContainText('0 commits novos indexados');

  await section(page).getByRole('searchbox', { name: 'Buscar no histórico Git' }).fill('timeout checkout');
  await section(page).getByRole('button', { name: 'Buscar' }).click();
  const hit = section(page).getByTestId('git-hit').first();
  await expect(hit).toContainText('Corrige timeout no checkout aumentando o pool');
  await expect(hit).toContainText('Ana Dev');
  await hit.getByRole('button').click();
  await expect(hit).toContainText('Pool do checkout');
  await expect(section(page)).not.toContainText('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  await expect(section(page)).not.toContainText('ana@exemplo.dev');

  // Agents find the same solution through the real MCP server, with a verifiable reference.
  const viaMcp = await callMcpTool(dataDir, 'codex', 'brain_rag_search', { query: 'size pool' }, id);
  expect(viaMcp.text).toMatch(/git:\/\/[0-9a-f]{40}\/src\/pool\.ts:1-1/);
  expect(viaMcp.text).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');

  // A new commit is the only thing read next time.
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 30;\n');
  git('commit', '-q', '-am', 'Ajusta o pool para 30');
  await section(page).getByRole('button', { name: 'Indexar histórico' }).click();
  await expect(section(page).getByTestId('git-index-report')).toContainText('1 commit novo indexado');
  await app.close();
});

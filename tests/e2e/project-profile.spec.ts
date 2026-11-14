import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';
import { callMcpTool } from './brain3d-helpers';

// Phase 21: the project's technical profile — built from the incremental file index and the manifests,
// shown with its sources, given to that project's tasks only, kept current after tasks, and readable by MCP.

function project(name: string): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-profile-')), name);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.3.0' }, devDependencies: { vitest: '4.1.0' } }));
  writeFileSync(join(root, 'src', 'checkout.ts'), 'export function finalizarCompra() {}\n');
  writeFileSync(join(root, '.env'), 'SECRET=nao-indexar\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  return root;
}

const section = (page: Page) => page.getByRole('region', { name: 'Perfil técnico' });

test('the profile is generated, updated by delta, and shows where each part comes from', async () => {
  const root = project('loja');
  const { app, page } = await launchApp(freshDataDir());
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.evaluate((projectId) => (location.hash = `#/projects/${projectId}`), id);

  await expect(section(page)).toContainText('Ainda não gerado');
  await section(page).getByRole('button', { name: 'Gerar perfil' }).click();
  await expect(section(page).getByRole('list', { name: 'Módulos' })).toContainText('src');
  await expect(section(page).getByRole('list', { name: 'Módulos' })).toContainText('finalizarCompra');
  await expect(section(page).getByRole('list', { name: 'Dependências' }).getByText('react')).toHaveAttribute('title', 'Declarada em package.json');
  await expect(section(page).getByRole('list', { name: 'Dependências' })).toContainText('(dev)');
  await expect(section(page).getByTestId('profile-index')).toContainText('1 arquivo no índice: 1 lidos agora');
  await expect(section(page)).not.toContainText('nao-indexar');

  // Delta: a new module and dependency; only the new file is read.
  mkdirSync(join(root, 'services', 'api'), { recursive: true });
  writeFileSync(join(root, 'services', 'api', 'server.ts'), 'export function ouvir() {}\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.3.0', zod: '4.0.0' } }));
  await section(page).getByRole('button', { name: 'Atualizar perfil' }).click();
  await expect(section(page).getByTestId('profile-index')).toContainText('2 arquivos no índice: 1 lidos agora, 1 sem mudança');
  await expect(section(page).getByTestId('profile-changes')).toContainText('módulos novos: services/api');
  await expect(section(page).getByTestId('profile-changes')).toContainText('dependências novas: zod');
  await expect(section(page).getByTestId('profile-changes')).toContainText('dependências removidas: vitest');
  await app.close();
});

test('tasks of the project get its profile as context, other projects do not, and a finished task refreshes it', async () => {
  const dataDir = freshDataDir();
  const loja = project('loja');
  const outro = project('outro');
  const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  const lojaId = (await page.evaluate((path) => window.neuralbridge.projects.add(path), loja)).id;
  const outroId = (await page.evaluate((path) => window.neuralbridge.projects.add(path), outro)).id;
  await page.evaluate((projectId) => window.neuralbridge.projects.refreshProfile(projectId), lojaId);

  const run = async (projectId: string, prompt: string, mode: 'claude' | 'codex') => {
    const { id } = await page.evaluate((input) => window.neuralbridge.tasks.start(input), { prompt, projectId, mode });
    await expect.poll(async () => (await page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id)).status, { timeout: 20_000 }).toBe('completed');
    return page.evaluate((taskId) => window.neuralbridge.tasks.get(taskId), id);
  };
  const references = (task: Awaited<ReturnType<typeof run>>) => task.events.filter((event) => event.kind === 'rag_context').flatMap((event) => (event.data['references'] as string[] | undefined) ?? []);

  expect(references(await run(lojaId, 'Explique o checkout', 'claude'))).toContain(`profile://${lojaId}`);
  expect(references(await run(outroId, 'Explique o checkout', 'claude')).join(' ')).not.toContain('profile://');

  // A finished edit task (the fake Codex writes nota.txt) refreshes the existing profile by delta.
  await run(lojaId, 'Implemente a nota', 'codex');
  await expect.poll(async () => (await page.evaluate((projectId) => window.neuralbridge.projects.profile(projectId), lojaId))?.index.files, { timeout: 15_000 }).toBe(2);

  // The agent reads the same profile through the real MCP server, scoped to its project.
  const viaMcp = await callMcpTool(dataDir, 'codex', 'project_profile', {}, lojaId);
  expect(viaMcp.text).toContain('"finalizarCompra"');
  expect((await callMcpTool(dataDir, 'codex', 'project_profile', {}, outroId)).text).toContain('"found":false');
  await app.close();
});

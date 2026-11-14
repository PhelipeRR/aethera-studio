import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';

function repository(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-automation-')), 'loja');
  mkdirSync(root, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'a.txt'), 'um\n');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  git('switch', '-q', '-c', 'feature/x');
  writeFileSync(join(root, 'b.txt'), 'dois\n');
  git('add', '.');
  git('commit', '-q', '-m', 'segundo');
  return root;
}

test('painel de automações Git: cria, liga, executa por branch e exclui', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  page.on('dialog', (dialog) => void dialog.accept());
  const { id } = await page.evaluate((path) => window.neuralbridge.projects.add(path), repository());
  const workflow = await page.evaluate((projectId) => window.neuralbridge.workflows.save(undefined, { schemaVersion: 2, name: 'Revisão E2E', projectId, maxParallel: 1, inputs: [], steps: [{ id: 'revisar', title: 'Revisar', kind: 'agent', prompt: 'Revise a alteração', agent: 'claude', mode: 'claude', access: 'read-only', dependsOn: [], requiresApproval: false }] }), id);
  await page.reload();
  await page.evaluate(() => { location.hash = '#/git-intelligence'; });
  await page.getByLabel('Selecionar projeto').selectOption(id);
  await page.getByRole('tab', { name: 'Automações' }).click();

  const panel = page.getByRole('region', { name: 'Automações Git' });
  await panel.getByLabel('Nome da automação').fill('Revisar feature');
  await panel.getByLabel('Workflow da automação').selectOption(workflow.id);
  await panel.getByLabel('Branch observada').selectOption('feature/x');
  await panel.getByLabel('Arquivos observados').fill('src/**');
  await panel.getByRole('button', { name: 'Criar automação' }).click();
  const item = panel.getByRole('listitem').filter({ hasText: 'Revisar feature' });
  await expect(item).toBeVisible();

  const saved = await page.evaluate((projectId) => window.neuralbridge.workflows.automations(projectId), id);
  expect(saved).toEqual([expect.objectContaining({ name: 'Revisar feature', workflowId: workflow.id })]);

  await panel.getByLabel('Branch base').selectOption('main');
  await panel.getByRole('button', { name: 'Na branch contra a base' }).click();
  await expect(panel.getByText('Execução iniciada. Acompanhe em Workflows.')).toBeVisible();

  await item.getByRole('button', { name: 'Excluir' }).click();
  await expect(item).toHaveCount(0);
  expect(await page.evaluate((projectId) => window.neuralbridge.workflows.automations(projectId), id)).toEqual([]);
  await app.close();
});

test('skills: obrigatória indisponível para a etapa, e o uso registrado aparece na página', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const definition = { schemaVersion: 2 as const, name: 'Skill obrigatória', projectId: null, maxParallel: 1, inputs: [], steps: [{ id: 'etapa', title: 'Etapa', kind: 'agent' as const, prompt: 'x', agent: 'claude' as const, mode: 'claude' as const, access: 'read-only' as const, dependsOn: [], requiresApproval: false, requiredSkillIds: ['skill-que-nao-existe'] }] };
  const workflow = await page.evaluate((value) => window.neuralbridge.workflows.save(undefined, value), definition);
  const reopened = await page.evaluate((id) => window.neuralbridge.workflows.get(id), workflow.id);
  expect(JSON.stringify(reopened?.definition)).toContain('skill-que-nao-existe');
  const { runId } = await page.evaluate((id) => window.neuralbridge.workflows.run(id, true), workflow.id);
  await expect.poll(async () => (await page.evaluate((id) => window.neuralbridge.workflows.steps(id), runId))[0]?.error ?? '').toContain('Skills obrigatórias indisponíveis');
  await page.getByRole('link', { name: 'Skills', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Uso de skills' })).toContainText('Nenhum uso registrado ainda.');
  const recommend = page.getByRole('region', { name: 'Recomendar skills' });
  const before = (await page.evaluate(() => window.neuralbridge.skills.settings())).preferences;
  await recommend.getByLabel('Tarefa para recomendar skills').fill('revisar a segurança do projeto');
  await recommend.getByRole('button', { name: 'Recomendar' }).click();
  await expect(recommend.getByRole('list', { name: 'Skills recomendadas' }).or(recommend.getByText('Nenhuma skill instalada combina com esta tarefa.'))).toBeVisible();
  expect((await page.evaluate(() => window.neuralbridge.skills.settings())).preferences).toEqual(before);
  await app.close();
});

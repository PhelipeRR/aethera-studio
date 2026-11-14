import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// Per-project permission levels: set on the project page (full access only after a confirmation), and
// applied to the CLI command lines of edit runs only. fake-agent.mjs logs the arguments it receives.

function gitProject(name: string): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-perms-')), name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'README.md'), `# ${name}\n`);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  return root;
}

async function open(dataDir: string, log: string, project?: string) {
  const launched = await launchApp(dataDir, { env: { ...FAKE_AGENTS, NB_FAKE_ARGS_LOG: log } });
  const id = project ? (await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), project)).id : null;
  // Added through IPC, not the screen: reload so the cached project list (the dashboard loads it) is fresh.
  if (project) await launched.page.reload();
  return { ...launched, id };
}

const runs = (log: string): { agent: string; args: string[] }[] =>
  existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { agent: string; args: string[] }) : [];

async function send(page: Page, prompt: string, mode: string, project: string) {
  await page.getByRole('complementary', { name: 'Menu' }).getByRole('link', { name: 'Chat', exact: true }).click();
  await page.getByRole('link', { name: 'Nova conversa' }).first().click();
  await expect(page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  await page.getByLabel('Projeto', { exact: true }).selectOption({ label: project });
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: mode });
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill(prompt);
  await box.press('Enter');
  await expect(page.getByRole('article', { name: `Tarefa: ${prompt}` }).getByRole('status')).toHaveText('Concluída');
}

test('the level is chosen on the project page, full access needs a confirmation, and both persist', async () => {
  const dataDir = freshDataDir();
  const log = join(dataDir, 'args.jsonl');
  const root = gitProject('loja perms');
  const first = await open(dataDir, log, root);
  let { app, page } = first;
  const { id } = first;
  await page.evaluate((projectId) => (location.hash = `#/projects/${projectId}`), id);
  const levels = page.getByRole('radiogroup', { name: 'Permissões dos agentes' });
  await expect(levels.getByRole('radio', { name: /Padrão/ })).toBeChecked();

  await levels.getByRole('radio', { name: /Comandos liberados/ }).click();
  const commands = page.getByLabel('Comandos liberados para o Claude Code');
  await commands.fill('npm run e2e\nnpm test && rm -rf /');
  await expect(page.getByRole('alert')).toContainText('“npm test && rm -rf /”');
  await expect(page.getByRole('button', { name: 'Salvar configurações' })).toBeDisabled();
  await commands.fill('npm run e2e\ndotnet ef');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByRole('status')).toHaveText('Configurações salvas.');

  // Full access: cancelling the confirmation keeps the previous level.
  await levels.getByRole('radio', { name: /Acesso total/ }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Dar acesso total aos agentes neste projeto?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(levels.getByRole('radio', { name: /Comandos liberados/ })).toBeChecked();
  await app.close();

  ({ app, page } = await open(dataDir, log));
  const project = await page.evaluate(() => window.neuralbridge.projects.list());
  expect(project[0]).toMatchObject({ permissionLevel: 'commands', allowedCommands: ['npm run e2e', 'dotnet ef'] });
  await page.evaluate((projectId) => (location.hash = `#/projects/${projectId}`), project[0]?.id);
  await page.getByRole('radiogroup', { name: 'Permissões dos agentes' }).getByRole('radio', { name: /Acesso total/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Dar acesso total' }).click();
  await expect(page.getByRole('note')).toContainText('Acesso total');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByRole('status')).toHaveText('Configurações salvas.');
  expect((await page.evaluate(() => window.neuralbridge.projects.list()))[0]?.permissionLevel).toBe('full');
  await app.close();
});

test('commands: edit runs get the listed commands (Claude) and the network (Codex); analysis does not', async () => {
  const dataDir = freshDataDir();
  const log = join(dataDir, 'args.jsonl');
  const { app, page, id } = await open(dataDir, log, gitProject('loja cmds'));
  await page.evaluate((projectId) => window.neuralbridge.projects.update(projectId ?? '', { permissionLevel: 'commands', allowedCommands: ['npm run e2e'] }), id);

  await send(page, 'Implemente a nota', 'Claude Code', 'loja cmds');
  await send(page, 'Explique o módulo de notas', 'Claude Code', 'loja cmds');
  await send(page, 'Implemente a nota no Codex', 'Codex CLI', 'loja cmds');
  const [edit, analysis, codex] = runs(log);
  expect(edit?.args).toEqual(expect.arrayContaining(['acceptEdits', 'Edit', 'Bash(npm run e2e:*)']));
  expect(edit?.args.join(' ')).not.toMatch(/dangerously/);
  expect(analysis?.args).toEqual(expect.arrayContaining(['default']));
  expect(analysis?.args.join(' ')).not.toMatch(/npm run e2e|Edit/);
  expect(codex?.args).toEqual(expect.arrayContaining(['sandbox_mode="workspace-write"', 'sandbox_workspace_write.network_access=true']));
  await app.close();
});

test('full: every single-agent run bypasses permissions and the sandbox, and the chat says so', async () => {
  const dataDir = freshDataDir();
  const log = join(dataDir, 'args.jsonl');
  const root = gitProject('loja total');
  const { app, page, id } = await open(dataDir, log, root);
  await page.evaluate((projectId) => window.neuralbridge.projects.update(projectId ?? '', { permissionLevel: 'full' }), id);

  await send(page, 'Implemente a nota', 'Codex CLI', 'loja total');
  await expect(page.getByText(/Acesso total neste projeto/)).toBeVisible();
  await page.getByRole('button', { name: 'Mostrar contexto e execução' }).click();
  await expect(page.getByRole('complementary', { name: 'Contexto e execução' }).getByRole('region', { name: 'Ambiente' })).toContainText('Acesso total');
  await page.keyboard.press('Escape');
  await send(page, 'Implemente a nota no Claude', 'Claude Code', 'loja total');
  await send(page, 'Explique o módulo de notas', 'Claude Code', 'loja total');
  const [codex, edit, analysis] = runs(log);
  expect(codex?.args).toContain('--dangerously-bypass-approvals-and-sandbox');
  expect(codex?.args.join(' ')).not.toMatch(/sandbox_mode/);
  expect(existsSync(join(root, 'nota.txt'))).toBe(true);
  expect(edit?.args).toContain('--dangerously-skip-permissions');
  expect(analysis?.args).toContain('--dangerously-skip-permissions');
  await app.close();
});

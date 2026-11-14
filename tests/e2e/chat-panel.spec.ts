import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// Phase 18.8: the right-hand context and execution panel, against fake-agent.mjs, which speaks the real CLI
// formats (Claude's Skill tool call, init MCP servers and modelUsage; Codex items and `mcp list --json`).

const panel = (page: Page) => page.getByRole('complementary', { name: 'Contexto e execução' });
const section = (page: Page, name: string) => panel(page).getByRole('region', { name });
const card = (page: Page, prompt: string) => page.getByRole('article', { name: `Tarefa: ${prompt}` });

function gitProject(name: string): { root: string; git: (...args: string[]) => string } {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-panel-')), name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'README.md'), `# ${name}\numa\nduas\n`);
  writeFileSync(join(root, 'velho.txt'), 'sai\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'trabalho');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  return { root, git };
}

async function openChat(dataDir = freshDataDir(), project?: string) {
  const launched = await launchApp(dataDir, { env: FAKE_AGENTS });
  // The default window is wide: the panel sits beside the chat.
  await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(1600, 900));
  if (project) await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), project);
  // Added through IPC, not the screen: reload so the cached project list (the dashboard loads it) is fresh.
  if (project) await launched.page.reload();
  await launched.page.getByRole('complementary', { name: 'Menu' }).getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(launched.page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  return launched;
}

async function send(page: Page, prompt: string, options: { project?: string; mode?: string } = {}) {
  if (options.project) await page.getByLabel('Projeto', { exact: true }).selectOption({ label: options.project });
  if (options.mode) await page.getByLabel('Agente', { exact: true }).selectOption({ label: options.mode });
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill(prompt);
  await box.press('Enter');
}

test('the panel opens and closes on its own, and it and its sections keep their state after a restart', async () => {
  const dataDir = freshDataDir();
  let { app, page } = await openChat(dataDir);
  await expect(panel(page)).toBeVisible();
  await expect(section(page, 'Ambiente')).toContainText('Local (este computador)');
  // Collapsing the history leaves the panel alone, and the other way round.
  await page.getByRole('button', { name: 'Recolher histórico' }).click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole('button', { name: 'Recolher painel' }).click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar histórico' }).click();
  await expect(page.getByRole('complementary', { name: 'Histórico de conversas' })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar contexto e execução' }).click();
  const outputs = section(page, 'Saídas').getByRole('button', { name: 'Saídas' });
  await expect(outputs).toHaveAttribute('aria-expanded', 'true');
  await outputs.click();
  await expect(outputs).toHaveAttribute('aria-expanded', 'false');
  // Keyboard resize of the panel.
  const separator = panel(page).getByRole('separator', { name: 'Largura do painel' });
  const before = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(separator).toHaveAttribute('aria-valuenow', String(before + 16));
  await page.getByRole('button', { name: 'Recolher painel' }).click();
  await app.close();

  ({ app, page } = await openChat(dataDir));
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar contexto e execução' }).click();
  await expect(section(page, 'Saídas').getByRole('button', { name: 'Saídas' })).toHaveAttribute('aria-expanded', 'false');
  await expect(panel(page).getByRole('separator')).toHaveAttribute('aria-valuenow', String(before + 16));
  await app.close();
});

test('Claude skills show as used only with a successful Skill call, with agent, run, context and MCP use', async () => {
  const { app, page } = await openChat();
  const prompt = 'Explique o checkout USAR-SKILL FALHAR-SKILL';
  await send(page, prompt, { mode: 'Claude Code' });
  await expect(card(page, prompt).getByRole('status')).toHaveText('Concluída');

  const skills = section(page, 'Skills');
  await expect(skills.getByRole('button', { name: 'Skills' })).toContainText('1 utilizada');
  const used = skills.getByTestId('skill-nb-demo');
  await expect(used).toContainText('Utilizada');
  await expect(skills.getByTestId('skill-nb-quebrada')).toContainText('Falha');
  // Offered by the session but never invoked: available, not used.
  await expect(skills.getByTestId('skill-nb-ociosa')).toHaveCount(0);
  await skills.getByRole('button', { name: /sem uso registrado/ }).click();
  await expect(skills.getByTestId('available-skill-nb-ociosa')).toContainText('Disponível');
  await used.getByRole('button').first().click();
  await expect(used).toContainText('Claude Code');
  await expect(used).toContainText('Launching skill: nb-demo');
  await expect(used).toContainText('não encontrada no Skills Manager');
  await expect(used.getByRole('link', { name: /Explique o checkout/ })).toHaveAttribute('href', /#\/runs\//);

  // Context from the result's own figures: 130 tokens of a 200,000-token window.
  const context = section(page, 'Contexto').getByTestId('context-claude');
  await expect(context).toContainText('130 tokens');
  await expect(context).toContainText('200.000 tokens');
  await expect(context.getByRole('meter')).toHaveAttribute('aria-valuenow', '0.1');
  await expect(section(page, 'Contexto')).toContainText('Total gasto');

  const connectors = section(page, 'Conectores');
  await connectors.getByRole('button', { name: 'Conectores' }).click();
  await expect(connectors.getByTestId('session-connector-neuralbridge')).toContainText('1 chamada');
  // Configured servers come from each CLI's mcp list; commands and keys never reach the screen.
  await expect(connectors.getByTestId('mcp-claude-context7')).toContainText('Conectado');
  await expect(connectors.getByTestId('mcp-claude-playwright')).toContainText('Falha ao conectar');
  await expect(connectors.getByTestId('mcp-codex-neuralbridge')).toContainText('conexão não verificada');
  await expect(connectors.getByTestId('mcp-codex-antigo')).toContainText('Desativado');
  await expect(panel(page)).not.toContainText(/ctx7sk|segredo-falso|npx/);

  // Sending still works with all three side columns open.
  await send(page, 'Explique também o pagamento');
  await expect(card(page, 'Explique também o pagamento').getByRole('status')).toHaveText('Concluída');
  await expect(skills.getByTestId('skill-nb-demo')).toContainText('Utilizada');
  await app.close();
});

test('Codex in a project: skills it read are loaded, context is unavailable, outputs and Git changes are real', async () => {
  const { root, git } = gitProject('loja panel');
  const { app, page } = await openChat(freshDataDir(), root);
  // Changes made outside the run count for the repository, not for the run.
  writeFileSync(join(root, 'README.md'), '# loja panel\numa\ntrês\nquatro\n');
  execFileSync('cmd', ['/c', 'del', '/q', join(root, 'velho.txt')]);
  const prompt = 'Implemente a nota LER-SKILL';
  await send(page, prompt, { project: 'loja panel', mode: 'Codex CLI' });
  await expect(card(page, prompt).getByRole('status')).toHaveText('Concluída');

  const environment = section(page, 'Ambiente');
  await expect(environment).toContainText('loja panel');
  await expect(environment).toContainText(root);
  await expect(environment).toContainText(git('branch', '--show-current').trim());

  const skills = section(page, 'Skills');
  await expect(skills.getByTestId('skill-nb-demo')).toContainText('Carregada');
  await expect(skills).toContainText('O Codex CLI não informa quando usa uma skill');
  await expect(skills.getByRole('button', { name: 'Skills' })).not.toContainText('utilizada');
  // Installed for Codex, whose use cannot be observed: unknown, never available or used. (The list comes from
  // the Skills Manager, so it depends on this machine; only its states are checked.)
  const unused = skills.getByRole('button', { name: /sem uso registrado/ });
  if (await unused.count()) await unused.click();
  for (const badge of await skills.getByRole('list', { name: 'Skills disponíveis' }).locator('li').all()) await expect(badge).toContainText('Indisponível');

  await expect(section(page, 'Contexto').getByTestId('context-codex')).toContainText('Indisponível');
  await expect(section(page, 'Contexto').getByRole('meter')).toHaveCount(0);

  const outputs = section(page, 'Saídas');
  await expect(outputs.getByTestId('output-file')).toHaveCount(1);
  await expect(outputs.getByTestId('output-file')).toContainText('nota.txt');
  await expect(outputs.getByRole('button', { name: 'Mostrar nota.txt na pasta' })).toBeVisible();

  // Git counts: README +2 −1 and velho.txt −1 tracked; nota.txt is new. Only nota.txt is the run's.
  const changes = section(page, 'Alterações');
  await expect(changes.getByTestId('changes-repository')).toContainText('3 arquivos');
  await expect(changes.getByTestId('changes-repository')).toContainText('+2');
  await expect(changes.getByTestId('changes-repository')).toContainText('−2');
  await expect(changes.getByTestId('changes-repository')).toContainText('1 novos');
  await expect(changes.getByTestId('changes-repository')).toContainText('1 excluídos');
  await expect(changes.getByTestId('changes-run')).toContainText('1 arquivo');
  await expect(changes.getByTestId('changes-run')).toContainText('1 novos');
  expect(git('status', '--porcelain').trim().split('\n')).toHaveLength(3);

  // The main process refuses anything outside the task's project, and opening what Windows would run.
  const taskId = await page.evaluate(async () => (await window.neuralbridge.tasks.list({ limit: 1 }))[0]?.id ?? '');
  writeFileSync(join(root, 'roda.cmd'), 'echo x');
  const refusals = await page.evaluate(async (id) => {
    const attempt = (path: string, action: 'open' | 'reveal') => window.neuralbridge.tasks.outputFile(id, path, action).then(() => 'ok', (error: unknown) => String(error));
    return [await attempt('../fora.txt', 'reveal'), await attempt('roda.cmd', 'open')];
  }, taskId);
  expect(refusals[0]).toMatch(/fora do projeto/);
  expect(refusals[1]).toMatch(/seria executado/);
  await app.close();
});

test('background tasks are the TaskEngine’s own, with elapsed time and a working cancel', async () => {
  const { app, page } = await openChat();
  await send(page, 'Explique LENTO a fila');
  const tasks = section(page, 'Tarefas em segundo plano');
  const row = tasks.getByTestId('background-task').filter({ hasText: 'Explique LENTO a fila' });
  await expect(row).toContainText('Executando');
  await expect(row).toContainText(/\d+ s/);
  const conversations = page.getByRole('navigation', { name: 'Conversas' });
  await conversations.getByRole('button', { name: 'Recolher Sem projeto' }).click();
  await expect(conversations.getByTestId('project-running')).toContainText('1 em execução');
  await row.getByRole('button', { name: /Cancelar/ }).click();
  await expect(card(page, 'Explique LENTO a fila').getByRole('status')).toHaveText('Cancelada');
  await expect(conversations.getByTestId('project-running')).toHaveCount(0);
  await expect(row).toContainText('Cancelada');
  await expect(row.getByRole('button', { name: /Cancelar/ })).toHaveCount(0);
  await expect(tasks).toContainText('Nenhuma tarefa em andamento.');
  await app.close();
});

test('in a narrow window the panel is a drawer over the chat, closed by default and closed by Escape', async () => {
  const { app, page } = await openChat();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(960, 600));
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(960);
  await expect(panel(page)).toHaveCount(0);
  const chatWidth = await page.getByRole('region', { name: 'Conversa' }).evaluate((element) => element.getBoundingClientRect().width);
  await page.getByRole('button', { name: 'Mostrar contexto e execução' }).click();
  await expect(panel(page)).toBeVisible();
  // Floating: the chat keeps its width, and the panel stays inside the window.
  expect(await page.getByRole('region', { name: 'Conversa' }).evaluate((element) => element.getBoundingClientRect().width)).toBe(chatWidth);
  const box = await panel(page).boundingBox();
  expect(box && box.x + box.width <= 960 + 1).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByLabel('Mensagem', { exact: true })).toBeVisible();
  await app.close();
});

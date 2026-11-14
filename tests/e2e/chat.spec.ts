import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';

// The whole chat flow against fake-agent.mjs, which speaks the real CLIs' formats: the app's adapters,
// parsers, process runner, engine, IPC and screens all run unchanged. Real CLIs: chat-real.spec.ts.

function gitProject(name: string): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-chat-')), name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'README.md'), `# ${name}\n`);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  return root;
}

async function openChat(project?: string) {
  const launched = await launchApp(undefined, { env: FAKE_AGENTS });
  if (project) await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), project);
  // Added through IPC, not the screen: reload so the cached project list (the dashboard loads it) is fresh.
  if (project) await launched.page.reload();
  await sidebar(launched.page, 'Chat').click();
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

const sidebar = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navegação principal' }).getByRole('link', { name, exact: true });
const card = (page: Page, prompt: string) => page.getByRole('article', { name: `Tarefa: ${prompt}` });

test('a question without a project is routed to Claude, streamed and kept in the history', async () => {
  const { app, page } = await openChat();
  await expect(page.getByLabel('Agente', { exact: true })).toHaveValue('auto');
  await send(page, 'Explique o que é um monorepo');

  const task = card(page, 'Explique o que é um monorepo');
  await expect(task.getByText('Resposta do agente falso para: Explique o que é um monorepo')).toBeVisible();
  await expect(task.getByRole('status')).toHaveText('Concluída');
  await expect(task).toContainText('Roteado para Claude Code, somente leitura.');
  await expect(task).toContainText('Pedido de análise ou explicação');
  await expect(task.getByText('Grep TODO')).toBeVisible();
  await expect(task).toContainText('130 tokens de entrada, 40 de saída, 10 em cache');
  await expect(task).toContainText('US$');
  await expect(page.getByRole('navigation', { name: 'Conversas' }).getByRole('link', { name: /Explique o que é um monorepo/ })).toHaveAttribute('aria-current', 'page');
  await page.getByLabel('Pesquisar conversas').fill('monorepo');
  await expect(page.getByRole('navigation', { name: 'Conversas' }).getByRole('link', { name: /Explique o que é um monorepo/ })).toBeVisible();
  await app.close();
});

test('o comando /video respeita o estado da extensão Velix', async () => {
  const { app, page } = await openChat();
  await send(page, '/video criar uma abertura azul de dez segundos');
  await expect(page.getByRole('heading', { name: 'Aethera indisponível', exact: true })).toBeVisible();
  await expect(page.getByText('A extensão Aethera não está instalada ou está desabilitada.')).toBeVisible();
  await app.close();
});

test('an implementation goes to Codex in the project, shows changed files and the diff, and the conversation continues', async () => {
  const root = gitProject('Calculadora');
  const { app, page } = await openChat(root);
  await send(page, 'Implemente a função de soma', { project: 'Calculadora' });

  const task = card(page, 'Implemente a função de soma');
  await expect(task.getByRole('status')).toHaveText('Concluída');
  await expect(task).toContainText('Roteado para Codex CLI, com permissão para alterar arquivos do projeto.');
  await expect(task.getByRole('region', { name: 'Arquivos alterados' })).toContainText('nota.txt');
  await expect(task.getByRole('list', { name: 'Etapas' }).getByText('nota.txt', { exact: true })).toBeVisible();
  await expect(task.getByText('npm test (exit 0)')).toBeVisible();
  await task.getByText('Ver diferenças').click();
  await expect(task.getByLabel('Diferenças')).toContainText('+feito: Implemente a função de soma');
  expect(readFileSync(join(root, 'nota.txt'), 'utf8')).toBe('feito: Implemente a função de soma\n');

  const followUp = page.getByLabel('Mensagem', { exact: true });
  const composer = page.getByRole('form', { name: 'Escrever mensagem' });
  await expect(composer).toContainText('Calculadora');
  await expect(composer).toContainText('Automático');
  await followUp.fill('Agora explique o que mudou');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(card(page, 'Agora explique o que mudou').getByText('Resposta do agente falso para: Agora explique o que mudou')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);
  await expect(page.getByRole('navigation', { name: 'Conversas' }).getByRole('listitem').getByRole('link')).toHaveCount(1);
  await app.close();
});

test('collaborative mode plans with Claude, implements with Codex, and fixes what the review rejected', async () => {
  const root = gitProject('Notas');
  const { app, page } = await openChat(root);
  await send(page, 'Crie a nota de release REPROVAR', { project: 'Notas', mode: 'Colaborativo' });

  const task = card(page, 'Crie a nota de release REPROVAR');
  await expect(task.getByText('Concluída com a revisão aprovada.')).toBeVisible({ timeout: 30_000 });
  await expect(task.getByRole('region', { name: 'Plano' })).toContainText('Escrever a nota');
  await expect(task.getByRole('region', { name: 'Revisão reprovada' })).toContainText('Falta a correção pedida.');
  const steps = task.getByRole('list', { name: 'Etapas' }).locator(':scope > li');
  await expect(steps).toHaveText([/Claude Code · Planejamento/, /Codex CLI · Implementação/, /Claude Code · Revisão/, /Codex CLI · Correção/, /Claude Code · Revisão/]);
  expect(readFileSync(join(root, 'nota.txt'), 'utf8')).toContain('corrigido');
  await app.close();
});

test('a destructive request waits for approval, and a running task can be cancelled', async () => {
  const { app, page } = await openChat();
  await send(page, 'Explique por que apagar a pasta dist resolve o problema');
  const risky = card(page, 'Explique por que apagar a pasta dist resolve o problema');
  const approval = risky.getByRole('alert', { name: 'Aprovação necessária' });
  await expect(approval).toContainText('Pede para apagar dados, arquivos ou histórico.');
  await expect(risky.getByRole('list', { name: 'Etapas' })).toHaveCount(0);
  await approval.getByRole('button', { name: 'Aprovar e executar' }).click();
  await expect(risky.getByRole('status')).toHaveText('Concluída');

  await page.getByRole('link', { name: 'Nova conversa' }).click();
  await expect(page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  await send(page, 'Explique LENTO o cache');
  const slow = card(page, 'Explique LENTO o cache');
  await expect(slow.getByText('Claude Code · Análise')).toBeVisible();
  await slow.getByRole('button', { name: 'Cancelar' }).click();
  await expect(slow.getByText('Cancelada por você.')).toBeVisible();
  await expect(slow.getByRole('status')).toHaveText('Cancelada');
  await app.close();
});

test('the executions page lists, filters and opens runs, and continues one in the chat', async () => {
  const root = gitProject('Loja');
  const { app, page } = await openChat(root);
  await send(page, 'Explique a arquitetura da loja');
  await expect(card(page, 'Explique a arquitetura da loja').getByRole('status')).toHaveText('Concluída');
  await page.getByRole('link', { name: 'Nova conversa' }).click();
  await expect(page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  await send(page, 'Implemente o carrinho', { project: 'Loja' });
  await expect(card(page, 'Implemente o carrinho').getByRole('status')).toHaveText('Concluída');

  await sidebar(page, 'Execuções').click();
  const rows = page.getByRole('region', { name: 'Lista de execuções' }).getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Implemente o carrinho');
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: 'Codex CLI' });
  await expect(rows).toHaveCount(1);
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: 'Todos' });
  await page.getByLabel('Buscar no pedido').fill('arquitetura');
  await expect(rows).toHaveCount(1);
  await page.getByRole('link', { name: 'Explique a arquitetura da loja' }).click();

  await expect(page.getByRole('heading', { level: 2, name: 'Explique a arquitetura da loja' })).toBeVisible();
  await expect(page.getByRole('definition').filter({ hasText: 'sem projeto' })).toBeVisible();
  await page.getByRole('link', { name: 'Continuar no chat' }).click();
  await expect(page.getByLabel('Mensagem', { exact: true })).toBeVisible();
  await app.close();
});

test('the build contains no test agent: only the environment variables point at it', () => {
  const out = resolve(import.meta.dirname, '../../apps/desktop/out');
  expect(existsSync(out)).toBe(true);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|html)$/.test(name)) files.push(full);
    }
  };
  walk(out);
  for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(/fake-agent|agente falso/);
});

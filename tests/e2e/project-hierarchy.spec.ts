import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

function repository(path: string) {
  mkdirSync(path, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: path });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(path, 'README.md'), 'x');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
}

function workspace(dataDir: string): string {
  const root = join(dataDir, 'Hepta');
  repository(join(root, 'backoffice'));
  repository(join(root, 'suporte-ms'));
  mkdirSync(join(root, 'sql'), { recursive: true });
  writeFileSync(join(root, 'sql', 'a.sql'), 'select 1');
  return root;
}

const pickFolder = (app: ElectronApplication, path: string) => app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, path);

test('detecta projetos em uma pasta, confirma a prévia e navega pela árvore', async () => {
  const dataDir = freshDataDir();
  const root = workspace(dataDir);
  const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  await page.getByRole('link', { name: 'Projetos', exact: true }).click();
  await pickFolder(app, root);
  await page.getByRole('button', { name: 'Detectar projetos' }).click();

  const preview = page.getByRole('region', { name: 'Prévia da descoberta' });
  await expect(preview.getByRole('list', { name: 'Projetos detectados' })).toContainText('backoffice');
  await expect(preview.getByRole('checkbox', { name: 'Incluir backoffice' })).toBeChecked();
  await expect(preview.getByRole('list', { name: 'Pastas auxiliares' })).toContainText('sql');
  await expect(preview.getByRole('checkbox', { name: 'Incluir sql' })).not.toBeChecked();
  await preview.getByRole('button', { name: 'Confirmar seleção' }).click();

  const tree = page.getByRole('region', { name: 'Árvore de projetos' });
  await expect(tree.getByRole('link', { name: /^Hepta/ })).toBeVisible();
  await expect(tree.getByRole('link', { name: /^backoffice/ })).toBeVisible();
  await expect(tree.getByRole('link', { name: /^sql/ })).toHaveCount(0);
  await expect(tree).toContainText('2 projetos');
  await expect(tree).toContainText('main');

  await tree.getByRole('button', { name: 'Recolher Hepta' }).click();
  await expect(tree.getByRole('link', { name: /^backoffice/ })).toHaveCount(0);
  await page.getByLabel('Pesquisar projetos').fill('suporte');
  await expect(tree.getByRole('link', { name: /^suporte-ms/ })).toBeVisible();
  await expect(tree.getByRole('link', { name: /^Hepta/ })).toHaveCount(0);
  await app.close();
});

test('detecta subprojetos a partir de um projeto já cadastrado', async () => {
  const dataDir = freshDataDir();
  const root = workspace(dataDir);
  const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload();
  await page.getByRole('link', { name: 'Projetos', exact: true }).click();
  await page.getByRole('main').getByRole('link', { name: /^Hepta/ }).click();

  const section = page.getByRole('region', { name: 'Subprojetos' });
  await expect(section).toContainText('Nenhum subprojeto cadastrado');
  await section.getByRole('button', { name: 'Detectar subprojetos' }).click();
  const preview = page.getByRole('region', { name: 'Prévia da descoberta' });
  await expect(preview.getByRole('checkbox', { name: 'Incluir backoffice' })).toBeChecked();
  await preview.getByRole('button', { name: 'Confirmar seleção' }).click();

  await expect(section.getByRole('link', { name: /^backoffice/ })).toBeVisible();
  await expect(section.getByRole('link', { name: /^suporte-ms/ })).toBeVisible();
  await section.getByRole('link', { name: /^backoffice/ }).click();
  await expect(page.getByRole('heading', { name: 'backoffice' })).toBeVisible();
  await app.close();
});

test('cria um projeto dentro do workspace, com repositório Git', async () => {
  const dataDir = freshDataDir();
  const root = workspace(dataDir);
  const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  await page.evaluate(async (path) => {
    const report = await window.neuralbridge.projects.discover(path);
    await window.neuralbridge.projects.confirmDiscovery(report.root, report.candidates.map(({ path: item, selected, classification, parentPath }) => ({ path: item, selected, classification, parentPath })));
  }, root);
  await page.reload();
  await page.getByRole('link', { name: 'Projetos', exact: true }).click();
  await page.getByRole('button', { name: 'Novo projeto' }).click();
  const panel = page.getByRole('region', { name: 'Novo projeto' });
  await panel.getByLabel('Nome da pasta').fill('NovoProjeto');
  await panel.getByLabel('Workspace').selectOption({ label: 'Hepta' });
  await expect(panel.getByLabel('Pasta onde criar')).toHaveValue(root);
  await panel.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'NovoProjeto' })).toBeVisible();
  expect(existsSync(join(root, 'NovoProjeto', '.git'))).toBe(true);
  await app.close();
});

test('o Chat lista a hierarquia e deixa escolher os projetos da tarefa', async () => {
  const dataDir = freshDataDir();
  const root = workspace(dataDir);
  const { app, page } = await launchApp(dataDir, { env: FAKE_AGENTS });
  await page.evaluate(async (path) => {
    const report = await window.neuralbridge.projects.discover(path);
    await window.neuralbridge.projects.confirmDiscovery(report.root, report.candidates.map(({ path: item, selected, classification, parentPath }) => ({ path: item, selected, classification, parentPath })));
  }, root);
  await page.reload();
  await page.getByRole('complementary', { name: 'Menu' }).getByRole('link', { name: 'Chat', exact: true }).click();
  await page.locator('#chat-project').selectOption({ label: 'Hepta' });
  await expect(page.getByRole('checkbox', { name: 'backoffice' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'backoffice' }).check();
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill('Explique a integração');
  await box.press('Enter');
  await expect(page.getByRole('article', { name: /Tarefa:/ }).getByRole('status')).toHaveText('Concluída', { timeout: 15_000 });
  await app.close();
});

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

function fingerprint(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(full).update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

function sampleProject(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-project-')), 'Loja Web');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' }, devDependencies: { typescript: '6.0.0' } }));
  writeFileSync(join(root, 'README.md'), '# Loja Web\n\nVitrine da loja.');
  writeFileSync(join(root, 'src', 'page.tsx'), 'export default function Page() {}\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'Vitrine inicial');
  writeFileSync(join(root, '.env'), 'STRIPE_KEY=sk_live_nao_mostrar');
  writeFileSync(join(root, 'src', 'page.tsx'), 'export default function Page() {\n  return null;\n}\n');
  writeFileSync(join(root, 'src', 'novo.tsx'), 'x');
  return root;
}

test('register a project folder, inspect it read-only, configure it and remove it', async () => {
  const root = sampleProject();
  const before = fingerprint(root);
  const { app, page } = await launchApp();

  await page.getByRole('link', { name: 'Projetos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum projeto ainda' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adicionar projeto' })).toBeVisible();

  // The button opens the system folder picker, which tests cannot drive: add through the same IPC call it makes.
  await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
  await page.reload();
  const row = page.getByRole('main').getByRole('link', { name: /Loja Web/ });
  await expect(row).toContainText('Next.js');
  await row.click();

  await expect(page.getByRole('heading', { level: 2, name: 'Loja Web' })).toBeVisible();
  await expect(page.getByText('id loja-web', { exact: false })).toBeVisible();
  const stack = page.getByRole('region', { name: 'Tecnologias' });
  for (const label of ['Node.js', 'TypeScript', 'React', 'Next.js']) await expect(stack.getByText(label, { exact: true })).toBeVisible();

  const git = page.getByRole('region', { name: 'Git', exact: true });
  await expect(git).toContainText('main');
  await expect(git).toContainText('Vitrine inicial');
  await git.getByRole('button', { name: /src\/page\.tsx/ }).click();
  await expect(page.getByLabel('Diferenças')).toContainText('+  return null;');
  await git.getByRole('button', { name: /src\/novo\.tsx/ }).click();
  await expect(git).toContainText('Arquivo novo, ainda não rastreado');

  const files = page.getByRole('region', { name: 'Arquivos de referência' });
  await expect(files.getByRole('button', { name: '.env' })).toHaveCount(0);
  await files.getByRole('button', { name: 'README.md' }).click();
  await expect(page.getByLabel('Conteúdo de README.md')).toContainText('Vitrine da loja.');
  expect(await page.evaluate(() => window.neuralbridge.projects.file('loja-web', '.env'))).toMatchObject({ ok: false });
  await expect(page.locator('body')).not.toContainText('sk_live_nao_mostrar');

  // Settings persist.
  await page.getByLabel('Agente preferido').selectOption('codex');
  await page.getByLabel('Regras do projeto (Markdown)').fill('Rodar `npm test` antes de concluir.');
  await page.getByLabel(/Projeto privado/).check();
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByRole('status')).toHaveText('Configurações salvas.');
  await page.reload();
  await expect(page.getByLabel('Agente preferido')).toHaveValue('codex');
  await expect(page.getByLabel('Regras do projeto (Markdown)')).toHaveValue('Rodar `npm test` antes de concluir.');

  // The project is now a scope for memories.
  await page.evaluate(() => window.neuralbridge.brain.store({ title: 'Cache da vitrine', content: 'ISR de 60 s.', type: 'decision', projectId: 'loja-web' }));
  await page.getByRole('link', { name: 'Memória', exact: true }).click();
  await page.getByRole('link', { name: 'Explorar' }).click();
  await page.getByLabel('Filtrar por projeto').selectOption({ label: 'Loja Web' });
  await expect(page.getByRole('heading', { level: 3, name: 'Cache da vitrine' })).toBeVisible();

  // Removing says what it deletes, deletes it, and leaves the folder alone.
  await page.getByRole('link', { name: 'Projetos', exact: true }).click();
  await page.getByRole('main').getByRole('link', { name: /Loja Web/ }).click();
  await page.getByRole('button', { name: 'Remover projeto' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Nenhum arquivo da pasta é alterado ou apagado.');
  await dialog.getByRole('button', { name: 'Remover e apagar 1 memória' }).click();
  await expect(page.getByRole('heading', { name: 'Nenhum projeto ainda' })).toBeVisible();
  expect((await page.evaluate(() => window.neuralbridge.brain.overview())).total).toBe(0);
  await app.close();

  expect(fingerprint(root)).toBe(before);
});

test('folders that cannot be projects are refused with a reason', async () => {
  const { app, page } = await launchApp();
  const attempt = (path: string) =>
    page.evaluate((value) => window.neuralbridge.projects.add(value).then(() => 'added', (error: unknown) => String(error)), path);
  expect(await attempt('C:\\')).toMatch(/disco inteiro/);
  expect(await attempt('\\\\servidor\\share')).toMatch(/rede/);
  expect(await attempt('relativo\\pasta')).toMatch(/caminho completo/);
  await app.close();
});

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// Images in the chat, end to end against fake-agent.mjs, which reads them the way the real CLIs take them
// (Claude: a stream-json message with base64 blocks; Codex: --image=<file>) and answers with what it got.

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

function files() {
  const dir = mkdtempSync(join(tmpdir(), 'nb-e2e-img-'));
  const write = (name: string, data: Buffer | string) => {
    writeFileSync(join(dir, name), data);
    return join(dir, name);
  };
  return { png: write('tela.png', PNG), jpeg: write('foto.jpg', JPEG), fake: write('falsa.png', 'não sou uma imagem'), svg: write('icone.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>') };
}

async function openChat(dataDir = freshDataDir(), project?: string) {
  const launched = await launchApp(dataDir, { env: FAKE_AGENTS });
  if (project) await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), project);
  // Added through IPC, not the screen: reload so the cached project list (the dashboard loads it) is fresh.
  if (project) await launched.page.reload();
  await launched.page.getByRole('complementary', { name: 'Menu' }).getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(launched.page.getByRole('region', { name: 'Conversa' })).toBeVisible();
  return launched;
}

const attached = (page: Page) => page.getByRole('list', { name: 'Imagens anexadas' }).getByRole('listitem');
const card = (page: Page, prompt: string) => page.getByRole('article', { name: `Tarefa: ${prompt}` });

/** A paste or drop as the browser fires it, with real File objects. */
async function fire(page: Page, kind: 'paste' | 'drop', name: string, bytes: number[], type: string) {
  await page.evaluate(
    ({ kind, name, bytes, type }) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], name, { type }));
      if (kind === 'paste') {
        document.querySelector('textarea')?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      } else {
        const box = document.querySelector('[data-testid="composer-box"]');
        box?.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
        box?.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
      }
    },
    { kind, name, bytes, type },
  );
}

test('images picked, pasted and dropped reach Claude Code, stay in the history and survive a restart', async () => {
  const dataDir = freshDataDir();
  const { png, jpeg } = files();
  let { app, page } = await openChat(dataDir);
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: 'Claude Code' });

  await page.getByLabel('Escolher imagens').setInputFiles([png, jpeg]);
  await expect(attached(page)).toHaveCount(2);
  await fire(page, 'paste', 'colada.png', [...PNG], 'image/png');
  await fire(page, 'drop', 'arrastada.jpg', [...JPEG], 'image/jpeg');
  await expect(attached(page)).toHaveCount(4);
  await page.getByRole('button', { name: 'Remover foto.jpg' }).click();
  await expect(attached(page)).toHaveCount(3);

  const prompt = 'Explique o que aparece na imagem';
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill(prompt);
  await box.press('Enter');
  const task = card(page, prompt);
  await expect(task.getByRole('status')).toHaveText('Concluída');
  // The agent got the three images, as images, in order.
  await expect(task).toContainText('Recebi 3 imagem(ns): png, png, jpeg.');
  await expect(page.getByRole('list', { name: 'Imagens anexadas' })).toHaveCount(0);
  const sent = task.getByRole('list', { name: 'Imagens enviadas' });
  await expect(sent.getByRole('img')).toHaveCount(3);

  await sent.getByRole('button', { name: 'Ampliar colada.png' }).click();
  const viewer = page.getByRole('dialog', { name: 'colada.png' });
  await expect(viewer.getByRole('img', { name: 'colada.png' })).toHaveAttribute('src', /^data:image\/png;base64,/);
  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // Stored in the app's data folder, and still shown after a restart.
  expect(readdirSync(join(dataDir, 'attachments'))).toHaveLength(1);
  await app.close();
  ({ app, page } = await openChat(dataDir));
  await page.getByRole('navigation', { name: 'Conversas' }).getByRole('button', { name: 'Expandir Sem projeto' }).click();
  await page.getByRole('navigation', { name: 'Conversas' }).getByRole('link', { name: new RegExp(prompt) }).click();
  await expect(card(page, prompt).getByRole('list', { name: 'Imagens enviadas' }).getByRole('img')).toHaveCount(3);

  // Deleting the conversation deletes its images.
  await page.getByRole('button', { name: `Excluir “${prompt}”` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir conversa' }).click();
  await expect.poll(() => readdirSync(join(dataDir, 'attachments'))).toEqual([]);
  await app.close();
});

test('Codex gets each image as --image in its project run and in a continuation; nothing lands in the project', async () => {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-e2e-img-proj-')), 'loja img');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'README.md'), '# loja\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  const { png, jpeg } = files();
  const { app, page } = await openChat(freshDataDir(), root);
  await page.getByLabel('Projeto', { exact: true }).selectOption({ label: 'loja img' });
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: 'Codex CLI' });
  await page.getByLabel('Escolher imagens').setInputFiles([jpeg]);
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill('Implemente a tela como na imagem');
  await box.press('Enter');
  await expect(card(page, 'Implemente a tela como na imagem')).toContainText('Recebi 1 imagem(ns): jpeg.');
  // The composer sends again only once the task is over.
  await expect(card(page, 'Implemente a tela como na imagem').getByRole('status')).toHaveText('Concluída');

  await page.getByLabel('Escolher imagens').setInputFiles([png]);
  await box.fill('Implemente também esta outra tela');
  await box.press('Enter');
  const next = card(page, 'Implemente também esta outra tela');
  await expect(next.getByRole('status')).toHaveText('Concluída');
  await expect(next).toContainText('Recebi 1 imagem(ns): png.');
  await expect(next.getByRole('list', { name: 'Imagens enviadas' }).getByRole('img')).toHaveCount(1);
  // Only the agent's own file changed in the project: the images live in the app's data folder.
  expect(git('status', '--porcelain').trim()).toBe('?? nota.txt');
  await app.close();
});

test('wrong files are refused with a reason, before and after leaving the window', async () => {
  const { fake, svg, png } = files();
  const { app, page } = await openChat();
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: 'Claude Code' });

  // Declared type and size are checked in the window.
  await page.getByLabel('Escolher imagens').setInputFiles([svg]);
  await expect(page.getByRole('alert', { name: 'Imagens recusadas' })).toContainText('“icone.svg” não é PNG, JPEG, GIF ou WebP.');
  await page.getByLabel('Escolher imagens').setInputFiles(Array(7).fill(png));
  await expect(attached(page)).toHaveCount(6);
  await expect(page.getByRole('alert', { name: 'Imagens recusadas' })).toContainText('No máximo 6 imagens por mensagem');
  await expect(page.getByRole('button', { name: 'Anexar imagens' })).toBeDisabled();
  for (let i = 0; i < 6; i++) await attached(page).first().getByRole('button').click();

  // The real bytes are checked in the main process: a text file named .png never reaches an agent.
  await page.getByLabel('Escolher imagens').setInputFiles([fake]);
  await expect(attached(page)).toHaveCount(1);
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill('Explique o que aparece na imagem');
  await box.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'não é uma imagem PNG, JPEG, GIF ou WebP' })).toBeVisible({ timeout: 15_000 });
  await expect(box).toHaveValue('Explique o que aparece na imagem');
  expect(await page.evaluate(() => window.neuralbridge.tasks.list({}))).toEqual([]);
  // And the IPC refuses a file path or anything but bytes.
  const refusal = await page.evaluate(() =>
    window.neuralbridge.tasks.start({ prompt: 'x', projectId: null, mode: 'claude', images: [{ name: 'a.png', data: 'C:/Windows/win.ini' as unknown as Uint8Array }] }).then(
      () => 'ok',
      (error: unknown) => String(error),
    ),
  );
  expect(refusal).not.toBe('ok');
  expect(existsSync(join(tmpdir(), 'nunca'))).toBe(false);
  await app.close();
});

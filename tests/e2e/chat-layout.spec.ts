import { expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, freshDataDir, launchApp } from './app';

// Phase 18: the conversation layout (collapsible panels, composer at the bottom, history management,
// model choice, stop) against the fake agent, which speaks the real CLI formats.

const menu = (page: Page) => page.getByRole('complementary', { name: 'Menu' });
const history = (page: Page) => page.getByRole('complementary', { name: 'Histórico de conversas' });
const conversations = (page: Page) => page.getByRole('navigation', { name: 'Conversas' });
const card = (page: Page, prompt: string) => page.getByRole('article', { name: `Tarefa: ${prompt}` });

async function openChat(dataDir = freshDataDir()) {
  const launched = await launchApp(dataDir, { env: FAKE_AGENTS });
  await menu(launched.page).getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(launched.page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  return launched;
}

async function send(page: Page, prompt: string) {
  const box = page.getByLabel('Mensagem', { exact: true });
  await box.fill(prompt);
  await box.press('Enter');
}

test('project groups start closed, open around the current conversation and show running work', async () => {
  const { app, page } = await openChat();
  const list = conversations(page);
  const group = list.getByRole('region', { name: 'Projeto Sem projeto' });
  await expect(group.getByRole('button', { name: 'Expandir Sem projeto' })).toBeVisible();

  await send(page, 'Explique a fila lenta');
  await expect(card(page, 'Explique a fila lenta').getByRole('status')).toHaveText('Concluída');
  await expect(group.getByRole('link', { name: /Explique a fila lenta/ })).toBeVisible();

  await page.getByRole('link', { name: 'Nova conversa' }).click();
  await expect(group.getByRole('link', { name: /Explique a fila lenta/ })).toHaveCount(0);
  await page.getByLabel('Pesquisar conversas').fill('fila');
  await expect(group.getByRole('link', { name: /Explique a fila lenta/ })).toBeVisible();
  await page.getByLabel('Pesquisar conversas').fill('');
  await group.getByRole('button', { name: 'Expandir Sem projeto' }).click();
  await expect(group.getByRole('link', { name: /Explique a fila lenta/ })).toBeVisible();
  await app.close();
});

test('the menu and the history collapse, keep their state after a restart, and navigation still works', async () => {
  const dataDir = freshDataDir();
  let { app, page } = await openChat(dataDir);

  await menu(page).getByRole('button', { name: 'Recolher menu' }).click();
  await expect(menu(page)).toHaveAttribute('data-collapsed', 'true');
  await expect.poll(async () => (await menu(page).boundingBox())?.width).toBeLessThan(80);
  // Icons only, but every entry keeps its name and shows it as a tooltip.
  const memory = menu(page).getByRole('link', { name: 'Memória', exact: true });
  await memory.hover();
  await expect(page.getByRole('tooltip', { name: 'Memória' })).toBeVisible();
  await memory.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Memória' })).toBeVisible();
  await menu(page).getByRole('link', { name: 'Chat', exact: true }).click();

  await history(page).getByRole('button', { name: 'Recolher histórico' }).click();
  await expect(history(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mostrar histórico' })).toBeVisible();
  await app.close();

  ({ app, page } = await launchApp(dataDir, { env: FAKE_AGENTS }));
  await expect(menu(page)).toHaveAttribute('data-collapsed', 'true');
  await menu(page).getByRole('link', { name: 'Chat', exact: true }).click();
  await expect(history(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar histórico' }).click();
  await expect(history(page)).toBeVisible();
  await menu(page).getByRole('button', { name: 'Expandir menu' }).click();
  await expect(menu(page)).toHaveAttribute('data-collapsed', 'false');
  await app.close();
});

test('the empty state is centred with the composer at the bottom; Shift+Enter breaks the line and Enter sends', async () => {
  const { app, page } = await openChat();
  const composer = page.getByRole('form', { name: 'Escrever mensagem' });
  const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const box = await composer.boundingBox();
  expect(box && box.y + box.height).toBeGreaterThan(viewport.height - 140);
  // No form at the top: the only text box on the page is the composer at the bottom.
  await expect(page.getByRole('textbox', { name: 'Mensagem' })).toHaveCount(1);
  await expect(page.getByLabel('Modelo')).toBeDisabled();

  const message = page.getByLabel('Mensagem', { exact: true });
  await message.click();
  await message.pressSequentially('Explique o cache');
  await message.press('Shift+Enter');
  await message.pressSequentially('em duas linhas');
  await expect(message).toHaveValue('Explique o cache\nem duas linhas');
  await expect(page.getByRole('article')).toHaveCount(0);
  await message.press('Enter');

  const task = card(page, 'Explique o cache\nem duas linhas');
  await expect(task.getByRole('status')).toHaveText('Concluída');
  // The newest message is in view, above the composer, not under it.
  const answer = await task.getByText('Resposta do agente falso', { exact: false }).boundingBox();
  const bottom = await composer.boundingBox();
  expect(answer && bottom && answer.y + answer.height).toBeLessThanOrEqual(bottom?.y ?? 0);
  await expect(page.getByLabel('Mensagem', { exact: true })).toHaveValue('');
  await app.close();
});

test('a running task is stopped from the composer', async () => {
  const { app, page } = await openChat();
  await send(page, 'Explique LENTO o cache');
  const stop = page.getByRole('button', { name: 'Parar' });
  await expect(stop).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar' })).toHaveCount(0);
  await stop.click();
  await expect(card(page, 'Explique LENTO o cache').getByRole('status')).toHaveText('Cancelada');
  await expect(page.getByRole('button', { name: 'Enviar' })).toBeVisible();
  await app.close();
});

test('an explicit agent takes an optional model, which the conversation keeps and later suggests', async () => {
  const { app, page } = await openChat();
  await page.getByLabel('Agente', { exact: true }).selectOption({ label: 'Claude Code' });
  const model = page.getByLabel('Modelo');
  await expect(model).toBeEnabled();
  await expect(page.getByText('os CLIs não informam quais estão disponíveis', { exact: false })).toBeVisible();
  await model.fill('opus');
  await send(page, 'Explique o roteador');

  const task = card(page, 'Explique o roteador');
  await expect(task.getByRole('status')).toHaveText('Concluída');
  await expect(task).toContainText('Roteado para Claude Code');
  const composer = page.getByRole('form', { name: 'Escrever mensagem' });
  await expect(composer).toContainText('opus');
  const stored = await page.evaluate(async () => {
    const [summary] = await window.neuralbridge.tasks.list({ limit: 1 });
    return { model: summary?.model, known: await window.neuralbridge.tasks.models() };
  });
  // Suggestions are only what the CLI reported in its session (the fake reports "fake-claude") and what was asked before.
  expect(stored).toEqual({ model: 'opus', known: { claude: ['fake-claude', 'opus'], codex: [] } });

  // A model that looks like a CLI option never reaches the CLI.
  const refused = await page.evaluate(() =>
    window.neuralbridge.tasks.start({ prompt: 'x', projectId: null, mode: 'claude', model: '--dangerously-skip-permissions' }).then(
      () => 'accepted',
      () => 'refused',
    ),
  );
  expect(refused).toBe('refused');
  await app.close();
});

test('conversations are renamed, searched by name, reopened and deleted after confirmation', async () => {
  const { app, page } = await openChat();
  await send(page, 'Explique a fila de pedidos');
  await expect(card(page, 'Explique a fila de pedidos').getByRole('status')).toHaveText('Concluída');
  await page.getByRole('link', { name: 'Nova conversa' }).click();
  await expect(page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  await send(page, 'Explique o cache de sessão');
  await expect(card(page, 'Explique o cache de sessão').getByRole('status')).toHaveText('Concluída');

  const list = conversations(page);
  // The history groups conversations by project: both are under "Sem projeto".
  await expect(list.getByRole('region', { name: 'Projeto Sem projeto' }).getByRole('link', { name: /Explique/ })).toHaveCount(2);
  await list.getByRole('button', { name: 'Renomear “Explique a fila de pedidos”' }).click();
  await list.getByLabel('Novo nome da conversa').fill('Filas: decisão');
  await list.getByLabel('Novo nome da conversa').press('Enter');
  await expect(list.getByRole('link', { name: /Filas: decisão/ })).toBeVisible();

  await page.getByLabel('Pesquisar conversas').fill('decisao');
  await expect(list.getByRole('listitem').getByRole('link')).toHaveCount(1);
  await list.getByRole('link', { name: /Filas: decisão/ }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Filas: decisão' })).toBeVisible();
  await expect(card(page, 'Explique a fila de pedidos')).toBeVisible();
  await page.getByLabel('Pesquisar conversas').fill('');

  await list.getByRole('button', { name: 'Excluir “Filas: decisão”' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Excluir esta conversa?' });
  await expect(dialog).toContainText('consumo de tokens');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(list.getByRole('listitem').getByRole('link')).toHaveCount(2);

  await list.getByRole('button', { name: 'Excluir “Filas: decisão”' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir conversa' }).click();
  await expect(page.getByRole('heading', { name: 'Em que vamos trabalhar?' })).toBeVisible();
  await list.getByRole('button', { name: 'Expandir Sem projeto' }).click();
  await expect(list.getByRole('listitem').getByRole('link')).toHaveCount(1);
  expect(await page.evaluate(async () => (await window.neuralbridge.tasks.list({})).map((task) => task.prompt))).toEqual(['Explique o cache de sessão']);
  await app.close();
});

test('the layout fits the smallest window without overlap or sideways scrolling', async () => {
  const { app, page } = await openChat();
  await send(page, 'Explique o módulo de pagamentos com um nome bem longo para testar a quebra de linhas no histórico');
  await expect(page.getByRole('article').getByRole('status')).toHaveText('Concluída');

  for (const [width, height] of [
    [960, 600],
    [1280, 820],
    [1920, 1080],
  ] as const) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(size.width, size.height), { width, height });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width);
    const layout = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
      const composer = rect('form[aria-label="Escrever mensagem"]');
      const log = document.querySelector('[role="log"]')?.parentElement?.getBoundingClientRect();
      const overflowing = [...document.querySelectorAll<HTMLElement>('main, main *')].filter((element) => element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX === 'visible' && element.clientWidth > 0).length;
      return {
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        pageScroll: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        overflowing,
        composerInside: composer ? composer.bottom <= window.innerHeight && composer.right <= window.innerWidth : false,
        noOverlap: composer && log ? log.bottom <= composer.top + 1 : false,
      };
    });
    expect(layout, `${width}x${height}`).toEqual({ sideways: false, pageScroll: false, overflowing: 0, composerInside: true, noOverlap: true });
  }
  await app.close();
});

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freshDataDir, launchApp } from './app';
import { seedGalaxy } from './galaxy-helpers';
import { recallThroughMcp } from './brain3d-helpers';

// Lote 50.06 — Memory Galaxy: one star per real memory, layout in a worker, details in the shell panel, real
// timeline, keyboard and list alternatives, rollback to the previous 3D brain.
const shots = join(process.cwd(), 'artifacts', 'singularity');

async function openGalaxy(count: number, options: Parameters<typeof launchApp>[1] = {}) {
  const dataDir = freshDataDir();
  const seeded = seedGalaxy(dataDir, { count, withEmbeddings: true });
  const launched = await launchApp(dataDir, options);
  await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'))?.setContentSize(1440, 900));
  await launched.page.evaluate(() => { window.location.hash = '#/memory/galaxy'; });
  return { ...launched, seeded };
}

const galaxy = (page: Page) => page.getByTestId('galaxy');

test('every live memory becomes one star, laid out by the worker, with real panel and timeline', async () => {
  mkdirSync(shots, { recursive: true });
  const { app, page, seeded } = await openGalaxy(300);
  await expect(galaxy(page)).toHaveAttribute('data-worker', 'ok', { timeout: 20_000 });
  await expect(galaxy(page)).toHaveAttribute('data-stars', '300');
  await expect(galaxy(page)).toHaveAttribute('data-visible', '300');
  await expect(galaxy(page)).toHaveAttribute('data-ready-ms', /\d+/);
  await expect(page.getByRole('navigation', { name: 'Seções da memória' }).getByRole('link', { name: 'Galáxia' })).toHaveAttribute('aria-current', 'page');

  const aside = page.getByRole('complementary', { name: 'Galáxia de memórias' });
  await expect(aside.getByText('300', { exact: true }).first()).toBeVisible();
  await expect(aside.getByText(/300 estrelas têm embedding/)).toBeVisible();
  const timeline = page.getByRole('region', { name: 'Linha do tempo de hoje' });
  await expect(timeline.getByRole('link')).toHaveCount(seeded.createdToday);
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, 'galaxy-dark-1440.png'), animations: 'disabled' });

  // Grouping changes the arms, never the star count.
  await page.getByRole('radio', { name: 'Projeto' }).click();
  await expect(galaxy(page)).toHaveAttribute('data-mode', 'project');
  await page.getByRole('radio', { name: 'Significado' }).click();
  await expect(galaxy(page)).toHaveAttribute('data-mode', 'semantic');
  await expect(galaxy(page)).toHaveAttribute('data-stars', '300');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shots, 'galaxy-semantic-1440.png'), animations: 'disabled' });

  // Filters dim exactly the memories that do not match.
  await page.getByLabel('Filtrar por tipo').selectOption('bug_fix');
  await expect(galaxy(page)).toHaveAttribute('data-visible', String(seeded.byType['bug_fix'] ?? 0));
  await page.getByLabel('Filtrar por tipo').selectOption('all');
  await expect(galaxy(page)).toHaveAttribute('data-visible', '300');

  // Search goes through the app's real hybrid search.
  await page.getByPlaceholder('Buscar por texto ou significado').fill('keycloak');
  await expect(page.getByText(/resultado\(s\) da busca/)).toBeVisible();
  await expect.poll(async () => Number(await galaxy(page).getAttribute('data-visible'))).toBeLessThan(300);
  await page.getByPlaceholder('Buscar por texto ou significado').fill('');

  // Keyboard: step to a star, open its details in the right panel.
  const view = page.getByRole('application');
  await view.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const details = page.getByRole('complementary', { name: 'Detalhes da memória' });
  await expect(details).toBeVisible();
  await expect(details.getByRole('heading', { level: 2 })).toHaveText(/^Fixture \d+ · /);
  await expect(details.getByText('Mais próximas por significado')).toBeVisible();
  await expect(details.locator('li button').first()).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, 'galaxy-selected-1440.png'), animations: 'disabled' });
  await expect(page).toHaveURL(/m=/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: 'Galáxia de memórias' })).toBeVisible();

  // A timeline event selects its star.
  await timeline.getByRole('link').first().click();
  await expect(details).toBeVisible();

  // List view: the same memories as accessible rows.
  await page.getByRole('button', { name: 'Ver como lista' }).click();
  await expect(page.getByRole('list', { name: 'Memórias da galáxia' }).or(page.getByLabel('Memórias da galáxia'))).toBeVisible();
  await page.getByRole('button', { name: 'Ver como lista' }).click();

  // Light theme: the galaxy stays a dark window into space; the shell follows the theme.
  await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(shots, 'galaxy-light-1440.png'), animations: 'disabled' });
  await app.close();
});

test('rollback: the previous 3D brain comes back from Memory settings without a restart', async () => {
  const { app, page } = await openGalaxy(40);
  await expect(galaxy(page)).toHaveAttribute('data-worker', 'ok', { timeout: 20_000 });
  const tabs = page.getByRole('navigation', { name: 'Seções da memória' });
  await tabs.getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('radio', { name: /Cérebro 3D anterior/ }).click();
  await expect(tabs.getByRole('link', { name: 'Cérebro 3D' })).toBeVisible();
  await expect(tabs.getByRole('link', { name: 'Galáxia' })).toHaveCount(0);
  await tabs.getByRole('link', { name: 'Cérebro 3D' }).click();
  await expect(page.getByTestId('brain3d')).toBeVisible();
  // The galaxy route keeps working by deep link.
  await page.evaluate(() => { window.location.hash = '#/memory/galaxy'; });
  await expect(galaxy(page)).toHaveAttribute('data-stars', '40', { timeout: 20_000 });
  await tabs.getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('radio', { name: /Galáxia de Memórias/ }).click();
  await expect(tabs.getByRole('link', { name: 'Galáxia' })).toBeVisible();
  await app.close();
});

test('without WebGL the galaxy shows the memories as a list and offers the 2D graph', async () => {
  const { app, page } = await openGalaxy(30, { chromiumArgs: ['--disable-gpu', '--disable-software-rasterizer'] });
  await expect(page.getByText(/não oferece WebGL/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Abrir o grafo 2D' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Fixture \d+ · / }).first()).toBeVisible();
  await page.getByRole('button', { name: /^Fixture \d+ · / }).first().click();
  await expect(page.getByRole('complementary', { name: 'Detalhes da memória' })).toBeVisible();
  await app.close();
});

test('reduced motion turns off rotation and the galaxy stays usable', async () => {
  const { app, page } = await openGalaxy(40);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(galaxy(page)).toHaveAttribute('data-worker', 'ok', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Rotação automática' })).toBeDisabled();
  await page.getByRole('button', { name: 'Aproximar' }).click();
  await page.getByRole('button', { name: 'Voltar à vista inicial' }).click();
  await expect(galaxy(page)).toHaveAttribute('data-stars', '40');
  await app.close();
});

// Lote 50.07: the galaxy follows the real memory and RAG.
test('a real MCP recall lights its star, appears in the panel and timeline; the RAG index and new memories are live', async () => {
  test.setTimeout(120_000);
  const { app, page, seeded, dataDir } = await openGalaxy(120);
  await expect(galaxy(page)).toHaveAttribute('data-worker', 'ok', { timeout: 20_000 });
  await expect(page.getByTestId('galaxy-rag-index')).toContainText('120 de 120 com embedding');

  // An agent recalls a global memory through the real MCP server, as Claude Code would.
  const title = seeded.titles[3] ?? '';
  await recallThroughMcp(dataDir, 'claude-code', title);
  const recalls = page.getByTestId('galaxy-recalls');
  await expect(recalls.getByRole('button', { name: title })).toBeVisible({ timeout: 20_000 });
  await expect(recalls).toContainText('Claude Code');
  await expect(page.getByRole('region', { name: 'Linha do tempo de hoje' }).locator(`a[title="${title} · Recuperada por Claude Code"]`)).toHaveCount(1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, 'galaxy-recall-1440.png'), animations: 'disabled' });

  // Search lists its hits with how they matched.
  await page.getByPlaceholder('Buscar por texto ou significado').fill('redis');
  await expect(page.getByTestId('galaxy-search-results').getByRole('button').first()).toBeVisible();
  await expect(page.getByTestId('galaxy-search-results')).toContainText('texto');
  await page.getByPlaceholder('Buscar por texto ou significado').fill('');

  // A memory stored now shows up without reopening the page (overview poll, then a reload of the snapshot).
  await page.evaluate(() => window.neuralbridge.brain.store({ title: 'Memória nova ao vivo', content: 'Criada durante o teste.', type: 'learning', projectId: null }));
  await expect(galaxy(page)).toHaveAttribute('data-stars', '121', { timeout: 30_000 });
  await app.close();
});

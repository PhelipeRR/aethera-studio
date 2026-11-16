import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

// Layout of the minimal "Produção com IA" screen (shadcn/ui migration): briefing, advanced settings, live tracking,
// per-project console, independent general console and the editorial audit tab. Screenshots land in
// docs/aethera/screenshots/production-ai/ for visual review.

async function hasHorizontalOverflow(win: Page): Promise<boolean> {
  return win.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    return main.scrollWidth > main.clientWidth + 1;
  });
}

test('Produção com IA — layout minimalista, consoles e acessibilidade', async () => {
  test.setTimeout(150_000);
  const appDir = resolve('apps/aethera-desktop');
  const shotsDir = resolve('docs/aethera/screenshots/production-ai');
  mkdirSync(shotsDir, { recursive: true });

  const tempHome = mkdtempSync(join(tmpdir(), 'aethera-production-layout-'));
  const appData = join(tempHome, 'AppData', 'Roaming');
  const localAppData = join(tempHome, 'AppData', 'Local');
  mkdirSync(appData, { recursive: true });
  mkdirSync(localAppData, { recursive: true });

  const electronPath = createRequire(join(appDir, 'package.json'))('electron') as unknown as string;
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  delete env['ELECTRON_RENDERER_URL'];
  delete env['ELECTRON_RUN_AS_NODE'];

  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: [appDir],
    cwd: appDir,
    env: {
      ...env,
      HOME: tempHome,
      USERPROFILE: tempHome,
      APPDATA: appData,
      LOCALAPPDATA: localAppData,
      NB_E2E_FAKE_AGENTS: JSON.stringify(FAKE_AGENTS),
      NB_E2E_NO_RELAUNCH: '1',
    },
  });

  try {
    const win = await mainWindowOf(electronApp);
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.waitForSelector('aside nav', { timeout: 15_000 });
    await win.locator('aside nav').getByRole('link', { name: 'Produção com IA' }).click();
    await expect(win.getByRole('heading', { name: 'Produção com IA', level: 1 })).toBeVisible();

    // Empty state: briefing + tracking side by side, advanced settings collapsed.
    await expect(win.getByRole('heading', { name: 'Briefing' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Acompanhamento' })).toBeVisible();
    await expect(win.getByText(/Nenhuma produção ativa/)).toBeVisible();
    await expect(win.locator('#cinema-narrative-format')).toHaveCount(0);
    await win.screenshot({ path: join(shotsDir, '01-briefing-vazio.png') });

    // Advanced settings expand in place and keep every control labelled.
    const advanced = win.getByRole('button', { name: 'Configurações avançadas' });
    await expect(advanced).toHaveAttribute('aria-expanded', 'false');
    await advanced.click();
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Formato narrativo', 'Categoria do conteúdo', 'Direção estética', 'Entrega audiovisual', 'Perfil de render', 'Resolução de preview']) {
      await expect(win.getByLabel(label, { exact: true })).toBeVisible();
    }
    await win.screenshot({ path: join(shotsDir, '02-configuracoes-avancadas.png'), fullPage: true });
    await advanced.click();

    // Start a production: fake agents pause it at the research gate, which is enough to render tracking and lists.
    await win.getByRole('button', { name: /Gerar Direção & Storyboard/i }).click();
    await expect(win.getByText(/Pausado \(Pesquisa Pendente\)/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(win.getByRole('progressbar', { name: 'Progresso da produção ativa' })).toBeVisible();
    await expect(win.getByRole('list', { name: 'Etapas da produção' }).getByRole('listitem')).toHaveCount(11);
    await win.evaluate(() => window.scrollTo({ top: 0 }));
    await win.screenshot({ path: join(shotsDir, '03-acompanhamento.png') });

    // Per-project console lives inside its production row; the general console is a separate section.
    const job = win.locator('[data-production-job]').first();
    await expect(job).toBeVisible();
    await expect(job.locator('[data-console-panel="job"]')).toHaveCount(1);
    const general = win.locator('[data-console-panel="general"]');
    await expect(general).toHaveCount(1);
    await expect(win.locator('[data-production-job] [data-console-panel="general"]')).toHaveCount(0);
    await expect(win.getByRole('heading', { name: 'Console Geral' })).toBeVisible();

    await job.locator('[data-console-panel="job"] > button').click();
    await general.locator('> button').click();
    await win.getByRole('heading', { name: /Projetos em Produção com IA/ }).scrollIntoViewIfNeeded();
    await win.screenshot({ path: join(shotsDir, '04-producoes-e-consoles.png') });

    // Tabs are keyboard operable (Radix roving focus) and switch to the editorial audit.
    const productionTab = win.getByRole('tab', { name: /Produção & Direção/ });
    await productionTab.focus();
    await win.keyboard.press('ArrowRight');
    await expect(win.getByRole('tab', { name: /Auditoria Editorial/ })).toHaveAttribute('aria-selected', 'true');
    await win.evaluate(() => window.scrollTo({ top: 0 }));
    await win.screenshot({ path: join(shotsDir, '05-auditoria.png') });
    await win.keyboard.press('ArrowLeft');
    await expect(productionTab).toHaveAttribute('aria-selected', 'true');

    // Narrow desktop: single column, no horizontal overflow.
    await win.setViewportSize({ width: 1024, height: 768 });
    await expect(win.getByRole('heading', { name: 'Briefing' })).toBeVisible();
    expect(await hasHorizontalOverflow(win)).toBe(false);
    await win.evaluate(() => window.scrollTo({ top: 0 }));
    await win.screenshot({ path: join(shotsDir, '06-1024px.png'), fullPage: true });
  } finally {
    await electronApp.close();
    rmSync(tempHome, { recursive: true, force: true });
  }
});

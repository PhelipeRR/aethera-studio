import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

// Layout of the minimal "Produção com IA" screen (proposal v2): production rail, intent tabs, briefing with
// progressive disclosure, active tracking, project console dock and the independent Console Geral. Screenshots land in
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

    // Criar: briefing is the protagonist, rail on the left, ideas on the right, details closed.
    await expect(win.getByRole('tab', { name: 'Criar' })).toHaveAttribute('aria-selected', 'true');
    await expect(win.getByRole('heading', { name: 'Briefing' })).toBeVisible();
    await expect(win.getByRole('navigation', { name: 'Produções' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Ideias pesquisadas' })).toBeVisible();
    // The example is a placeholder: nothing is pre-filled and the CTA waits for a real briefing.
    const briefing = win.locator('#cinema-prompt');
    await expect(briefing).toHaveValue('');
    await expect(briefing).toHaveAttribute('placeholder', /^Ex\.:/);
    await expect(win.getByText('Entendi:')).toHaveCount(0);
    await expect(win.getByRole('button', { name: /Gerar Direção & Storyboard/i })).toBeDisabled();
    await briefing.fill('Crie um vídeo cinematográfico sobre os 10 chefes mais difíceis de Elden Ring, com narrativa épica, humor pontual e duração de 12 minutos.');
    await expect(win.getByText('Entendi:')).toBeVisible();
    // Formato and Estilo are compact selects carrying the whole catalog.
    await expect(win.getByRole('combobox', { name: 'Formato', exact: true })).toBeVisible();
    await expect(win.getByRole('combobox', { name: 'Estilo', exact: true })).toBeVisible();
    await expect(win.getByLabel('Humor')).toHaveAttribute('aria-valuetext', /%/);
    await expect(win.getByRole('button', { name: 'Atualizar lista de vozes do VoiceStudio' })).toHaveCount(0);
    await win.screenshot({ path: join(shotsDir, '01-criar.png') });

    // Progressive disclosure: every detail row opens in place and keeps its controls labelled.
    await win.getByRole('button', { name: /Narração e idioma/ }).click();
    await expect(win.getByLabel('Idioma do vídeo', { exact: true })).toBeVisible();
    await expect(win.getByRole('button', { name: 'Atualizar lista de vozes do VoiceStudio' })).toBeVisible();
    await win.getByRole('button', { name: /^Qualidade/ }).click();
    const advanced = win.getByRole('button', { name: /^Configurações avançadas/ });
    await expect(advanced).toHaveAttribute('aria-expanded', 'false');
    await advanced.click();
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Categoria do conteúdo', 'Direção estética', 'Perfil de render', 'Resolução de preview']) {
      await expect(win.getByLabel(label, { exact: true })).toBeVisible();
    }
    await win.screenshot({ path: join(shotsDir, '02-detalhes-abertos.png'), fullPage: true });
    await advanced.click();

    // "ajustar" in the understanding row opens the advanced catalog.
    await win.getByRole('button', { name: 'ajustar' }).click();
    await expect(advanced).toHaveAttribute('aria-expanded', 'true');
    await advanced.click();

    // New idea search opens the real Trend Radar in a dialog that closes with Escape.
    const searchIdeas = win.getByRole('button', { name: 'Pesquisar novas ideias' });
    if (await searchIdeas.isEnabled()) {
      await searchIdeas.click();
      const dialog = win.getByRole('dialog', { name: 'Pesquisar novas ideias' });
      await expect(dialog).toBeVisible();
      await dialog.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
      await win.screenshot({ path: join(shotsDir, '03-pesquisar-ideias.png') });
      await win.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    }

    // Diagnostics live behind the gear popover, not on the page.
    await win.getByRole('button', { name: 'Diagnóstico do ambiente' }).click();
    await expect(win.getByRole('button', { name: /Rodar Benchmark/ })).toBeVisible();
    await win.keyboard.press('Escape');

    // Start a production: fake agents pause it at the research gate, which is enough to render tracking.
    await win.getByRole('button', { name: /Gerar Direção & Storyboard/i }).click();
    await expect(win.getByRole('tab', { name: /Produção ativa/ })).toHaveAttribute('aria-selected', 'true');
    await expect(win.getByText(/Pausado \(Pesquisa Pendente\)/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(win.getByRole('progressbar', { name: 'Progresso da produção ativa' })).toBeVisible();
    await expect(win.getByText(/Etapa \d+ de 11/)).toBeVisible();
    const stepper = win.getByRole('list', { name: 'Etapas da produção' });
    await expect(stepper.locator('[data-stage-state]')).toHaveCount(11);
    for (const phase of ['Planejamento', 'Mídia', 'Montagem', 'Entrega']) {
      await expect(stepper.getByText(phase, { exact: true }).first()).toBeVisible();
    }
    await expect(win.getByRole('heading', { name: 'Agora' })).toBeVisible();

    // The rail lists the production with icon + text status; the project console is the dock, scoped to it.
    const job = win.locator('[data-production-job]').first();
    await expect(job).toBeVisible();
    await expect(job).toHaveAttribute('aria-current', 'true');
    const dock = win.locator('#cinema-project-console');
    await expect(dock.locator('[data-console-panel="job"]')).toHaveCount(1);
    await expect(win.locator('[data-console-panel="general"]')).toHaveCount(0);
    await win.screenshot({ path: join(shotsDir, '04-producao-ativa.png') });
    await win.getByRole('button', { name: /Abrir no console desta produção/ }).click();
    await expect(dock.locator('[data-console-panel="job"] > button')).toHaveAttribute('aria-expanded', 'true');
    // Quiet console: advanced filters and stage chips stay folded until asked for.
    const filtersToggle = dock.getByRole('button', { name: /^Filtros/ });
    await expect(filtersToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(dock.getByLabel('Origem')).toBeHidden();
    await filtersToggle.click();
    await expect(dock.getByLabel('Origem')).toBeVisible();
    await filtersToggle.click();
    await win.screenshot({ path: join(shotsDir, '05-console-do-projeto.png') });

    // Tabs are keyboard operable (Radix roving focus).
    const activeTab = win.getByRole('tab', { name: /Produção ativa/ });
    await activeTab.focus();
    await win.keyboard.press('ArrowRight');
    await expect(win.getByRole('tab', { name: 'Revisão' })).toHaveAttribute('aria-selected', 'true');
    await expect(win.getByRole('tablist', { name: 'Itens de revisão' })).toBeVisible();
    await win.screenshot({ path: join(shotsDir, '06-revisao.png') });
    await win.keyboard.press('ArrowRight');
    await expect(win.getByRole('tab', { name: /Auditoria Editorial/ })).toHaveAttribute('aria-selected', 'true');
    await win.screenshot({ path: join(shotsDir, '07-auditoria.png') });

    // Narrow desktop: no horizontal overflow.
    await win.setViewportSize({ width: 1024, height: 768 });
    const createTab = win.getByRole('tab', { name: 'Criar' });
    await createTab.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await createTab.click();
    await expect(win.getByRole('heading', { name: 'Briefing' })).toBeVisible();
    expect(await hasHorizontalOverflow(win)).toBe(false);
    await win.screenshot({ path: join(shotsDir, '08-1024px.png'), fullPage: true });
    await win.setViewportSize({ width: 1440, height: 900 });

    // Console Geral is an independent area of the main navigation, showing every production.
    await win.locator('aside nav').getByRole('link', { name: 'Console Geral' }).click();
    await expect(win.getByRole('heading', { name: 'Console Geral', level: 1 })).toBeVisible();
    await expect(win.locator('[data-console-panel="general"]')).toHaveCount(1);
    await win.screenshot({ path: join(shotsDir, '09-console-geral.png') });
  } finally {
    await electronApp.close();
    rmSync(tempHome, { recursive: true, force: true });
  }
});

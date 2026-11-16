import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

test('Aethera Studio Redesign — E2E Navigation, Cinema AI IPC & Visual Screenshots', async () => {
  test.setTimeout(120_000);
  const appDir = resolve('apps/aethera-desktop');
  const screenshotsDir = resolve('docs/aethera/screenshots');
  mkdirSync(screenshotsDir, { recursive: true });

  const tempHome = mkdtempSync(join(tmpdir(), 'aethera-redesign-e2e-'));
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

    // 1. Verify Aethera Studio theme & Singularity separation
    const themeAttr = await win.locator('[data-studio-theme="aethera"]').count();
    expect(themeAttr).toBeGreaterThan(0);

    const navText = await win.locator('aside nav').innerText();
    expect(navText).toContain('Home');
    expect(navText).toContain('Projeto Manual');
    expect(navText).toContain('Produção com IA');
    expect(navText).toContain('Editor');
    expect(navText).toContain('Biblioteca');
    expect(navText).toContain('Agentes');
    expect(navText).toContain('Revisão e Qualidade');
    expect(navText).not.toContain('MCP');
    expect(navText).not.toContain('RAG');
    expect(navText).not.toContain('Memórias');

    // Home screenshot
    await expect(win.getByRole('heading', { name: 'Aethera Studio' })).toBeVisible();
    await win.screenshot({ path: join(screenshotsDir, '01-home.png') });

    // 2. Projetos
    await win.locator('aside nav').getByRole('link', { name: 'Projeto Manual' }).click();
    await expect(win.getByRole('heading', { name: 'Projeto Manual' })).toBeVisible();
    await win.screenshot({ path: join(screenshotsDir, '02-projetos.png') });

    // 3. Produção com IA + Production Contract sync + staged pipeline (real IPC)
    await win.locator('aside nav').getByRole('link', { name: 'Produção com IA' }).click();
    await expect(win.getByRole('heading', { name: 'Produção com IA' })).toBeVisible();
    await expect(win.getByText(/720s \(12 min\)/i)).toBeVisible();
    const briefing = win.locator('#cinema-prompt');
    await briefing.fill('Crie um vídeo de 10 minutos sobre os 10 chefes mais difíceis de Elden Ring, com pesquisa verificável.');
    await win.locator('#cinema-duration').fill('12');
    await win.locator('#cinema-duration').press('Tab');
    await briefing.fill('Crie um vídeo de 10 minutos sobre os 10 chefes mais difíceis de Elden Ring, com pesquisa verificável.');
    await expect(win.getByText(/entrou em conflito com controles alterados manualmente/i)).toBeVisible();
    await win.getByRole('button', { name: 'Manter controle' }).click();
    await win.getByRole('button', { name: /Gerar Direção & Storyboard/i }).click();
    await expect(win.getByRole('region', { name: 'Conformidade do contrato de produção' })).toBeVisible();
    // The button starts the staged pipeline. The E2E fake agents return no verifiable research
    // dossier, so the job must pause at the research gate instead of inventing facts.
    await expect(win.getByText(/Pausado \(Pesquisa Pendente\)/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(win.getByText(/Nenhum fato foi inventado/i).first()).toBeVisible();
    await expect(win.getByRole('button', { name: 'Retomar Projeto' }).first()).toBeVisible();
    await win.screenshot({ path: join(screenshotsDir, '03-producao-ia.png') });

    // 4. Editor NLE Profissional — Importar -> Editar -> Preview -> Renderizar MP4 Real
    // The staged production above stops at the research gate, so seed a short real package through
    // the deterministic cinema:produce IPC; the Editor opens the latest project.
    const seeded = await win.evaluate(async () => {
      const api = (window as unknown as { aetheraBridge?: { cinemaProduce?: (i: Record<string, unknown>) => Promise<{ timeline?: { projectId?: string } }> } }).aetheraBridge;
      return api?.cinemaProduce?.({
        projectId: 'e2e_editor_seed',
        prompt: 'Mini documentário sobre exploração espacial',
        genre: 'documentary',
        format: 'youtube_16_9',
        targetDurationSec: 12,
        humorIntensity: 20,
      }) ?? null;
    });
    expect(seeded?.timeline?.projectId).toBe('e2e_editor_seed');
    await win.locator('aside nav').getByRole('link', { name: 'Editor' }).click();
    await expect(win.getByText('Editor NLE Profissional')).toBeVisible();
    await expect(win.getByText('Timeline NLE')).toBeVisible({ timeout: 10_000 });
    await expect(win.getByRole('slider', { name: /Régua temporal e playhead/i })).toBeVisible();

    // Edit clip via Trim -0.5s and verify project persistence
    await win.getByRole('button', { name: 'Trim -0.5s' }).click();
    await expect(win.getByText(/Projeto salvo \(v/i)).toBeVisible({ timeout: 10_000 });

    // Import real MP4 asset via IPC and verify thumbnail/duration
    const showcaseMp4 = resolve('docs/aethera/cinema/real-showcase/showcase-v2-final.mp4');
    const imported = await win.evaluate(async (p) => {
      const api = (window as unknown as { aetheraBridge?: { cinemaImportMedia?: (i: { filePath: string }) => Promise<{ name: string; durationSec: number } | null> } }).aetheraBridge;
      return api?.cinemaImportMedia?.({ filePath: p }) ?? null;
    }, showcaseMp4);
    expect(imported?.name).toBe('showcase-v2-final.mp4');
    expect(imported?.durationSec).toBeGreaterThanOrEqual(60);

    // Render edited timeline to real MP4 & verify <video> loads aethera-media://
    await win.getByRole('button', { name: /^Renderizar MP4$/i }).click();
    await expect(win.locator('video')).toBeVisible({ timeout: 90_000 });
    const videoSrc = await win.locator('video').getAttribute('src');
    expect(videoSrc).toContain('aethera-media://local');
    await win.screenshot({ path: join(screenshotsDir, '04-editor.png') });

    // 5. Biblioteca de Mídia
    await win.locator('aside nav').getByRole('link', { name: 'Biblioteca' }).click();
    await expect(win.getByRole('heading', { name: 'Biblioteca de Mídia' })).toBeVisible();
    await win.screenshot({ path: join(screenshotsDir, '05-biblioteca.png') });

    // 6. Agentes Cinematográficos
    await win.locator('aside nav').getByRole('link', { name: 'Agentes' }).click();
    await expect(
      win.getByRole('heading', { name: 'Equipe de 15 Diretores Cinematográficos' }),
    ).toBeVisible();
    await expect(win.getByText(/Executar Orquestração DAG/i)).toBeVisible();
    await win.screenshot({ path: join(screenshotsDir, '06-agentes.png') });

    // 7. Revisão e Qualidade
    await win.locator('aside nav').getByRole('link', { name: 'Revisão e Qualidade' }).click();
    await expect(win.getByRole('heading', { name: 'Revisão e Qualidade' })).toBeVisible();
    await expect(win.getByText(/Qualidade Auditada \(MP4 Real\)|Estimativa de Planejamento/i)).toBeVisible({ timeout: 10_000 });
    await win.screenshot({ path: join(screenshotsDir, '07-revisao-qualidade.png') });
  } finally {
    await electronApp.close();
    rmSync(tempHome, { recursive: true, force: true });
  }
});

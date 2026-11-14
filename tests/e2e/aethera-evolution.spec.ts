import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

test('Aethera Evolution & Academy — 15 Directors, DAG, Feedback Learning & Academy Q&A', async () => {
  test.setTimeout(120_000);
  const appDir = resolve('apps/aethera-desktop');

  const tempHome = mkdtempSync(join(tmpdir(), 'aethera-evo-e2e-'));
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

    // Navigate to Agentes (15 Directors + Evolution + Academy)
    await win.locator('aside nav').getByRole('link', { name: 'Agentes' }).click();
    await expect(
      win.getByRole('heading', { name: 'Equipe de 15 Diretores Cinematográficos' }),
    ).toBeVisible();
    await expect(win.getByRole('button', { name: 'Diretores (15)' })).toBeVisible();

    // 1. Run 15-Director Orchestration DAG
    await win.getByRole('button', { name: /Executar Orquestração DAG/i }).click();
    await expect(
      win.getByText(/Orquestração DAG dos 15 diretores concluída/i),
    ).toBeVisible({ timeout: 15_000 });

    // 2. Submit human feedback and inspect memory & decisions
    await win.getByRole('button', { name: /Memória & Feedback/i }).click();
    await win
      .getByLabel('Feedback humano para os diretores')
      .fill('O áudio sobrepôs na cena 2 e a narração competiu com o SFX');
    await win.getByRole('button', { name: 'Registrar Aprendizado' }).click();
    await expect(
      win.getByText(/Feedback classificado e registrado na memória evolutiva/i),
    ).toBeVisible();
    await expect(win.getByText(/sound_director/i).first()).toBeVisible();

    // 3. Aethera Academia: ingest material, validate exercise, ask Q&A
    await win.getByRole('button', { name: /Aethera Academia/i }).click();
    await win.getByLabel('Título do material').fill('Manual de Mixagem EBU R128 e J-Cut');
    await win
      .getByLabel('Conteúdo do material')
      .fill('Aplicar J-cut de 400ms antes de cortes narrativos e manter true peak abaixo de -1.0 dBTP.');
    await win.getByRole('button', { name: /Indexar e Rotear para Diretores/i }).click();
    await expect(
      win.getByText(/Manual de Mixagem EBU R128 e J-Cut/i).first(),
    ).toBeVisible();

    // Validate via practical exercise
    await win.getByRole('button', { name: /Praticar & Validar/i }).first().click();
    await expect(win.getByText(/Exercício validado/i)).toBeVisible();

    // Ask Academy
    await win.getByLabel('Pergunta à Academia').fill('Como aplicar J-cut e true peak?');
    await win.getByRole('button', { name: 'Consultar' }).click();
    await expect(win.getByText(/Fontes citadas:/i)).toBeVisible();
  } finally {
    await electronApp.close();
    rmSync(tempHome, { recursive: true, force: true });
  }
});

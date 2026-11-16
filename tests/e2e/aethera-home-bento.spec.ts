import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { FAKE_AGENTS, mainWindowOf } from './app';

// Light bento home (docs/aethera/home-light-bento-plan.md). Screenshots land in docs/aethera/screenshots/home/.
test('Aethera home — light bento layout', async () => {
  test.setTimeout(120_000);
  const appDir = resolve('apps/aethera-desktop');
  const shotsDir = resolve('docs/aethera/screenshots/home');
  mkdirSync(shotsDir, { recursive: true });

  const tempHome = mkdtempSync(join(tmpdir(), 'aethera-home-'));
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

    // Empty state first.
    await expect(win.getByRole('link', { name: 'Gerar vídeo com IA' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Pra aprovar' })).toBeVisible();
    await expect(win.getByRole('heading', { name: 'Agenda' })).toBeVisible();
    await win.screenshot({ path: join(shotsDir, '01-home-vazia.png') });

    // Seed a few real projects through the public IPC surface.
    await win.evaluate(async () => {
      const titles = ['Só dando uma olhada', 'Confirma antes', 'Pedir no balcão', 'Quiz condicional'];
      for (const title of titles) {
        await window.neuralbridge.content.createProject({
          id: crypto.randomUUID(),
          workspaceId: 'default',
          channelId: null,
          videoProjectId: null,
          title,
          autonomy: 'assisted',
        });
      }
    });
    await win.reload();
    await win.waitForSelector('aside nav', { timeout: 15_000 });
    await expect(win.getByRole('heading', { name: 'Recentes' })).toBeVisible();
    await expect(win.getByText('Confirma antes').first()).toBeVisible();

    const overflow = await win.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      return main.scrollWidth > main.clientWidth + 1;
    });
    expect(overflow).toBe(false);
    await win.screenshot({ path: join(shotsDir, '02-home-com-projetos.png') });

    await win.setViewportSize({ width: 1024, height: 900 });
    await win.screenshot({ path: join(shotsDir, '03-home-1024px.png') });

    // The rest of the system follows the same light palette.
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.locator('aside nav').getByRole('link', { name: 'Produção com IA' }).click();
    await expect(win.getByRole('heading', { name: 'Produção com IA', level: 1 })).toBeVisible();
    await win.screenshot({ path: join(shotsDir, '04-producao-ia-tema-claro.png') });
    await win.locator('aside nav').getByRole('link', { name: 'Revisão e Qualidade' }).click();
    await win.screenshot({ path: join(shotsDir, '05-revisao-tema-claro.png') });
    await win.locator('aside nav').getByRole('link', { name: 'Thumbs & Artes' }).click();
    await win.waitForTimeout(1500);
    await win.screenshot({ path: join(shotsDir, '06-thumbs-artes-tema-claro.png'), fullPage: true });
    console.log('CREATIVE_TEXT', (await win.locator('main').innerText()).slice(0, 600));
  } finally {
    await electronApp.close();
    rmSync(tempHome, { recursive: true, force: true });
  }
});

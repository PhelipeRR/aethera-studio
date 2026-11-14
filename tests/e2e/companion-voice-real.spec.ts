import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { NeuraState } from '@neuralbridge/shared/neura-state';
import { freshDataDir, launchApp } from './app';

// Opt-in, because it needs the local VoiceStudio and plays a voice through the speakers: set NB_E2E_REAL_VOICE=1.
// A state pushed the way the main process pushes it, then everything real: renderer, IPC, VoiceStudio, audio and mouth.

const shots = resolve('artifacts/motion');
mkdirSync(shots, { recursive: true });

async function openNeura(): Promise<{ app: ElectronApplication; hud: Page; state: NeuraState }> {
  const dataDir = freshDataDir();
  writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', companionHud: { visible: true, x: 200, y: 200, mode: 'expanded', alwaysOnTop: true } }));
  const { app, page } = await launchApp(dataDir);
  await page.evaluate(() => window.neuralbridge.neura.updateSettings({ enabled: true, meetingConsent: true }));
  await expect.poll(() => app.windows().some((item) => item.url().includes('companion=hud'))).toBe(true);
  const hud = app.windows().find((item) => item.url().includes('companion=hud'));
  if (!hud) throw new Error('HUD window not found');
  await hud.getByRole('button', { name: 'Void', exact: true }).click();
  await expect(hud.getByTestId('neura-activity')).toBeVisible();
  return { app, hud, state: await hud.evaluate(() => window.neuralbridge.neura.state()) };
}

const push = (app: ElectronApplication, state: unknown) => app.evaluate(({ BrowserWindow }, value) => {
  BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('companion=hud'))?.webContents.send('neura:changed', value);
}, state);

test.describe(() => {
  test.skip(process.env['NB_E2E_REAL_VOICE'] !== '1', 'set NB_E2E_REAL_VOICE=1 with VoiceStudio running');
  test.setTimeout(180_000);

  test('the mascot speaks with the real voice and its mouth follows the audio', async () => {
    const { app, hud, state } = await openNeura();
    const before = await hud.locator('[data-mascot-state]').getAttribute('data-mascot-state');
    await hud.evaluate(() => {
      const memo = window as unknown as { mouth: number[]; speaking: boolean };
      memo.mouth = []; memo.speaking = false;
      const tick = () => {
        const svg = document.querySelector<SVGSVGElement>('.nb-mascot svg');
        if (document.querySelector('[data-mascot-state="speaking"]')) { memo.speaking = true; memo.mouth.push(Number(svg?.style.getPropertyValue('--nb-mouth') ?? 0)); }
        requestAnimationFrame(tick);
      };
      tick();
    });
    await push(app, { ...state, lastResponse: { correlationId: '00000000-0000-4000-8000-0000000000aa', message: 'Olá, eu sou a Neura, e esta frase testa a minha boca com a voz de verdade.', speak: true, status: 'done', action: null } });
    await expect(hud.locator('[data-mascot-state]')).toHaveAttribute('data-mascot-state', 'speaking', { timeout: 120_000 });
    await expect.poll(() => hud.evaluate(() => Math.max(0, ...(window as unknown as { mouth: number[] }).mouth)), { timeout: 60_000 }).toBeGreaterThan(.02);
    await hud.locator('.companion-mascot').screenshot({ path: join(shots, 'state-speaking.png'), omitBackground: true });
    const mouth = await hud.evaluate(() => (window as unknown as { mouth: number[] }).mouth);
    await expect(hud.locator('[data-mascot-state]')).toHaveAttribute('data-mascot-state', before ?? 'idle', { timeout: 60_000 });
    const distinct = new Set(mouth.map((value) => value.toFixed(2))).size;
    console.log(`mouth frames=${mouth.length} distinct=${distinct} max=${Math.max(...mouth).toFixed(3)}`);
    expect(distinct).toBeGreaterThan(5);
    await app.close();
  });

  test('captures the new expressions', async () => {
    const { app, hud, state } = await openNeura();
    const mascot = hud.locator('.companion-mascot');
    const figure = hud.locator('[data-mascot-state]');
    await push(app, { ...state, voice: state.voice ?? { sessionId: '00000000-0000-4000-8000-0000000000bb', provider: 'windows-speech', state: 'listening', language: 'pt-BR', startedAt: new Date().toISOString() } });
    await expect(figure).toHaveAttribute('data-mascot-state', 'voiceListening');
    await hud.waitForTimeout(400);
    await mascot.screenshot({ path: join(shots, 'state-voiceListening.png'), omitBackground: true });
    await push(app, { ...state, voice: { sessionId: '00000000-0000-4000-8000-0000000000bb', provider: 'windows-speech', state: 'listening', language: 'pt-BR', startedAt: new Date().toISOString() }, drafting: true });
    await expect(figure).toHaveAttribute('data-mascot-state', 'thinking');
    await hud.waitForTimeout(400);
    await mascot.screenshot({ path: join(shots, 'state-thinking.png'), omitBackground: true });
    await app.close();
  });
});

test.describe(() => {
  test.skip(process.env['NB_E2E_REAL_VOICE'] !== '1' || process.env['NB_E2E_REAL_AGENT'] !== '1', 'set NB_E2E_REAL_VOICE=1 and NB_E2E_REAL_AGENT=1: it plays a voice and spends a real agent run');
  test.setTimeout(150_000);

  test('hears a question the computer plays and answers it in the bubble', async () => {
    const dataDir = freshDataDir();
    writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', companionHud: { visible: true, x: 200, y: 300, mode: 'expanded', alwaysOnTop: true } }));
    const { app, page } = await launchApp(dataDir, { isolateClients: false });
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), mkdtempSync(join(tmpdir(), 'nb-call-')));
    await page.evaluate((id) => window.neuralbridge.neura.updateSettings({ enabled: true, meetingConsent: true, meetingAudioConsent: true, projectId: id, agent: 'claude' }), project.id);
    await expect.poll(() => app.windows().some((item) => item.url().includes('companion=hud'))).toBe(true);
    const hud = app.windows().find((item) => item.url().includes('companion=hud'));
    if (!hud) throw new Error('HUD window not found');
    await hud.getByRole('button', { name: 'Void', exact: true }).click();
    await hud.getByRole('button', { name: 'Ouvir a call' }).click();
    await expect(hud.getByText('Ouvindo a call. As sugestões aparecem aqui e no balão.')).toBeVisible({ timeout: 25_000 });
    await hud.getByRole('button', { name: 'Minimizar para a cápsula' }).click();
    await expect(hud.getByTestId('neura-badge')).toHaveText('Ouvindo a call');
    await hud.locator('.companion-mascot').click();
    await expect(hud.locator('main')).toHaveClass(/companion-hud--mascot/);
    await expect(hud.getByTestId('hearing-cue')).toBeVisible();
    await hud.waitForTimeout(1500);

    const question = await page.evaluate(() => window.neuralbridge.neura.speak({ text: 'Você consegue me dizer quando a entrega do projeto vai ficar pronta?', language: 'pt-BR' }));
    const said = Date.now();
    await page.evaluate(async (url) => { const audio = new Audio(url); await audio.play(); await new Promise<void>((done) => { audio.onended = () => done(); }); }, question.audio);
    const ended = Date.now();
    await hud.waitForTimeout(0);
    const bubble = hud.getByRole('article', { name: 'Sugestão de resposta' });
    await expect(bubble).toBeVisible({ timeout: 40_000 });
    const text = await bubble.locator('.companion-bubble__text').innerText();
    console.log(`bubble ${Date.now() - ended} ms after the question ended (${ended - said} ms long): ${text}`);
    await hud.screenshot({ path: join(shots, 'call-bubble.png'), omitBackground: false });

    await bubble.getByRole('button', { name: 'Ver tudo' }).click();
    await hud.getByRole('button', { name: 'Ocultar Companion' }).click();
    await expect.poll(() => page.evaluate(async () => (await window.neuralbridge.neura.state()).meeting)).toBeNull();
    await page.evaluate(() => window.neuralbridge.companion.openHudPanel());
    await expect(hud.getByRole('button', { name: 'Ouvir a call' })).toBeVisible();
    await expect(hud.getByTestId('hearing-cue')).toHaveCount(0);
    const denied = await hud.evaluate(() => navigator.mediaDevices.getDisplayMedia({ video: true, audio: true }).then(() => 'granted', (error: Error) => error.name));
    expect(denied).not.toBe('granted');
    await app.close();
  });
});

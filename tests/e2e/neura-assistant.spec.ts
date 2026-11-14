import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';

// The real app with a fake agent and a fake speech engine. It proves everything from the engine's line of text to the
// screen, and says nothing about a real microphone or a real model.

const fakeVoice = resolve(import.meta.dirname, 'fake-voice.mjs');

async function findHud(app: ElectronApplication): Promise<Page> {
  await expect.poll(() => app.windows().some((page) => page.url().includes('companion=hud'))).toBe(true);
  const hud = app.windows().find((page) => page.url().includes('companion=hud'));
  if (!hud) throw new Error('HUD window not found');
  return hud;
}

async function openNeura(hud: Page, page: Page): Promise<void> {
  await page.evaluate(() => window.neuralbridge.companion.openHudPanel());
  await hud.getByRole('button', { name: 'Void', exact: true }).click();
}

async function enable(page: Page, consents: string[]): Promise<void> {
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await page.getByRole('checkbox', { name: 'Ativar o Void' }).click();
  for (const name of consents) await page.getByRole('checkbox', { name }).click();
}

test('stays off until the user opts in, with no Neura control in the HUD', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const hud = await findHud(app);
  await page.evaluate(() => window.neuralbridge.companion.openHudPanel());
  await expect(hud.getByRole('heading', { name: 'Eventos recentes' })).toBeVisible();
  await expect(hud.getByRole('button', { name: 'Void', exact: true })).toHaveCount(0);
  await expect(page.evaluate(() => window.neuralbridge.neura.input({ text: 'próxima música' }))).rejects.toThrow('neura_disabled');
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.getByRole('checkbox', { name: 'Ativar o Void' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Permitir ouvir o microfone' })).toHaveCount(0);
  await app.close();
});

test('shows why a provider is unavailable and keeps text working', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await enable(page, []);
  const hud = await findHud(app);
  await openNeura(hud, page);
  await hud.getByLabel('Mensagem para o Void').fill('próxima música');
  await hud.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(hud.getByTestId('neura-response')).toContainText('não está conectado');
  await app.close();
});

test('keeps the three independent Neura consents checked after rapid changes', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await page.getByRole('checkbox', { name: 'Ativar o Void' }).click();
  await page.getByRole('checkbox', { name: 'Permitir sugestões em reuniões' }).click();
  const consents = ['Permitir ouvir o áudio das calls', 'Permitir visualizar a tela', 'Permitir localização para consultar o clima'];
  const audioConsent = consents[0];
  if (!audioConsent) throw new Error('Consent fixture is incomplete');
  await expect(page.getByRole('checkbox', { name: audioConsent })).toBeVisible();
  for (const name of consents) await page.getByRole('checkbox', { name }).click();
  for (const name of consents) await expect(page.getByRole('checkbox', { name })).toBeChecked();
  await app.close();
});

test('organizes the Neura panel into keyboard-accessible tabs', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await enable(page, []);
  const hud = await findHud(app);
  await openNeura(hud, page);

  const tabs = hud.getByRole('tab');
  await expect(tabs).toHaveCount(3);
  await expect(hud.getByRole('tabpanel')).toContainText('Pedir ao Void');
  await hud.getByRole('tab', { name: 'Sugestões' }).click();
  await expect(hud.getByRole('tabpanel')).toContainText('Sugestões');
  await expect(hud.getByRole('tab', { name: 'Assistente' })).toHaveAttribute('aria-selected', 'false');
  await hud.getByRole('tab', { name: 'Void' }).click();
  await expect(hud.getByRole('tabpanel')).toContainText('Estado da voz');
  await app.close();
});

test('follows a meeting in English, suggests in English and sends nothing', async () => {
  test.setTimeout(60_000);
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  const projectId = await page.evaluate((path) => window.neuralbridge.projects.add(path).then((project) => project.id), mkdtempSync(join(tmpdir(), 'nb-neura-')));
  await enable(page, ['Permitir sugestões em reuniões']);
  await page.evaluate((id) => window.neuralbridge.neura.updateSettings({ projectId: id }), projectId);
  const hud = await findHud(app);
  await openNeura(hud, page);
  await hud.getByRole('button', { name: 'Acompanhar reunião' }).click();
  await expect(hud.getByTestId('neura-activity')).toHaveText('Acompanhando reunião');
  await hud.getByLabel('Trecho da reunião').fill('We should review the budget for this quarter with the team\nCould you share the timeline with the team?');
  await hud.getByRole('button', { name: 'Sugerir resposta' }).click();
  await hud.getByRole('tab', { name: 'Sugestões' }).click();
  const card = hud.getByRole('article', { name: 'Sugestão de resposta' });
  await expect(card).toContainText('We can share it by Friday.', { timeout: 30_000 });
  await expect(card).toContainText('EN •');
  await expect(card.getByRole('button', { name: /enviar/i })).toHaveCount(0);
  await card.getByRole('button', { name: 'Editar' }).click();
  await card.getByLabel('Editar sugestão').fill('Friday works for us.');
  await card.getByRole('button', { name: 'Salvar edição' }).click();
  await expect(card).toContainText('Friday works for us.');
  await hud.screenshot({ path: join('artifacts', 'neura-hud-suggestion.png'), omitBackground: true });
  await card.getByRole('button', { name: 'Aceitar' }).click();
  await expect(card).toHaveCount(0);
  await app.close();
});

test('audits an approved action, opening the app only after the decision', async () => {
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS });
  await enable(page, []);
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as unknown as { opened: string[] }).opened = opened;
    shell.openExternal = (url: string) => { opened.push(url); return Promise.resolve(); };
  });
  const opened = () => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
  const hud = await findHud(app);
  await openNeura(hud, page);
  await hud.getByLabel('Mensagem para o Void').fill('abre as configurações');
  await hud.getByRole('button', { name: 'Enviar', exact: true }).click();
  const approval = hud.getByRole('group', { name: 'Confirmar ação' });
  await expect(approval).toContainText('Abrir Configurações do Windows');
  expect(await opened()).toEqual([]);
  await approval.getByRole('button', { name: 'Permitir' }).click();
  await expect(hud.getByTestId('neura-response')).toContainText('aberto');
  expect(await opened()).toEqual(['ms-settings:']);
  await hud.getByLabel('Mensagem para o Void').fill('abre o powershell');
  await hud.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(hud.getByTestId('neura-response')).toContainText('Só posso abrir');
  expect(await opened()).toEqual(['ms-settings:']);
  await app.close();
});

test('wakes on the word, routes speech and stops everything on pause', async () => {
  const { app, page } = await launchApp(undefined, { env: { ...FAKE_AGENTS, NB_NEURA_VOICE_CMD: JSON.stringify([process.execPath, fakeVoice]) } });
  await enable(page, ['Permitir ouvir o microfone']);
  const hud = await findHud(app);
  await openNeura(hud, page);
  await expect(hud.getByRole('heading', { name: 'Pedir ao Void' })).toBeVisible();
  const listenButton = hud.getByRole('button', { name: /^(Ouvir|Parar de ouvir)$/ });
  await expect(listenButton).toBeVisible();
  if (await listenButton.getAttribute('aria-pressed') === 'false') await listenButton.click();
  await expect.poll(async () => hud.getByTestId('neura-response').textContent(), { timeout: 30_000 }).toContain('não está conectado');
  await expect(hud.getByTestId('neura-activity')).toHaveText('Ouvindo “Neura”');
  await hud.getByRole('button', { name: 'Pausar tudo' }).click();
  await expect(hud.getByTestId('neura-activity')).toHaveText('Pausada');
  await expect(hud.getByLabel('Mensagem para o Void')).toBeDisabled();
  await hud.getByRole('button', { name: 'Retomar' }).click();
  await expect(hud.getByTestId('neura-activity')).toHaveText('Ouvindo “Neura”');
  await app.close();
});

test('answers a spoken request in a bubble in silent mode', async () => {
  const { app, page } = await launchApp(undefined, { env: { ...FAKE_AGENTS, NB_NEURA_VOICE_CMD: JSON.stringify([process.execPath, fakeVoice]) } });
  await page.evaluate(() => window.neuralbridge.neura.updateSettings({ enabled: true, voiceConsent: true, silentReplies: true }));
  const hud = await findHud(app);
  await expect(hud.getByTestId('neura-reply-bubble')).toContainText('não está conectado', { timeout: 30_000 });
  await hud.getByRole('button', { name: 'Fechar resposta' }).click();
  await expect(hud.getByTestId('neura-reply-bubble')).toBeHidden();
  await app.close();
});


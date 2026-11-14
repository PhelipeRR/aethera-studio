import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FAKE_AGENTS, launchApp } from './app';

test('Companion IPC is read-only, typed and survives window lifecycle', async () => {
  const first = await launchApp();
  const initial = await first.page.evaluate(async () => {
    const sessions = await window.neuralbridge.companion.listSessions({ limit: 10 });
    const subscription = await window.neuralbridge.companion.subscribe({}, () => undefined);
    await subscription.cancel();
    return { sessions, subscriptionId: subscription.subscriptionId, hasPublish: 'publish' in window.neuralbridge.companion };
  });
  expect(initial.sessions.items).toEqual([]);
  expect(initial.subscriptionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(initial.hasPublish).toBe(false);
  await first.app.close();

  const second = await launchApp(first.dataDir);
  await expect(second.page.evaluate(() => window.neuralbridge.companion.listSessions({ limit: 10 }))).resolves.toEqual({ items: [], nextOffset: null });
  await second.app.close();
});

test('Companion receives a session from a real TaskEngine execution', async () => {
  const launched = await launchApp(undefined, { env: FAKE_AGENTS });
  const projectRoot = mkdtempSync(join(tmpdir(), 'nb-companion-project-'));
  const project = await launched.page.evaluate((path) => window.neuralbridge.projects.add(path), projectRoot);
  const taskId = await launched.page.evaluate((projectId) => window.neuralbridge.tasks.start({ prompt: 'Responda com uma palavra', projectId, mode: 'claude', model: null, skillIds: [] }), project.id);
  await expect.poll(async () => (await launched.page.evaluate((id) => window.neuralbridge.tasks.get(id), taskId.id)).status, { timeout: 15_000 }).not.toBe('queued');
  await expect.poll(async () => (await launched.page.evaluate(() => window.neuralbridge.companion.listSessions({ limit: 10 }))).items.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const sessions = await launched.page.evaluate(() => window.neuralbridge.companion.listSessions({ limit: 10 }));
  expect(sessions.items[0]?.agent).toBe('claude');
  await launched.app.close();
});

test('opens settings without showing the previous route', async () => {
  const { app, page } = await launchApp();
  await page.evaluate(() => { window.location.hash = '#/mission-control'; });
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((window) => !window.webContents.getURL().includes('companion=hud'));
    main?.hide();
    main?.once('show', () => { (globalThis as unknown as { shownAt: string }).shownAt = main.webContents.getURL(); });
  });
  await expect.poll(() => app.windows().some((item) => item.url().includes('companion=hud'))).toBe(true);
  const hud = app.windows().find((item) => item.url().includes('companion=hud'));
  await hud?.evaluate(() => window.neuralbridge.companion.openSettings());
  await expect.poll(() => app.evaluate(() => (globalThis as unknown as { shownAt?: string }).shownAt)).toContain('#/settings');
  await app.close();
});

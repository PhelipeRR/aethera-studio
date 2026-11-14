import { expect, test } from '@playwright/test';
import { launchApp } from './app';

test.setTimeout(60_000);
test('Personal Agent stays disabled by default and exposes its persisted notification surface after enablement', async () => {
  const { app, page } = await launchApp(undefined, { freshInstall: true });
  try {
    const before = await page.evaluate(() => window.neuralbridge.extensions.list());
    expect(before.find((item) => item.manifest.id === 'personal-agent')?.state).toBe('disabled');
    await page.evaluate(() => window.neuralbridge.extensions.enable('personal-agent'));
    await expect.poll(async () => (await page.evaluate(() => window.neuralbridge.extensions.list())).find((item) => item.manifest.id === 'personal-agent')?.state).toBe('enabled');
    await page.evaluate(() => { window.location.hash = '#/personal-agent'; });
    await expect(page.getByRole('heading', { name: 'Void Pessoal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Notificações' })).toBeVisible();
    await expect(page.getByText('Nenhuma notificação pendente')).toBeVisible();
    await expect(page.getByText('Nenhuma conta conectada')).toBeVisible();
    expect(await page.evaluate(() => window.neuralbridge.personal.notifications())).toEqual([]);
  } finally { await app.close(); }
});

test('personal writes stop at the broker until an explicit human decision', async () => {
  const { app, page } = await launchApp(undefined, { freshInstall: true });
  try {
    await page.evaluate(() => window.neuralbridge.extensions.enable('personal-agent'));
    const request = await page.evaluate(() => window.neuralbridge.personal.sendMail({ accountId: 'account-not-connected', to: ['owner@example.com'], subject: 'Teste', body: 'Não enviar' }));
    expect(request.status).toBe('requested');
    const decision = await page.evaluate((actionId) => window.neuralbridge.personal.decideAction({ actionId, decision: 'deny', decidedAt: new Date().toISOString() }), request.actionId);
    expect(decision.status).toBe('denied');
  } finally { await app.close(); }
});

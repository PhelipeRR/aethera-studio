import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// CORE-07: the "Dispositivos e acesso remoto" section. Remote access is off by default; without a ready Tailscale the
// switch and pairing stay unavailable, and the screen says why (the machine running this has no Tailscale, or it is off).
test('settings show remote access off by default and explain what is missing', async () => {
  const { app, page } = await launchApp();
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  const section = page.getByTestId('core-devices');
  await expect(section.getByRole('heading', { name: 'Dispositivos e acesso remoto' })).toBeVisible();
  const remote = section.getByRole('checkbox', { name: 'Permitir acesso remoto pelo Tailscale' });
  await expect(remote).not.toBeChecked();
  for (const status of await section.getByRole('status').all()) await expect(status).not.toHaveText('');
  const status = await page.evaluate(() => window.neuralbridge.core.status());
  expect(status.enabled).toBe(false);
  expect(status.serving).toBe(false);
  if (status.state !== 'ready') await expect(remote).toBeDisabled();
  await expect(section.getByRole('button', { name: 'Parear um aparelho' })).toBeDisabled();
  await expect(section.getByText('Nenhum aparelho pareado.')).toBeVisible();
  expect(await page.evaluate(() => window.neuralbridge.core.devices())).toEqual([]);
  await app.close();
});

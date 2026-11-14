import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// Real provider: runs the installed Claude Code and Codex CLIs. Opt-in with NB_REAL_CLI=1.
test.describe(() => {
  test.skip(process.env['NB_REAL_CLI'] !== '1', 'needs Claude Code and Codex installed (NB_REAL_CLI=1)');

  test('a CLI without login is reported as unavailable, with how to fix it', async () => {
    // launchApp points both CLIs at empty config folders, so they are installed but logged out.
    const { app, page } = await launchApp();
    await page.getByRole('link', { name: 'Agentes', exact: true }).click();
    const claude = page.getByRole('listitem', { name: 'Claude Code' });
    await expect(claude.getByText('Indisponível')).toBeVisible({ timeout: 30_000 });
    await expect(claude).toContainText('Sem login');
    await expect(claude).toContainText('/login');
    await expect(claude).toContainText('2.1.');
    const codex = page.getByRole('listitem', { name: 'Codex CLI' });
    await expect(codex).toContainText('Sem login');
    await expect(codex).toContainText('codex login');
    await app.close();
  });
});

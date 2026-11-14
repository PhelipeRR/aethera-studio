import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './app';

// Real provider: registers NeuralBridge with the installed CLIs, inside the test data dir. Opt-in with NB_REAL_CLI=1.
// Runs the real CLIs against config folders inside the test data dir (see launchApp).
test.describe(() => {
  test.skip(process.env['NB_REAL_CLI'] !== '1', 'needs Claude Code and Codex installed (NB_REAL_CLI=1)');

  for (const [name, configPath] of [
    ['Claude Code', ['claude-config', '.claude.json']],
    ['Codex CLI', ['codex-home', 'config.toml']],
  ] as const) {
    test(`registers and removes NeuralBridge in ${name} after confirmation`, async () => {
      const { app, page, dataDir } = await launchApp();
      mkdirSync(join(dataDir, configPath[0]), { recursive: true });
      const configFile = join(dataDir, ...configPath);
      await page.getByRole('link', { name: 'MCPs', exact: true }).click();
      const row = page.getByRole('listitem', { name });
      await expect(row.getByText('Não registrado')).toBeVisible({ timeout: 30_000 });

      await row.getByRole('button', { name: 'Registrar' }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog).toContainText(configFile);
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      expect(existsSync(configFile) && readFileSync(configFile, 'utf8').includes('neuralbridge')).toBe(false);

      await row.getByRole('button', { name: 'Registrar' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Registrar' }).click();
      await expect(page.getByRole('status')).toContainText(`Registrado no ${name}.`, { timeout: 30_000 });
      await expect(row.getByText('Registrado nesta instalação')).toBeVisible({ timeout: 30_000 });
      expect(readFileSync(configFile, 'utf8')).toContain('mcp-server.js');

      await row.getByRole('button', { name: 'Remover' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Remover' }).click();
      await expect(page.getByRole('status')).toContainText(`Removido do ${name}.`, { timeout: 30_000 });
      await expect(row.getByText('Não registrado')).toBeVisible({ timeout: 30_000 });
      await app.close();
    });
  }
});

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electronPath = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;

const fakeAgent = resolve(import.meta.dirname, 'fake-agent.mjs');

/** Points the app at the fake Claude Code and Codex (fake-agent.mjs) instead of the installed CLIs. */
export const FAKE_AGENTS: Record<string, string> = {
  NB_CLAUDE_CLI: JSON.stringify([process.execPath, fakeAgent, 'claude']),
  NB_CODEX_CLI: JSON.stringify([process.execPath, fakeAgent, 'codex']),
};

/** The floating Companion window can register first; every spec means the main window. */
export async function mainWindowOf(app: ElectronApplication): Promise<Page> {
  const isHud = (candidate: Page) => candidate.url().includes('companion=hud');
  const first = await app.firstWindow();
  return isHud(first) ? app.windows().find((candidate) => !isHud(candidate)) ?? await app.waitForEvent('window', { predicate: (candidate) => !isHud(candidate) }) : first;
}

export function freshDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'nb-e2e-'));
}

/** Launches the built app (run `npm run build` first) against an isolated data directory. */
export async function launchApp(
  dataDir = freshDataDir(),
  options: { isolateClients?: boolean; env?: Record<string, string>; chromiumArgs?: string[]; guidedTours?: boolean; freshInstall?: boolean } = {},
): Promise<{ app: ElectronApplication; page: Page; dataDir: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const clientDirs = { CLAUDE_CONFIG_DIR: join(dataDir, 'claude-config'), CODEX_HOME: join(dataDir, 'codex-home') };
  // Existing but empty, like a fresh install: Codex refuses a CODEX_HOME that does not exist.
  if (options.isolateClients !== false) for (const dir of Object.values(clientDirs)) mkdirSync(dir, { recursive: true });
  // Existing Companion specs represent an installed user upgrading from the pre-COMP-01 behavior.
  // A genuinely new install opts into `freshInstall` so the default-off decision is tested explicitly.
  if (!options.freshInstall && !existsSync(join(dataDir, 'preferences.json'))) writeFileSync(join(dataDir, 'preferences.json'), JSON.stringify({ theme: 'dark', companionHud: { visible: true, x: null, y: null, mode: 'mascot', alwaysOnTop: true, align: 'right' } }));
  delete env['ELECTRON_RENDERER_URL'];
  delete env['ELECTRON_RUN_AS_NODE'];
  const app = await electron.launch({
    executablePath: electronPath,
    // Launch the app directory (package.json "main" → out/main/index.js) so app name and version resolve as when packaged.
    args: [...(options.chromiumArgs ?? []), desktopDir],
    cwd: desktopDir,
    // Client config dirs point inside the data dir, so MCP registration tests never touch the user's real
    // ~/.claude.json or ~/.codex/config.toml (both CLIs honour these official overrides).
    env: {
      ...env,
      NB_DATA_DIR: dataDir,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'true',
      GIT_EDITOR: 'cmd.exe /c exit 0',
      ...(options.isolateClients === false ? {} : clientDirs),
      ...options.env,
    },
    // Playwright emulates a light colour scheme by default; null lets nativeTheme drive it, as in real use.
    colorScheme: null,
  });
  const page = await mainWindowOf(app);
  await page.waitForLoadState('domcontentloaded');
  // The first-run card floats over the page and takes clicks, so only the specs about it keep it.
  if (!options.guidedTours) await page.getByRole('button', { name: 'Pular por agora' }).click({ timeout: 2_000 }).catch(() => undefined);
  return { app, page, dataDir };
}

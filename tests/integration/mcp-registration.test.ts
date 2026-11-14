import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clientConfigFile, createCliRunner, findClientCli, register, registrationStatus, serverLaunch, unregister, type McpClientId } from '@neuralbridge/workspace';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Real CLIs, isolated configs: CLAUDE_CONFIG_DIR / CODEX_HOME point at temp folders, so the user's
// own ~/.claude.json and ~/.codex/config.toml are never touched. Needs Claude Code and Codex installed.
const enabled = process.env['NB_REAL_CLI'] === '1';

const desktopDir = resolve(import.meta.dirname, '../../apps/desktop');
const electron = createRequire(join(desktopDir, 'package.json'))('electron') as unknown as string;
const serverScript = join(desktopDir, 'out/main/mcp-server.js');
const realConfigs = [clientConfigFile('claude', {}, homedir()), clientConfigFile('codex', {}, homedir())];
const fingerprint = () => realConfigs.map((file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : 'absent'));

describe.skipIf(!enabled)('MCP registration with the installed CLIs (isolated configs)', () => {
  const root = mkdtempSync(join(tmpdir(), 'nb-registration-'));
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, 'claude'), CODEX_HOME: join(root, 'codex') };
  const run = createCliRunner({ env });
  const launch = serverLaunch(electron, serverScript, { NB_DATA_DIR: join(root, 'data') });
  let before: string[];

  beforeAll(() => {
    mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
    mkdirSync(env.CODEX_HOME, { recursive: true });
    before = fingerprint();
  });

  afterAll(() => {
    expect(fingerprint()).toEqual(before);
  });

  for (const client of ['claude', 'codex'] as McpClientId[]) {
    it(`${client}: registers, detects, repairs and removes NeuralBridge`, async () => {
      const cli = findClientCli(client, env);
      expect(cli, `${client} CLI not found on PATH`).not.toBeNull();
      if (!cli) return;
      const location = { configFile: clientConfigFile(client, env), backupDir: join(root, 'backups') };

      expect(await registrationStatus(client, cli, launch, run)).toEqual({ registered: false, matches: false });
      expect((await register(client, cli, launch, run, location)).changed).toBe(true);
      expect(await registrationStatus(client, cli, launch, run)).toEqual({ registered: true, matches: true });
      expect(readFileSync(location.configFile, 'utf8')).toContain('mcp-server.js');
      expect(await register(client, cli, launch, run, location)).toEqual({ changed: false, backup: null });

      const moved = serverLaunch(electron, serverScript.replace('mcp-server.js', 'moved\\mcp-server.js'), launch.env);
      expect(await registrationStatus(client, cli, moved, run)).toEqual({ registered: true, matches: false });
      expect((await register(client, cli, moved, run, location)).changed).toBe(true);
      expect(await registrationStatus(client, cli, moved, run)).toEqual({ registered: true, matches: true });

      expect((await unregister(client, cli, run, location)).changed).toBe(true);
      expect(await registrationStatus(client, cli, launch, run)).toEqual({ registered: false, matches: false });
    });
  }
});

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export type McpClientId = 'claude' | 'codex';

/** How to start a CLI without a shell: executable plus fixed leading arguments. */
export interface CommandSpec {
  command: string;
  args: string[];
}

function pathDirs(env: Record<string, string | undefined>): string[] {
  return (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter(Boolean);
}

function findOnPath(env: Record<string, string | undefined>, file: string): string | null {
  for (const dir of pathDirs(env)) {
    const candidate = join(dir, file);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const OVERRIDE_VAR: Record<McpClientId, string> = { claude: 'NB_CLAUDE_CLI', codex: 'NB_CODEX_CLI' };

/**
 * NB_CLAUDE_CLI / NB_CODEX_CLI point at another build of a CLI: an absolute executable path, or a JSON
 * array [executable, ...leading args]. Anything else is ignored so a typo never runs something unexpected.
 */
function overrideCli(client: McpClientId, env: Record<string, string | undefined>): CommandSpec | null {
  const raw = env[OVERRIDE_VAR[client]]?.trim();
  if (!raw) return null;
  let parts: unknown = [raw];
  if (raw.startsWith('[')) {
    try {
      parts = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parts) || parts.length === 0 || !parts.every((part) => typeof part === 'string')) return null;
  const [command, ...args] = parts as string[];
  if (!command || !isAbsolute(command) || !existsSync(command)) return null;
  return { command, args };
}

/**
 * Locates a client CLI so it can be spawned with shell: false. Claude Code ships a native claude.exe.
 * npm-installed Codex is a .cmd shim (unspawnable without a shell) around bin/codex.js, so we run that
 * script with node, which is what the shim does. Detailed detection (version, login) is Phase 7.
 */
export function findClientCli(client: McpClientId, env: Record<string, string | undefined> = process.env): CommandSpec | null {
  const override = overrideCli(client, env);
  if (override) return override;
  if (client === 'claude') {
    const exe = findOnPath(env, 'claude.exe');
    return exe ? { command: exe, args: [] } : null;
  }
  const native = findOnPath(env, 'codex.exe');
  if (native) return { command: native, args: [] };
  const shim = findOnPath(env, 'codex.cmd');
  const node = findOnPath(env, 'node.exe');
  if (!shim || !node) return null;
  const launcher = join(shim, '..', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  return existsSync(launcher) ? { command: node, args: [launcher] } : null;
}

/** The file each client writes MCP registrations to, honouring the official config-dir overrides. */
export function clientConfigFile(client: McpClientId, env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  if (client === 'claude') return join(env['CLAUDE_CONFIG_DIR'] ?? home, '.claude.json');
  return join(env['CODEX_HOME'] ?? join(home, '.codex'), 'config.toml');
}

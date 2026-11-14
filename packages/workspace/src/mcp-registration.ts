import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { CommandSpec, McpClientId } from './clients.js';

export const SERVER_NAME = 'neuralbridge';

/** How a client should start the NeuralBridge MCP server. */
export interface ServerLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type Runner = (cli: CommandSpec, args: string[]) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export interface RegistrationStatus {
  registered: boolean;
  /** false when registered with another command, e.g. after the app moved or was updated. */
  matches: boolean;
}

export interface ChangeResult {
  changed: boolean;
  /** Copy of the client config taken before the change, if the file existed. */
  backup: string | null;
}

export class RegistrationError extends Error {
  override name = 'RegistrationError';

  constructor(
    message: string,
    readonly output: { code: number | null; stdout: string; stderr: string },
  ) {
    super(`${message} (exit ${output.code}): ${(output.stderr || output.stdout).trim().slice(0, 500)}`);
  }
}

/** The app's own executable runs the server script as Node: no separate Node install needed. */
export function serverLaunch(appExecutable: string, serverScript: string, extraEnv: Record<string, string> = {}): ServerLaunch {
  return { command: appExecutable, args: [serverScript], env: { ELECTRON_RUN_AS_NODE: '1', ...extraEnv } };
}

// Argument shapes follow `claude mcp add --help` (2.1.312) and `codex mcp add --help` (0.162.1).
// Claude's -e is variadic, so the server name must come before it and `--` must end it.
export function addArgs(client: McpClientId, launch: ServerLaunch, name = SERVER_NAME): string[] {
  const env = Object.entries(launch.env).map(([key, value]) => `${key}=${value}`);
  return client === 'claude'
    ? ['mcp', 'add', '-s', 'user', name, ...env.flatMap((pair) => ['-e', pair]), '--', launch.command, ...launch.args]
    : ['mcp', 'add', name, ...env.flatMap((pair) => ['--env', pair]), '--', launch.command, ...launch.args];
}

export function getArgs(client: McpClientId, name = SERVER_NAME): string[] {
  return client === 'claude' ? ['mcp', 'get', name] : ['mcp', 'get', name, '--json'];
}

export function removeArgs(client: McpClientId, name = SERVER_NAME): string[] {
  return client === 'claude' ? ['mcp', 'remove', name, '-s', 'user'] : ['mcp', 'remove', name];
}

/** `claude mcp get` prints text; Args are space-joined, so they are compared as one line. */
export function parseClaudeGet(stdout: string): { command: string; argsLine: string; env: Record<string, string>; scope: string } | null {
  const lines = stdout.split(/\r?\n/);
  const field = (label: string) => lines.find((line) => line.trimStart().startsWith(`${label}:`))?.trim().slice(label.length + 1).trim();
  const command = field('Command');
  if (command === undefined) return null;
  const env: Record<string, string> = {};
  const envStart = lines.findIndex((line) => line.trim() === 'Environment:');
  if (envStart >= 0) {
    for (const line of lines.slice(envStart + 1)) {
      const match = /^\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!match) break;
      env[match[1] ?? ''] = match[2] ?? '';
    }
  }
  const scope = /^(\w+)/.exec(field('Scope') ?? '')?.[1]?.toLowerCase() ?? 'unknown';
  return { command, argsLine: field('Args') ?? '', env, scope };
}

export function parseCodexGet(stdout: string): ServerLaunch | null {
  try {
    const transport = (JSON.parse(stdout) as { transport?: { type?: string; command?: string; args?: string[]; env?: Record<string, string> | null } }).transport;
    if (transport?.type !== 'stdio' || !transport.command) return null;
    return { command: transport.command, args: transport.args ?? [], env: transport.env ?? {} };
  } catch {
    return null;
  }
}

// Clients may echo paths with forward slashes; Windows paths are case-insensitive.
const same = (a: string, b: string) => a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();
const envMatches = (actual: Record<string, string>, wanted: Record<string, string>) =>
  Object.entries(wanted).every(([key, value]) => actual[key] !== undefined && same(actual[key] ?? '', value));

export async function registrationStatus(client: McpClientId, cli: CommandSpec, launch: ServerLaunch, run: Runner, name = SERVER_NAME): Promise<RegistrationStatus> {
  const result = await run(cli, getArgs(client, name));
  if (result.code !== 0) return { registered: false, matches: false };
  if (client === 'claude') {
    const current = parseClaudeGet(result.stdout);
    if (!current) return { registered: false, matches: false };
    const matches = same(current.command, launch.command) && same(current.argsLine, launch.args.join(' ')) && envMatches(current.env, launch.env);
    return { registered: true, matches };
  }
  const current = parseCodexGet(result.stdout);
  if (!current) return { registered: false, matches: false };
  const matches =
    same(current.command, launch.command) &&
    current.args.length === launch.args.length &&
    current.args.every((arg, i) => same(arg, launch.args[i] ?? '')) &&
    envMatches(current.env, launch.env);
  return { registered: true, matches };
}

function backupConfig(client: McpClientId, configFile: string, backupDir: string): string | null {
  if (!existsSync(configFile)) return null;
  mkdirSync(backupDir, { recursive: true });
  const target = join(backupDir, `${client}-${new Date().toISOString().replace(/[:.]/g, '-')}-${basename(configFile)}`);
  copyFileSync(configFile, target);
  return target;
}

async function runOrThrow(run: Runner, cli: CommandSpec, args: string[], what: string): Promise<void> {
  const result = await run(cli, args);
  if (result.code !== 0) throw new RegistrationError(what, result);
}

export interface ConfigLocation {
  configFile: string;
  backupDir: string;
}

/** Registers (or repairs) the server in the client's user-level config. Backs the config up first. */
export async function register(client: McpClientId, cli: CommandSpec, launch: ServerLaunch, run: Runner, location: ConfigLocation, name = SERVER_NAME): Promise<ChangeResult> {
  const status = await registrationStatus(client, cli, launch, run, name);
  if (status.matches) return { changed: false, backup: null };
  const backup = backupConfig(client, location.configFile, location.backupDir);
  if (status.registered) await runOrThrow(run, cli, removeArgs(client, name), `Could not remove the outdated ${client} registration`);
  await runOrThrow(run, cli, addArgs(client, launch, name), `Could not register ${name} in ${client}`);
  return { changed: true, backup };
}

export async function unregister(client: McpClientId, cli: CommandSpec, run: Runner, location: ConfigLocation, name = SERVER_NAME): Promise<ChangeResult> {
  const result = await run(cli, getArgs(client, name));
  if (result.code !== 0) return { changed: false, backup: null };
  const backup = backupConfig(client, location.configFile, location.backupDir);
  await runOrThrow(run, cli, removeArgs(client, name), `Could not remove ${name} from ${client}`);
  return { changed: true, backup };
}

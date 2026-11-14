import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addArgs,
  getArgs,
  parseClaudeGet,
  parseCodexGet,
  register,
  RegistrationError,
  registrationStatus,
  removeArgs,
  serverLaunch,
  unregister,
  type Runner,
  type ServerLaunch,
} from '../src/mcp-registration.js';

const launch = serverLaunch('C:\\Program Files\\NeuralBridge\\NeuralBridge.exe', 'C:\\Program Files\\NeuralBridge\\resources\\mcp-server.js');
const cli = { command: 'claude.exe', args: [] };

const CLAUDE_GET = [
  'neuralbridge:',
  '  Scope: User config (available in all your projects)',
  '  Status: ✔ Connected',
  '  Type: stdio',
  '  Command: C:\\Program Files\\NeuralBridge\\NeuralBridge.exe',
  '  Args: C:\\Program Files\\NeuralBridge\\resources\\mcp-server.js',
  '  Environment:',
  '    ELECTRON_RUN_AS_NODE=1',
  '',
  'To remove this server, run: claude mcp remove neuralbridge -s user',
].join('\n');

function codexGet(transport: Partial<ServerLaunch>): string {
  return JSON.stringify({
    name: 'neuralbridge',
    enabled: true,
    transport: { type: 'stdio', command: launch.command, args: launch.args, env: launch.env, env_vars: [], cwd: null, ...transport },
  });
}

function fakeRunner(responses: Record<string, { code: number; stdout?: string; stderr?: string }>) {
  const calls: string[][] = [];
  const run: Runner = async (_cli, args) => {
    calls.push(args);
    const response = responses[args.slice(0, 2).join(' ')] ?? { code: 0 };
    return { code: response.code, stdout: response.stdout ?? '', stderr: response.stderr ?? '' };
  };
  return { run, calls };
}

describe('command lines', () => {
  it('launches the server through the app executable as Node', () => {
    expect(launch.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
    expect(serverLaunch('e.exe', 's.js', { NB_DATA_DIR: 'D:\\data' }).env).toEqual({ ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: 'D:\\data' });
  });

  it('builds the documented add, get and remove arguments for each client', () => {
    expect(addArgs('claude', launch)).toEqual(['mcp', 'add', '-s', 'user', 'neuralbridge', '-e', 'ELECTRON_RUN_AS_NODE=1', '--', launch.command, ...launch.args]);
    expect(addArgs('codex', launch)).toEqual(['mcp', 'add', 'neuralbridge', '--env', 'ELECTRON_RUN_AS_NODE=1', '--', launch.command, ...launch.args]);
    expect(getArgs('claude')).toEqual(['mcp', 'get', 'neuralbridge']);
    expect(getArgs('codex')).toEqual(['mcp', 'get', 'neuralbridge', '--json']);
    expect(removeArgs('claude')).toEqual(['mcp', 'remove', 'neuralbridge', '-s', 'user']);
    expect(removeArgs('codex')).toEqual(['mcp', 'remove', 'neuralbridge']);
  });
});

describe('parsing', () => {
  it('reads command, args, env and scope from claude mcp get', () => {
    expect(parseClaudeGet(CLAUDE_GET)).toEqual({ command: launch.command, argsLine: launch.args.join(' '), env: { ELECTRON_RUN_AS_NODE: '1' }, scope: 'user' });
    expect(parseClaudeGet('No MCP server found with name: "neuralbridge".')).toBeNull();
  });

  it('reads the stdio transport from codex mcp get --json', () => {
    expect(parseCodexGet(codexGet({}))).toEqual(launch);
    expect(parseCodexGet('not json')).toBeNull();
    expect(parseCodexGet(JSON.stringify({ transport: { type: 'streamable_http', url: 'http://x' } }))).toBeNull();
  });
});

describe('registrationStatus', () => {
  it('reports a matching registration, ignoring slash direction and case of paths', async () => {
    const forward = CLAUDE_GET.replaceAll('\\', '/').replace('NeuralBridge.exe', 'neuralbridge.exe');
    const { run } = fakeRunner({ 'mcp get': { code: 0, stdout: forward } });
    expect(await registrationStatus('claude', cli, launch, run)).toEqual({ registered: true, matches: true });
  });

  it('reports a stale registration (e.g. after the app moved) as not matching', async () => {
    const { run } = fakeRunner({ 'mcp get': { code: 0, stdout: codexGet({ command: 'C:\\Old\\NeuralBridge.exe' }) } });
    expect(await registrationStatus('codex', cli, launch, run)).toEqual({ registered: true, matches: false });
  });

  it('reports a missing registration', async () => {
    const { run } = fakeRunner({ 'mcp get': { code: 1, stderr: 'No MCP server found' } });
    expect(await registrationStatus('claude', cli, launch, run)).toEqual({ registered: false, matches: false });
  });
});

describe('register and unregister', () => {
  const configDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-reg-'));
    writeFileSync(join(dir, 'config.toml'), 'model = "x"\n');
    return { configFile: join(dir, 'config.toml'), backupDir: join(dir, 'backups') };
  };

  it('adds a missing registration after backing up the client config', async () => {
    const { configFile, backupDir } = configDir();
    const { run, calls } = fakeRunner({ 'mcp get': { code: 1 } });
    expect(await register('codex', cli, launch, run, { configFile, backupDir })).toEqual({ changed: true, backup: expect.stringContaining('codex-') });
    expect(calls.map((args) => args.slice(0, 2).join(' '))).toEqual(['mcp get', 'mcp add']);
    const [backup] = readdirSync(backupDir);
    expect(readFileSync(join(backupDir, backup ?? ''), 'utf8')).toBe('model = "x"\n');
  });

  it('does nothing when the registration already matches', async () => {
    const { configFile, backupDir } = configDir();
    const { run, calls } = fakeRunner({ 'mcp get': { code: 0, stdout: codexGet({}) } });
    expect(await register('codex', cli, launch, run, { configFile, backupDir })).toEqual({ changed: false, backup: null });
    expect(calls).toHaveLength(1);
    expect(existsSync(backupDir)).toBe(false);
  });

  it('replaces a stale registration', async () => {
    const { configFile, backupDir } = configDir();
    const { run, calls } = fakeRunner({ 'mcp get': { code: 0, stdout: codexGet({ args: ['C:\\Old\\mcp-server.js'] }) } });
    await register('codex', cli, launch, run, { configFile, backupDir });
    expect(calls.map((args) => args.slice(0, 2).join(' '))).toEqual(['mcp get', 'mcp remove', 'mcp add']);
  });

  it('works when the client has no config file yet', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-reg-'));
    const { run } = fakeRunner({ 'mcp get': { code: 1 } });
    expect(await register('claude', cli, launch, run, { configFile: join(dir, '.claude.json'), backupDir: join(dir, 'backups') })).toEqual({ changed: true, backup: null });
  });

  it('surfaces CLI failures with their output', async () => {
    const { configFile, backupDir } = configDir();
    const { run } = fakeRunner({ 'mcp get': { code: 1 }, 'mcp add': { code: 2, stderr: 'permission denied' } });
    await expect(register('claude', cli, launch, run, { configFile, backupDir })).rejects.toThrow(RegistrationError);
    await expect(register('claude', cli, launch, run, { configFile, backupDir })).rejects.toThrow(/permission denied/);
  });

  it('removes an existing registration and is a no-op when absent', async () => {
    const { configFile, backupDir } = configDir();
    const present = fakeRunner({ 'mcp get': { code: 0, stdout: codexGet({}) } });
    expect(await unregister('codex', cli, present.run, { configFile, backupDir })).toEqual({ changed: true, backup: expect.any(String) });
    expect(present.calls.map((args) => args.slice(0, 2).join(' '))).toEqual(['mcp get', 'mcp remove']);
    const absent = fakeRunner({ 'mcp get': { code: 1 } });
    expect(await unregister('codex', cli, absent.run, { configFile, backupDir })).toEqual({ changed: false, backup: null });
  });

  it('adds the Singularity alias without removing the NeuralBridge registration', async () => {
    const { configFile, backupDir } = configDir();
    const { run, calls } = fakeRunner({ 'mcp get': { code: 1 } });
    await register('codex', cli, launch, run, { configFile, backupDir }, 'singularity');
    expect(calls[0]).toEqual(['mcp', 'get', 'singularity', '--json']);
    expect(calls[1]).toContain('singularity');
  });
});

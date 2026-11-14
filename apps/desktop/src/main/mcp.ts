import type { McpChangeResult, McpClientId, McpClientStatus, McpServerList, McpStatus } from '@neuralbridge/shared';
import {
  addArgs,
  clientConfigFile,
  createCliRunner,
  findClientCli,
  parseClaudeMcpList,
  parseCodexMcpList,
  register,
  registrationStatus,
  removeArgs,
  serverLaunch,
  unregister,
  type Runner,
} from '@neuralbridge/workspace';

const CLIENTS: { id: McpClientId; cliName: string; label: string }[] = [
  { id: 'claude', cliName: 'claude', label: 'Claude Code' },
  { id: 'codex', cliName: 'codex', label: 'Codex CLI' },
];

/** A copy-pasteable rendering of an argv array (cmd.exe and PowerShell both accept double quotes). */
export function formatCommand(program: string, args: string[]): string {
  const quote = (arg: string) => (/[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg);
  return [program, ...args.map(quote)].join(' ');
}

const SERVERS_TTL_MS = 5 * 60_000;

export interface McpServiceOptions {
  /** The app executable (process.execPath), which runs the server as Node. */
  appExecutable: string;
  serverScript: string;
  backupDir: string;
  env?: Record<string, string | undefined>;
  run?: Runner;
}

/** Registration of the NeuralBridge MCP server in Claude Code and Codex, through their official CLIs. */
export function createMcpService(options: McpServiceOptions) {
  const env = options.env ?? process.env;
  const run = options.run ?? createCliRunner({ env });
  const dataDir = env['NB_DATA_DIR'];
  const launch = serverLaunch(options.appExecutable, options.serverScript, dataDir ? { NB_DATA_DIR: dataDir } : {});

  const cliFor = (client: McpClientId) => {
    const cli = findClientCli(client, env);
    if (!cli) throw new Error(`${CLIENTS.find((entry) => entry.id === client)?.label ?? client} is not installed or not on PATH.`);
    return cli;
  };
  const location = (client: McpClientId) => ({ configFile: clientConfigFile(client, env), backupDir: options.backupDir });

  async function clientStatus(client: (typeof CLIENTS)[number]): Promise<McpClientStatus> {
    const base = {
      id: client.id,
      configFile: clientConfigFile(client.id, env),
      addCommand: formatCommand(client.cliName, addArgs(client.id, launch)),
      removeCommand: formatCommand(client.cliName, removeArgs(client.id)),
    };
    const cli = findClientCli(client.id, env);
    if (!cli) return { ...base, installed: false, registered: false, matches: false, error: null };
    try {
      return { ...base, installed: true, ...(await registrationStatus(client.id, cli, launch, run)), error: null };
    } catch (error) {
      return { ...base, installed: true, registered: false, matches: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // `claude mcp list` starts every server to check its health: list on demand and keep the answer a while.
  let servers: { at: number; value: Promise<McpServerList> } | null = null;

  async function clientServers(client: McpClientId): Promise<McpServerList['clients'][number]> {
    const cli = findClientCli(client, env);
    if (!cli) return { id: client, installed: false, servers: [], error: null };
    try {
      const result = await run(cli, client === 'claude' ? ['mcp', 'list'] : ['mcp', 'list', '--json']);
      if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim().slice(0, 300) || `exit ${result.code}`);
      return { id: client, installed: true, servers: client === 'claude' ? parseClaudeMcpList(result.stdout) : parseCodexMcpList(result.stdout), error: null };
    } catch (error) {
      return { id: client, installed: true, servers: [], error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    /** MCP servers configured in each CLI (names, transport and state only); cached for five minutes unless refresh. */
    servers(refresh: boolean): Promise<McpServerList> {
      if (!servers || refresh || Date.now() - servers.at > SERVERS_TTL_MS) {
        const value = Promise.all(CLIENTS.map((client) => clientServers(client.id))).then((clients) => ({ clients, checkedAt: new Date().toISOString() }));
        servers = { at: Date.now(), value };
      }
      return servers.value;
    },
    async status(): Promise<McpStatus> {
      return { server: launch, backupDir: options.backupDir, clients: await Promise.all(CLIENTS.map(clientStatus)) };
    },
    async register(client: McpClientId): Promise<McpChangeResult> {
      return register(client, cliFor(client), launch, run, location(client));
    },
    async unregister(client: McpClientId): Promise<McpChangeResult> {
      return unregister(client, cliFor(client), run, location(client));
    },
    async registerAlias(client: McpClientId): Promise<McpChangeResult> {
      return register(client, cliFor(client), launch, run, location(client), 'singularity');
    },
  };
}

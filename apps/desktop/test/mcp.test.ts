import { describe, expect, it } from 'vitest';
import type { Runner } from '@neuralbridge/workspace';
import { createMcpService, formatCommand } from '../src/main/mcp.js';

describe('formatCommand', () => {
  it('quotes arguments that contain spaces or quotes so the line can be pasted into a terminal', () => {
    expect(formatCommand('claude', ['mcp', 'add', '--', 'C:\\Program Files\\NeuralBridge\\NeuralBridge.exe', 'x.js'])).toBe(
      'claude mcp add -- "C:\\Program Files\\NeuralBridge\\NeuralBridge.exe" x.js',
    );
    expect(formatCommand('codex', ['say "hi"'])).toBe('codex "say \\"hi\\""');
  });
});

describe('createMcpService', () => {
  const missingEverywhere: Runner = async () => ({ code: 1, stdout: '', stderr: 'not found' });

  it('reports each client with the server command it would register', async () => {
    const service = createMcpService({
      appExecutable: 'C:\\NB\\NeuralBridge.exe',
      serverScript: 'C:\\NB\\resources\\mcp-server.js',
      backupDir: 'C:\\data\\backups',
      env: { PATH: '' },
      run: missingEverywhere,
    });
    const status = await service.status();
    expect(status.server).toEqual({ command: 'C:\\NB\\NeuralBridge.exe', args: ['C:\\NB\\resources\\mcp-server.js'], env: { ELECTRON_RUN_AS_NODE: '1' } });
    expect(status.clients.map((client) => [client.id, client.installed, client.registered])).toEqual([
      ['claude', false, false],
      ['codex', false, false],
    ]);
    expect(status.clients[0]?.addCommand).toBe('claude mcp add -s user neuralbridge -e ELECTRON_RUN_AS_NODE=1 -- C:\\NB\\NeuralBridge.exe C:\\NB\\resources\\mcp-server.js');
  });

  it('passes a custom data directory on to the server', async () => {
    const service = createMcpService({ appExecutable: 'e.exe', serverScript: 's.js', backupDir: 'b', env: { PATH: '', NB_DATA_DIR: 'D:\\nb' }, run: missingEverywhere });
    expect((await service.status()).server.env).toEqual({ ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: 'D:\\nb' });
  });

  it('lists the servers configured in each CLI through its own mcp list, and caches the answer', async () => {
    const calls: string[][] = [];
    const run: Runner = async (cli, args) => {
      calls.push([...cli.args, ...args]);
      if (cli.args[0] === 'claude-cli') return { code: 0, stdout: 'Checking MCP server health...\n\ncontext7: npx ctx - ✓ Connected\n', stderr: '' };
      return { code: 0, stdout: JSON.stringify([{ name: 'playwright', enabled: true, transport: { type: 'stdio' }, auth_status: 'unsupported' }]), stderr: '' };
    };
    // Overrides must name an existing absolute program: this Node, tagged with an argument.
    const env = { PATH: '', NB_CLAUDE_CLI: JSON.stringify([process.execPath, 'claude-cli']), NB_CODEX_CLI: JSON.stringify([process.execPath, 'codex-cli']) };
    const service = createMcpService({ appExecutable: 'e.exe', serverScript: 's.js', backupDir: 'b', env, run });
    const list = await service.servers(false);
    expect(list.clients).toEqual([
      { id: 'claude', installed: true, servers: [{ name: 'context7', transport: 'stdio', status: 'connected', detail: null }], error: null },
      { id: 'codex', installed: true, servers: [{ name: 'playwright', transport: 'stdio', status: 'not_checked', detail: null }], error: null },
    ]);
    expect(calls).toEqual([
      ['claude-cli', 'mcp', 'list'],
      ['codex-cli', 'mcp', 'list', '--json'],
    ]);
    await service.servers(false);
    expect(calls).toHaveLength(2);
    await service.servers(true);
    expect(calls).toHaveLength(4);
  });

  it('reports a failing or missing CLI per client instead of failing the whole list', async () => {
    const run: Runner = async () => ({ code: 1, stdout: '', stderr: 'boom' });
    const service = createMcpService({ appExecutable: 'e.exe', serverScript: 's.js', backupDir: 'b', env: { PATH: '', NB_CODEX_CLI: process.execPath }, run });
    const list = await service.servers(true);
    expect(list.clients).toEqual([
      { id: 'claude', installed: false, servers: [], error: null },
      { id: 'codex', installed: true, servers: [], error: expect.stringContaining('boom') },
    ]);
  });

  it('refuses to change a client that is not installed', async () => {
    const service = createMcpService({ appExecutable: 'e.exe', serverScript: 's.js', backupDir: 'b', env: { PATH: '' }, run: missingEverywhere });
    await expect(service.register('codex')).rejects.toThrow(/Codex CLI is not installed/);
  });
});

import { describe, expect, it } from 'vitest';
import { parseClaudeMcpList, parseCodexMcpList } from '../src/mcp-servers.js';

describe('Codex mcp list --json', () => {
  // Shape of codex-cli 0.162.1 (keys checked against a real run; values here are invented).
  const entry = (name: string, enabled: boolean, extra: Record<string, unknown> = {}) => ({
    name,
    enabled,
    disabled_reason: null,
    transport: { type: 'stdio', command: 'npx', args: ['-y', 'pkg', '--api-key', 'sk-secret'], env: { TOKEN: 'segredo' }, env_vars: ['TOKEN'], cwd: '/x' },
    startup_timeout_sec: 10,
    tool_timeout_sec: 60,
    auth_status: 'unsupported',
    ...extra,
  });

  it('reports name, transport and whether it is enabled, never the command, arguments or environment', () => {
    const servers = parseCodexMcpList(JSON.stringify([entry('context7', true), entry('old', false, { disabled_reason: 'desligado pelo usuário' }), entry('remote', true, { auth_status: 'not_logged_in', transport: { type: 'streamable_http', url: 'https://x' } })]));
    expect(servers).toEqual([
      { name: 'context7', transport: 'stdio', status: 'not_checked', detail: null },
      { name: 'old', transport: 'stdio', status: 'disabled', detail: 'desligado pelo usuário' },
      { name: 'remote', transport: 'streamable_http', status: 'needs_auth', detail: null },
    ]);
    expect(JSON.stringify(servers)).not.toMatch(/sk-secret|segredo|npx/);
  });

  it('rejects output that is not the expected list', () => {
    expect(() => parseCodexMcpList('No MCP servers configured yet.')).toThrow();
    expect(parseCodexMcpList('[]')).toEqual([]);
  });
});

describe('claude mcp list', () => {
  it('reads each server line, its transport and health, without the command or URL', () => {
    const stdout = [
      'Checking MCP server health...',
      '',
      'context7: npx -y @upstash/context7-mcp --api-key ctx7sk-abc - ✓ Connected',
      'playwright: npx @playwright/mcp@latest - ✗ Failed to connect',
      'claude.ai Gmail: https://gmail.mcp.claude.com/mcp?token=abc (HTTP) - ! Needs authentication',
      'weird: something - who knows',
      '',
    ].join('\n');
    const servers = parseClaudeMcpList(stdout);
    expect(servers).toEqual([
      { name: 'context7', transport: 'stdio', status: 'connected', detail: null },
      { name: 'playwright', transport: 'stdio', status: 'failed', detail: 'Failed to connect' },
      { name: 'claude.ai Gmail', transport: 'http', status: 'needs_auth', detail: null },
      { name: 'weird', transport: 'stdio', status: 'unknown', detail: 'who knows' },
    ]);
    expect(JSON.stringify(servers)).not.toMatch(/ctx7sk|token=|npx/);
  });

  it('reads the marks Claude Code actually prints and treats a bare URL as a remote server', () => {
    // Seen with the real CLI: "✔ Connected" (U+2714), and claude.ai connectors listed by URL.
    const stdout = ['playwright: npx @playwright/mcp@latest - ✔ Connected', 'claude.ai Docs: https://mcp.example.com/x - ✔ Connected', 'broken: cmd - ✘ Failed to connect'].join('\n');
    expect(parseClaudeMcpList(stdout)).toEqual([
      { name: 'playwright', transport: 'stdio', status: 'connected', detail: null },
      { name: 'claude.ai Docs', transport: 'http', status: 'connected', detail: null },
      { name: 'broken', transport: 'stdio', status: 'failed', detail: 'Failed to connect' },
    ]);
  });

  it('has no servers when none are configured', () => {
    expect(parseClaudeMcpList('No MCP servers configured. Use `claude mcp add` to add a server.\n')).toEqual([]);
  });
});

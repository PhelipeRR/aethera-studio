import type { McpServerInfo } from '@neuralbridge/shared';

// MCP servers configured in each CLI, read through their own `mcp list` commands. Only the name, the
// transport and the state leave this module: commands, arguments, URLs and environment can carry keys.

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null;
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `codex mcp list --json` (checked with codex-cli 0.162.1). Codex does not connect to list, so enabled servers are not_checked. */
export function parseCodexMcpList(stdout: string): McpServerInfo[] {
  const value: unknown = JSON.parse(stdout);
  if (!Array.isArray(value)) throw new Error('codex mcp list --json did not return a list');
  return value.filter(isObject).map((entry) => {
    const transport = isObject(entry['transport']) ? str(entry['transport']['type']) || null : null;
    if (entry['enabled'] === false) return { name: str(entry['name']), transport, status: 'disabled', detail: str(entry['disabled_reason']) || null };
    return { name: str(entry['name']), transport, status: entry['auth_status'] === 'not_logged_in' ? 'needs_auth' : 'not_checked', detail: null };
  });
}

/**
 * `claude mcp list`: "<name>: <command or URL>[ (HTTP|SSE)] - <mark> <health>" per line (Claude Code
 * 2.1.312 prints "✔ Connected"), after a health check that starts each server. The format is text, so unknown lines are skipped and an
 * unrecognised health is kept as unknown with its words.
 */
export function parseClaudeMcpList(stdout: string): McpServerInfo[] {
  const servers: McpServerInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const colon = line.indexOf(': ');
    const dash = line.lastIndexOf(' - ');
    if (colon <= 0 || dash <= colon) continue;
    const name = line.slice(0, colon).trim();
    const target = line.slice(colon + 2, dash);
    // Any leading mark (✔ ✓ ✗ ✘ ! ⚠ …): the words decide.
    const health = line.slice(dash + 3).replace(/^[^\p{L}]+/u, '').trim();
    const transport = /\((HTTP|SSE)\)\s*$/i.exec(target)?.[1]?.toLowerCase() ?? (/^\s*https?:\/\//i.test(target) ? 'http' : 'stdio');
    const status: McpServerInfo['status'] = /^connected/i.test(health)
      ? 'connected'
      : /auth/i.test(health)
        ? 'needs_auth'
        : /fail/i.test(health)
          ? 'failed'
          : 'unknown';
    servers.push({ name, transport, status, detail: status === 'connected' || status === 'needs_auth' ? null : health || null });
  }
  return servers;
}

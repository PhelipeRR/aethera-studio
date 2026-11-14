import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AgentEvent } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { claudeArgs, ClaudeCliAdapter, claudeStdin } from '../src/claude-adapter.js';
import { codexArgs, CodexCliAdapter, isStrictOutputSchema, usesElevatedSandbox } from '../src/codex-adapter.js';

const fakeCli = resolve(import.meta.dirname, 'bin/fake-cli.mjs');
const fixtures = resolve(import.meta.dirname, 'fixtures');
const cli = { command: process.execPath, args: [fakeCli] };
const mcp = { command: 'C:\\NB\\NeuralBridge.exe', args: ['C:\\NB\\mcp-server.js'], env: { ELECTRON_RUN_AS_NODE: '1' }, tools: ['brain_search', 'brain_store'] };

describe('command lines', () => {
  it('runs a lean request with nothing but its own system prompt', () => {
    const args = claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', lean: { systemPrompt: 'Draft one reply.' } });
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
    expect(args.slice(args.indexOf('--setting-sources'), args.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', '']);
    expect(args.slice(args.indexOf('--system-prompt'), args.indexOf('--system-prompt') + 2)).toEqual(['--system-prompt', 'Draft one reply.']);
    expect(args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']));
    expect(args).not.toContain('--allowedTools');
    const withMcp = claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', lean: { systemPrompt: 'y' }, mcp: { command: 'node', args: [], env: {}, tools: ['brain_search'] } }, 'C:\\tmp\\mcp.json');
    expect(withMcp).not.toContain('--mcp-config');
  });

  it('leaves the dialect marker out of a schema, which the Claude CLI refuses', () => {
    const args = claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', outputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' } });
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify({ type: 'object' }));
  });

  it('Claude: read-only and edit modes, MCP injection and resume', () => {
    expect(claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only' })).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--allowedTools', 'Read', 'Grep', 'Glob',
    ]);
    expect(claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'edit', resumeSessionId: 'abc', model: 'opus' }, 'C:\\tmp\\mcp.json')).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits', '--model', 'opus', '--resume', 'abc',
      '--allowedTools', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'NotebookEdit',
    ]);
    const withMcp = claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', mcp, allowedTools: ['Read', 'Bash(npm test)'] }, 'C:\\tmp\\mcp.json');
    expect(withMcp).toEqual([
      '-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'default', '--mcp-config', 'C:\\tmp\\mcp.json', '--strict-mcp-config',
      '--allowedTools', 'Read', 'Bash(npm test)', 'mcp__neuralbridge__brain_search', 'mcp__neuralbridge__brain_store',
    ]);
    expect(withMcp.join(' ')).not.toMatch(/dangerously|bypassPermissions/);
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
    const structured = claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', outputSchema: schema });
    expect(structured.slice(structured.indexOf('--json-schema'), structured.indexOf('--json-schema') + 2)).toEqual(['--json-schema', JSON.stringify(schema)]);
  });

  it('Codex: sandbox per mode, the elevated-sandbox workaround, MCP injection, resume, prompt on stdin', () => {
    expect(codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only' }, { elevatedSandbox: true })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-',
    ]);
    expect(codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'edit', model: 'gpt-5', resumeSessionId: 'thread-1', mcp }, { elevatedSandbox: true })).toEqual([
      'exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', '-c', 'windows.sandbox="unelevated"', '-m', 'gpt-5',
      '-c', 'mcp_servers.neuralbridge.command="C:\\\\NB\\\\NeuralBridge.exe"',
      '-c', 'mcp_servers.neuralbridge.args=["C:\\\\NB\\\\mcp-server.js"]',
      '-c', 'mcp_servers.neuralbridge.env={ELECTRON_RUN_AS_NODE="1"}',
      '-c', 'mcp_servers.neuralbridge.default_tools_approval_mode="approve"',
      '-c', 'mcp_servers.neuralbridge.enabled_tools=["brain_search","brain_store"]',
      'thread-1', '-',
    ]);
    expect(codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'edit' }, { elevatedSandbox: false })).not.toContain('windows.sandbox="unelevated"');
  });

  it('bypasses permissions only for an edit run the user granted full access, never for read-only runs', () => {
    // Flags as listed by Claude Code 2.1.312 and Codex 0.162.1 --help.
    const claude = claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'edit', access: { full: true, network: false } });
    expect(claude).toContain('--dangerously-skip-permissions');
    expect(claude).not.toContain('acceptEdits');
    expect(claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', access: { full: true, network: false } }).join(' ')).not.toMatch(/dangerously/);

    const codex = codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'edit', resumeSessionId: 't1', access: { full: true, network: false } }, { elevatedSandbox: true });
    expect(codex).toEqual(['exec', 'resume', '--json', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', 't1', '-']);
    expect(codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', access: { full: true, network: true } }, { elevatedSandbox: false })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', '-',
    ]);
  });

  it('Codex: opens the network of the workspace sandbox when the project allows it', () => {
    expect(codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'edit', access: { full: false, network: true } }, { elevatedSandbox: false })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true', '-',
    ]);
  });

  it('sends images the way each CLI takes them: Claude a stream-json message, Codex one --image per file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-img-'));
    const png = join(dir, '0.png');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const images = [{ path: png, mime: 'image/png' as const }];
    // Formats confirmed with the real Claude Code 2.1.312 and Codex 0.162.1 (both described a test image).
    const claude = claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', images });
    expect(claude.slice(0, 7)).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--input-format', 'stream-json', '--permission-mode']);
    const line = JSON.parse(claudeStdin({ prompt: 'Veja a tela', cwd: 'C:\\p', mode: 'read-only', images }));
    expect(line).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Veja a tela' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64') } }] },
    });
    // Without images nothing changes: plain text on stdin.
    expect(claudeArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only' })).not.toContain('--input-format');
    expect(claudeStdin({ prompt: 'só texto', cwd: 'C:\\p', mode: 'read-only' })).toBe('só texto');

    expect(codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'edit', resumeSessionId: 't1', images: [...images, { path: 'C:\\a\\1.webp', mime: 'image/webp' }] }, { elevatedSandbox: false })).toEqual([
      'exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="workspace-write"', `--image=${png}`, '--image=C:\\a\\1.webp', 't1', '-',
    ]);
  });

  it('detects the elevated Windows sandbox in the user config', () => {
    expect(usesElevatedSandbox('model = "x"\n\n[windows]\nsandbox = "elevated"\n')).toBe(true);
    expect(usesElevatedSandbox('[windows]\nsandbox = "unelevated"\n')).toBe(false);
    expect(usesElevatedSandbox('[other]\nsandbox = "elevated"\n[windows]\nfoo = 1\n')).toBe(false);
    expect(usesElevatedSandbox('')).toBe(false);
  });
});

function scripted(outputs: Record<string, { stdout?: string; stderr?: string; code?: number }>) {
  return { ...process.env, FAKE_CLI_OUTPUT: JSON.stringify(outputs) };
}

const CLAUDE_HELP = '--output-format --input-format stream-json --mcp-config --strict-mcp-config --json-schema --resume --permission-mode --allowedTools';
const CODEX_HELP = '--json --output-schema --sandbox resume --skip-git-repo-check';

describe('detect', () => {
  it('reports a missing CLI', async () => {
    const status = await new ClaudeCliAdapter({ env: { PATH: mkdtempSync(join(tmpdir(), 'nb-empty-')) } }).detect();
    expect(status).toMatchObject({ id: 'claude', installed: false, path: null, problems: [expect.stringContaining('não encontrado')] });
  });

  it('reads version and login without keeping e-mail or organisation', async () => {
    const env = scripted({
      '--version': { stdout: '2.1.312 (Claude Code)\n' },
      'auth status': { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'ana@example.com', orgName: 'ACME' }) },
      '--help': { stdout: CLAUDE_HELP },
    });
    const status = await new ClaudeCliAdapter({ cli, env }).detect();
    expect(status).toMatchObject({ installed: true, version: '2.1.312', authenticated: true, authMethod: 'claude.ai', problems: [], warnings: [] });
    expect(status.features).toEqual(expect.arrayContaining(['stream-json', 'mcp-config', 'resume']));
    expect(JSON.stringify(status)).not.toMatch(/ana@example|ACME/);
  });

  it('flags a logged-out or outdated Claude', async () => {
    const env = scripted({
      '--version': { stdout: '2.0.5 (Claude Code)\n' },
      'auth status': { stdout: JSON.stringify({ loggedIn: false, authMethod: 'none' }) },
      '--help': { stdout: CLAUDE_HELP },
    });
    const status = await new ClaudeCliAdapter({ cli, env }).detect();
    expect(status.authenticated).toBe(false);
    expect(status.problems).toEqual([expect.stringContaining('login')]);
    expect(status.warnings).toEqual([expect.stringContaining('2.1.312')]);
  });

  it('reads Codex login and warns about the elevated sandbox workaround', async () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'nb-codex-home-'));
    writeFileSync(join(codexHome, 'config.toml'), '[windows]\nsandbox = "elevated"\n');
    const env = scripted({
      '--version': { stdout: 'codex-cli 0.162.1\n' },
      // As codex 0.162.1 really does it: stderr, with the exit code carrying the state.
      'login status': { stderr: 'Logged in using ChatGPT\n', code: 0 },
      'exec --help': { stdout: CODEX_HELP },
    });
    const status = await new CodexCliAdapter({ cli, env: { ...env, CODEX_HOME: codexHome } }).detect();
    expect(status).toMatchObject({ id: 'codex', version: '0.162.1', authenticated: true, authMethod: 'ChatGPT', problems: [] });
    expect(status.warnings).toEqual([expect.stringContaining('sandbox')]);

    const loggedOut = scripted({ '--version': { stdout: 'codex-cli 0.162.1\n' }, 'login status': { stderr: 'Not logged in\n', code: 1 }, 'exec --help': { stdout: CODEX_HELP } });
    expect((await new CodexCliAdapter({ cli, env: loggedOut }).detect()).authenticated).toBe(false);
  });
});

async function drain(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const all: AgentEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

describe('run', () => {
  const work = join(mkdtempSync(join(tmpdir(), 'nb-run-')), 'projeto com espaço');
  mkdirSync(work, { recursive: true });

  it('streams parsed events and finishes with a done event carrying the session and final answer', async () => {
    const replay = { command: process.execPath, args: [fakeCli, 'replay', join(fixtures, 'claude-edit.jsonl'), '0'] };
    const events = await drain(new ClaudeCliAdapter({ cli: replay }).run({ prompt: 'x', cwd: work, mode: 'edit' }));
    expect(events.at(-1)).toMatchObject({ kind: 'done', ok: true, exitCode: 0, cancelled: false, sessionId: expect.any(String), result: expect.any(String) });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'file_change' }));
  });

  it('uses the last Codex message as the final answer', async () => {
    const replay = { command: process.execPath, args: [fakeCli, 'replay', join(fixtures, 'codex-edit.jsonl'), '0'] };
    const events = await drain(new CodexCliAdapter({ cli: replay, env: { ...process.env, CODEX_HOME: work } }).run({ prompt: 'x', cwd: work, mode: 'edit' }));
    expect(events.at(-1)).toMatchObject({ kind: 'done', ok: true, result: expect.stringContaining('hello.txt') });
  });

  it('a non-zero exit is a failed run with the stderr tail attached', async () => {
    const replay = { command: process.execPath, args: [fakeCli, 'replay', join(fixtures, 'codex-text.jsonl'), '2'] };
    const events = await drain(new CodexCliAdapter({ cli: replay }).run({ prompt: 'x', cwd: work, mode: 'read-only' }));
    expect(events.at(-1)).toMatchObject({ kind: 'done', ok: false, exitCode: 2, errorOutput: expect.stringContaining('replayed') });
  });

  it('sends the prompt on stdin and writes the MCP config to a temporary file it removes afterwards', async () => {
    const echo = { command: process.execPath, args: [fakeCli, 'print-args'] };
    const events = await drain(new ClaudeCliAdapter({ cli: echo }).run({ prompt: 'Long prompt with "quotes" & ação', cwd: work, mode: 'read-only', mcp }));
    const raw = events.find((event) => event.kind === 'raw');
    const printed = JSON.parse(raw?.kind === 'raw' ? raw.line : '{}') as { args: string[]; stdin: string };
    expect(printed.stdin).toBe('Long prompt with "quotes" & ação');
    const configPath = printed.args[printed.args.indexOf('--mcp-config') + 1] ?? '';
    expect(() => readFileSync(configPath)).toThrow(/ENOENT/);
  });

  it('cancellation ends the run as cancelled', async () => {
    const copy = join(work, 'fake-cli.mjs');
    copyFileSync(fakeCli, copy);
    const controller = new AbortController();
    const run = new CodexCliAdapter({ cli: { command: process.execPath, args: [copy, 'tree'] } }).run({ prompt: 'x', cwd: work, mode: 'read-only' }, controller.signal);
    const events: AgentEvent[] = [];
    for await (const event of run) {
      events.push(event);
      controller.abort();
    }
    expect(events.at(-1)).toMatchObject({ kind: 'done', ok: false, cancelled: true });
  });
});

describe('Codex structured output', () => {
  const strict = { type: 'object', properties: { a: { type: 'string' }, b: { type: ['string', 'null'] }, list: { type: 'array', items: { type: 'object', properties: { c: { type: 'string', enum: ['type'] } }, required: ['c'], additionalProperties: false } } }, required: ['a', 'b', 'list'], additionalProperties: false };
  it('tells strict schemas from the ones the API refuses', () => {
    expect(isStrictOutputSchema(strict)).toBe(true);
    expect(isStrictOutputSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] })).toBe(false);
    expect(isStrictOutputSchema({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'], additionalProperties: false })).toBe(false);
    expect(isStrictOutputSchema({ type: 'object', properties: { list: { type: 'array', items: { type: 'object' } } }, required: ['list'], additionalProperties: false })).toBe(false);
  });
  it('passes the schema file and the web choice only when asked', () => {
    const args = codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', webSearch: true }, { elevatedSandbox: false, outputSchemaFile: 'C:\\t\\schema.json' });
    expect(args).toEqual(expect.arrayContaining(['--output-schema', 'C:\\t\\schema.json', 'web_search="live"']));
    expect(codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only', webSearch: false }, { elevatedSandbox: false })).toContain('web_search="disabled"');
    expect(codexArgs({ prompt: 'x', cwd: 'C:\\p', mode: 'read-only' }, { elevatedSandbox: false }).join(' ')).not.toMatch(/web_search|output-schema/);
  });
});

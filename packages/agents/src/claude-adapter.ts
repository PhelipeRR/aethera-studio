import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, AgentStatus } from '@neuralbridge/shared';
import { findClientCli } from '@neuralbridge/workspace';
import { createDetector, runAgent, type AdapterOptions, type AgentAdapter, type AgentRunRequest } from './agent.js';
import { createClaudeParser } from './claude-parser.js';

export const CLAUDE_TESTED_VERSION = '2.1.312';
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
const EDIT_TOOLS = ['Edit', 'Write', 'NotebookEdit'];

/**
 * Arguments for `claude -p` (prompt on stdin). Permissions are an explicit allowlist: in print mode
 * anything not allowed is denied, never prompted. The only bypass is the user's own choice of full access
 * for a project, and only for edit runs.
 */
export function claudeArgs(request: AgentRunRequest, mcpConfigFile?: string): string[] {
  const full = request.mode === 'edit' && request.access?.full === true;
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  // With images the prompt goes as a stream-json user message (claudeStdin), the only way -p takes them.
  if (request.images?.length) args.push('--input-format', 'stream-json');
  args.push(...(full ? ['--dangerously-skip-permissions'] : ['--permission-mode', request.mode === 'edit' ? 'acceptEdits' : 'default']));
  if (request.model) args.push('--model', request.model);
  if (request.resumeSessionId) args.push('--resume', request.resumeSessionId);
  if (request.mcp && mcpConfigFile && !request.lean) args.push('--mcp-config', mcpConfigFile, '--strict-mcp-config');
  if (request.outputSchema) {
    // Zod stamps the 2020-12 dialect, and the CLI's validator fails on a dialect it has not loaded before it reads the schema.
    const schema = { ...(request.outputSchema as Record<string, unknown>) };
    delete schema['$schema'];
    args.push('--json-schema', JSON.stringify(schema));
  }
  if (request.lean) {
    args.push('--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--no-session-persistence', '--system-prompt', request.lean.systemPrompt);
    return args;
  }
  const tools = request.allowedTools ?? (request.mode === 'edit' ? [...READ_TOOLS, ...EDIT_TOOLS] : READ_TOOLS);
  // --allowedTools is variadic: it goes last, after every other option.
  args.push('--allowedTools', ...tools, ...(request.mcp?.tools.map((tool) => `mcp__neuralbridge__${tool}`) ?? []));
  return args;
}

/**
 * What `claude -p` reads on stdin: the prompt text, or with images one stream-json user message with the
 * text and each image as a base64 block (checked with Claude Code 2.1.312: it described a test image).
 */
export function claudeStdin(request: AgentRunRequest): string {
  if (!request.images?.length) return request.prompt;
  const content = [
    { type: 'text', text: request.prompt },
    ...request.images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mime, data: readFileSync(image.path).toString('base64') } })),
  ];
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}

export class ClaudeCliAdapter implements AgentAdapter {
  readonly id: import('@neuralbridge/shared').AgentId;
  private readonly detector;

  constructor(private readonly options: AdapterOptions = {}) {
    this.id = options.id ?? 'claude';
    this.detector = createDetector(
      {
        id: this.id === 'claude-gateway' ? 'claude' : this.id,
        label: 'Claude Code',
        testedVersion: CLAUDE_TESTED_VERSION,
        versionArgs: ['--version'],
        authArgs: ['auth', 'status'],
        helpArgs: ['--help'],
        // Only these two fields are read: the output also carries e-mail and organisation, which we never keep.
        parseAuth: ({ stdout }) => {
          try {
            const value = JSON.parse(stdout) as { loggedIn?: unknown; authMethod?: unknown };
            return {
              authenticated: typeof value.loggedIn === 'boolean' ? value.loggedIn : null,
              method: typeof value.authMethod === 'string' && value.authMethod !== 'none' ? value.authMethod : null,
            };
          } catch {
            return { authenticated: null, method: null };
          }
        },
        features: {
          'stream-json': 'stream-json',
          'mcp-config': '--mcp-config',
          'strict-mcp-config': '--strict-mcp-config',
          'json-schema': '--json-schema',
          resume: '--resume',
          'permission-mode': '--permission-mode',
          'allowed-tools': '--allowedTools',
        },
        required: ['stream-json', 'permission-mode', 'allowed-tools'],
        loginHint: 'Abra um terminal, rode "claude" e use /login.',
      },
      options,
    );
  }

  detect(options?: { refresh?: boolean }): Promise<AgentStatus> {
    return this.detector(options);
  }

  run(request: AgentRunRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const resolvedEnv = this.options.resolveEnv
      ? { ...process.env, ...this.options.env, ...this.options.resolveEnv() }
      : this.options.env;
    const cli = this.options.cli ?? findClientCli('claude', resolvedEnv ?? process.env);
    if (!cli) return failedRun('Claude Code não encontrado no PATH.');
    let configFile: string | undefined;
    if (request.mcp) {
      configFile = join(tmpdir(), `neuralbridge-mcp-${randomUUID()}.json`);
      const { command, args, env } = request.mcp;
      writeFileSync(configFile, JSON.stringify({ mcpServers: { neuralbridge: { command, args, env } } }));
    }
    let stdin: string;
    try {
      stdin = claudeStdin(request);
    } catch (error) {
      if (configFile) rmSync(configFile, { force: true });
      return failedRun(`Não foi possível ler uma imagem anexada: ${error instanceof Error ? error.message : String(error)}`);
    }
    const gatewayModel =
      resolvedEnv?.['ANTHROPIC_BASE_URL'] && resolvedEnv?.['ANTHROPIC_AUTH_TOKEN'] && resolvedEnv?.['ANTHROPIC_MODEL']
        ? resolvedEnv['ANTHROPIC_MODEL']
        : undefined;
    const effectiveRequest = gatewayModel ? { ...request, model: gatewayModel } : request;
    return runAgent({
      cli,
      args: claudeArgs(effectiveRequest, configFile),
      request: effectiveRequest,
      stdin,
      ...(resolvedEnv ? { env: resolvedEnv } : {}),
      ...(signal ? { signal } : {}),
      parser: createClaudeParser(),
      cleanup: () => configFile && rmSync(configFile, { force: true }),
    });
  }
}

export async function* failedRun(message: string): AsyncGenerator<AgentEvent> {
  yield { kind: 'error', message };
  yield { kind: 'done', ok: false, exitCode: null, timedOut: false, cancelled: false, sessionId: null, result: null, errorOutput: message };
}

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readCodexLimits } from './codex-limits.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, AgentStatus } from '@neuralbridge/shared';
import { clientConfigFile, findClientCli } from '@neuralbridge/workspace';
import { createDetector, runAgent, type AdapterOptions, type AgentAdapter, type AgentRunRequest } from './agent.js';
import { failedRun } from './claude-adapter.js';
import { createCodexParser } from './codex-parser.js';

export const CODEX_TESTED_VERSION = '0.162.1';

/** True when the user's config selects the elevated Windows sandbox, which fails when Codex is launched by another app (R14). */
export function usesElevatedSandbox(configToml: string): boolean {
  const section = /^\[windows\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(configToml)?.[1] ?? '';
  return /^\s*sandbox\s*=\s*"elevated"\s*$/m.test(section);
}

function elevatedInConfig(env: Record<string, string | undefined>): boolean {
  const file = clientConfigFile('codex', env);
  return existsSync(file) && usesElevatedSandbox(readFileSync(file, 'utf8'));
}

const toml = (value: unknown) => JSON.stringify(value);

/**
 * Codex's API refuses the whole run for a schema that is not strict: every object closed, with all its
 * properties required. A looser one stays with the prompt and the caller's runtime validation.
 */
export function isStrictOutputSchema(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(isStrictOutputSchema);
  if (typeof schema !== 'object' || schema === null) return true;
  const node = schema as Record<string, unknown>;
  const type = node['type'];
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) {
    const properties = node['properties'];
    if (typeof properties !== 'object' || properties === null || node['additionalProperties'] !== false) return false;
    const required = Array.isArray(node['required']) ? node['required'] : [];
    if (Object.keys(properties).some((key) => !required.includes(key))) return false;
    return Object.values(properties).every(isStrictOutputSchema);
  }
  return Object.entries(node).every(([key, value]) => key === 'enum' || isStrictOutputSchema(value));
}

/**
 * Arguments for `codex exec` / `codex exec resume`, prompt on stdin ("-"). The sandbox goes through
 * `-c sandbox_mode=…` because `exec resume` accepts neither -s nor -C; the folder is the process cwd.
 */
export function codexArgs(request: AgentRunRequest, context: { elevatedSandbox: boolean; outputSchemaFile?: string }): string[] {
  const args = ['exec'];
  if (request.resumeSessionId) args.push('resume');
  args.push('--json', '--skip-git-repo-check');
  const edit = request.mode === 'edit';
  if (edit && request.access?.full) {
    // The user's choice of full access for the project: no sandbox and no approvals.
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    args.push('-c', `sandbox_mode=${toml(edit ? 'workspace-write' : 'read-only')}`);
    if (edit && context.elevatedSandbox) args.push('-c', 'windows.sandbox="unelevated"');
    if (edit && request.access?.network) args.push('-c', 'sandbox_workspace_write.network_access=true');
  }
  if (request.webSearch !== undefined) args.push('-c', `web_search=${toml(request.webSearch ? 'live' : 'disabled')}`);
  if (context.outputSchemaFile) args.push('--output-schema', context.outputSchemaFile);
  if (request.model) args.push('-m', request.model);
  // One --image=<file> per image: the flag takes several values, so a bare path could swallow the prompt's "-".
  for (const image of request.images ?? []) args.push(`--image=${image.path}`);
  if (request.mcp) {
    const env = Object.entries(request.mcp.env)
      .map(([key, value]) => `${key}=${toml(value)}`)
      .join(',');
    args.push(
      '-c', `mcp_servers.neuralbridge.command=${toml(request.mcp.command)}`,
      '-c', `mcp_servers.neuralbridge.args=${toml(request.mcp.args)}`,
      '-c', `mcp_servers.neuralbridge.env={${env}}`,
      '-c', 'mcp_servers.neuralbridge.default_tools_approval_mode="approve"',
      '-c', `mcp_servers.neuralbridge.enabled_tools=${toml(request.mcp.tools)}`,
    );
  }
  if (request.resumeSessionId) args.push(request.resumeSessionId);
  args.push('-');
  return args;
}

/** Codex reads the schema from a file, which lives only as long as the run. */
async function* withSchemaFile(schema: object, start: (file: string) => AsyncIterable<AgentEvent>): AsyncIterable<AgentEvent> {
  const folder = mkdtempSync(join(tmpdir(), 'nb-codex-schema-'));
  try {
    const file = join(folder, 'schema.json');
    writeFileSync(file, JSON.stringify(schema));
    yield* start(file);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export class CodexCliAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  private readonly detector;

  constructor(private readonly options: AdapterOptions = {}) {
    this.detector = createDetector(
      {
        id: 'codex',
        label: 'Codex CLI',
        testedVersion: CODEX_TESTED_VERSION,
        versionArgs: ['--version'],
        authArgs: ['login', 'status'],
        helpArgs: ['exec', '--help'],
        // `codex login status` writes to stderr and exits 1 when logged out (0.162.1).
        parseAuth: ({ stdout, stderr, code }) => {
          const output = `${stdout}\n${stderr}`;
          if (/not logged in/i.test(output)) return { authenticated: false, method: null };
          const match = /logged in using ([^\r\n]+)/i.exec(output);
          if (match && code === 0) return { authenticated: true, method: match[1]?.trim() ?? null };
          return { authenticated: null, method: null };
        },
        features: { json: '--json', 'output-schema': '--output-schema', resume: 'resume', 'skip-git-repo-check': '--skip-git-repo-check' },
        required: ['json'],
        loginHint: 'Abra um terminal e rode "codex login".',
        extraWarnings: (env) =>
          elevatedInConfig(env)
            ? ['Seu Codex usa o sandbox elevado do Windows, que falha quando outro app o inicia. Para editar arquivos, o NeuralBridge usa o sandbox não elevado (isolamento menor).']
            : [],
      },
      options,
    );
  }

  detect(options?: { refresh?: boolean }): Promise<AgentStatus> {
    return this.detector(options);
  }

  run(request: AgentRunRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const env = this.options.env ?? process.env;
    const cli = this.options.cli ?? findClientCli('codex', env);
    if (!cli) return failedRun('Codex CLI não encontrado no PATH.');
    const start = (outputSchemaFile?: string) => runAgent({
      cli,
      args: codexArgs(request, { elevatedSandbox: elevatedInConfig(env), ...(outputSchemaFile ? { outputSchemaFile } : {}) }),
      request,
      ...(this.options.env ? { env: this.options.env } : {}),
      ...(signal ? { signal } : {}),
      parser: createCodexParser(),
    });
    const events = !request.outputSchema || !isStrictOutputSchema(request.outputSchema) ? start() : withSchemaFile(request.outputSchema, start);
    return withRecordedLimits(events, env);
  }
}

/** After the run, the usage limits Codex recorded for this thread (see codex-limits.ts), as the same event Claude emits. */
async function* withRecordedLimits(events: AsyncIterable<AgentEvent>, env: Record<string, string | undefined>): AsyncIterable<AgentEvent> {
  let threadId: string | null = null;
  for await (const event of events) {
    if (event.kind === 'session' && event.sessionId) threadId = event.sessionId;
    yield event;
  }
  if (!threadId) return;
  let windows: ReturnType<typeof readCodexLimits> = null;
  try { windows = readCodexLimits(threadId, env); } catch { /* no snapshot: the page says the usage is unknown */ }
  if (windows) yield { kind: 'limits', windows };
}

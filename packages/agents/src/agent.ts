import type { AgentEvent, AgentId, AgentStatus } from '@neuralbridge/shared';
import { createCliRunner, findClientCli, type CommandSpec } from '@neuralbridge/workspace';
import { runProcess } from './process-runner.js';

export interface AgentRunRequest {
  /** Sent on stdin. */
  prompt: string;
  /** Project folder the agent works in. */
  cwd: string;
  /** read-only: may read and use MCP tools. edit: may also change files inside cwd. */
  mode: 'read-only' | 'edit';
  timeoutMs?: number;
  /**
   * What the user granted for the project, applied to edit runs only (read-only runs never change). full: no
   * permission checks and, for Codex, no sandbox; network: Codex's workspace sandbox may reach the network.
   */
  access?: { full: boolean; network: boolean };
  /** Images the user attached (files already validated by the app), sent with the prompt. */
  images?: { path: string; mime: string }[];
  /** Claude only: replaces the default tool allowlist of the mode (e.g. to allow "Bash(npm test)"). */
  allowedTools?: string[];
  /**
   * Claude only: a one-shot answer with no tools, settings, plugins or memory, and only this system prompt. Those load about
   * 45,000 tokens before the first word, which costs a short reply twenty times what it should.
   */
  lean?: { systemPrompt: string };
  model?: string;
  resumeSessionId?: string;
  /** Inject the NeuralBridge MCP server for this run only; `tools` are allowed without prompting. */
  mcp?: { command: string; args: string[]; env: Record<string, string>; tools: string[] };
  /** Full redacted output for debugging. */
  logFile?: string;
  /**
   * JSON Schema the final answer must follow. Claude reports it in the result event's structured; Codex
   * enforces it on the text, and only when the schema is strict (see isStrictOutputSchema).
   */
  outputSchema?: object;
  /** Codex only: turns its web search on or off for this run; unset keeps the user's config. Claude uses allowedTools. */
  webSearch?: boolean;
}

export interface AdapterOptions {
  /** Override the CLI location (tests, custom installs). */
  cli?: CommandSpec;
  env?: Record<string, string | undefined>;
  /** Dynamic environment resolver evaluated on each detect/run call (e.g. gateway token toggle). */
  resolveEnv?: () => Record<string, string | undefined>;
}

export interface AgentAdapter {
  readonly id: AgentId;
  detect(options?: { refresh?: boolean }): Promise<AgentStatus>;
  run(request: AgentRunRequest, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

export function versionOf(text: string): string | null {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
}

export function olderThan(version: string, reference: string): boolean {
  const a = version.split('.').map(Number);
  const b = reference.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

export interface DetectSpec {
  id: AgentId;
  label: string;
  testedVersion: string;
  /** Arguments for the commands detection runs. */
  versionArgs: string[];
  authArgs: string[];
  helpArgs: string[];
  /** Gets both streams and the exit code: Codex reports login on stderr and signals it with the exit code. */
  parseAuth(output: { stdout: string; stderr: string; code: number | null }): { authenticated: boolean | null; method: string | null };
  /** Feature name -> text that must appear in the help output. */
  features: Record<string, string>;
  /** Features without which runs cannot work. */
  required: string[];
  loginHint: string;
  extraWarnings?(env: Record<string, string | undefined>): string[];
}

/** Shared detection: location, version, login, features. Results are cached for a minute. */
export function createDetector(spec: DetectSpec, options: AdapterOptions) {
  let cached: { at: number; status: AgentStatus } | null = null;
  return async function detect({ refresh = false } = {}): Promise<AgentStatus> {
    if (!refresh && cached && Date.now() - cached.at < 60_000) return cached.status;
    const env = options.resolveEnv
      ? { ...process.env, ...options.env, ...options.resolveEnv() }
      : (options.env ?? process.env);
    const base: AgentStatus = {
      id: spec.id,
      label: spec.label,
      installed: false,
      path: null,
      version: null,
      testedVersion: spec.testedVersion,
      authenticated: null,
      authMethod: null,
      features: [],
      warnings: [],
      problems: [],
      checkedAt: new Date().toISOString(),
    };
    const cli = options.cli ?? findClientCli(spec.id, env);
    if (!cli) {
      const status = { ...base, problems: [`${spec.label} não encontrado no PATH. Instale o CLI e abra o NeuralBridge de novo.`] };
      cached = { at: Date.now(), status };
      return status;
    }

    const run = createCliRunner({ env, timeoutMs: 30_000 });
    const [versionOut, authOut, helpOut] = await Promise.all([run(cli, spec.versionArgs), run(cli, spec.authArgs), run(cli, spec.helpArgs)]);
    const version = versionOf(versionOut.stdout);
    const parsedAuth = spec.parseAuth(authOut);
    const auth =
      spec.id === 'claude' && env['ANTHROPIC_AUTH_TOKEN'] && env['ANTHROPIC_BASE_URL']
        ? { authenticated: true, method: 'gateway-token' }
        : parsedAuth;
    const features = Object.entries(spec.features)
      .filter(([, marker]) => helpOut.stdout.includes(marker))
      .map(([name]) => name);

    const problems: string[] = [];
    const warnings: string[] = [];
    if (!version) problems.push(`Não foi possível ler a versão do ${spec.label}.`);
    else if (olderThan(version, spec.testedVersion)) warnings.push(`Versão ${version} é anterior à testada (${spec.testedVersion}); atualize se algo falhar.`);
    if (auth.authenticated === false) problems.push(`${spec.label} não está com login feito. ${spec.loginHint}`);
    if (auth.authenticated === null) warnings.push(`Não foi possível confirmar o login do ${spec.label}.`);
    const missing = spec.required.filter((feature) => !features.includes(feature));
    if (missing.length) problems.push(`Esta versão do ${spec.label} não oferece: ${missing.join(', ')}.`);
    warnings.push(...(spec.extraWarnings?.(env) ?? []));

    const status: AgentStatus = {
      ...base,
      installed: true,
      path: [cli.command, ...cli.args].join(' '),
      version,
      authenticated: auth.authenticated,
      authMethod: auth.method,
      features,
      warnings,
      problems,
    };
    cached = { at: Date.now(), status };
    return status;
  };
}

/**
 * Runs a CLI and turns its stdout into AgentEvents, ending with one `done` event. Stopping the
 * iteration early cancels the process; `cleanup` always runs.
 */
export async function* runAgent(options: {
  cli: CommandSpec;
  args: string[];
  request: AgentRunRequest;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  parser: (line: string) => AgentEvent[];
  cleanup?: () => void;
  /** What goes to stdin instead of the prompt text (Claude's stream-json message with images). */
  stdin?: string;
}): AsyncGenerator<AgentEvent> {
  const internal = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, internal.signal]) : internal.signal;
  const { request } = options;
  const process_ = runProcess({
    command: options.cli.command,
    args: [...options.cli.args, ...options.args],
    cwd: request.cwd,
    ...(options.env ? { env: options.env } : {}),
    stdin: options.stdin ?? request.prompt,
    signal,
    ...(request.timeoutMs ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.logFile ? { logFile: request.logFile } : {}),
  });

  let sessionId: string | null = null;
  let result: string | null = null;
  let resultOk: boolean | null = null;
  let lastText: string | null = null;
  let finished = false;
  try {
    for await (const line of process_.lines) {
      if (line.stream !== 'stdout') continue;
      for (const event of options.parser(line.line)) {
        if (event.kind === 'session') sessionId = event.sessionId;
        if (event.kind === 'result') {
          result = event.text;
          resultOk = event.ok;
        }
        if (event.kind === 'text') lastText = event.text;
        yield event;
      }
    }
    const outcome = await process_.result;
    finished = true;
    const ok = outcome.exitCode === 0 && !outcome.timedOut && !outcome.cancelled && outcome.spawnError === null && resultOk !== false;
    yield {
      kind: 'done',
      ok,
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      cancelled: outcome.cancelled,
      sessionId,
      result: result ?? lastText,
      errorOutput: ok ? null : outcome.spawnError ?? (outcome.stderrTail.slice(-2000) || null),
    };
  } finally {
    if (!finished) internal.abort();
    options.cleanup?.();
  }
}

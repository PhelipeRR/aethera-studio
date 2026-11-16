import { findClientCli } from '@neuralbridge/workspace';
import { findAntigravityCli } from './antigravity-cli.js';
import type { ProductionConsoleService, ProductionLogStage } from './production-console.js';
import {
  ClaudeStreamReader,
  clipLine,
  readClaudeStreamLine,
  runInstrumentedCommand,
  type AgentActivitySnapshot,
  type CapturedLine,
  type LineActivity,
} from './production-agent-runner.js';

export type ProductionAgentProviderId = 'antigravity-cli' | 'claude-cli' | 'claude-gateway' | 'codex-cli';
export type ProductionAgentStreamFormat = 'claude-stream-json' | 'antigravity-json' | 'text';

/**
 * Failure classification for fallback decisions. `quota_exhausted` means the provider's account has no remaining
 * credits and retrying the same provider is pointless; `rate_limited` is a temporary throttle that may resolve
 * after a cooldown; `auth_failed` means credentials are invalid or missing.
 */
export type ProductionAgentFailureKind =
  | 'cli_not_installed'
  | 'quota_exhausted'
  | 'rate_limited'
  | 'auth_failed'
  | 'config_error'
  | 'timeout'
  /** No real progress for the whole inactivity window: hang confirmed by the supervisor. */
  | 'stalled'
  | 'network_error'
  | 'invalid_response'
  | 'cancelled'
  /** The user skipped this agent on purpose: the chain moves on, the backend is not penalized. */
  | 'skipped'
  | 'unknown';

export interface ProductionAgentProvider {
  id: ProductionAgentProviderId;
  label: string;
  streamFormat: ProductionAgentStreamFormat;
  /** Where the CLI is, or null when it is not installed. `prefixArgs` are launcher arguments (e.g. codex.cmd). */
  locate(env?: Record<string, string | undefined>): { command: string; prefixArgs: string[] } | null;
  buildArgs(prompt: string): string[];
  /**
   * Extra environment variables this provider needs at runtime (e.g. gateway token). Merged on top of process.env
   * before spawning the CLI. Returning an empty object or undefined means the provider uses the default env.
   */
  resolveEnv?: () => Record<string, string | undefined>;
  /**
   * When two providers share the same underlying endpoint and credentials, the fallback chain should skip the
   * duplicate after one of them fails with quota/auth errors. Returns a stable key identifying the shared backend,
   * or null when the provider is independent.
   */
  backendKey?: (env?: Record<string, string | undefined>) => string | null;
}

/**
 * Classifies a failure reason into a structured kind so the fallback chain can skip redundant providers (same backend
 * after quota exhaustion) or apply cooldowns (rate limits). Patterns are matched case-insensitively against the raw
 * stderr/stdout tail captured by the runner.
 */
export function classifyProductionAgentFailure(reason: string | undefined): ProductionAgentFailureKind {
  if (!reason) return 'unknown';
  const lower = reason.toLowerCase();
  if (lower.includes('pulado pelo usuário')) return 'skipped';
  if (CONFIG_ERROR_PATTERN.test(reason)) return 'config_error';
  if (lower.includes('cli_not_installed') || lower.includes('not found') || lower.includes('enoent')) return 'cli_not_installed';
  if (lower.includes('cancelado') || lower.includes('aborted')) return 'cancelled';
  if (lower.includes('travamento confirmado')) return 'stalled';
  if (
    lower.includes('tempo limite') ||
    lower.includes('tempo máximo') ||
    lower.includes('timed out') ||
    lower.includes('timeout')
  ) {
    return 'timeout';
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('network') || lower.includes('fetch failed')) return 'network_error';
  // Quota exhausted: permanent credit/balance errors — retrying the same backend is pointless.
  if (
    lower.includes('quota') ||
    lower.includes('balance is too low') ||
    lower.includes('resource_exhausted') ||
    lower.includes('usage limit') ||
    lower.includes('credits') ||
    lower.includes('passe foi encerrado') ||
    lower.includes('insufficient') ||
    lower.includes('billing')
  ) {
    return 'quota_exhausted';
  }
  // Rate limit: temporary throttle that may resolve after a cooldown.
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('too many requests') || lower.includes('throttl')) {
    return 'rate_limited';
  }
  if (lower.includes('auth') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('invalid token') || lower.includes('api key')) {
    return 'auth_failed';
  }
  if (lower.includes('json') || lower.includes('parse') || lower.includes('invalid response') || lower.includes('sem texto final')) {
    return 'invalid_response';
  }
  return 'unknown';
}

const CONFIG_ERROR_PATTERN =
  /unknown (option|argument|flag)|unrecognized (option|argument)|invalid (model|option)|model[^\n]{0,60}not (found|available|supported)|not_found_error|missing required (argument|option)/i;

const DEFINITIVE_FAILURES: Array<{ kind: ProductionAgentFailureKind; pattern: RegExp }> = [
  {
    kind: 'auth_failed',
    pattern:
      /(status|http|code|error)[^\n]{0,12}\b401\b|\b401\b[^\n]{0,40}(unauthori|auth|invalid)|unauthori[sz]ed|authentication[_ ]error|invalid[ _-](api[ _-]?key|x-api-key|token|bearer)|not logged in|please run \/login|oauth token (has )?expired|permission_error/i,
  },
  {
    kind: 'quota_exhausted',
    pattern:
      /credit balance is too low|balance is too low|insufficient[_ ](quota|credits?|balance)|quota (exceeded|exhausted)|resource_exhausted|usage limit|passe foi encerrado|billing/i,
  },
  { kind: 'config_error', pattern: CONFIG_ERROR_PATTERN },
];

/**
 * A line that proves the run can never succeed (credentials refused, quota gone, invalid configuration). The run is
 * ended at once and the chain falls back immediately instead of waiting for the agent to give up. Only stderr and
 * structured error events are inspected: the agent's own answer may legitimately talk about "quota" or "billing".
 */
export function detectDefinitiveFailure(line: Pick<CapturedLine, 'stream' | 'text'>): string | null {
  let candidate: string | null = null;
  if (line.stream === 'stderr') {
    candidate = line.text;
  } else {
    const trimmed = line.text.trim();
    if (!trimmed.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const type = typeof parsed['type'] === 'string' ? parsed['type'] : '';
      const subtype = typeof parsed['subtype'] === 'string' ? parsed['subtype'] : '';
      const status = typeof parsed['error_status'] === 'number' ? parsed['error_status'] : null;
      if (type === 'system' && /error|retry/i.test(subtype)) {
        if (status === 401 || status === 403) return `HTTP ${status} (${subtype})`;
        candidate = JSON.stringify(parsed['error'] ?? parsed['message'] ?? '');
      } else if (type === 'error') {
        candidate = JSON.stringify(parsed['error'] ?? parsed['message'] ?? parsed);
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }
  if (!candidate) return null;
  for (const { pattern } of DEFINITIVE_FAILURES) {
    if (pattern.test(candidate)) return clipLine(candidate.trim(), 300);
  }
  return null;
}

/**
 * How a long agent run is supervised. Editorial work (research, script, planning) has NO fixed total timeout: it runs
 * while the agent shows real progress and ends only on confirmed inactivity, a definitive error, cancellation, or the
 * optional `maxDurationMs` ceiling.
 */
export interface AgentExecutionPolicy {
  /** Window without real progress that confirms a hang. Default 10 min. */
  inactivityTimeoutMs: number;
  /** Optional hard ceiling; `null` = disabled (default for editorial work). */
  maxDurationMs: number | null;
  /** Heartbeat to the console (elapsed time, last event, state). Default 15 s. */
  heartbeatIntervalMs?: number;
  /** After this long without progress the agent shows as "raciocinando (silencioso)". Default 30 s. */
  silentAfterMs?: number;
  /** How long an agent may linger after delivering its result before its tree is ended. Default 30 s. */
  postResultGraceMs?: number;
  /** SIGTERM → SIGKILL escalation. Default 5 s. */
  killGraceMs?: number;
}

export const DEFAULT_EDITORIAL_EXECUTION_POLICY: AgentExecutionPolicy = {
  inactivityTimeoutMs: 10 * 60_000,
  maxDurationMs: null,
  heartbeatIntervalMs: 15_000,
  silentAfterMs: 30_000,
  postResultGraceMs: 30_000,
};

/** Activity description per stream format: repetition is judged on the meaningful content, not on raw bytes. */
function describeAgentActivity(format: ProductionAgentStreamFormat, line: CapturedLine): LineActivity | null {
  const text = line.text.trim();
  if (!text) return null;
  if (format === 'claude-stream-json' && line.stream === 'stdout' && text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const type = typeof parsed['type'] === 'string' ? parsed['type'] : '';
      const subtype = typeof parsed['subtype'] === 'string' ? parsed['subtype'] : '';
      // Retry banners and keep-alives say the agent is waiting, not working.
      if (type === 'system' && /retry|keep_?alive|ping/i.test(subtype)) {
        return { key: `system:${subtype}`, summary: `sistema: ${subtype}`, kind: 'noise' };
      }
    } catch {
      // not JSON: treated as plain text below
    }
    const activity = readClaudeStreamLine(text);
    // Structured events: numbers are content (tool inputs), so the comparison is exact.
    if (activity) return { key: activity.text, summary: activity.text, exact: true };
    // Other structured events (user/tool results): content is the progress.
    return { key: text.slice(0, 2000), summary: clipLine(text, 200), exact: true };
  }
  return { key: text.slice(0, 2000), summary: clipLine(text, 200) };
}

function isAgentCompletionLine(format: ProductionAgentStreamFormat, line: CapturedLine): boolean {
  if (line.stream !== 'stdout') return false;
  const text = line.text.trim();
  if (!text.startsWith('{')) return false;
  if (format === 'claude-stream-json') return /"type"\s*:\s*"result"/.test(text) && readClaudeStreamLine(text)?.finalText !== undefined;
  if (format === 'antigravity-json') {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      return typeof parsed['status'] === 'string' && ('response' in parsed || 'error' in parsed);
    } catch {
      return false;
    }
  }
  return false;
}

// ─── Active runs (manual skip / cancel) ──────────────────────────────────────

export interface ActiveAgentRun {
  runId: string;
  projectId: string;
  jobId?: string;
  stage: ProductionLogStage;
  label: string;
  providerId: ProductionAgentProviderId;
  providerLabel: string;
  startedAt: string;
  activity: AgentActivitySnapshot | null;
}

const activeAgentRuns = new Map<string, { info: ActiveAgentRun; controller: AbortController }>();

/** Agent runs in progress right now, for the UI. */
export function listActiveAgentRuns(projectId?: string): ActiveAgentRun[] {
  return [...activeAgentRuns.values()]
    .map((entry) => entry.info)
    .filter((info) => !projectId || info.projectId === projectId);
}

/**
 * Ends the running agent of `runId` (its whole process tree). `skip` moves the fallback chain on to the next provider;
 * `cancel` ends only this agent run and reports it as cancelled (the production itself is cancelled through the
 * pipeline, which aborts every run of the job).
 */
export function stopActiveAgentRun(runId: string, mode: 'skip' | 'cancel' = 'skip'): boolean {
  const entry = activeAgentRuns.get(runId);
  if (!entry) return false;
  entry.controller.abort(mode);
  return true;
}

/**
 * The CLIs the studio can call for editorial work, in fallback order. Claude Gateway sits between Claude Code CLI and
 * Codex CLI: it reuses the same claude binary but with its own endpoint/token, so it only appears when explicitly
 * configured and enabled. When gateway and CLI share the same base URL and token, the fallback chain treats them as
 * one backend to avoid redundant attempts after quota exhaustion.
 */
export const PRODUCTION_AGENT_PROVIDERS: ProductionAgentProvider[] = [
  {
    id: 'antigravity-cli',
    label: 'Antigravity CLI (agy)',
    streamFormat: 'antigravity-json',
    locate: (env) => {
      const path = findAntigravityCli(env ?? process.env);
      return path ? { command: path, prefixArgs: [] } : null;
    },
    buildArgs: (prompt) => ['--output-format', 'json', '--mode', 'plan', '--print', prompt],
  },
  {
    id: 'claude-cli',
    label: 'Claude Code (claude)',
    streamFormat: 'claude-stream-json',
    locate: (env) => {
      const cli = findClientCli('claude', env ?? process.env);
      return cli ? { command: cli.command, prefixArgs: cli.args } : null;
    },
    buildArgs: (prompt) => ['-p', '--output-format', 'stream-json', '--verbose', prompt],
    backendKey: (env) => {
      const baseUrl = env?.['ANTHROPIC_BASE_URL'];
      const token = env?.['ANTHROPIC_AUTH_TOKEN'] ?? env?.['ANTHROPIC_API_KEY'];
      return baseUrl && token ? `claude:${baseUrl}` : null;
    },
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI (codex)',
    streamFormat: 'text',
    locate: (env) => {
      const cli = findClientCli('codex', env ?? process.env);
      return cli ? { command: cli.command, prefixArgs: cli.args } : null;
    },
    buildArgs: (prompt) => ['exec', '--skip-git-repo-check', prompt],
  },
];

/** Antigravity answers with one JSON document; the useful text is `response`, and `status` tells success from failure. */
export function parseAntigravityJsonOutput(raw: string): { ok: boolean; text: string; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, text: '', error: 'Antigravity CLI retornou saída vazia.' };
  try {
    const parsed = JSON.parse(trimmed) as { status?: string; response?: string; error?: string };
    if (parsed.status && parsed.status !== 'SUCCESS') {
      return { ok: false, text: parsed.response ?? '', error: parsed.error ?? `Status ${parsed.status}` };
    }
    return { ok: true, text: (parsed.response ?? trimmed).trim() };
  } catch {
    return { ok: true, text: trimmed };
  }
}

export interface ProductionAgentRunInput {
  console: ProductionConsoleService;
  projectId: string;
  jobId?: string;
  runId: string;
  stage: ProductionLogStage;
  label: string;
  prompt: string;
  /**
   * Legacy fixed total timeout. Editorial callers pass `execution` instead; when both are absent the editorial policy
   * (no total limit, 10 min inactivity window) applies.
   */
  timeoutMs?: number;
  /** Long-run supervision. Defaults to `DEFAULT_EDITORIAL_EXECUTION_POLICY`. */
  execution?: AgentExecutionPolicy;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  /**
   * Validates the text recovered from a run that hung after producing output. When it returns true, the partial result
   * is kept and the chain stops there instead of starting the task over on the next provider.
   */
  acceptPartial?: (text: string) => boolean;
}

export interface ProductionAgentRunOutcome {
  providerId: ProductionAgentProviderId;
  /** Text the caller parses (dossier JSON, script JSON, plain answer). */
  text: string;
  ok: boolean;
  durationMs: number;
  failureReason?: string;
  /** Structured failure kind for fallback decisions (skip duplicate backend, cooldown, etc.). */
  failureKind?: ProductionAgentFailureKind;
  /** The output was recovered from a run that hung after producing it (only set when `acceptPartial` approved it). */
  recoveredPartial?: boolean;
  /** How the supervisor last saw the agent. */
  finalState?: AgentActivitySnapshot['state'];
}

/**
 * Executes one provider for real and records everything in the production console: the command, its stdout/stderr as
 * they arrive, and the result. Returns the text the caller should parse, or a failure reason to fall through to the
 * next provider.
 */
export async function runProductionAgentCommand(
  provider: ProductionAgentProvider,
  input: ProductionAgentRunInput,
): Promise<ProductionAgentRunOutcome> {
  const located = provider.locate(input.env);
  if (!located) {
    input.console.emit({
      projectId: input.projectId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      runId: input.runId,
      stage: input.stage,
      origin: 'agent',
      channel: 'result',
      event: 'command_failed',
      severity: 'warn',
      source: provider.id,
      message: `${input.label}: ${provider.label} não encontrado neste computador`,
    });
    return { providerId: provider.id, text: '', ok: false, durationMs: 0, failureReason: 'cli_not_installed' };
  }

  // Provider-level env (e.g. gateway token) is resolved lazily and merged on top of process.env + input.env so each
  // provider can carry its own credentials without leaking them to siblings in the fallback chain.
  const providerEnv = provider.resolveEnv?.() ?? {};
  const mergedEnv = { ...process.env, ...input.env, ...providerEnv };

  const reader = new ClaudeStreamReader();
  const policy = input.execution ?? (input.timeoutMs !== undefined ? null : DEFAULT_EDITORIAL_EXECUTION_POLICY);

  // Own controller per run, linked to the job's signal: the UI can skip this agent without cancelling the production.
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(typeof input.signal?.reason === 'string' ? input.signal.reason : 'cancel');
  if (input.signal?.aborted) onParentAbort();
  else input.signal?.addEventListener('abort', onParentAbort, { once: true });
  const registryInfo: ActiveAgentRun = {
    runId: input.runId,
    projectId: input.projectId,
    ...(input.jobId ? { jobId: input.jobId } : {}),
    stage: input.stage,
    label: input.label,
    providerId: provider.id,
    providerLabel: provider.label,
    startedAt: new Date().toISOString(),
    activity: null,
  };
  activeAgentRuns.set(input.runId, { info: registryInfo, controller });

  let result: Awaited<ReturnType<typeof runInstrumentedCommand>>;
  try {
    result = await runInstrumentedCommand({
      console: input.console,
      projectId: input.projectId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      runId: input.runId,
      stage: input.stage,
      origin: 'agent',
      source: provider.id,
      label: `${input.label} (${provider.label})`,
      command: located.command,
      args: [...located.prefixArgs, ...provider.buildArgs(input.prompt)],
      ...(policy
        ? {
            supervision: {
              inactivityTimeoutMs: policy.inactivityTimeoutMs,
              maxDurationMs: policy.maxDurationMs,
              ...(policy.heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs: policy.heartbeatIntervalMs } : {}),
              ...(policy.silentAfterMs !== undefined ? { silentAfterMs: policy.silentAfterMs } : {}),
              ...(policy.postResultGraceMs !== undefined ? { postResultGraceMs: policy.postResultGraceMs } : {}),
              ...(policy.killGraceMs !== undefined ? { killGraceMs: policy.killGraceMs } : {}),
              describeActivity: (line: CapturedLine) => describeAgentActivity(provider.streamFormat, line),
              isCompletionLine: (line: CapturedLine) => isAgentCompletionLine(provider.streamFormat, line),
              detectFatal: detectDefinitiveFailure,
            },
          }
        : { timeoutMs: input.timeoutMs ?? 120_000 }),
      signal: controller.signal,
      onActivity: (snapshot: AgentActivitySnapshot) => {
        registryInfo.activity = snapshot;
      },
      env: mergedEnv,
      ...(provider.streamFormat === 'claude-stream-json'
        ? {
            // Structured events are whole JSON documents, sometimes long (tool lists, usage); they must reach the
            // parser uncut, and the panel shows the summary instead of the raw blob.
            maxLineChars: 400_000,
            transformLine: (line: { stream: 'stdout' | 'stderr'; text: string }) => {
              if (line.stream !== 'stdout') return clipLine(line.text, 600);
              const activity = reader.handle(line.text);
              // Non-event lines (warnings, plain text) are shown as they are; JSON events become readable summaries.
              return activity ? activity.text : clipLine(line.text, 600);
            },
          }
        : {}),
    });
  } finally {
    input.signal?.removeEventListener('abort', onParentAbort);
    if (activeAgentRuns.get(input.runId)?.controller === controller) activeAgentRuns.delete(input.runId);
  }

  const rawStdout = result.stdout;
  // A run that delivered its result and merely lingered is a success: it is never redone because it was slow.
  let ok =
    !result.spawnError &&
    !result.aborted &&
    !result.fatalReason &&
    (result.completedByResult === true || (result.code === 0 && !result.timedOut && !result.stalled));
  let text: string;
  let failureReason: string | undefined;

  if (provider.streamFormat === 'antigravity-json' && ok) {
    const parsed = parseAntigravityJsonOutput(rawStdout);
    if (!parsed.ok) {
      ok = false;
      failureReason = parsed.error ?? 'resposta inválida do Antigravity';
      text = parsed.text;
    } else {
      text = parsed.text;
    }
  } else if (provider.streamFormat === 'claude-stream-json') {
    text = reader.finalText(rawStdout);
    if (ok && !text.trim()) {
      ok = false;
      failureReason = 'o agente terminou sem texto final';
    }
  } else {
    text = rawStdout;
  }

  if (!ok && !failureReason) {
    // Include stderr tail in the failure reason so classifyProductionAgentFailure can detect quota/auth/rate-limit
    // patterns from the raw CLI output (e.g. "Seu Passe foi encerrado", "credits balance is too low").
    const stderrTail = result.stderr.trim().slice(-500);
    const baseReason = result.spawnError
      ? result.spawnError
      : result.fatalReason
        ? `erro definitivo: ${result.fatalReason}`
        : result.aborted
          ? result.abortReason === 'skip'
            ? 'pulado pelo usuário'
            : 'cancelado'
          : result.stalled
            ? `travamento confirmado: sem progresso real por ${Math.round((result.idleMsAtEnd ?? 0) / 1000)}s`
            : result.timedOut
              ? policy?.maxDurationMs
                ? `tempo máximo de execução de ${Math.round(policy.maxDurationMs / 1000)}s excedido`
                : 'tempo limite excedido'
              : `exit code ${result.code ?? 'desconhecido'}`;
    // Cancellation/skip/stall are the supervisor's verdict; stderr is context, not the cause.
    failureReason = stderrTail && !result.aborted ? `${baseReason} | ${stderrTail}` : baseReason;
  }

  let failureKind = ok ? undefined : classifyProductionAgentFailure(failureReason);
  if (!ok && result.aborted) failureKind = result.abortReason === 'skip' ? 'skipped' : 'cancelled';
  else if (!ok && result.stalled) {
    // A hang caused by an endless retry loop is better described by its cause (rate limit, quota, auth).
    const cause = classifyProductionAgentFailure(result.stderr.trim().slice(-500));
    failureKind = cause === 'rate_limited' || cause === 'quota_exhausted' || cause === 'auth_failed' || cause === 'config_error' ? cause : 'stalled';
  }

  // Confirmed hang after real output: keep what is valid instead of redoing the task elsewhere.
  let recoveredPartial = false;
  if (!ok && (result.stalled || result.timedOut) && text.trim() && input.acceptPartial?.(text)) {
    ok = true;
    recoveredPartial = true;
    failureKind = undefined;
    input.console.emit({
      projectId: input.projectId,
      ...(input.jobId ? { jobId: input.jobId } : {}),
      runId: input.runId,
      stage: input.stage,
      origin: 'agent',
      channel: 'result',
      event: 'log',
      severity: 'warn',
      source: provider.id,
      message: `${input.label}: ${provider.label} travou após produzir um resultado válido — resultado intermediário preservado.`,
      details: { failureReason, textLength: text.length },
    });
    failureReason = undefined;
  }

  return {
    providerId: provider.id,
    text,
    ok,
    durationMs: result.durationMs,
    ...(failureReason ? { failureReason } : {}),
    ...(failureKind ? { failureKind } : {}),
    ...(recoveredPartial ? { recoveredPartial } : {}),
    ...(result.lastActivity ? { finalState: result.lastActivity.state } : {}),
  };
}

/** Providers installed right now, in the order the studio should try them. */
export function availableProductionAgentProviders(
  env: Record<string, string | undefined> = process.env,
): ProductionAgentProvider[] {
  return PRODUCTION_AGENT_PROVIDERS.filter((provider) => provider.locate(env) !== null);
}

/**
 * Builds the fallback chain for a production run, injecting the Claude Gateway between Claude Code CLI and Codex CLI
 * when it is configured and enabled. The gateway reuses the claude binary but with its own endpoint/token, so it only
 * appears when `resolveGatewayEnv` returns non-empty env vars. When two providers share the same backend key (same
 * endpoint + token), the chain keeps both but marks them as duplicates so the caller can skip redundant attempts
 * after quota/auth exhaustion.
 */
export function buildProductionFallbackChain(options: {
  resolveGatewayEnv?: () => Record<string, string | undefined>;
  env?: Record<string, string | undefined>;
}): ProductionAgentProvider[] {
  const baseEnv = options.env ?? process.env;
  const gatewayEnv = options.resolveGatewayEnv?.() ?? {};
  const hasGateway = Boolean(gatewayEnv['ANTHROPIC_BASE_URL'] && gatewayEnv['ANTHROPIC_AUTH_TOKEN']);

  const chain: ProductionAgentProvider[] = [];
  for (const provider of PRODUCTION_AGENT_PROVIDERS) {
    if (provider.id === 'codex-cli' && hasGateway) {
      // Inject gateway before Codex CLI, reusing the claude binary location from the base env.
      const cli = findClientCli('claude', baseEnv);
      if (cli) {
        const gatewayModel = gatewayEnv['ANTHROPIC_MODEL'] ?? 'claude-opus-5-5';
        const gatewayProvider: ProductionAgentProvider = {
          id: 'claude-gateway',
          label: `Claude Gateway (${gatewayModel})`,
          streamFormat: 'claude-stream-json',
          locate: () => ({ command: cli.command, prefixArgs: cli.args }),
          // --tools "" disables built-in tools; --allowedTools "" also removes MCP tools that survive --tools "".
          // Without both, the model sees available tools and emits an introductory "Vou pesquisar..." message instead
          // of generating the JSON directly (stop_reason: end_turn, ~30 tokens). Diagnostic evidence:
          // test-gateway-editorial-fixed.ts with these flags produced 18,452 chars / 4,613 output tokens / 10 entities.
          buildArgs: (prompt) => ['-p', '--output-format', 'stream-json', '--verbose', '--tools', '', '--allowedTools', '', '--model', gatewayModel, prompt],
          ...(options.resolveGatewayEnv ? { resolveEnv: options.resolveGatewayEnv } : {}),
          backendKey: () => {
            const baseUrl = gatewayEnv['ANTHROPIC_BASE_URL'];
            const token = gatewayEnv['ANTHROPIC_AUTH_TOKEN'];
            return baseUrl && token ? `claude:${baseUrl}` : null;
          },
        };
        chain.push(gatewayProvider);
      }
    }
    // Skip the static claude-cli entry when gateway is active and shares the same backend — the gateway entry
    // already covers that backend with its own credentials. When they differ (different base URL), keep both.
    if (provider.id === 'claude-cli' && hasGateway) {
      const cliBackend = provider.backendKey?.(baseEnv);
      const gwBackend = gatewayEnv['ANTHROPIC_BASE_URL'] && gatewayEnv['ANTHROPIC_AUTH_TOKEN']
        ? `claude:${gatewayEnv['ANTHROPIC_BASE_URL']}`
        : null;
      if (cliBackend && cliBackend === gwBackend) continue;
    }
    chain.push(provider);
  }

  return chain.filter((provider) => provider.locate(baseEnv) !== null || provider.id === 'claude-gateway');
}

/**
 * Persistent record of backend failures across runs within the same process lifetime. When a production is resumed
 * after being paused (e.g. `paused_pending_research`), the in-memory `exhaustedBackends` set inside
 * `runProductionAgentWithFallback` is gone, so Antigravity/Claude Code get retried even though they just failed with
 * quota exhaustion. This map survives across calls so resumed productions skip backends that are known-exhausted
 * until their cooldown expires.
 */
const backendFailureState = new Map<string, { kind: ProductionAgentFailureKind; at: number }>();

/** Cooldown for quota/auth failures: 10 minutes. Rate limits use a shorter window (60s) because they are transient. */
const BACKEND_COOLDOWN_MS: Record<string, number> = {
  quota_exhausted: 10 * 60 * 1000,
  auth_failed: 10 * 60 * 1000,
  config_error: 10 * 60 * 1000,
  rate_limited: 60 * 1000,
};

function isBackendInCooldown(backendKey: string, now: number): boolean {
  const state = backendFailureState.get(backendKey);
  if (!state) return false;
  const cooldown = BACKEND_COOLDOWN_MS[state.kind] ?? 60_000;
  if (now - state.at < cooldown) return true;
  // Cooldown expired — clear the entry so the backend can be retried.
  backendFailureState.delete(backendKey);
  return false;
}

function recordBackendFailure(backendKey: string, kind: ProductionAgentFailureKind): void {
  backendFailureState.set(backendKey, { kind, at: Date.now() });
}

/** Exposed for tests: clears all recorded backend failures so each test starts with a clean slate. */
export function resetBackendFailureState(): void {
  backendFailureState.clear();
}

/**
 * Runs the fallback chain end-to-end, logging each attempt and fallback decision to the production console. Returns
 * the first successful outcome, or null when every provider failed. Skips duplicate backends after quota/auth errors
 * to avoid redundant attempts that would hit the same limit, both within a single run (in-memory set) and across
 * resumed runs (persistent map with cooldown).
 */
export async function runProductionAgentWithFallback(
  chain: ProductionAgentProvider[],
  input: ProductionAgentRunInput,
): Promise<{ outcome: ProductionAgentRunOutcome; provider: ProductionAgentProvider } | null> {
  const exhaustedBackends = new Set<string>();
  let lastOutcome: ProductionAgentRunOutcome | null = null;
  const now = Date.now();

  for (let i = 0; i < chain.length; i++) {
    // A cancelled production stops the chain: no new agent is started for a job the user ended.
    if (input.signal?.aborted) break;
    const provider = chain[i];
    if (!provider) continue;
    const backendKey = provider.backendKey?.(input.env) ?? null;

    // Skip providers that share a backend already exhausted by a previous attempt, either within this run
    // (in-memory set) or across resumed runs (persistent map with cooldown). This prevents the exact scenario
    // where Antigravity and Claude Code are retried on resume despite having just failed with quota exhaustion.
    if (backendKey && (exhaustedBackends.has(backendKey) || isBackendInCooldown(backendKey, now))) {
      input.console.emit({
        projectId: input.projectId,
        ...(input.jobId ? { jobId: input.jobId } : {}),
        runId: input.runId,
        stage: input.stage,
        origin: 'agent',
        channel: 'progress',
        event: 'log',
        severity: 'warn',
        source: 'fallback-chain',
        message: `[Fallback] ${provider.label} ignorado: backend em cooldown após falha recente.`,
        details: { backendKey, skippedProvider: provider.id },
      });
      continue;
    }

    const outcome = await runProductionAgentCommand(provider, input);
    lastOutcome = outcome;

    if (outcome.ok) {
      return { outcome, provider };
    }

    // Mark backend as exhausted for quota/auth/rate_limit failures so subsequent duplicates are skipped
    // within this run AND across resumed runs (persistent map survives process lifetime).
    if (outcome.failureKind === 'cancelled' && input.signal?.aborted) break;
    if (
      backendKey &&
      outcome.failureKind &&
      outcome.failureKind !== 'unknown' &&
      outcome.failureKind !== 'cancelled' &&
      outcome.failureKind !== 'skipped'
    ) {
      exhaustedBackends.add(backendKey);
      recordBackendFailure(backendKey, outcome.failureKind);
    }

    // Log fallback decision when there is a next provider to try.
    const nextProvider = chain[i + 1];
    if (nextProvider) {
      const reasonLabel = outcome.failureKind === 'quota_exhausted'
        ? 'quota esgotada'
        : outcome.failureKind === 'rate_limited'
          ? 'rate limit temporário'
          : outcome.failureKind === 'auth_failed'
            ? 'falha de autenticação'
            : outcome.failureKind === 'config_error'
              ? 'erro de configuração'
              : outcome.failureKind === 'stalled'
                ? 'travamento confirmado'
                : outcome.failureKind === 'skipped'
                  ? 'pulado pelo usuário'
                  : outcome.failureReason ?? 'falha desconhecida';
      input.console.emit({
        projectId: input.projectId,
        ...(input.jobId ? { jobId: input.jobId } : {}),
        runId: input.runId,
        stage: input.stage,
        origin: 'agent',
        channel: 'progress',
        event: 'stage_retry',
        severity: 'warn',
        source: 'fallback-chain',
        message: `[Fallback] ${provider.label} indisponível (${reasonLabel}). Tentando ${nextProvider.label}...`,
        details: {
          failedProvider: provider.id,
          failureKind: outcome.failureKind,
          failureReason: outcome.failureReason,
          nextProvider: nextProvider.id,
          durationMs: outcome.durationMs,
          ...(backendKey ? { backendKey } : {}),
        },
      });
    }
  }

  const lastProvider = chain[chain.length - 1];
 return lastOutcome && lastProvider ? { outcome: lastOutcome, provider: lastProvider } : null;
}

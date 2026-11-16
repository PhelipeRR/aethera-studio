import { findClientCli } from '@neuralbridge/workspace';
import { findAntigravityCli } from './antigravity-cli.js';
import type { ProductionConsoleService, ProductionLogStage } from './production-console.js';
import { ClaudeStreamReader, clipLine, runInstrumentedCommand } from './production-agent-runner.js';

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
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'cancelled'
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
  if (lower.includes('cli_not_installed') || lower.includes('not found') || lower.includes('enoent')) return 'cli_not_installed';
  if (lower.includes('cancelado') || lower.includes('aborted')) return 'cancelled';
  if (lower.includes('tempo limite') || lower.includes('timed out') || lower.includes('timeout')) return 'timeout';
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
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
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
  const result = await runInstrumentedCommand({
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
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
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

  const rawStdout = result.stdout;
  let ok = result.code === 0 && !result.timedOut && !result.aborted && !result.spawnError;
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
    const baseReason = result.timedOut
      ? 'tempo limite excedido'
      : result.aborted
        ? 'cancelado'
        : result.spawnError
          ? result.spawnError
          : `exit code ${result.code ?? 'desconhecido'}`;
    failureReason = stderrTail ? `${baseReason} | ${stderrTail}` : baseReason;
  }

  const failureKind = ok ? undefined : classifyProductionAgentFailure(failureReason);

  return {
    providerId: provider.id,
    text,
    ok,
    durationMs: result.durationMs,
    ...(failureReason ? { failureReason } : {}),
    ...(failureKind ? { failureKind } : {}),
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
    if (backendKey && outcome.failureKind && outcome.failureKind !== 'unknown' && outcome.failureKind !== 'cancelled') {
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

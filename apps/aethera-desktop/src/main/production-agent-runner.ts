import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import type { ProductionConsoleService, ProductionLogOrigin, ProductionLogStage } from './production-console.js';

// ─── Process tree management ─────────────────────────────────────────────────

/** Pids of every command started by `captureCommand` that has not exited yet. */
const liveProcessTrees = new Set<number>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  // Last line of defence against orphans: if the app exits while an agent runs, its whole tree goes with it.
  process.once('exit', () => killAllTrackedProcessTrees());
}

/**
 * Ends a process and every process it started. A CLI agent (claude, codex, agy) spawns its own children — node
 * workers, MCP servers, shells — and killing only the launcher would leave them running.
 * Windows: `taskkill /T /F` walks the tree. POSIX: the child is a process-group leader (spawned `detached`), so the
 * whole group receives the signal.
 */
export function killProcessTree(pid: number, signal: NodeJS.Signals = 'SIGTERM', options: { sync?: boolean } = {}): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/T', '/F'];
    try {
      if (options.sync) {
        spawnSync('taskkill', args, { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      } else {
        const killer = spawn('taskkill', args, { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => undefined);
      }
    } catch {
      // taskkill unavailable: fall back to the direct pid
      try {
        process.kill(pid, signal);
      } catch {
        // already gone
      }
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/** Kills every process tree still tracked. Synchronous so it can run from `process.on('exit')` and `will-quit`. */
export function killAllTrackedProcessTrees(): number {
  const pids = [...liveProcessTrees];
  for (const pid of pids) killProcessTree(pid, 'SIGKILL', { sync: true });
  liveProcessTrees.clear();
  return pids.length;
}

/** Exposed for tests: pids of trees that are still running. */
export function trackedProcessTreeCount(): number {
  return liveProcessTrees.size;
}

// ─── Activity supervision ────────────────────────────────────────────────────

/**
 * Health of a long-running agent, as the supervisor sees it.
 * - `active`: real progress recently.
 * - `silent`: alive, no new progress for a while — normal for an agent that is reasoning without emitting events.
 * - `stalled`: no real progress for the whole inactivity window; the tree was ended.
 */
export type AgentRunState =
  | 'starting'
  | 'active'
  | 'silent'
  | 'stalled'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface AgentActivitySnapshot {
  state: AgentRunState;
  pid: number | null;
  startedAt: string;
  elapsedMs: number;
  /** Last line of any kind (progress or repetition). */
  lastEventAt: string | null;
  lastEventSummary: string | null;
  /** Last line that counted as real progress. */
  lastProgressAt: string | null;
  /** Time since the last real progress (or since start). */
  idleMs: number;
  progressEvents: number;
  repeatedEvents: number;
  resultReceived: boolean;
  inactivityTimeoutMs: number | null;
  maxDurationMs: number | null;
}

/**
 * How a line counts for the supervisor. `key` identifies the content for repetition detection (the same key seen
 * recently is a repetition, not progress); `kind: 'noise'` forces a line to never count as progress (retry banners,
 * spinners). Returning null ignores the line for activity purposes.
 */
export interface LineActivity {
  key: string;
  summary: string;
  kind?: 'progress' | 'noise';
  /**
   * Compare `key` as is instead of normalizing numbers away. Use for structured events whose numbers are content
   * (tool inputs, page ids); free text keeps the normalization so "attempt 3" ≡ "attempt 4".
   */
  exact?: boolean;
}

const REPETITION_WINDOW = 24;

/** Same text modulo numbers/timestamps/whitespace: "Retrying in 5s (attempt 3)" ≡ "Retrying in 9s (attempt 4)". */
export function normalizeActivityKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>')
    .replace(/[⠀-⣿◐◓◑◒|/\\]/g, ' ')
    .replace(/\d+([.,:]\d+)*/g, '#')
    .replace(/[\s.…·•|\-_=*~^]+/g, ' ')
    .trim();
}

export type CommandStream = 'stdout' | 'stderr';

export interface CapturedLine {
  stream: CommandStream;
  text: string;
  /** ISO timestamp of the moment the line was read, not of the process exit. */
  at: string;
}

export interface CommandCaptureResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** The optional hard ceiling (`maxDurationMs`/`timeoutMs`) was reached. */
  timedOut: boolean;
  aborted: boolean;
  /** No real progress for the whole inactivity window: hang confirmed, tree ended. */
  stalled: boolean;
  /** A definitive error (auth, quota, configuration) was detected while running; the tree was ended at once. */
  fatalReason?: string;
  /** The agent delivered its final result; true even when the tree had to be ended after it lingered. */
  resultReceived: boolean;
  /** The process did not exit by itself after its result and was ended by the supervisor. */
  completedByResult: boolean;
  /** Abort reason passed to `AbortController.abort(reason)` when it was a string (e.g. `skip`). */
  abortReason?: string;
  /** Time without real progress when the process ended. */
  idleMsAtEnd: number;
  lastActivity: AgentActivitySnapshot;
  /** Lines read from both streams, before the streaming cap. */
  lineCount: number;
  /** True when the streaming cap stopped lines from reaching the console; capture itself keeps going. */
  streamTruncated: boolean;
  /** True when a whole stream exceeded `maxCaptureBytes` and was cut. */
  captureTruncated: boolean;
  spawnError?: string;
}

export interface CaptureCommandOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Legacy alias of `maxDurationMs`. When neither is given and no `inactivityTimeoutMs` is set, the historical default
   * of 120 s applies so short tool calls keep their old behaviour.
   */
  timeoutMs?: number;
  /** Hard ceiling for the whole run. `null` or `0` disables it (the default for editorial agents). */
  maxDurationMs?: number | null;
  /**
   * Ends the run only after this long WITHOUT REAL PROGRESS. Silence is tolerated for the whole window (an agent may be
   * reasoning without emitting anything); repeated lines with no new content do not reset the clock.
   */
  inactivityTimeoutMs?: number | null;
  /** After this long without progress the state becomes `silent` (informational only). Default 30 s. */
  silentAfterMs?: number;
  /** How often `onActivity` reports while the process runs. Default 15 s. */
  heartbeatIntervalMs?: number;
  /** Once `isCompletionLine` matched, how long the process may linger before its tree is ended. Default 30 s. */
  postResultGraceMs?: number;
  /** SIGTERM → SIGKILL escalation on POSIX. Default 5 s. */
  killGraceMs?: number;
  signal?: AbortSignal;
  /** Per stream. Default 4 MB. */
  maxCaptureBytes?: number;
  /** Default 1600 characters. */
  maxLineChars?: number;
  /** Lines forwarded to `onLine`; further lines only count. Default 500. */
  maxStreamedLines?: number;
  onLine?: (line: CapturedLine) => void;
  /** Describes how a line counts for activity. Default: every non-empty line, keyed by its normalized text. */
  describeActivity?: (line: CapturedLine) => LineActivity | null;
  /** True for the line that carries the final answer (e.g. Claude's `result` event). */
  isCompletionLine?: (line: CapturedLine) => boolean;
  /** Returns a reason when the line proves a definitive failure (auth, quota, configuration). */
  detectFatal?: (line: CapturedLine) => string | null;
  /** Heartbeats and state transitions. */
  onActivity?: (snapshot: AgentActivitySnapshot) => void;
}

function resolveMaxDuration(options: CaptureCommandOptions): number | null {
  if (options.maxDurationMs !== undefined) return options.maxDurationMs && options.maxDurationMs > 0 ? options.maxDurationMs : null;
  if (options.timeoutMs !== undefined) return options.timeoutMs > 0 ? options.timeoutMs : null;
  return options.inactivityTimeoutMs ? null : 120_000;
}

/**
 * Runs a command without a shell, capturing both streams and forwarding each complete line as it arrives, so the
 * console shows real output while the process is still running. Never throws for a non-zero exit: the caller decides.
 *
 * Long runs are supervised by activity, not by a fixed clock: the run ends on confirmed inactivity (no real progress for
 * `inactivityTimeoutMs`), on a definitive error, on cancellation, or on the optional `maxDurationMs`. Every way out ends
 * the whole process tree.
 */
export function captureCommand(options: CaptureCommandOptions): Promise<CommandCaptureResult> {
  const maxCaptureBytes = options.maxCaptureBytes ?? 4 * 1024 * 1024;
  const maxLineChars = options.maxLineChars ?? 1600;
  const maxStreamedLines = options.maxStreamedLines ?? 500;
  const maxDurationMs = resolveMaxDuration(options);
  const inactivityTimeoutMs = options.inactivityTimeoutMs && options.inactivityTimeoutMs > 0 ? options.inactivityTimeoutMs : null;
  const silentAfterMs = Math.max(1, options.silentAfterMs ?? 30_000);
  const heartbeatIntervalMs = Math.max(10, options.heartbeatIntervalMs ?? 15_000);
  const postResultGraceMs = Math.max(0, options.postResultGraceMs ?? 30_000);
  const killGraceMs = Math.max(10, options.killGraceMs ?? 5000);
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(options.command);
  installExitHook();

  return new Promise<CommandCaptureResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let captureTruncated = false;
    let streamedLines = 0;
    let lineCount = 0;
    let streamTruncated = false;
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let stalled = false;
    let fatalReason: string | undefined;
    let abortReason: string | undefined;
    let resultReceived = false;
    let completedByResult = false;
    let spawnError: string | undefined;
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;
    let killRequested = false;
    const pending: Record<CommandStream, string> = { stdout: '', stderr: '' };

    // Activity bookkeeping.
    let lastProgressAt = startedAt;
    let sawProgress = false;
    let lastEventAt: number | null = null;
    let lastEventSummary: string | null = null;
    let progressEvents = 0;
    let repeatedEvents = 0;
    const recentKeys: string[] = [];
    let state: AgentRunState = 'starting';

    const snapshot = (): AgentActivitySnapshot => {
      const now = Date.now();
      return {
        state,
        pid: child.pid ?? null,
        startedAt: startedIso,
        elapsedMs: now - startedAt,
        lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
        lastEventSummary,
        lastProgressAt: sawProgress ? new Date(lastProgressAt).toISOString() : null,
        idleMs: now - lastProgressAt,
        progressEvents,
        repeatedEvents,
        resultReceived,
        inactivityTimeoutMs,
        maxDurationMs,
      };
    };

    const setState = (next: AgentRunState) => {
      if (state === next) return;
      state = next;
      try {
        options.onActivity?.(snapshot());
      } catch {
        // observers never break the run
      }
    };

    let child: ChildProcess;
    try {
      child = spawn(options.command, options.args, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        env: options.env ?? process.env,
        windowsHide: true,
        shell,
        // POSIX: own process group, so the whole tree can be signalled at once. Windows uses taskkill /T instead.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: 0,
        timedOut: false,
        aborted: false,
        stalled: false,
        resultReceived: false,
        completedByResult: false,
        idleMsAtEnd: 0,
        lastActivity: {
          state: 'failed',
          pid: null,
          startedAt: startedIso,
          elapsedMs: 0,
          lastEventAt: null,
          lastEventSummary: null,
          lastProgressAt: null,
          idleMs: 0,
          progressEvents: 0,
          repeatedEvents: 0,
          resultReceived: false,
          inactivityTimeoutMs,
          maxDurationMs,
        },
        lineCount: 0,
        streamTruncated: false,
        captureTruncated: false,
        spawnError: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const pid = child.pid;
    if (pid) liveProcessTrees.add(pid);

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const intervals: Array<ReturnType<typeof setInterval>> = [];

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      for (const interval of intervals) clearInterval(interval);
      options.signal?.removeEventListener('abort', onAbort);
      if (pid) liveProcessTrees.delete(pid);
      for (const stream of ['stdout', 'stderr'] as CommandStream[]) {
        const rest = pending[stream].trim();
        if (rest) handleLine(stream, rest);
        pending[stream] = '';
      }
      const finalState: AgentRunState = aborted
        ? 'cancelled'
        : stalled
          ? 'stalled'
          : timedOut
            ? 'timed_out'
            : resultReceived || (code === 0 && !fatalReason && !spawnError)
              ? 'completed'
              : 'failed';
      setState(finalState);
      resolve({
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        stalled,
        ...(fatalReason ? { fatalReason } : {}),
        resultReceived,
        completedByResult,
        ...(abortReason ? { abortReason } : {}),
        idleMsAtEnd: Date.now() - lastProgressAt,
        lastActivity: snapshot(),
        lineCount,
        streamTruncated,
        captureTruncated,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    /** Ends the tree; escalates to SIGKILL; resolves even if the pipes never close (a grandchild holding them). */
    const killTree = () => {
      if (killRequested) return;
      killRequested = true;
      if (pid) {
        if (!exitInfo || process.platform !== 'win32') killProcessTree(pid, 'SIGTERM');
      } else {
        try {
          child.kill('SIGTERM');
        } catch {
          // already gone
        }
      }
      timers.push(
        setTimeout(() => {
          if (settled) return;
          // Windows reuses pids quickly: never signal a pid whose process already exited.
          if (pid && (!exitInfo || process.platform !== 'win32')) killProcessTree(pid, 'SIGKILL');
          timers.push(
            setTimeout(() => {
              // Pipes still open after the kill: report with what we have instead of hanging the pipeline.
              finish(exitInfo?.code ?? null, exitInfo?.signal ?? 'SIGKILL');
            }, killGraceMs),
          );
        }, killGraceMs),
      );
    };

    const forward = (line: CapturedLine) => {
      if (streamedLines >= maxStreamedLines) {
        streamTruncated = true;
        return;
      }
      streamedLines += 1;
      options.onLine?.(line);
    };

    const noteActivity = (line: CapturedLine) => {
      let activity: LineActivity | null;
      try {
        activity = options.describeActivity
          ? options.describeActivity(line)
          : { key: line.text, summary: clipLine(line.text.trim(), 200) };
      } catch {
        activity = { key: line.text, summary: clipLine(line.text.trim(), 200) };
      }
      if (!activity) return;
      const now = Date.now();
      lastEventAt = now;
      lastEventSummary = clipLine(activity.summary, 240);
      const key = activity.exact ? activity.key.trim() : normalizeActivityKey(activity.key);
      const repeated = activity.kind === 'noise' || !key || recentKeys.includes(key);
      if (key) {
        recentKeys.push(key);
        if (recentKeys.length > REPETITION_WINDOW) recentKeys.shift();
      }
      if (repeated) {
        repeatedEvents += 1;
        return;
      }
      progressEvents += 1;
      sawProgress = true;
      lastProgressAt = now;
      if (!resultReceived) setState('active');
    };

    const handleLine = (stream: CommandStream, rawText: string) => {
      lineCount += 1;
      const line: CapturedLine = { stream, text: clipLine(rawText, maxLineChars), at: new Date().toISOString() };
      forward(line);
      noteActivity(line);
      if (!resultReceived && options.isCompletionLine?.(line)) {
        resultReceived = true;
        setState('completed');
        if (!settled && !exitInfo) {
          timers.push(
            setTimeout(() => {
              if (settled || exitInfo) return;
              completedByResult = true;
              killTree();
            }, postResultGraceMs),
          );
        }
      }
      if (!fatalReason && !resultReceived && options.detectFatal) {
        const reason = options.detectFatal(line);
        if (reason) {
          fatalReason = reason;
          setState('failed');
          killTree();
        }
      }
    };

    const collect = (stream: CommandStream, chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const used = stream === 'stdout' ? stdoutBytes : stderrBytes;
      const room = maxCaptureBytes - used;
      if (room <= 0) {
        captureTruncated = true;
      } else {
        const piece = text.length > room ? text.slice(0, room) : text;
        if (piece.length < text.length) captureTruncated = true;
        if (stream === 'stdout') {
          stdout += piece;
          stdoutBytes += piece.length;
        } else {
          stderr += piece;
          stderrBytes += piece.length;
        }
      }
      pending[stream] += text;
      const lines = pending[stream].split(/\r?\n/);
      pending[stream] = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) handleLine(stream, line);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect('stderr', chunk));

    if (maxDurationMs !== null) {
      timers.push(
        setTimeout(() => {
          if (settled || resultReceived) return;
          timedOut = true;
          setState('timed_out');
          killTree();
        }, maxDurationMs),
      );
    }

    // Supervision tick: silence is only informational until the inactivity window closes.
    const tickMs = Math.max(10, Math.min(1000, Math.floor((inactivityTimeoutMs ?? silentAfterMs) / 10)));
    intervals.push(
      setInterval(() => {
        if (settled || killRequested || resultReceived) return;
        const idle = Date.now() - lastProgressAt;
        if (inactivityTimeoutMs !== null && idle >= inactivityTimeoutMs) {
          stalled = true;
          setState('stalled');
          killTree();
          return;
        }
        if (idle >= silentAfterMs && (state === 'active' || state === 'starting')) setState('silent');
      }, tickMs),
    );
    if (options.onActivity) {
      intervals.push(
        setInterval(() => {
          if (settled) return;
          try {
            options.onActivity?.(snapshot());
          } catch {
            // observers never break the run
          }
        }, heartbeatIntervalMs),
      );
    }

    const onAbort = () => {
      if (settled) return;
      aborted = true;
      const reason = options.signal?.reason as unknown;
      if (typeof reason === 'string') abortReason = reason;
      setState('cancelled');
      killTree();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    child.on('error', (error: Error) => {
      spawnError = error.message;
      finish(null, null);
    });
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      exitInfo = { code, signal };
      if (pid) liveProcessTrees.delete(pid);
      // Grandchildren may keep the pipes open: give them a moment to flush, then end the tree and report.
      timers.push(
        setTimeout(() => {
          if (settled) return;
          // POSIX: the group outlives its leader, so stragglers can still be reached. Windows: never signal a dead
          // pid (it may already belong to another process).
          if (pid && process.platform !== 'win32') killProcessTree(pid, 'SIGKILL');
          finish(code, signal);
        }, killGraceMs),
      );
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => finish(code ?? exitInfo?.code ?? null, signal ?? exitInfo?.signal ?? null));
  });
}

/** Removes ANSI colour codes CLIs use on stderr, which would otherwise show as `[1m` noise in the panel. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

export function clipLine(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…(+${text.length - maxChars} chars)`;
}

/** Arguments are echoed in the console; long ones (prompts) are cut instead of filling the panel. */
export function previewArgument(argument: string, maxChars = 220): string {
  if (argument.length <= maxChars) return argument;
  return `${argument.slice(0, maxChars)}…(+${argument.length - maxChars} chars)`;
}

export function buildCommandPreview(command: string, args: string[], maxChars = 220): string {
  return [command, ...args.map((arg) => previewArgument(arg, maxChars))].join(' ');
}

const SENSITIVE_FLAG = /^--?(api[-_]?key|apikey|token|secret|password|passwd|auth|authorization|access[-_]?key|private[-_]?key|key)(=|$)/i;

/**
 * Argument list as it should appear in the console: long values are cut and the value that follows a sensitive flag
 * (`--api-key`, `--token`, `--password`, …) is masked, even when it does not look like a known credential shape.
 */
export function previewArguments(args: string[]): string[] {
  return args.map((arg, index) => {
    const previous = index > 0 ? args[index - 1] : undefined;
    if (previous && SENSITIVE_FLAG.test(previous)) return '[REDACTED]';
    const inline = /^(--?[a-z0-9-]+)=(.+)$/i.exec(arg);
    if (inline && inline[1] && SENSITIVE_FLAG.test(inline[1]) && inline[2]) return `${inline[1]}=[REDACTED]`;
    return previewArgument(arg);
  });
}

export interface InstrumentedCommandOptions {
  console: ProductionConsoleService;
  projectId: string;
  jobId?: string;
  runId: string;
  stage: ProductionLogStage;
  origin: ProductionLogOrigin;
  source: string;
  /** Human label shown before the command, e.g. "Pesquisa editorial". */
  label: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Legacy hard ceiling; see `CaptureCommandOptions.timeoutMs`. */
  timeoutMs?: number;
  /** Activity supervision (inactivity window, optional ceiling, heartbeat). See `CaptureCommandOptions`. */
  supervision?: Pick<
    CaptureCommandOptions,
    | 'maxDurationMs'
    | 'inactivityTimeoutMs'
    | 'silentAfterMs'
    | 'heartbeatIntervalMs'
    | 'postResultGraceMs'
    | 'killGraceMs'
    | 'describeActivity'
    | 'isCompletionLine'
    | 'detectFatal'
  >;
  /** Extra observer of heartbeats/state changes (the console already records them). */
  onActivity?: (snapshot: AgentActivitySnapshot) => void;
  signal?: AbortSignal;
  maxStreamedLines?: number;
  maxLineChars?: number;
  maxCaptureBytes?: number;
  /**
   * Rewrites the text of each captured line before it reaches the console. Returning `null` hides the line (e.g. raw
   * JSON of a structured stream already summarized); the capture itself is unaffected.
   */
  transformLine?: (line: CapturedLine) => string | null;
}

/**
 * Runs one real command and records it in the production console: the command line, every stdout/stderr line while it
 * runs, and the outcome with exit code and duration. Nothing here is synthesized — the pipeline calls this only where a
 * CLI is actually executed.
 */
export async function runInstrumentedCommand(options: InstrumentedCommandOptions): Promise<CommandCaptureResult> {
  const { console: consoleService } = options;
  const base = {
    projectId: options.projectId,
    ...(options.jobId ? { jobId: options.jobId } : {}),
    runId: options.runId,
    stage: options.stage,
    origin: options.origin,
    source: options.source,
  };

  consoleService.emit({
    ...base,
    channel: 'command',
    event: 'command_started',
    severity: 'info',
    message: `${options.label}: ${options.source} iniciado`,
    details: {
      command: options.command,
      args: previewArguments(options.args),
      argCount: options.args.length,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      promptChars: options.args.reduce((total, arg) => total + arg.length, 0),
    },
  });

  // Heartbeats tell the UI the agent is alive (elapsed time, last event, state) without waiting for output.
  const heartbeatEvery = Math.max(10, (options.supervision?.heartbeatIntervalMs ?? 15_000) - 5);
  let lastHeartbeatAt = 0;
  let lastReportedState: AgentRunState | null = null;
  const emitHeartbeat = (snapshot: AgentActivitySnapshot) => {
    const idleSec = Math.round(snapshot.idleMs / 1000);
    consoleService.emit({
      ...base,
      channel: 'progress',
      event: 'agent_heartbeat',
      severity: snapshot.state === 'stalled' || snapshot.state === 'timed_out' ? 'warn' : 'debug',
      message: `${options.label}: ${AGENT_STATE_LABELS[snapshot.state]} · ${formatElapsed(snapshot.elapsedMs)}${
        snapshot.state === 'silent' ? ` · sem eventos novos há ${idleSec}s` : ''
      }`,
      details: { ...snapshot },
    });
  };

  const result = await captureCommand({
    command: options.command,
    args: options.args,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...supervisionWithCleanLines(options.supervision),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.maxStreamedLines !== undefined ? { maxStreamedLines: options.maxStreamedLines } : {}),
    ...(options.maxLineChars !== undefined ? { maxLineChars: options.maxLineChars } : {}),
    ...(options.maxCaptureBytes !== undefined ? { maxCaptureBytes: options.maxCaptureBytes } : {}),
    onActivity: (snapshot) => {
      if (snapshot.state !== lastReportedState || Date.now() - lastHeartbeatAt >= heartbeatEvery) {
        lastReportedState = snapshot.state;
        lastHeartbeatAt = Date.now();
        emitHeartbeat(snapshot);
      }
      options.onActivity?.(snapshot);
    },
    onLine: (rawLine) => {
      const line = { ...rawLine, text: stripAnsi(rawLine.text) };
      const text = options.transformLine ? options.transformLine(line) : line.text;
      if (text === null) return;
      consoleService.emit({
        ...base,
        channel: line.stream,
        severity: 'debug',
        message: text,
      });
    },
  });

  if (result.streamTruncated) {
    consoleService.emit({
      ...base,
      channel: 'progress',
      severity: 'debug',
      message: `Saída de ${options.source} excedeu o limite de linhas exibidas; o restante continua sendo capturado internamente.`,
      details: { streamedLines: options.maxStreamedLines ?? 500, totalLines: result.lineCount },
    });
  }

  const ok = captureSucceeded(result);
  const failureReason = describeCaptureFailure(result);

  consoleService.emit({
    ...base,
    channel: 'result',
    event: ok ? 'command_completed' : 'command_failed',
    severity: ok ? 'info' : 'error',
    message: ok
      ? `${options.label}: ${options.source} concluído com sucesso`
      : `${options.label}: ${options.source} falhou (${failureReason})`,
    durationMs: result.durationMs,
    exitCode: result.code,
    details: {
      ...(ok ? {} : { failureReason }),
      stdoutTail: tail(result.stdout, 2000),
      stderrTail: tail(result.stderr, 4000),
      lineCount: result.lineCount,
      streamTruncated: result.streamTruncated,
      captureTruncated: result.captureTruncated,
      ...(result.timedOut ? { timedOut: true } : {}),
      ...(result.stalled ? { stalled: true, idleMsAtEnd: result.idleMsAtEnd } : {}),
      ...(result.fatalReason ? { fatalReason: result.fatalReason } : {}),
      ...(result.completedByResult ? { completedByResult: true } : {}),
      ...(result.spawnError ? { spawnError: result.spawnError } : {}),
      agentState: result.lastActivity.state,
      lastEventSummary: result.lastActivity.lastEventSummary,
    },
  });

  return result;
}

export const AGENT_STATE_LABELS: Record<AgentRunState, string> = {
  starting: 'iniciando',
  active: 'ativo',
  silent: 'raciocinando (silencioso)',
  stalled: 'travamento confirmado',
  completed: 'concluído',
  failed: 'falhou',
  cancelled: 'cancelado',
  timed_out: 'tempo máximo excedido',
};

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

/**
 * A run succeeded when it exited cleanly, or when it delivered its final result and only lingered afterwards (the
 * supervisor ended it). A long run that finished is never treated as a failure because it took long.
 */
export function captureSucceeded(result: CommandCaptureResult): boolean {
  if (result.spawnError || result.aborted || result.fatalReason) return false;
  if (result.completedByResult) return true;
  return result.code === 0 && !result.timedOut && !result.stalled;
}

export function describeCaptureFailure(result: CommandCaptureResult): string {
  if (result.spawnError) return result.spawnError;
  if (result.fatalReason) return `erro definitivo: ${result.fatalReason}`;
  if (result.aborted) return result.abortReason === 'skip' ? 'pulado pelo usuário' : 'cancelado';
  if (result.stalled) return `travamento confirmado: sem progresso real por ${Math.round(result.idleMsAtEnd / 1000)}s`;
  if (result.timedOut) {
    const max = result.lastActivity.maxDurationMs;
    return `tempo máximo de execução de ${Math.round((max ?? 0) / 1000)}s excedido`;
  }
  if (result.code === null) return `encerrado por sinal ${result.signal ?? 'desconhecido'}`;
  return `exit code ${result.code}`;
}

function supervisionWithCleanLines(
  supervision: InstrumentedCommandOptions['supervision'],
): Partial<CaptureCommandOptions> {
  if (!supervision) return {};
  const clean = (line: CapturedLine): CapturedLine => ({ ...line, text: stripAnsi(line.text) });
  const { describeActivity, isCompletionLine, detectFatal, ...timing } = supervision;
  return {
    ...timing,
    ...(describeActivity ? { describeActivity: (line: CapturedLine) => describeActivity(clean(line)) } : {}),
    ...(isCompletionLine ? { isCompletionLine: (line: CapturedLine) => isCompletionLine(clean(line)) } : {}),
    ...(detectFatal ? { detectFatal: (line: CapturedLine) => detectFatal(clean(line)) } : {}),
  };
}

export function tail(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `…${trimmed.slice(-maxChars)}`;
}

export interface ClaudeStreamActivity {
  /** Line to show in the console. */
  text: string;
  /** Final answer extracted from the `result` event, when present. */
  finalText?: string;
  /** Raw assistant text, used as a fallback when the run ends without a `result` event. */
  assistantText?: string;
}

/**
 * Reads one JSON line of `claude --output-format stream-json`. Claude Code emits system/assistant/user/result events;
 * the console shows what really happened (tools the agent called, text it produced) instead of the raw JSON blob.
 */
export function readClaudeStreamLine(line: string): ClaudeStreamActivity | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = typeof parsed['type'] === 'string' ? (parsed['type'] as string) : '';
  if (type === 'result') {
    const resultText = typeof parsed['result'] === 'string' ? (parsed['result'] as string) : '';
    const subtype = typeof parsed['subtype'] === 'string' ? parsed['subtype'] : 'result';
    const isError = parsed['is_error'] === true || subtype !== 'success';
    return {
      text: `resultado do agente (${subtype})${isError ? ' — erro' : ''}`,
      finalText: resultText,
    };
  }
  if (type === 'assistant') {
    const message = parsed['message'] as { content?: Array<Record<string, unknown>> } | undefined;
    const blocks = Array.isArray(message?.content) ? message.content : [];
    const parts: string[] = [];
    const rawTexts: string[] = [];
    for (const block of blocks) {
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        rawTexts.push(block['text']);
        parts.push(`texto: ${clipLine(block['text'].replace(/\s+/g, ' ').trim(), 280)}`);
      } else if (block['type'] === 'thinking') {
        // Private reasoning is never rendered; only the fact that the agent reasoned is.
        const thinking = typeof block['thinking'] === 'string' ? block['thinking'] : '';
        parts.push(`raciocínio do agente (${thinking.length} chars, conteúdo não exibido)`);
      } else if (block['type'] === 'tool_use') {
        const name = typeof block['name'] === 'string' ? block['name'] : 'ferramenta';
        const input = block['input'] ? JSON.stringify(block['input']) : '';
        parts.push(`ferramenta ${name}: ${clipLine(input.replace(/\s+/g, ' '), 220)}`);
      }
    }
    if (!parts.length) return null;
    return { text: parts.join(' | '), ...(rawTexts.length ? { assistantText: rawTexts.join('\n') } : {}) };
  }
  if (type === 'system') {
    const subtype = typeof parsed['subtype'] === 'string' ? parsed['subtype'] : 'sistema';
    const model = typeof parsed['model'] === 'string' ? parsed['model'] : null;
    return { text: `sessão do agente (${subtype})${model ? ` — modelo ${model}` : ''}` };
  }
  return null;
}

/**
 * Feeds stream-json lines through the parser, returning what the console should show for each line (the raw line is
 * shown when it is not a JSON event, so nothing is hidden) and keeping the final answer.
 */
export class ClaudeStreamReader {
  private readonly finalChunks: string[] = [];
  private readonly textChunks: string[] = [];
  private sawResult = false;

  /** Returns the summarized line, or null when the line is not a structured event. */
  handle(line: string): ClaudeStreamActivity | null {
    const activity = readClaudeStreamLine(line);
    if (!activity) return null;
    if (activity.finalText !== undefined) {
      this.sawResult = true;
      if (activity.finalText.trim()) this.finalChunks.push(activity.finalText);
    }
    if (activity.assistantText) this.textChunks.push(activity.assistantText);
    return activity;
  }

  /** Text the caller should parse: the result event when it exists, otherwise the assistant text seen so far. */
  finalText(fallback: string): string {
    if (this.sawResult) return this.finalChunks.join('\n').trim();
    return this.textChunks.length ? this.textChunks.join('\n').trim() : fallback;
  }

  get hasResult(): boolean {
    return this.sawResult;
  }
}



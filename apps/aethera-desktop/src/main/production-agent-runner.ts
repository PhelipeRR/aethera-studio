import { spawn } from 'node:child_process';
import type { ProductionConsoleService, ProductionLogOrigin, ProductionLogStage } from './production-console.js';

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
  timedOut: boolean;
  aborted: boolean;
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
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Per stream. Default 4 MB. */
  maxCaptureBytes?: number;
  /** Default 1600 characters. */
  maxLineChars?: number;
  /** Lines forwarded to `onLine`; further lines only count. Default 500. */
  maxStreamedLines?: number;
  onLine?: (line: CapturedLine) => void;
}

/**
 * Runs a command without a shell, capturing both streams and forwarding each complete line as it arrives, so the
 * console shows real output while the process is still running. Never throws for a non-zero exit: the caller decides.
 */
export function captureCommand(options: CaptureCommandOptions): Promise<CommandCaptureResult> {
  const maxCaptureBytes = options.maxCaptureBytes ?? 4 * 1024 * 1024;
  const maxLineChars = options.maxLineChars ?? 1600;
  const maxStreamedLines = options.maxStreamedLines ?? 500;
  const startedAt = Date.now();
  const shell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(options.command);

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
    let spawnError: string | undefined;
    const pending: Record<CommandStream, string> = { stdout: '', stderr: '' };

    const child = spawn(options.command, options.args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: options.env ?? process.env,
      windowsHide: true,
      shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', onAbort);
      for (const stream of ['stdout', 'stderr'] as CommandStream[]) {
        const rest = pending[stream].trim();
        if (rest) forward(stream, rest);
      }
      resolve({
        code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        aborted,
        lineCount,
        streamTruncated,
        captureTruncated,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    const forward = (stream: CommandStream, text: string) => {
      lineCount += 1;
      if (streamedLines >= maxStreamedLines) {
        streamTruncated = true;
        return;
      }
      streamedLines += 1;
      options.onLine?.({ stream, text: clipLine(text, maxLineChars), at: new Date().toISOString() });
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
        if (line.trim()) forward(stream, line);
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => collect('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect('stderr', chunk));

    const kill = () => {
      if (!child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // process may already be gone
        }
      }
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs ?? 120_000);

    const onAbort = () => {
      aborted = true;
      kill();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    child.on('error', (error: Error) => {
      spawnError = error.message;
      finish(null, null);
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => finish(code, signal));
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
  timeoutMs?: number;
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

  const result = await captureCommand({
    command: options.command,
    args: options.args,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.maxStreamedLines !== undefined ? { maxStreamedLines: options.maxStreamedLines } : {}),
    ...(options.maxLineChars !== undefined ? { maxLineChars: options.maxLineChars } : {}),
    ...(options.maxCaptureBytes !== undefined ? { maxCaptureBytes: options.maxCaptureBytes } : {}),
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

  const ok = result.code === 0 && !result.timedOut && !result.aborted && !result.spawnError;
  const failureReason = result.spawnError
    ? result.spawnError
    : result.timedOut
      ? `tempo limite de ${Math.round((options.timeoutMs ?? 120_000) / 1000)}s excedido`
      : result.aborted
        ? 'cancelado'
        : result.code === null
          ? `encerrado por sinal ${result.signal ?? 'desconhecido'}`
          : `exit code ${result.code}`;

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
      ...(result.spawnError ? { spawnError: result.spawnError } : {}),
    },
  });

  return result;
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



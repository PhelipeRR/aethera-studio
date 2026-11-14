import { execFile, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { redactSecrets } from './redact.js';

export interface ProcessOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  /** Written to stdin, which is then closed. Prompts go here: no command-line length limit, no quoting. */
  stdin?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Full output, secrets redacted, one line per line of output. */
  logFile?: string;
  /** Lines buffered before the child's output is paused until the consumer catches up. */
  highWaterMark?: number;
  /** Longer lines are cut to this many characters. */
  maxLineLength?: number;
}

export interface ProcessLine {
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  cancelled: boolean;
  /** Set when the executable could not be started (e.g. ENOENT). */
  spawnError: string | null;
  /** Last 64 KB of stderr, redacted. */
  stderrTail: string;
  durationMs: number;
  truncatedLines: number;
  /** Largest number of lines waiting for the consumer (memory stays bounded by highWaterMark). */
  maxQueued: number;
}

export interface ProcessRun {
  pid: number | undefined;
  /** Single consumer. Stopping early discards the rest without blocking the child. */
  lines: AsyncIterable<ProcessLine>;
  result: Promise<ProcessResult>;
}

const STDERR_TAIL = 64 * 1024;

/** Kills a process and everything it started. Windows has no process groups: taskkill /T walks the tree. */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

/** Runs a CLI without a shell and streams its output line by line with bounded memory. */
export function runProcess(options: ProcessOptions): ProcessRun {
  const started = Date.now();
  const highWaterMark = options.highWaterMark ?? 1000;
  const maxLineLength = options.maxLineLength ?? 1024 * 1024;
  const queue: ProcessLine[] = [];
  const state = { ended: false, discard: false, paused: false, maxQueued: 0, truncated: 0, timedOut: false, cancelled: false, spawnError: null as string | null };
  let stderrTail = '';
  let wake: (() => void) | null = null;
  const signalConsumer = () => {
    wake?.();
    wake = null;
  };

  const lines: AsyncIterable<ProcessLine> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<ProcessLine>> => {
        while (queue.length === 0 && !state.ended) await new Promise<void>((resolveWait) => (wake = resolveWait));
        const value = queue.shift();
        if (state.paused && queue.length < highWaterMark / 2) resume();
        return value ? { value, done: false } : { value: undefined, done: true };
      },
      return: async (): Promise<IteratorResult<ProcessLine>> => {
        state.discard = true;
        queue.length = 0;
        resume();
        return { value: undefined, done: true };
      },
    }),
  };

  if (options.signal?.aborted) {
    state.ended = true;
    state.cancelled = true;
    return { pid: undefined, lines, result: Promise.resolve(finalResult(null)) };
  }

  let log: WriteStream | null = null;
  if (options.logFile) {
    mkdirSync(dirname(options.logFile), { recursive: true });
    log = createWriteStream(options.logFile, { flags: 'a', encoding: 'utf8' });
  }

  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  function resume(): void {
    if (!state.paused) return;
    state.paused = false;
    child.stdout?.resume();
    child.stderr?.resume();
  }

  function push(line: ProcessLine): void {
    log?.write(`${line.stream === 'stderr' ? '[stderr] ' : ''}${redactSecrets(line.line)}\n`);
    if (line.stream === 'stderr') stderrTail = (stderrTail + line.line + '\n').slice(-STDERR_TAIL);
    if (state.discard) return;
    queue.push(line);
    state.maxQueued = Math.max(state.maxQueued, queue.length);
    if (queue.length > highWaterMark && !state.paused) {
      state.paused = true;
      child.stdout?.pause();
      child.stderr?.pause();
    }
    signalConsumer();
  }

  function splitLines(stream: Readable | null, name: ProcessLine['stream']): void {
    if (!stream) {
      return;
    }
    stream.setEncoding('utf8');
    let buffer = '';
    let skipping = false; // inside the cut-off remainder of an over-long line
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline === -1) break;
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (skipping) skipping = false;
        else push({ stream: name, line });
      }
      if (!skipping && buffer.length > maxLineLength) {
        push({ stream: name, line: buffer.slice(0, maxLineLength) });
        state.truncated++;
        skipping = true;
        buffer = '';
      } else if (skipping) {
        buffer = '';
      }
    });
    stream.on('end', () => {
      if (buffer && !skipping) push({ stream: name, line: buffer.replace(/\r$/, '') });
    });
  }
  splitLines(child.stdout, 'stdout');
  splitLines(child.stderr, 'stderr');

  child.stdin?.on('error', () => {}); // the child may exit without reading its input
  child.stdin?.end(options.stdin ?? '');

  const kill = () => child.pid !== undefined && killTree(child.pid);
  const timer = options.timeoutMs
    ? setTimeout(() => {
        state.timedOut = true;
        kill();
      }, options.timeoutMs)
    : null;
  const onAbort = () => {
    state.cancelled = true;
    kill();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  function finalResult(exitCode: number | null): ProcessResult {
    return {
      exitCode,
      timedOut: state.timedOut,
      cancelled: state.cancelled,
      spawnError: state.spawnError,
      stderrTail: redactSecrets(stderrTail),
      durationMs: Date.now() - started,
      truncatedLines: state.truncated,
      maxQueued: state.maxQueued,
    };
  }

  const result = new Promise<ProcessResult>((resolveResult) => {
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      state.ended = true;
      signalConsumer();
      const done = () => resolveResult(finalResult(exitCode));
      if (log) log.end(done);
      else done();
    };
    child.on('error', (error) => {
      state.spawnError = error.message;
      finish(null);
    });
    child.on('close', (code) => {
      // 'close' fires after both pipes ended, so every line is already queued.
      finish(code);
    });
  });

  return { pid: child.pid, lines, result };
}

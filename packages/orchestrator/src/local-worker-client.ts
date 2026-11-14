import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { LOCAL_WORKER_PROTOCOL_VERSION, languageDetectionInputSchema, languageDetectionSchema, meetingContextInputSchema, meetingContextSchema, transcriptWindowInputSchema, transcriptWindowSchema, type LanguageDetection, type LanguageDetectionInput, type MeetingContext, type MeetingContextInput, type TranscriptWindow, type TranscriptWindowInput } from '@neuralbridge/shared';

const MAX_REQUEST_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 2 * MAX_REQUEST_BYTES;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_IDLE_MS = 5 * 60_000;
const DEFAULT_KILL_GRACE_MS = 1_000;

export type LocalWorkerErrorCode = 'unavailable' | 'timeout' | 'cancelled' | 'protocol' | 'rejected';

/** Any of these codes means "take the model path": preprocessing is an optimization, never a requirement. */
export class LocalWorkerError extends Error {
  constructor(readonly code: LocalWorkerErrorCode, readonly workerCode: string | null = null) { super(`local_worker_${code}`); this.name = 'LocalWorkerError'; }
}

/** The process died under a request. Internal, so the restart budget is decided in one place. */
class WorkerCrash extends Error {
  constructor(readonly generation: number) { super('local_worker_crash'); }
}

export interface LocalWorkerCommand { executable: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>>; }
export interface LocalWorkerOptions { command: LocalWorkerCommand | null; timeoutMs?: number; startupTimeoutMs?: number; idleMs?: number; killGraceMs?: number; }
export interface LocalWorkerCallOptions { signal?: AbortSignal; timeoutMs?: number; }

export interface LocalWorker {
  detectLanguage(input: LanguageDetectionInput, options?: LocalWorkerCallOptions): Promise<LanguageDetection>;
  filterTranscript(input: TranscriptWindowInput, options?: LocalWorkerCallOptions): Promise<TranscriptWindow>;
  summarizeWindow(input: MeetingContextInput, options?: LocalWorkerCallOptions): Promise<MeetingContext>;
}

export interface ResolveLocalWorkerInput { workerRoot: string; pythonPath?: string; venvDir?: string; platform?: NodeJS.Platform; exists?: (path: string) => boolean; baseEnv?: Readonly<Record<string, string | undefined>>; }

/** Python comes from the package's own venv or from an absolute pinned path, never from PATH: null means "no worker". */
export function resolveLocalWorkerCommand(input: ResolveLocalWorkerInput): LocalWorkerCommand | null {
  const { workerRoot, pythonPath, venvDir = join(workerRoot, '.venv'), platform = process.platform, exists = existsSync, baseEnv = process.env } = input;
  if (pythonPath !== undefined && !isAbsolute(pythonPath)) return null;
  const executable = pythonPath ?? (platform === 'win32' ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python'));
  const src = join(workerRoot, 'src');
  if (!exists(executable) || !exists(join(src, 'neura_worker', '__main__.py'))) return null;
  const env: Record<string, string> = { PYTHONPATH: src, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', PYTHONNOUSERSITE: '1' };
  // Windows cannot start the interpreter without these; nothing else from the app's environment gets through.
  for (const key of ['SYSTEMROOT', 'WINDIR']) { const value = baseEnv[key]; if (value) env[key] = value; }
  return { executable, args: ['-B', '-m', 'neura_worker'], cwd: src, env };
}

const responseSchema = z.object({
  v: z.literal(LOCAL_WORKER_PROTOCOL_VERSION),
  id: z.string().nullable(),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
const healthSchema = z.object({ status: z.literal('ok'), schemaVersion: z.number(), workerVersion: z.string(), operations: z.array(z.string()) });
const speechDetectionSchema = z.strictObject({ ranges: z.array(z.strictObject({ startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() })), durationMs: z.number().int().nonnegative(), speechRatio: z.number().min(0).max(1) });
const speechInputSchema = z.strictObject({ pcm16Base64: z.string().min(1).max(MAX_REQUEST_BYTES - 1_000).regex(/^[A-Za-z0-9+/]+={0,2}$/), sampleRate: z.number().int().min(8_000).max(48_000) });
export type SpeechDetection = z.infer<typeof speechDetectionSchema>;
export type SpeechDetectionInput = z.infer<typeof speechInputSchema>;

interface Pending { settle(result: unknown): void; refuse(error: Error): void; }
interface RunningWorker {
  child: ChildProcessWithoutNullStreams;
  generation: number;
  pending: Map<string, Pending>;
  abandoned: Map<string, NodeJS.Timeout>;
  chunks: Buffer[];
  size: number;
  ready: Promise<void>;
  exited: Promise<void>;
  dead: boolean;
}

/** One short-lived subprocess, started on demand, with one restart per failure streak and no retained state. */
export class LocalWorkerClient implements LocalWorker {
  private worker: RunningWorker | null = null;
  private generation = 0;
  private restartedFrom: number | null = null;
  private failed = false;
  private disposed = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly command: LocalWorkerCommand | null;
  private readonly timeoutMs: number;
  private readonly startupTimeoutMs: number;
  private readonly idleMs: number;
  private readonly killGraceMs: number;

  constructor(options: LocalWorkerOptions) {
    this.command = options.command;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  }

  get available(): boolean { return this.command !== null && !this.failed && !this.disposed; }
  get running(): boolean { return this.worker !== null; }

  async detectLanguage(input: LanguageDetectionInput, options: LocalWorkerCallOptions = {}): Promise<LanguageDetection> {
    return this.call('detect_language', languageDetectionInputSchema.parse(input), languageDetectionSchema, options);
  }

  async filterTranscript(input: TranscriptWindowInput, options: LocalWorkerCallOptions = {}): Promise<TranscriptWindow> {
    return this.call('filter_transcript', transcriptWindowInputSchema.parse(input), transcriptWindowSchema, options);
  }

  async summarizeWindow(input: MeetingContextInput, options: LocalWorkerCallOptions = {}): Promise<MeetingContext> {
    return this.call('summarize_window', meetingContextInputSchema.parse(input), meetingContextSchema, options);
  }

  async detectSpeech(input: SpeechDetectionInput, options: LocalWorkerCallOptions = {}): Promise<SpeechDetection> {
    return this.call('detect_speech', speechInputSchema.parse(input), speechDetectionSchema, options);
  }

  /** Forgets a past failure, for after the user repairs the interpreter. */
  reset(): void { this.failed = false; this.restartedFrom = null; }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.clearIdle();
    const worker = this.worker;
    if (!worker) return;
    this.stop(worker);
    await worker.exited;
  }

  private async call<T>(op: string, payload: unknown, schema: z.ZodType<T>, options: LocalWorkerCallOptions): Promise<T> {
    if (options.signal?.aborted) throw new LocalWorkerError('cancelled');
    for (;;) {
      if (!this.available) throw new LocalWorkerError('unavailable');
      try {
        const worker = this.current();
        await worker.ready;
        const result = await this.send(worker, op, payload, schema, options.timeoutMs ?? this.timeoutMs, options.signal);
        this.restartedFrom = null;
        return result;
      } catch (error) {
        if (!(error instanceof WorkerCrash)) throw error;
        if (this.disposed || !this.mayRestart(error.generation)) throw new LocalWorkerError('unavailable');
      }
    }
  }

  /** Requests that fell with the same process share its restart; a second generation failing ends the streak. */
  private mayRestart(generation: number): boolean {
    this.restartedFrom ??= generation;
    if (this.restartedFrom === generation) return true;
    this.failed = true;
    return false;
  }

  private current(): RunningWorker {
    if (this.worker) return this.worker;
    const command = this.command;
    if (!command) throw new LocalWorkerError('unavailable');
    const generation = ++this.generation;
    let child: ChildProcessWithoutNullStreams;
    try {
      // stderr is piped and dropped below: a traceback could quote the transcript.
      child = spawn(command.executable, [...command.args], { cwd: command.cwd, env: { ...command.env }, shell: false, windowsHide: true });
    } catch {
      throw new WorkerCrash(generation);
    }
    let markExited: () => void = () => undefined;
    const exited = new Promise<void>((resolve) => { markExited = resolve; });
    const worker: RunningWorker = { child, generation, pending: new Map(), abandoned: new Map(), chunks: [], size: 0, ready: Promise.resolve(), exited, dead: false };
    this.worker = worker;
    child.stderr.resume();
    child.stdin.on('error', () => undefined);
    child.stdout.on('data', (chunk: Buffer) => this.receive(worker, chunk));
    child.on('error', () => { this.stop(worker); markExited(); });
    child.on('exit', () => { this.stop(worker); markExited(); });
    worker.ready = this.send(worker, 'health', {}, healthSchema, this.startupTimeoutMs).then((health) => {
      if (health.schemaVersion !== LOCAL_WORKER_PROTOCOL_VERSION) throw new LocalWorkerError('protocol');
    }).catch(() => {
      this.stop(worker);
      throw new WorkerCrash(generation);
    });
    worker.ready.catch(() => undefined);
    return worker;
  }

  private send<T>(worker: RunningWorker, op: string, payload: unknown, schema: z.ZodType<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    if (worker.dead) return Promise.reject(new WorkerCrash(worker.generation));
    if (signal?.aborted) return Promise.reject(new LocalWorkerError('cancelled'));
    const id = randomUUID();
    const line = `${JSON.stringify({ v: LOCAL_WORKER_PROTOCOL_VERSION, id, op, payload, deadlineMs: timeoutMs })}\n`;
    if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) return Promise.reject(new LocalWorkerError('rejected', 'too_large'));
    this.clearIdle();
    return new Promise<T>((resolve, reject) => {
      const finish = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        worker.pending.delete(id);
      };
      const giveUp = (code: 'timeout' | 'cancelled'): void => {
        finish();
        this.abandon(worker, id);
        reject(new LocalWorkerError(code));
      };
      const onAbort = (): void => giveUp('cancelled');
      const timer = setTimeout(() => giveUp('timeout'), timeoutMs);
      timer.unref();
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.pending.set(id, {
        settle: (result) => {
          finish();
          const parsed = schema.safeParse(result);
          if (parsed.success) resolve(parsed.data); else reject(new LocalWorkerError('protocol'));
          this.armIdle(worker);
        },
        refuse: (error) => { finish(); reject(error); },
      });
      worker.child.stdin.write(line);
    });
  }

  /** The caller has moved on, so the worker gets a chance to stop; one that does not answer is killed. */
  private abandon(worker: RunningWorker, id: string): void {
    if (worker.dead) return;
    worker.child.stdin.write(`${JSON.stringify({ v: LOCAL_WORKER_PROTOCOL_VERSION, id: randomUUID(), op: 'cancel', payload: { targetId: id } })}\n`);
    const timer = setTimeout(() => {
      this.mayRestart(worker.generation);
      this.stop(worker);
    }, this.killGraceMs);
    timer.unref();
    worker.abandoned.set(id, timer);
  }

  private receive(worker: RunningWorker, chunk: Buffer): void {
    let rest = chunk;
    for (;;) {
      const end = rest.indexOf(0x0a);
      if (end < 0) break;
      worker.chunks.push(rest.subarray(0, end));
      const line = Buffer.concat(worker.chunks).toString('utf8');
      worker.chunks = [];
      worker.size = 0;
      rest = rest.subarray(end + 1);
      this.handleLine(worker, line);
      if (worker.dead) return;
    }
    worker.size += rest.length;
    if (worker.size > MAX_RESPONSE_BYTES) { this.stop(worker); return; }
    if (rest.length) worker.chunks.push(rest);
  }

  private handleLine(worker: RunningWorker, line: string): void {
    let message: z.infer<typeof responseSchema>;
    try {
      message = responseSchema.parse(JSON.parse(line));
    } catch {
      // A stream that stopped speaking the protocol cannot be trusted for the requests behind it either.
      this.stop(worker);
      return;
    }
    if (message.id === null) return;
    const late = worker.abandoned.get(message.id);
    if (late) {
      clearTimeout(late);
      worker.abandoned.delete(message.id);
      this.armIdle(worker);
      return;
    }
    const pending = worker.pending.get(message.id);
    if (!pending) return;
    if (message.ok) { pending.settle(message.result); return; }
    const code = message.error?.code ?? 'unknown';
    pending.refuse(code === 'timeout' || code === 'cancelled' ? new LocalWorkerError(code) : new LocalWorkerError('rejected', code));
    this.armIdle(worker);
  }

  private armIdle(worker: RunningWorker): void {
    if (worker.dead || worker.pending.size || worker.abandoned.size) return;
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.stop(worker), this.idleMs);
    this.idleTimer.unref();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private stop(worker: RunningWorker): void {
    if (worker.dead) return;
    worker.dead = true;
    if (this.worker === worker) this.worker = null;
    for (const timer of worker.abandoned.values()) clearTimeout(timer);
    worker.abandoned.clear();
    for (const pending of [...worker.pending.values()]) pending.refuse(new WorkerCrash(worker.generation));
    worker.child.kill();
  }
}

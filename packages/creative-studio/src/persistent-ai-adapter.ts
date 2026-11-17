import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ExternalImageAdapter,
  ImageGenerationRequest,
  SemanticEvaluationRequest,
  SemanticEvaluationResult,
} from './image-generation-adapter.js';

function resolvePersistentWorkerScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '..', 'scripts', 'vision_worker_persistent.py');
  if (existsSync(candidate)) return candidate;
  return resolve(process.cwd(), 'packages', 'creative-studio', 'scripts', 'vision_worker_persistent.py');
}

export interface PersistentAiAdapterOptions {
  pythonPath?: string;
  workerScriptPath?: string;
  model?: string;
  steps?: number;
  timeoutMs?: number;
}

interface WorkerResponse {
  ok: boolean;
  error?: string;
  traceback?: string;
  ready?: boolean;
  [key: string]: unknown;
}

/**
 * Persistent AI adapter that keeps a single Python process alive with models
 * loaded in GPU memory. Eliminates the ~15s model reload overhead per generation
 * and prevents VRAM fragmentation from repeated load/unload cycles.
 *
 * Communication protocol: one JSON object per line on stdin, one JSON response
 * per line on stdout. The worker signals readiness with {"ready": true}.
 */
export class PersistentPythonAiAdapter implements ExternalImageAdapter {
  readonly id = 'persistent-sdxl-clip';
  private readonly pythonPath: string;
  private readonly workerScriptPath: string;
  private readonly model: string;
  private readonly steps: number;
  private readonly timeoutMs: number;

  private process: ChildProcess | null = null;
  private readyPromise: Promise<void> | null = null;
  private pendingRequests = new Map<number, { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }>();
  private nextRequestId = 1;
  private buffer = '';
  private availabilityCache: { checkedAt: number; available: boolean } | null = null;

  constructor(options?: PersistentAiAdapterOptions) {
    this.pythonPath = options?.pythonPath ?? process.env['NB_PYTHON'] ?? 'python';
    this.workerScriptPath = options?.workerScriptPath ?? resolvePersistentWorkerScript();
    this.model = options?.model ?? 'stabilityai/sdxl-turbo';
    this.steps = options?.steps ?? 4;
    this.timeoutMs = options?.timeoutMs ?? 300_000;
  }

  async isAvailable(): Promise<boolean> {
    if (this.availabilityCache && Date.now() - this.availabilityCache.checkedAt < 60_000) {
      return this.availabilityCache.available;
    }
    if (!existsSync(this.workerScriptPath)) {
      this.availabilityCache = { checkedAt: Date.now(), available: false };
      return false;
    }
    try {
      await this.ensureWorker();
      this.availabilityCache = { checkedAt: Date.now(), available: true };
      return true;
    } catch {
      this.availabilityCache = { checkedAt: Date.now(), available: false };
      return false;
    }
  }

  /**
   * Starts the persistent worker process and waits for the {"ready": true} signal.
   * Reuses existing process if already running.
   */
  private async ensureWorker(): Promise<void> {
    if (this.process && !this.process.killed && this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise<void>((resolveReady, rejectReady) => {
      const proc = spawn(this.pythonPath, ['-u', this.workerScriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      this.process = proc;
      this.buffer = '';

      let stderrBuf = '';
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
      });

      proc.stdout?.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split('\n');
        // Keep incomplete last line in buffer
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as WorkerResponse;
            if (msg.ready) {
              resolveReady();
              continue;
            }
            // Route response to pending request by matching order (FIFO)
            // Since we send one at a time and wait, FIFO is safe
            const firstPending = this.pendingRequests.entries().next().value;
            if (firstPending) {
              const [, handler] = firstPending;
              this.pendingRequests.delete(firstPending[0]);
              handler.resolve(msg);
            }
          } catch {
            // Skip non-JSON lines (e.g., progress bars from diffusers)
          }
        }
      });

      proc.on('error', (err) => {
        rejectReady(err);
        for (const [, handler] of this.pendingRequests) {
          handler.reject(err);
        }
        this.pendingRequests.clear();
      });

      proc.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          const err = new Error(`Persistent worker exited with code ${code}: ${stderrBuf.slice(-500)}`);
          rejectReady(err);
          for (const [, handler] of this.pendingRequests) {
            handler.reject(err);
          }
          this.pendingRequests.clear();
        }
        this.process = null;
        this.readyPromise = null;
      });

      // Timeout for readiness
      setTimeout(() => {
        rejectReady(new Error(`Persistent worker did not signal readiness within 120s. stderr: ${stderrBuf.slice(-500)}`));
      }, 120_000);
    });

    return this.readyPromise;
  }

  /**
   * Sends a command to the persistent worker and waits for the response.
   * Serializes access so only one GPU operation runs at a time.
   */
  private async sendCommand(cmd: Record<string, unknown>): Promise<WorkerResponse> {
    await this.ensureWorker();

    if (!this.process || !this.process.stdin || this.process.killed) {
      throw new Error('Persistent worker process is not running.');
    }

    const requestId = this.nextRequestId++;
    const jsonLine = JSON.stringify(cmd) + '\n';

    return new Promise<WorkerResponse>((res, rej) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        rej(new Error(`Worker command "${cmd.command}" timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pendingRequests.set(requestId, {
        resolve: (v) => { clearTimeout(timer); res(v); },
        reject: (e) => { clearTimeout(timer); rej(e); },
      });

      this.process!.stdin!.write(jsonLine, (err) => {
        if (err) {
          this.pendingRequests.delete(requestId);
          clearTimeout(timer);
          rej(err);
        }
      });
    });
  }

  async generateImage(request: ImageGenerationRequest): Promise<Buffer> {
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-persist-gen-'));
    const outPath = join(workDir, 'generated.png');

    // Snap dimensions to multiples of 8 and cap for 8 GB VRAM safety
    const maxSide = 1024;
    const scale = Math.min(1, maxSide / Math.max(request.width, request.height));
    const genW = Math.max(256, Math.round((request.width * scale) / 8) * 8);
    const genH = Math.max(256, Math.round((request.height * scale) / 8) * 8);

    try {
      const cmd: Record<string, unknown> = {
        command: 'generate',
        prompt: request.prompt,
        output: outPath,
        width: genW,
        height: genH,
        steps: this.steps,
        model: this.model,
      };

      const resp = await this.sendCommand(cmd);
      if (!resp.ok) {
        throw new Error(`Worker generate failed: ${resp.error ?? 'unknown error'}${resp.traceback ? '\n' + resp.traceback : ''}`);
      }

      if (!existsSync(outPath)) {
        throw new Error('Persistent worker completed without writing output image.');
      }
      return readFileSync(outPath);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  async evaluateImageSemantics(request: SemanticEvaluationRequest): Promise<SemanticEvaluationResult> {
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-persist-eval-'));
    const imgPath = join(workDir, 'candidate.png');

    try {
      writeFileSync(imgPath, request.imageBuffer);

      const resp = await this.sendCommand({
        command: 'evaluate-semantic',
        image: imgPath,
        positives: request.positiveConcepts.join('|'),
        negatives: request.negativeConcepts.join('|'),
      });

      if (!resp.ok) {
        throw new Error(`Worker evaluate-semantic failed: ${resp.error ?? 'unknown error'}`);
      }

      const pos = (resp.positive_prob as number) ?? 0.5;
      const neg = (resp.negative_prob as number) ?? 0.5;
      const isOffTopic = Boolean(resp.is_off_topic);

      return {
        evaluatorId: 'persistent-clip-vit-base-patch32',
        positiveScore: pos,
        negativeScore: neg,
        margin: (resp.margin as number) ?? pos - neg,
        isOffTopic,
        matchedLabel: (resp.best_positive as string) ?? request.positiveConcepts[0] ?? '',
        rationale: isOffTopic
          ? `CLIP multimodal detectou desalinhamento semântico (${(pos * 100).toFixed(1)}% positivo vs ${(neg * 100).toFixed(1)}% distrator "${(resp.best_negative as string) ?? ''}").`
          : `CLIP multimodal confirmou aderência ao tema "${(resp.best_positive as string) ?? ''}" (similaridade calibrada ${(pos * 100).toFixed(1)}% vs ${(neg * 100).toFixed(1)}% distrator).`,
        evidenceScope: request.evidenceBbox ? 'localized' : 'generic',
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  /** CS-9: L2-normalised CLIP image embeddings for image-to-image identity comparison. */
  async embedImages(imagePaths: string[]): Promise<number[][]> {
    const resp = await this.sendCommand({ command: 'embed-images', images: imagePaths.join('|') });
    if (!resp.ok) throw new Error(`Worker embed-images failed: ${resp.error ?? 'unknown error'}`);
    const embeddings = resp.embeddings as number[][] | undefined;
    if (!embeddings || embeddings.length !== imagePaths.length) {
      throw new Error('Worker embed-images returned an unexpected number of embeddings.');
    }
    return embeddings;
  }

  /**
   * Gracefully shuts down the persistent worker, freeing GPU memory.
   */
  async shutdown(): Promise<void> {
    if (!this.process || this.process.killed) return;
    try {
      await this.sendCommand({ command: 'shutdown' });
    } catch {
      // Worker may have already exited
    }
    try {
      this.process.kill('SIGTERM');
    } catch {
      // Already dead
    }
    this.process = null;
    this.readyPromise = null;
  }
}

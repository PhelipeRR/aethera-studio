import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Availability, EmbeddingProvider } from './provider.js';

export const DEFAULT_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
const DIM = 384;

type Extractor = ((texts: string[], options: { pooling: 'mean'; normalize: boolean }) => Promise<{ tolist(): number[][] }>) & {
  dispose?: () => Promise<void>;
};

export interface LocalProviderOptions {
  /** Where model files live (and are downloaded to): %APPDATA%\NeuralBridge\models. */
  cacheDir: string;
  /** Only true after the user agreed to download; MCP servers never download. */
  allowDownload?: boolean;
  model?: string;
  /** Free the ~300 MB the model uses after this long without use. */
  idleUnloadMs?: number;
  onProgress?: (progress: { file?: string; loaded?: number; total?: number; status: string }) => void;
}

/**
 * multilingual-e5-small through transformers.js on the CPU. Loaded on first use, unloaded when idle.
 * e5 expects "passage: " / "query: " prefixes; vectors are mean-pooled and normalised.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dim = DIM;
  private extractor: Promise<Extractor> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private loadFailed = false;

  constructor(private readonly options: LocalProviderOptions) {
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
  }

  /** True when the model files are already on disk. */
  isDownloaded(): boolean {
    const dir = join(this.options.cacheDir, ...this.model.split('/'));
    return existsSync(join(dir, 'tokenizer.json')) && existsSync(join(dir, 'onnx', 'model_quantized.onnx'));
  }

  async availability(): Promise<Availability> {
    if (this.loadFailed) return { ok: false, reason: 'model_error' };
    if (!this.isDownloaded() && !this.options.allowDownload) return { ok: false, reason: 'model_missing' };
    return { ok: true };
  }

  /** Loads the model, downloading it first when allowed. Resolves once it is ready to use. */
  async prepare(): Promise<void> {
    await this.load();
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.embed(texts.map((text) => `passage: ${text}`));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vector] = await this.embed([`query: ${text}`]);
    if (!vector) throw new Error('The embedding model returned no vector.');
    return vector;
  }

  async unload(): Promise<void> {
    const extractor = this.extractor;
    this.extractor = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    await (await extractor?.catch(() => null))?.dispose?.();
  }

  private async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.load();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    this.touch();
    return output.tolist().map((values) => Float32Array.from(values));
  }

  private load(): Promise<Extractor> {
    if (!this.isDownloaded() && !this.options.allowDownload) {
      return Promise.reject(new Error(`The embedding model ${this.model} is not downloaded.`));
    }
    this.extractor ??= (async () => {
      const transformers = await import('@huggingface/transformers');
      transformers.env.cacheDir = this.options.cacheDir;
      transformers.env.localModelPath = this.options.cacheDir;
      transformers.env.allowLocalModels = true;
      transformers.env.allowRemoteModels = this.options.allowDownload === true;
      const pipeline = transformers.pipeline as unknown as (task: string, model: string, options: Record<string, unknown>) => Promise<Extractor>;
      return pipeline('feature-extraction', this.model, {
        dtype: 'q8',
        device: 'cpu',
        ...(this.options.onProgress ? { progress_callback: this.options.onProgress } : {}),
      });
    })().catch((error: unknown) => {
      this.extractor = null;
      this.loadFailed = true;
      throw error;
    });
    this.touch();
    return this.extractor;
  }

  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.unload(), this.options.idleUnloadMs ?? 10 * 60_000);
    this.idleTimer.unref();
  }
}

import { isNull, sql } from 'drizzle-orm';
import {
  DEFAULT_EMBEDDING_MODEL,
  GatedProvider,
  IndexScheduler,
  LocalEmbeddingProvider,
  readSemanticSettings,
  writeSemanticSettings,
  type EmbeddingProvider,
} from '@neuralbridge/brain';
import { memories, type DatabaseHandle } from '@neuralbridge/database';
import type { SemanticStatus } from '@neuralbridge/shared';

/** What the service needs from a model: an embedding provider that can also report and fetch its files. */
export interface ModelProvider extends EmbeddingProvider {
  isDownloaded(): boolean;
  prepare(): Promise<void>;
  unload(): Promise<void>;
}

export interface SemanticServiceOptions {
  handle: DatabaseHandle | null;
  modelsDir: string;
  createProvider?: (options: { allowDownload: boolean }) => ModelProvider;
  /** How often to look for memories written by other processes (MCP servers). 0 disables the timer. */
  intervalMs?: number;
  log?: (message: string) => void;
}

/**
 * Semantic search in the app: consent-gated model download (decision A6) and background indexing of
 * memories written by the app or by any MCP server process.
 */
export function createSemanticService(options: SemanticServiceOptions) {
  const { handle, modelsDir, log = () => {} } = options;
  const createProvider =
    options.createProvider ?? (({ allowDownload }) => new LocalEmbeddingProvider({ cacheDir: modelsDir, allowDownload }));
  const local = createProvider({ allowDownload: false });
  // Used for indexing and for the app's own searches; switched on and off by the user's setting.
  const gated = handle ? new GatedProvider(local, () => readSemanticSettings(handle).enabled) : null;
  const scheduler = handle && gated ? new IndexScheduler(handle, gated, log) : null;

  const interval = options.intervalMs ?? 30_000;
  const timer = scheduler && interval > 0 ? setInterval(() => scheduler.schedule(), interval) : null;
  timer?.unref();
  scheduler?.schedule();

  function counts() {
    if (!handle) return { indexed: 0, pending: 0, failed: 0 };
    const rows = handle.db
      .select({ status: memories.embeddingStatus, n: sql<number>`count(*)` })
      .from(memories)
      .where(isNull(memories.deletedAt))
      .groupBy(memories.embeddingStatus)
      .all();
    const of = (status: string) => rows.find((row) => row.status === status)?.n ?? 0;
    return { indexed: of('ready'), pending: of('pending'), failed: of('failed') };
  }

  async function status(): Promise<SemanticStatus> {
    return {
      enabled: handle ? readSemanticSettings(handle).enabled : false,
      downloaded: local.isDownloaded(),
      model: DEFAULT_EMBEDDING_MODEL,
      modelsDir,
      ...counts(),
    };
  }

  return {
    status,

    /** Embedding provider for search; null when there is no database. */
    provider: gated,

    /** The user confirmed the download dialog: fetch the model if needed, then switch semantic search on. */
    async enable(): Promise<SemanticStatus> {
      if (!handle) throw new Error('Semantic search needs the database, which is unavailable.');
      if (!local.isDownloaded()) {
        const downloader = createProvider({ allowDownload: true });
        await downloader.prepare();
        await downloader.unload();
      }
      writeSemanticSettings(handle, { enabled: true, consentedAt: new Date().toISOString() });
      scheduler?.schedule();
      return status();
    },

    async disable(): Promise<SemanticStatus> {
      if (handle) writeSemanticSettings(handle, { ...readSemanticSettings(handle), enabled: false });
      await local.unload();
      return status();
    },

    /** Called after the app writes a memory. */
    schedule(): void {
      scheduler?.schedule();
    },

    idle(): Promise<void> {
      return scheduler?.idle() ?? Promise.resolve();
    },

    dispose(): void {
      if (timer) clearInterval(timer);
    },
  };
}

import { eq } from 'drizzle-orm';
import { settings, type DatabaseHandle } from '@neuralbridge/database';
import { EmbeddingIndexer } from './indexer.js';
import type { Availability, EmbeddingProvider } from './provider.js';

const SETTINGS_KEY = 'semantic_search';

export interface SemanticSettings {
  /** Off until the user agrees to download the model (decision A6). */
  enabled: boolean;
  consentedAt: string | null;
}

const DEFAULTS: SemanticSettings = { enabled: false, consentedAt: null };

export function readSemanticSettings(handle: DatabaseHandle): SemanticSettings {
  const row = handle.db.select({ value: settings.value }).from(settings).where(eq(settings.key, SETTINGS_KEY)).get();
  if (!row) return { ...DEFAULTS };
  try {
    const value = JSON.parse(row.value) as Partial<SemanticSettings>;
    return { enabled: value.enabled === true, consentedAt: typeof value.consentedAt === 'string' ? value.consentedAt : null };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeSemanticSettings(handle: DatabaseHandle, value: SemanticSettings): void {
  const json = JSON.stringify(value);
  handle.db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: json, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date().toISOString() } })
    .run();
}

/** Wraps a provider so it is only used while semantic search is switched on (checked on every call). */
export class GatedProvider implements EmbeddingProvider {
  constructor(
    private readonly inner: EmbeddingProvider,
    private readonly isEnabled: () => boolean,
  ) {}

  get model(): string {
    return this.inner.model;
  }

  get dim(): number {
    return this.inner.dim;
  }

  async availability(): Promise<Availability> {
    return this.isEnabled() ? this.inner.availability() : { ok: false, reason: 'disabled' };
  }

  embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.inner.embedPassages(texts);
  }

  embedQuery(text: string): Promise<Float32Array> {
    return this.inner.embedQuery(text);
  }
}

/**
 * Runs the indexer off the request path. Repeated schedule() calls while a run is in progress
 * collapse into one more run, so a burst of stores costs at most two passes.
 */
export class IndexScheduler {
  private readonly indexer: EmbeddingIndexer;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    handle: DatabaseHandle,
    private readonly provider: EmbeddingProvider,
    private readonly log: (message: string) => void = () => {},
  ) {
    this.indexer = new EmbeddingIndexer(handle, provider);
  }

  schedule(): void {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
      // A request that arrived after the loop's last check but before this cleanup would otherwise be lost.
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    });
  }

  /** Resolves when no run is in progress. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  /** One pass now (used at startup and by tests). */
  async runNow(): Promise<void> {
    if (!(await this.provider.availability()).ok) return;
    for (;;) {
      const result = await this.indexer.processPending();
      if (result.indexed + result.failed + result.skipped === 0) return;
      if (result.failed) this.log(`embedding failed for ${result.failed} memories`);
      if (result.indexed === 0) return; // only skips/failures left: try again on the next schedule
    }
  }

  private async loop(): Promise<void> {
    do {
      this.again = false;
      try {
        await this.runNow();
      } catch (error) {
        this.log(`indexing stopped: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    } while (this.again);
  }
}

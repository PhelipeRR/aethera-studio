import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { evaluateItemLicense, DEFAULT_LICENSE_POLICY, type LicensePolicy } from './licensing.js';
import {
  CircuitBreaker,
  realClock,
  scopedSignal,
  SlidingWindowRateLimiter,
  toProviderError,
  TtlCache,
  withRetry,
  type Clock,
} from './resilience.js';
import { checkSourceFidelity, planSceneSources, type SourcePlan } from './source-selection.js';
import {
  MediaProviderError,
  type LicenseDecision,
  type MediaProviderAdapter,
  type MediaProviderKey,
  type ProviderConnectivity,
  type ProviderDescriptor,
  type ProviderHealthResult,
  type ProviderMediaItem,
  type ProviderSearchPage,
  type ProviderSearchRequest,
  type ProviderTelemetryEvent,
  type SceneSourceContext,
} from './types.js';

export interface ProviderUserSettings {
  enabled: boolean;
  /** Lower runs first. */
  priority: number;
}

export interface MediaSourcesSettings {
  providers: Partial<Record<MediaProviderKey, ProviderUserSettings>>;
  allowEditorialPromotionalUse: boolean;
  commercialUse: boolean;
}

export const DEFAULT_MEDIA_SOURCES_SETTINGS: MediaSourcesSettings = {
  providers: {},
  allowEditorialPromotionalUse: false,
  commercialUse: true,
};

export interface ProviderStatusView {
  id: MediaProviderKey;
  name: string;
  category: ProviderDescriptor['category'];
  kinds: ProviderDescriptor['kinds'];
  docsUrl: string;
  enabled: boolean;
  priority: number;
  configured: boolean;
  credentialFields: ProviderDescriptor['credentialFields'];
  knownLimits: string;
  termsSummary: string;
  capabilities: ProviderDescriptor['capabilities'];
  permanentlyDisabledReason: string | null;
  connectivity: ProviderConnectivity;
  circuit: 'closed' | 'open' | 'half_open';
  lastError: string | null;
  lastErrorAt: string | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
}

export interface ScoredProviderItem {
  item: ProviderMediaItem;
  license: LicenseDecision;
  score: number;
}

export interface RejectedProviderItem {
  item: ProviderMediaItem;
  stage: 'source_fidelity' | 'license' | 'duplicate';
  code: string;
  reason: string;
  license?: LicenseDecision;
}

export interface ProviderAttempt {
  provider: MediaProviderKey;
  status: 'ok' | 'empty' | 'skipped_disabled' | 'skipped_no_auth' | 'circuit_open' | 'rate_limited' | 'error' | 'cancelled';
  count: number;
  durationMs: number;
  detail?: string;
}

export interface SceneSearchResult {
  plan: SourcePlan;
  accepted: ScoredProviderItem[];
  rejected: RejectedProviderItem[];
  attempts: ProviderAttempt[];
}

export interface AcquireOptions {
  signal?: AbortSignal;
  jobId?: string;
  maxBytes?: number;
  fileStem?: string;
  /** yt-dlp --download-sections value (e.g. "*1:10-2:40") for long videos. */
  downloadSection?: string;
}

export interface AcquireResult {
  filePath: string;
  bytes: number;
  durationMs: number;
}

export interface MediaProviderRegistryOptions {
  adapters: MediaProviderAdapter[];
  settings?: () => MediaSourcesSettings;
  onEvent?: (event: ProviderTelemetryEvent) => void;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  /** Delegate for `yt_dlp`/`hls` acquisition (yt-dlp + ffmpeg in the desktop). */
  externalAcquire?: (item: ProviderMediaItem, destDir: string, options: AcquireOptions) => Promise<string | null>;
  searchTimeoutMs?: number;
  cacheTtlMs?: number;
  userAgent?: string;
}

interface ProviderRuntime {
  limiter: SlidingWindowRateLimiter;
  breaker: CircuitBreaker;
  connectivity: ProviderConnectivity;
  lastError: string | null;
  lastErrorAt: string | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
}

const DEFAULT_UA = 'AetheraStudio/0.1 (desktop media acquisition)';

export class MediaProviderRegistry {
  private readonly adapters = new Map<MediaProviderKey, MediaProviderAdapter>();
  private readonly runtime = new Map<MediaProviderKey, ProviderRuntime>();
  private readonly cache: TtlCache<ProviderSearchPage>;
  private readonly clock: Clock;

  constructor(private readonly options: MediaProviderRegistryOptions) {
    this.clock = options.clock ?? realClock;
    this.cache = new TtlCache<ProviderSearchPage>(500, this.clock);
    for (const adapter of options.adapters) this.register(adapter);
  }

  register(adapter: MediaProviderAdapter): void {
    const d = adapter.descriptor;
    this.adapters.set(d.id, adapter);
    this.runtime.set(d.id, {
      limiter: new SlidingWindowRateLimiter(d.rateLimit, this.clock),
      breaker: new CircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 }, this.clock),
      connectivity: d.permanentlyDisabledReason ? 'unavailable_permanently' : 'unknown',
      lastError: d.permanentlyDisabledReason ?? null,
      lastErrorAt: null,
      lastCheckedAt: null,
      lastLatencyMs: null,
    });
  }

  private runtimeOf(id: MediaProviderKey): ProviderRuntime {
    const rt = this.runtime.get(id);
    if (!rt) throw new MediaProviderError('disabled', id, 'Provedor não registrado.', false);
    return rt;
  }

  adapter(id: MediaProviderKey): MediaProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  settings(): MediaSourcesSettings {
    return this.options.settings?.() ?? DEFAULT_MEDIA_SOURCES_SETTINGS;
  }

  licensePolicy(context?: SceneSourceContext, automatedAcquisition = true): LicensePolicy {
    const s = this.settings();
    return {
      ...DEFAULT_LICENSE_POLICY,
      commercialUse: context?.commercialUse ?? s.commercialUse,
      allowEditorialPromotionalUse: s.allowEditorialPromotionalUse,
      automatedAcquisition,
    };
  }

  userSettings(id: MediaProviderKey): ProviderUserSettings {
    const d = this.adapters.get(id)?.descriptor;
    const stored = this.settings().providers[id];
    return {
      enabled: d?.permanentlyDisabledReason ? false : (stored?.enabled ?? d?.enabledByDefault ?? false),
      priority: stored?.priority ?? d?.defaultPriority ?? 100,
    };
  }

  /** Why a provider cannot be used right now, or null when it can. */
  unusableReason(id: MediaProviderKey): { status: ProviderAttempt['status']; reason: string } | null {
    const adapter = this.adapters.get(id);
    if (!adapter) return { status: 'skipped_disabled', reason: 'Provedor não registrado.' };
    const d = adapter.descriptor;
    if (d.permanentlyDisabledReason) return { status: 'skipped_disabled', reason: d.permanentlyDisabledReason };
    if (!this.userSettings(id).enabled) return { status: 'skipped_disabled', reason: 'Desativado em Configurações → Fontes de mídia.' };
    if (!adapter.isConfigured()) return { status: 'skipped_no_auth', reason: 'Credencial ausente.' };
    const rt = this.runtimeOf(id);
    if (!rt.breaker.canPass()) {
      return { status: 'circuit_open', reason: `Circuit breaker aberto após falhas consecutivas (reabre em ${Math.ceil(rt.breaker.remainingCooldownMs() / 1000)}s).` };
    }
    return null;
  }

  status(): ProviderStatusView[] {
    return [...this.adapters.values()]
      .map((adapter) => {
        const d = adapter.descriptor;
        const rt = this.runtimeOf(d.id);
        const us = this.userSettings(d.id);
        const configured = adapter.isConfigured();
        let connectivity = rt.connectivity;
        if (d.permanentlyDisabledReason) connectivity = 'unavailable_permanently';
        else if (!us.enabled) connectivity = 'disabled';
        else if (!configured) connectivity = 'auth_missing';
        return {
          id: d.id,
          name: d.name,
          category: d.category,
          kinds: d.kinds,
          docsUrl: d.docsUrl,
          enabled: us.enabled,
          priority: us.priority,
          configured,
          credentialFields: d.credentialFields,
          knownLimits: d.knownLimits,
          termsSummary: d.termsSummary,
          capabilities: d.capabilities,
          permanentlyDisabledReason: d.permanentlyDisabledReason ?? null,
          connectivity,
          circuit: rt.breaker.current(),
          lastError: rt.lastError,
          lastErrorAt: rt.lastErrorAt,
          lastCheckedAt: rt.lastCheckedAt,
          lastLatencyMs: rt.lastLatencyMs,
        };
      })
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }

  private emit(event: ProviderTelemetryEvent): void {
    try {
      this.options.onEvent?.(event);
    } catch {
      // telemetry must never break acquisition
    }
  }

  private recordError(id: MediaProviderKey, err: MediaProviderError): void {
    const rt = this.runtime.get(id);
    if (!rt) return;
    rt.lastError = err.message.slice(0, 300);
    rt.lastErrorAt = new Date(this.clock.now()).toISOString();
    rt.connectivity =
      err.code === 'auth_failed' ? 'auth_failed' : err.code === 'auth_missing' ? 'auth_missing' : err.code === 'rate_limited' ? 'rate_limited' : err.code === 'cancelled' ? rt.connectivity : 'degraded';
    if (err.retryable && err.code !== 'cancelled') rt.breaker.recordFailure();
    if (err.code === 'rate_limited' && err.retryAfterMs) rt.limiter.pauseUntil(this.clock.now() + err.retryAfterMs);
    if (rt.breaker.current() === 'open') rt.connectivity = 'down';
  }

  /** One provider, one page — with rate limit, retry, timeout, circuit breaker and cache. */
  async search(id: MediaProviderKey, request: ProviderSearchRequest): Promise<ProviderSearchPage & { fromCache: boolean }> {
    const adapter = this.adapters.get(id);
    const unusable = this.unusableReason(id);
    if (!adapter || unusable) {
      const code = unusable?.status === 'skipped_no_auth' ? 'auth_missing' : unusable?.status === 'circuit_open' ? 'circuit_open' : 'disabled';
      throw new MediaProviderError(code, id, unusable?.reason ?? 'indisponível', false);
    }
    const page = Math.max(1, request.page ?? 1);
    const perPage = Math.max(1, Math.min(80, request.perPage ?? 10));
    const cacheKey = JSON.stringify([id, request.query.trim().toLowerCase(), page, perPage, request.kinds ?? [], request.category ?? '']);
    const ctx = request.context;
    this.emit({ type: 'provider_query', provider: id, ...(ctx?.jobId ? { jobId: ctx.jobId } : {}), ...(ctx?.sceneId ? { sceneId: ctx.sceneId } : {}), query: request.query, page });
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.emit({ type: 'provider_result', provider: id, ...(ctx?.jobId ? { jobId: ctx.jobId } : {}), ...(ctx?.sceneId ? { sceneId: ctx.sceneId } : {}), query: request.query, count: cached.items.length, durationMs: 0, fromCache: true });
      return { ...cached, fromCache: true };
    }
    const rt = this.runtimeOf(id);
    const started = this.clock.now();
    try {
      const result = await withRetry(
        id,
        () =>
          rt.limiter.run(
            () => adapter.search({ ...request, page, perPage, signal: scopedSignal(this.options.searchTimeoutMs ?? 15_000, request.signal) }),
            request.signal,
          ),
        {
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 8_000,
          ...(request.signal ? { signal: request.signal } : {}),
          onRetry: (attempt, delayMs, error) => {
            rt.breaker.recordFailure();
            this.emit({ type: 'provider_retry', provider: id, ...(ctx?.jobId ? { jobId: ctx.jobId } : {}), attempt, delayMs, reason: error.message });
          },
        },
        this.clock,
      );
      const durationMs = this.clock.now() - started;
      rt.breaker.recordSuccess();
      rt.connectivity = 'ok';
      rt.lastLatencyMs = durationMs;
      rt.lastCheckedAt = new Date(this.clock.now()).toISOString();
      this.cache.set(cacheKey, result, this.options.cacheTtlMs ?? (id === 'pixabay' ? 24 * 3_600_000 : 30 * 60_000));
      this.emit({ type: 'provider_result', provider: id, ...(ctx?.jobId ? { jobId: ctx.jobId } : {}), ...(ctx?.sceneId ? { sceneId: ctx.sceneId } : {}), query: request.query, count: result.items.length, durationMs, fromCache: false });
      return { ...result, fromCache: false };
    } catch (error) {
      const err = toProviderError(id, error, request.signal);
      this.recordError(id, err);
      this.emit({ type: 'provider_error', provider: id, ...(ctx?.jobId ? { jobId: ctx.jobId } : {}), ...(ctx?.sceneId ? { sceneId: ctx.sceneId } : {}), code: err.code, message: err.message, durationMs: this.clock.now() - started });
      throw err;
    }
  }

  /**
   * Scene-aware search: plans providers from the scene context, falls back provider by provider, gates each item on
   * source fidelity and license, deduplicates, and ranks for relevance, quality, provenance and diversity.
   */
  async searchForScene(
    query: string,
    context: SceneSourceContext,
    options: { signal?: AbortSignal; minResults?: number; perProvider?: number; providers?: MediaProviderKey[] } = {},
  ): Promise<SceneSearchResult> {
    const plan = planSceneSources({ ...context, query });
    const minResults = options.minResults ?? 6;
    const perProvider = options.perProvider ?? 8;
    const planned = options.providers ?? plan.providers;
    const order = planned
      .filter((id) => this.adapters.has(id))
      .map((id, index) => ({ id, index, priority: this.userSettings(id).priority }))
      .sort((a, b) => a.priority - b.priority || a.index - b.index)
      .map((x) => x.id);
    this.emit({ type: 'source_plan', ...(context.jobId ? { jobId: context.jobId } : {}), ...(context.sceneId ? { sceneId: context.sceneId } : {}), intent: plan.intent, providers: order, rationale: plan.rationale });

    const attempts: ProviderAttempt[] = [];
    const accepted: ScoredProviderItem[] = [];
    const rejected: RejectedProviderItem[] = [];
    const seen = new Set<string>();
    const policy = this.licensePolicy(context, true);
    let previousFailure: { provider: MediaProviderKey; reason: string } | null = null;

    for (const id of order) {
      if (options.signal?.aborted) {
        attempts.push({ provider: id, status: 'cancelled', count: 0, durationMs: 0 });
        break;
      }
      if (accepted.length >= minResults) break;
      if (previousFailure) {
        this.emit({ type: 'provider_fallback', from: previousFailure.provider, to: id, ...(context.jobId ? { jobId: context.jobId } : {}), ...(context.sceneId ? { sceneId: context.sceneId } : {}), reason: previousFailure.reason });
        previousFailure = null;
      }
      const unusable = this.unusableReason(id);
      if (unusable) {
        attempts.push({ provider: id, status: unusable.status, count: 0, durationMs: 0, detail: unusable.reason });
        this.emit({ type: 'provider_skipped', provider: id, ...(context.jobId ? { jobId: context.jobId } : {}), ...(context.sceneId ? { sceneId: context.sceneId } : {}), reason: unusable.reason });
        previousFailure = { provider: id, reason: unusable.reason };
        continue;
      }
      const started = this.clock.now();
      try {
        const page = await this.search(id, { query, perPage: perProvider, context, ...(options.signal ? { signal: options.signal } : {}) });
        attempts.push({ provider: id, status: page.items.length > 0 ? 'ok' : 'empty', count: page.items.length, durationMs: this.clock.now() - started });
        if (page.items.length === 0) previousFailure = { provider: id, reason: 'Nenhum resultado.' };
        for (const item of page.items) {
          // pageUrl is shared by many assets (e.g. every trailer of one Steam store page), so it only counts without a file URL.
          const dedupKeys = [item.id, item.acquisition.url ?? item.pageUrl].filter((k): k is string => Boolean(k)).map((k) => canonicalUrl(k));
          if (dedupKeys.some((k) => seen.has(k))) {
            rejected.push({ item, stage: 'duplicate', code: 'duplicate_item', reason: 'Item duplicado (mesma URL/ID já selecionado).' });
            continue;
          }
          for (const k of dedupKeys) seen.add(k);
          const fidelity = checkSourceFidelity(item, plan, context);
          if (!fidelity.pass) {
            rejected.push({ item, stage: 'source_fidelity', code: fidelity.code ?? 'source_fidelity', reason: fidelity.reason });
            this.emit({ type: 'media_rejected', provider: id, ...(context.jobId ? { jobId: context.jobId } : {}), ...(context.sceneId ? { sceneId: context.sceneId } : {}), itemId: item.id, title: item.title, reason: fidelity.reason });
            continue;
          }
          const license = evaluateItemLicense(item, policy);
          if (license.status === 'blocked') {
            rejected.push({ item, stage: 'license', code: 'license_incompatible', reason: license.reasons.join(' '), license });
            this.emit({ type: 'media_rejected', provider: id, ...(context.jobId ? { jobId: context.jobId } : {}), ...(context.sceneId ? { sceneId: context.sceneId } : {}), itemId: item.id, title: item.title, reason: license.reasons.join(' ') });
            continue;
          }
          accepted.push({ item, license, score: scoreItem(item, license, context) });
        }
      } catch (error) {
        const err = toProviderError(id, error, options.signal);
        const status: ProviderAttempt['status'] =
          err.code === 'rate_limited' ? 'rate_limited' : err.code === 'cancelled' ? 'cancelled' : err.code === 'circuit_open' ? 'circuit_open' : err.code === 'auth_missing' ? 'skipped_no_auth' : 'error';
        attempts.push({ provider: id, status, count: 0, durationMs: this.clock.now() - started, detail: err.message });
        previousFailure = { provider: id, reason: err.message };
        if (err.code === 'cancelled') break;
      }
    }
    if (previousFailure && accepted.length < minResults) {
      this.emit({ type: 'provider_fallback', from: previousFailure.provider, to: null, ...(context.jobId ? { jobId: context.jobId } : {}), ...(context.sceneId ? { sceneId: context.sceneId } : {}), reason: `${previousFailure.reason} Sem mais provedores adequados para a cena.` });
    }

    const ranked = diversify(accepted.sort((a, b) => b.score - a.score));
    for (const s of ranked.slice(0, minResults)) {
      this.emit({ type: 'media_selected', provider: s.item.provider, ...(context.jobId ? { jobId: context.jobId } : {}), ...(context.sceneId ? { sceneId: context.sceneId } : {}), itemId: s.item.id, title: s.item.title, classification: s.item.classification, license: s.license.status });
    }
    return { plan, accepted: ranked, rejected, attempts };
  }

  async healthCheck(id: MediaProviderKey, signal?: AbortSignal): Promise<ProviderHealthResult> {
    const adapter = this.adapters.get(id);
    const rt = this.runtime.get(id);
    const checkedAt = new Date(this.clock.now()).toISOString();
    if (!adapter || !rt) return { connectivity: 'unknown', detail: 'Provedor não registrado.', checkedAt };
    if (adapter.descriptor.permanentlyDisabledReason) {
      return { connectivity: 'unavailable_permanently', detail: adapter.descriptor.permanentlyDisabledReason, checkedAt };
    }
    if (!adapter.isConfigured()) {
      rt.connectivity = 'auth_missing';
      rt.lastCheckedAt = checkedAt;
      return { connectivity: 'auth_missing', detail: 'Credencial ausente — configure a chave para testar.', checkedAt };
    }
    try {
      const result = await rt.limiter.run(() => adapter.healthCheck(scopedSignal(15_000, signal)), signal);
      rt.connectivity = result.connectivity;
      rt.lastCheckedAt = result.checkedAt;
      if (result.latencyMs !== undefined) rt.lastLatencyMs = result.latencyMs;
      if (result.connectivity === 'ok') {
        rt.breaker.recordSuccess();
      } else {
        rt.lastError = result.detail;
        rt.lastErrorAt = result.checkedAt;
      }
      return result;
    } catch (error) {
      const err = toProviderError(id, error, signal);
      this.recordError(id, err);
      rt.lastCheckedAt = checkedAt;
      return { connectivity: rt.connectivity, detail: err.message, checkedAt };
    }
  }

  /** Downloads a selected item. Direct HTTP streams to disk with real byte progress; yt_dlp/hls go to the delegate. */
  async acquire(item: ProviderMediaItem, destDir: string, options: AcquireOptions = {}): Promise<AcquireResult> {
    const started = this.clock.now();
    const jobField = options.jobId ? { jobId: options.jobId } : {};
    const url = item.acquisition.url;
    if (item.acquisition.method === 'none' || !url) {
      const reason = item.acquisition.reason ?? 'Provedor não permite aquisição automatizada deste item.';
      this.emit({ type: 'download_failed', provider: item.provider, ...jobField, itemId: item.id, reason, durationMs: 0 });
      throw new MediaProviderError('license_blocked', item.provider, reason, false);
    }
    this.emit({ type: 'download_started', provider: item.provider, ...jobField, itemId: item.id, url });
    mkdirSync(destDir, { recursive: true });
    try {
      if (item.acquisition.method === 'yt_dlp' || item.acquisition.method === 'hls') {
        if (!this.options.externalAcquire) throw new MediaProviderError('unavailable', item.provider, 'yt-dlp/ffmpeg indisponível para este tipo de mídia.', false);
        const filePath = await this.options.externalAcquire(item, destDir, options);
        if (!filePath || !existsSync(filePath)) throw new MediaProviderError('invalid_response', item.provider, 'Download externo terminou sem arquivo.', false);
        const bytes = statSync(filePath).size;
        const durationMs = this.clock.now() - started;
        this.emit({ type: 'download_completed', provider: item.provider, ...jobField, itemId: item.id, filePath, bytes, durationMs });
        return { filePath, bytes, durationMs };
      }
      const result = await this.downloadDirect(item, url, destDir, options);
      this.emit({ type: 'download_completed', provider: item.provider, ...jobField, itemId: item.id, filePath: result.filePath, bytes: result.bytes, durationMs: result.durationMs });
      return result;
    } catch (error) {
      const err = toProviderError(item.provider, error, options.signal);
      this.emit({ type: 'download_failed', provider: item.provider, ...jobField, itemId: item.id, reason: err.message, durationMs: this.clock.now() - started });
      throw err;
    }
  }

  private async downloadDirect(item: ProviderMediaItem, url: string, destDir: string, options: AcquireOptions): Promise<AcquireResult> {
    const started = this.clock.now();
    const maxBytes = options.maxBytes ?? 120 * 1024 * 1024;
    const fetchFn = this.options.fetchImpl ?? fetch;
    const res = await fetchFn(url, {
      headers: { 'User-Agent': this.options.userAgent ?? DEFAULT_UA },
      signal: scopedSignal(180_000, options.signal),
    });
    if (!res.ok || !res.body) {
      throw new MediaProviderError(res.status === 429 ? 'rate_limited' : 'unavailable', item.provider, `HTTP ${res.status} ao baixar mídia.`, res.status === 429 || res.status >= 500);
    }
    const total = Number(res.headers.get('content-length') ?? '');
    const totalBytes = Number.isFinite(total) && total > 0 ? total : undefined;
    if (totalBytes && totalBytes > maxBytes) {
      await res.body.cancel().catch(() => undefined);
      throw new MediaProviderError('invalid_response', item.provider, `Arquivo excede ${Math.round(maxBytes / 1048576)}MB.`, false);
    }
    const ext = guessExtension(url, res.headers.get('content-type'), item);
    const stem = (options.fileStem ?? `${item.provider}_${item.providerItemId}`).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
    const finalPath = join(destDir, `${stem}${ext}`);
    const partPath = `${finalPath}.part`;
    let received = 0;
    let lastEmit = 0;
    const jobField = options.jobId ? { jobId: options.jobId } : {};
    const source = Readable.fromWeb(res.body as WebReadableStream<Uint8Array>);
    source.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) source.destroy(new MediaProviderError('invalid_response', item.provider, `Arquivo excede ${Math.round(maxBytes / 1048576)}MB.`, false));
      const now = this.clock.now();
      if (now - lastEmit >= 250) {
        lastEmit = now;
        this.emit({
          type: 'download_progress',
          provider: item.provider,
          ...jobField,
          itemId: item.id,
          receivedBytes: received,
          ...(totalBytes ? { totalBytes, pct: Math.min(100, Math.round((received / totalBytes) * 100)) } : {}),
        });
      }
    });
    try {
      await pipeline(source, createWriteStream(partPath));
    } catch (error) {
      try {
        unlinkSync(partPath);
      } catch {
        /* ignore */
      }
      throw error;
    }
    if (received < 1024) {
      unlinkSync(partPath);
      throw new MediaProviderError('invalid_response', item.provider, `Arquivo muito pequeno (${received} bytes).`, false);
    }
    renameSync(partPath, finalPath);
    this.emit({ type: 'download_progress', provider: item.provider, ...jobField, itemId: item.id, receivedBytes: received, ...(totalBytes ? { totalBytes } : {}), pct: 100 });
    return { filePath: finalPath, bytes: received, durationMs: this.clock.now() - started };
  }
}

export function canonicalUrl(value: string): string {
  try {
    const u = new URL(value);
    u.hash = '';
    // cache-busting params (Steam `t=`) do not change the asset
    u.searchParams.delete('t');
    const yt = u.hostname.includes('youtube.com') ? u.searchParams.get('v') : u.hostname === 'youtu.be' ? u.pathname.slice(1) : null;
    if (yt) return `youtube:${yt}`;
    return `${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function guessExtension(url: string, contentType: string | null, item: ProviderMediaItem): string {
  const fromUrl = (() => {
    try {
      return extname(new URL(url).pathname).toLowerCase();
    } catch {
      return '';
    }
  })();
  if (/^\.(mp4|webm|mov|mkv|jpg|jpeg|png|webp|gif)$/.test(fromUrl)) return fromUrl;
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('mp4')) return '.mp4';
  if (ct.includes('webm')) return '.webm';
  if (ct.includes('png')) return '.png';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  return item.kind === 'video' ? '.mp4' : item.kind === 'gif' ? '.gif' : '.jpg';
}

const LICENSE_RANK: Record<LicenseDecision['status'], number> = { allowed: 3, allowed_with_restrictions: 2, pending_human_review: 0, blocked: -10 };

/** Relevance + quality + provenance + format + license. Diversity is applied afterwards. */
export function scoreItem(item: ProviderMediaItem, license: LicenseDecision, context: SceneSourceContext): number {
  let score = item.classificationConfidence * 10;
  score += LICENSE_RANK[license.status];
  const text = `${item.title} ${item.description ?? ''} ${item.tags.join(' ')}`.toLowerCase();
  for (const entity of context.entities ?? []) {
    const e = entity.toLowerCase().trim();
    if (e.length >= 3 && text.includes(e)) score += 3;
  }
  const px = (item.width ?? 0) * (item.height ?? 0);
  if (px >= 1920 * 1080) score += 2;
  else if (px >= 1280 * 720) score += 1;
  else if (px > 0 && px < 640 * 360) score -= 2;
  if (item.kind === 'video') score += 1;
  if (item.durationSec !== undefined) {
    if (item.durationSec >= 5 && item.durationSec <= 180) score += 1;
    if (item.durationSec > 900) score -= 2;
  }
  return Number(score.toFixed(3));
}

/** Interleaves providers and caps repeats of the same subject so the edit does not reuse one source visually. */
export function diversify(sorted: ScoredProviderItem[]): ScoredProviderItem[] {
  const perSubject = new Map<string, number>();
  const head: ScoredProviderItem[] = [];
  const tail: ScoredProviderItem[] = [];
  for (const s of sorted) {
    const subject = `${s.item.provider}:${s.item.provenance.subject?.gameId ?? s.item.provenance.subject?.channelTitle ?? s.item.provenance.subject?.datasetId ?? '*'}:${s.item.classification}`;
    const n = perSubject.get(subject) ?? 0;
    perSubject.set(subject, n + 1);
    (n < 3 ? head : tail).push(s);
  }
  return [...head, ...tail];
}

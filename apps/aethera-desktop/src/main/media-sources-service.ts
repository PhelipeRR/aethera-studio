import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import {
  createDefaultMediaProviderAdapters,
  DEFAULT_MEDIA_SOURCES_SETTINGS,
  MediaProviderRegistry,
  type IgdbPort,
  type MediaProviderKey,
  type MediaSourcesSettings,
  type ProviderStatusView,
  type ProviderTelemetryEvent,
} from '@neuralbridge/cinema';
import type { CollageSecretCipher } from '../../../../packages/desktop-shared/src/main/collage-secret-store.js';
import { StudioSecretStore } from '../../../../packages/desktop-shared/src/main/studio-secret-store.js';
import type { EmitProductionLogInput } from './production-console.js';

/**
 * Configurações → Fontes de mídia, in the main process.
 *
 * Owns the provider registry, the encrypted credentials of the new providers (safeStorage, same StudioSecretStore as
 * IGDB/RAWG), the non-secret settings file, and the mapping of registry telemetry to ProductionConsole lines of the
 * job that issued the request. Credentials never cross to the renderer: it only sees "configured" + a masked hint.
 */

export const MEDIA_SOURCES_IPC = {
  list: 'media-sources:list',
  saveSettings: 'media-sources:save-settings',
  saveCredential: 'media-sources:save-credential',
  clearCredential: 'media-sources:clear-credential',
  test: 'media-sources:test',
} as const;

const keySchema = z.strictObject({ apiKey: z.string().trim().min(1).max(500) });
const tokenSchema = z.strictObject({ token: z.string().trim().min(1).max(500) });

/** Providers whose credentials this service stores (IGDB and RAWG keep their existing stores). */
const OWN_CREDENTIALS = {
  youtube: { file: 'aethera-youtube-data-api-key.bin', schema: keySchema, field: 'apiKey', label: 'a API key do YouTube' },
  pexels: { file: 'aethera-pexels-key.bin', schema: keySchema, field: 'apiKey', label: 'a API key do Pexels' },
  pixabay: { file: 'aethera-pixabay-key.bin', schema: keySchema, field: 'apiKey', label: 'a API key do Pixabay' },
  kawaii_red: { file: 'aethera-kawaii-red-token.bin', schema: tokenSchema, field: 'token', label: 'o token do Kawaii API' },
  huggingface_datasets: { file: 'aethera-huggingface-token.bin', schema: tokenSchema, field: 'token', label: 'o token do Hugging Face' },
} as const;
type OwnCredentialProvider = keyof typeof OWN_CREDENTIALS;

const settingsSchema = z.object({
  providers: z.record(z.string(), z.object({ enabled: z.boolean(), priority: z.number().int().min(0).max(1000) })).default({}),
  allowEditorialPromotionalUse: z.boolean().default(false),
  commercialUse: z.boolean().default(true),
});

export interface MediaSourcesServiceDeps {
  userDataDir: string;
  cipher: CollageSecretCipher;
  igdb: IgdbPort;
  /** Existing RAWG store (legacy provider). */
  rawgApiKey: () => string | null;
  saveIgdb: (credentials: { clientId: string; clientSecret: string }) => void;
  clearIgdb: () => void;
  saveRawg: (apiKey: string) => void;
  clearRawg: () => void;
  emitLog: (input: EmitProductionLogInput) => void;
  /** yt-dlp + ffmpeg acquisition used for `yt_dlp`/`hls` items. */
  acquireStream?: (input: { url: string; root: string; relativeDir: string; fileStem: string; downloadSection?: string; signal?: AbortSignal }) => Promise<string | null>;
}

export interface MediaSourcesView {
  providers: Array<ProviderStatusView & { credentialHint: string | null }>;
  allowEditorialPromotionalUse: boolean;
  commercialUse: boolean;
}

export const mask = (value: string | null | undefined): string | null => (value ? (value.length <= 4 ? '••••' : `••••${value.slice(-4)}`) : null);

export class MediaSourcesService {
  readonly registry: MediaProviderRegistry;
  private readonly stores = new Map<OwnCredentialProvider, StudioSecretStore<Record<string, string>>>();
  private readonly settingsFile: string;
  private settingsCache: MediaSourcesSettings;
  private readonly lastProgressLog = new Map<string, number>();

  constructor(private readonly deps: MediaSourcesServiceDeps) {
    for (const [id, cfg] of Object.entries(OWN_CREDENTIALS) as Array<[OwnCredentialProvider, (typeof OWN_CREDENTIALS)[OwnCredentialProvider]]>) {
      this.stores.set(id, new StudioSecretStore<Record<string, string>>(join(deps.userDataDir, cfg.file), deps.cipher, cfg.schema as unknown as z.ZodType<Record<string, string>>, cfg.label));
    }
    this.settingsFile = join(deps.userDataDir, 'aethera-media-sources.json');
    this.settingsCache = this.readSettings();
    const secret = (id: OwnCredentialProvider) => () => {
      const stored = this.stores.get(id)?.load();
      return stored ? (stored[OWN_CREDENTIALS[id].field] ?? null) : null;
    };
    this.registry = new MediaProviderRegistry({
      adapters: createDefaultMediaProviderAdapters({
        igdb: deps.igdb,
        youtubeApiKey: secret('youtube'),
        pexelsApiKey: secret('pexels'),
        pixabayApiKey: secret('pixabay'),
        kawaiiRedToken: secret('kawaii_red'),
        huggingFaceToken: secret('huggingface_datasets'),
        rawgApiKey: deps.rawgApiKey,
      }),
      settings: () => this.settingsCache,
      onEvent: (event) => this.log(event),
      ...(deps.acquireStream
        ? {
            externalAcquire: async (item, destDir, options) => {
              if (!item.acquisition.url) return null;
              return deps.acquireStream!({
                url: item.acquisition.url,
                root: dirname(destDir),
                relativeDir: basename(destDir),
                fileStem: options.fileStem ?? `${item.provider}_${item.providerItemId}`,
                ...(options.downloadSection ? { downloadSection: options.downloadSection } : {}),
                ...(options.signal ? { signal: options.signal } : {}),
              });
            },
          }
        : {}),
    });
  }

  private readSettings(): MediaSourcesSettings {
    try {
      if (!existsSync(this.settingsFile)) return { ...DEFAULT_MEDIA_SOURCES_SETTINGS };
      const parsed = settingsSchema.safeParse(JSON.parse(readFileSync(this.settingsFile, 'utf8')));
      return parsed.success ? (parsed.data as MediaSourcesSettings) : { ...DEFAULT_MEDIA_SOURCES_SETTINGS };
    } catch {
      return { ...DEFAULT_MEDIA_SOURCES_SETTINGS };
    }
  }

  settings(): MediaSourcesSettings {
    return this.settingsCache;
  }

  saveSettings(input: unknown): MediaSourcesView {
    const patch = z
      .object({
        providers: z.record(z.string(), z.object({ enabled: z.boolean().optional(), priority: z.number().int().min(0).max(1000).optional() })).optional(),
        allowEditorialPromotionalUse: z.boolean().optional(),
        commercialUse: z.boolean().optional(),
      })
      .strict()
      .parse(input);
    const known = new Set(this.registry.status().map((s) => s.id as string));
    const providers = { ...this.settingsCache.providers };
    for (const [id, value] of Object.entries(patch.providers ?? {})) {
      if (!known.has(id)) throw new Error(`invalid: provedor desconhecido (${id}).`);
      const current = this.registry.userSettings(id as MediaProviderKey);
      providers[id as MediaProviderKey] = { enabled: value.enabled ?? current.enabled, priority: value.priority ?? current.priority };
    }
    this.settingsCache = {
      providers,
      allowEditorialPromotionalUse: patch.allowEditorialPromotionalUse ?? this.settingsCache.allowEditorialPromotionalUse,
      commercialUse: patch.commercialUse ?? this.settingsCache.commercialUse,
    };
    mkdirSync(dirname(this.settingsFile), { recursive: true });
    const tmp = `${this.settingsFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.settingsCache, null, 2), 'utf8');
    renameSync(tmp, this.settingsFile);
    return this.view();
  }

  saveCredential(input: unknown): MediaSourcesView {
    const { provider, values } = z.object({ provider: z.string(), values: z.record(z.string(), z.string()) }).strict().parse(input);
    if (provider === 'igdb') {
      this.deps.saveIgdb({ clientId: values.clientId ?? '', clientSecret: values.clientSecret ?? '' });
    } else if (provider === 'rawg') {
      this.deps.saveRawg(values.apiKey ?? '');
    } else if (provider in OWN_CREDENTIALS) {
      const cfg = OWN_CREDENTIALS[provider as OwnCredentialProvider];
      this.stores.get(provider as OwnCredentialProvider)?.save({ [cfg.field]: values[cfg.field] ?? '' });
    } else {
      throw new Error(`invalid: ${provider} não aceita credenciais.`);
    }
    return this.view();
  }

  clearCredential(input: unknown): MediaSourcesView {
    const { provider } = z.object({ provider: z.string() }).strict().parse(input);
    if (provider === 'igdb') this.deps.clearIgdb();
    else if (provider === 'rawg') this.deps.clearRawg();
    else if (provider in OWN_CREDENTIALS) this.stores.get(provider as OwnCredentialProvider)?.clear();
    else throw new Error(`invalid: ${provider} não aceita credenciais.`);
    return this.view();
  }

  async test(input: unknown): Promise<{ result: Awaited<ReturnType<MediaProviderRegistry['healthCheck']>>; view: MediaSourcesView }> {
    const { provider } = z.object({ provider: z.string() }).strict().parse(input);
    if (!this.registry.adapter(provider as MediaProviderKey)) throw new Error(`invalid: provedor desconhecido (${provider}).`);
    const result = await this.registry.healthCheck(provider as MediaProviderKey);
    return { result, view: this.view() };
  }

  private credentialHint(id: MediaProviderKey): string | null {
    if (id in OWN_CREDENTIALS) {
      const stored = this.stores.get(id as OwnCredentialProvider)?.load();
      return mask(stored?.[OWN_CREDENTIALS[id as OwnCredentialProvider].field]);
    }
    if (id === 'rawg') return mask(this.deps.rawgApiKey());
    if (id === 'igdb') return this.deps.igdb.configured() ? 'configurado' : null;
    return null;
  }

  view(): MediaSourcesView {
    return {
      providers: this.registry.status().map((s) => ({ ...s, credentialHint: this.credentialHint(s.id) })),
      allowEditorialPromotionalUse: this.settingsCache.allowEditorialPromotionalUse,
      commercialUse: this.settingsCache.commercialUse,
    };
  }

  /** Registry telemetry → console line of the owning job. Events without a job are not written to any job. */
  log(event: ProviderTelemetryEvent): void {
    const jobId = 'jobId' in event ? event.jobId : undefined;
    if (!jobId) return;
    const line = describeEvent(event);
    if (!line) return;
    if (event.type === 'download_progress') {
      const key = `${jobId}:${event.itemId}`;
      const last = this.lastProgressLog.get(key) ?? -1;
      const pct = event.pct ?? -1;
      // keep the console readable: 10% steps (or every MB when size is unknown)
      const bucket = pct >= 0 ? Math.floor(pct / 10) : Math.floor(event.receivedBytes / 1_048_576);
      if (bucket === last && pct !== 100) return;
      this.lastProgressLog.set(key, bucket);
    }
    this.deps.emitLog({ projectId: jobId, jobId, ...line });
  }
}

type LogLine = Omit<EmitProductionLogInput, 'projectId' | 'jobId'>;

export function describeEvent(event: ProviderTelemetryEvent): LogLine | null {
  const source = 'provider' in event ? `media-source:${event.provider}` : 'media-sources';
  switch (event.type) {
    case 'source_plan':
      return { stage: 'pesquisa', origin: 'pesquisa', channel: 'progress', event: 'log', severity: 'info', source, message: `Plano de fontes (${event.intent}) para ${event.sceneId ?? 'cena'}: ${event.providers.join(' → ') || 'nenhum'}. ${event.rationale}`, details: { sceneId: event.sceneId, providers: event.providers, intent: event.intent } };
    case 'provider_query':
      return { stage: 'pesquisa', origin: 'pesquisa', channel: 'command', event: 'command_started', severity: 'info', source, message: `Consultando ${event.provider}: "${event.query}" (página ${event.page})`, details: { provider: event.provider, query: event.query, page: event.page, sceneId: event.sceneId } };
    case 'provider_result':
      return { stage: 'pesquisa', origin: 'pesquisa', channel: 'result', event: 'command_completed', severity: 'info', source, message: `${event.provider}: ${event.count} resultado(s) para "${event.query}"${event.fromCache ? ' (cache)' : ''}`, durationMs: event.durationMs, details: { provider: event.provider, query: event.query, count: event.count, fromCache: event.fromCache } };
    case 'provider_retry':
      return { stage: 'pesquisa', origin: 'pesquisa', channel: 'progress', event: 'stage_retry', severity: 'warn', source, message: `${event.provider}: nova tentativa ${event.attempt + 1} em ${Math.round(event.delayMs)} ms — ${event.reason}`, details: { provider: event.provider, attempt: event.attempt, delayMs: event.delayMs } };
    case 'provider_error':
      return { stage: 'pesquisa', origin: 'pesquisa', channel: 'result', event: 'command_failed', severity: event.code === 'auth_missing' || event.code === 'cancelled' ? 'warn' : 'error', source, message: `${event.provider} falhou (${event.code}): ${event.message}`, durationMs: event.durationMs, details: { provider: event.provider, code: event.code } };
    case 'provider_skipped':
      return { stage: 'pesquisa', origin: 'pesquisa', channel: 'progress', event: 'log', severity: 'warn', source, message: `${event.provider} ignorado: ${event.reason}`, details: { provider: event.provider } };
    case 'provider_fallback':
      return { stage: 'fallback', origin: 'pesquisa', channel: 'progress', event: 'log', severity: 'warn', source, message: event.to ? `Fallback ${event.from} → ${event.to}: ${event.reason}` : `Sem fallback adequado após ${event.from}: ${event.reason} Cena mantida pendente de revisão se não houver mídia válida.`, details: { from: event.from, to: event.to, sceneId: event.sceneId } };
    case 'media_selected':
      return { stage: 'pesquisa', origin: 'pesquisa', channel: 'result', event: 'log', severity: 'info', source, message: `Selecionado de ${event.provider}: "${event.title}" [${event.classification}, licença ${event.license}]`, details: { itemId: event.itemId, classification: event.classification, license: event.license, sceneId: event.sceneId } };
    case 'media_rejected':
      return { stage: 'validacao_visual', origin: 'pesquisa', channel: 'result', event: 'log', severity: 'warn', source, message: `Rejeitado de ${event.provider}: "${event.title}" — ${event.reason}`, details: { itemId: event.itemId, sceneId: event.sceneId } };
    case 'download_started':
      return { stage: 'aquisicao', origin: 'aquisicao', channel: 'command', event: 'command_started', severity: 'info', source, message: `Download iniciado (${event.provider}): ${event.itemId}`, details: { itemId: event.itemId, url: event.url } };
    case 'download_progress':
      return { stage: 'aquisicao', origin: 'aquisicao', channel: 'progress', event: 'log', severity: 'debug', source, message: `Baixando ${event.itemId}: ${(event.receivedBytes / 1_048_576).toFixed(1)} MB${event.totalBytes ? ` de ${(event.totalBytes / 1_048_576).toFixed(1)} MB` : ''}${event.pct !== undefined ? ` (${event.pct}%)` : ''}`, details: { itemId: event.itemId, receivedBytes: event.receivedBytes, totalBytes: event.totalBytes, downloadPct: event.pct } };
    case 'download_completed':
      return { stage: 'aquisicao', origin: 'aquisicao', channel: 'result', event: 'command_completed', severity: 'info', source, message: `Download concluído (${event.provider}): ${event.itemId} — ${(event.bytes / 1_048_576).toFixed(1)} MB`, durationMs: event.durationMs, details: { itemId: event.itemId, bytes: event.bytes } };
    case 'download_failed':
      return { stage: 'aquisicao', origin: 'aquisicao', channel: 'result', event: 'command_failed', severity: 'warn', source, message: `Download falhou (${event.provider}): ${event.itemId} — ${event.reason}`, durationMs: event.durationMs, details: { itemId: event.itemId } };
    default:
      return null;
  }
}

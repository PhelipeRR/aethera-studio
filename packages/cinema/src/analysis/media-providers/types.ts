/**
 * Shared contract of the Aethera media-provider layer.
 *
 * Every external source (game metadata, game media, video platforms, stock libraries, anime reactions, datasets)
 * is an adapter behind this contract. The registry adds the cross-cutting concerns (rate limiting, retry, circuit
 * breaker, cache, deduplication, fallback, telemetry) so adapters only translate one provider's API.
 */

export type MediaProviderKey =
  | 'igdb'
  | 'steam'
  | 'youtube'
  | 'pexels'
  | 'pixabay'
  | 'nekos_best'
  | 'kawaii_red'
  | 'waifu_pics'
  | 'anime_reaction_api'
  | 'huggingface_datasets'
  | 'rawg'
  | 'mixkit';

export type MediaKind = 'video' | 'image' | 'gif' | 'dataset';

export type ProviderCategory =
  | 'game_metadata'
  | 'game_media'
  | 'video_platform'
  | 'stock'
  | 'anime_reaction'
  | 'dataset';

/** Editorial class of a result. AI-generated media can never be any of the "official"/"authentic" classes. */
export type MediaClassification =
  | 'official_game_trailer'
  | 'authentic_gameplay'
  | 'official_screenshot'
  | 'promotional_artwork'
  | 'stock_video'
  | 'stock_image'
  | 'anime_image'
  /** Video footage of an anime (episode clip, opening, PV/trailer, scene upload). */
  | 'anime_footage'
  | 'anime_reaction_gif'
  | 'dataset_media'
  | 'ai_generated';

export const MEDIA_CLASSIFICATION_LABELS: Record<MediaClassification, string> = {
  official_game_trailer: 'Official Game Trailer',
  authentic_gameplay: 'Authentic Gameplay',
  official_screenshot: 'Official Screenshot',
  promotional_artwork: 'Promotional Artwork',
  stock_video: 'Stock Video',
  stock_image: 'Stock Image',
  anime_image: 'Anime Image',
  anime_footage: 'Anime Footage',
  anime_reaction_gif: 'Anime Reaction GIF',
  dataset_media: 'Dataset Media',
  ai_generated: 'AI Generated',
};

export type UsageRestriction =
  | 'attribution_required'
  | 'no_resale_unmodified'
  | 'no_endorsement_implication'
  | 'no_redistribution_as_stock'
  | 'no_hotlinking'
  | 'editorial_only'
  | 'non_commercial_only'
  | 'no_automated_download'
  | 'third_party_rights'
  | 'identifiable_people'
  | 'unknown_terms';

export interface LicenseInfo {
  /** Stable id, e.g. `pexels_license`, `cc-by-4.0`, `publisher_promotional`, `unknown`. */
  licenseId: string;
  licenseName: string;
  licenseUrl?: string;
  author?: string;
  authorUrl?: string;
  /** Text to show in credits when attribution is required or recommended. */
  attributionText?: string;
  commercialUse: 'allowed' | 'forbidden' | 'unknown';
  automatedDownload: 'allowed' | 'forbidden' | 'unknown';
  attributionRequired: boolean | 'recommended';
  restrictions: UsageRestriction[];
  /** Free-form notes copied from the provider's terms that informed the decision. */
  notes?: string;
}

export type LicenseDecisionStatus = 'allowed' | 'allowed_with_restrictions' | 'pending_human_review' | 'blocked';

export interface LicenseDecision {
  status: LicenseDecisionStatus;
  reasons: string[];
  /** Restrictions that remain binding when the media is used. */
  obligations: UsageRestriction[];
}

export type AcquisitionMethod = 'direct_http' | 'yt_dlp' | 'hls' | 'none';

export interface ProviderMediaItem {
  /** `${provider}:${providerItemId}` — stable across searches. */
  id: string;
  provider: MediaProviderKey;
  providerItemId: string;
  kind: MediaKind;
  title: string;
  description?: string;
  /** Canonical page of the item on the provider (for humans and attribution). */
  pageUrl: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  durationSec?: number;
  fileFormat?: string;
  acquisition: { method: AcquisitionMethod; url?: string; reason?: string };
  classification: MediaClassification;
  /** 0..1 — how strong the evidence behind the classification is. */
  classificationConfidence: number;
  classificationEvidence: string[];
  aiGenerated: boolean | 'unknown';
  license: LicenseInfo;
  provenance: {
    provider: MediaProviderKey;
    providerItemId: string;
    retrievedAt: string;
    apiEndpoint: string;
    /** Identity the provider itself asserts (e.g. the Steam app the screenshot belongs to). */
    subject?: {
      gameTitle?: string;
      gameId?: string;
      publisher?: string[];
      animeTitle?: string;
      characterNames?: string[];
      channelTitle?: string;
      datasetId?: string;
    };
  };
  tags: string[];
}

export interface SceneSourceContext {
  /** Job that owns the request; every telemetry event carries it so console lines land in the right job. */
  jobId?: string;
  projectId?: string;
  sceneId?: string;
  prompt?: string;
  genre?: string;
  narrationText?: string;
  entities?: string[];
  /** Developers/publishers known for the subject (from IGDB/Steam) — used to recognise official channels. */
  knownPublishers?: string[];
  /** Commercial (monetised) production — the default, since Aethera publishes to channels. */
  commercialUse?: boolean;
}

export interface ProviderSearchRequest {
  query: string;
  kinds?: MediaKind[];
  page?: number;
  perPage?: number;
  category?: string;
  signal?: AbortSignal;
  context?: SceneSourceContext;
}

export interface ProviderSearchPage {
  items: ProviderMediaItem[];
  page: number;
  perPage: number;
  hasMore: boolean;
  totalHint?: number;
}

export type ProviderConnectivity =
  | 'unknown'
  | 'ok'
  | 'degraded'
  | 'down'
  | 'auth_missing'
  | 'auth_failed'
  | 'rate_limited'
  | 'disabled'
  | 'unavailable_permanently';

export interface ProviderHealthResult {
  connectivity: ProviderConnectivity;
  latencyMs?: number;
  detail: string;
  checkedAt: string;
}

export interface ProviderDescriptor {
  id: MediaProviderKey;
  name: string;
  category: ProviderCategory;
  kinds: MediaKind[];
  docsUrl: string;
  /** Credential fields the provider needs; empty when it works without credentials. */
  credentialFields: Array<{ key: string; label: string; secret: boolean; optional?: boolean }>;
  knownLimits: string;
  enabledByDefault: boolean;
  defaultPriority: number;
  capabilities: {
    search: boolean;
    categories: boolean;
    pagination: boolean;
    preview: boolean;
    /** Whether the automated pipeline may download media from this provider at all. */
    automatedAcquisition: boolean;
    metadataOnly: boolean;
  };
  /** Set when the provider must stay disabled whatever the user configures (dead API, incompatible terms). */
  permanentlyDisabledReason?: string;
  /** Terms summary shown in the UI and recorded with each item. */
  termsSummary: string;
  rateLimit: { requests: number; perMs: number; maxConcurrent: number };
}

export interface MediaProviderAdapter {
  readonly descriptor: ProviderDescriptor;
  isConfigured(): boolean;
  search(request: ProviderSearchRequest): Promise<ProviderSearchPage>;
  healthCheck(signal?: AbortSignal): Promise<ProviderHealthResult>;
  categories?(signal?: AbortSignal): Promise<string[]>;
}

export type ProviderErrorCode =
  | 'auth_missing'
  | 'auth_failed'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid_response'
  | 'cancelled'
  | 'timeout'
  | 'circuit_open'
  | 'disabled'
  | 'not_found'
  | 'license_blocked';

export class MediaProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    readonly provider: MediaProviderKey,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(`${provider}: ${code}: ${message}`);
    this.name = 'MediaProviderError';
  }
}

/** Telemetry the registry emits; the desktop maps each event to a ProductionConsole line of the owning job. */
export type ProviderTelemetryEvent =
  | { type: 'provider_query'; provider: MediaProviderKey; jobId?: string; sceneId?: string; query: string; page: number }
  | { type: 'provider_result'; provider: MediaProviderKey; jobId?: string; sceneId?: string; query: string; count: number; durationMs: number; fromCache: boolean }
  | { type: 'provider_retry'; provider: MediaProviderKey; jobId?: string; attempt: number; delayMs: number; reason: string }
  | { type: 'provider_error'; provider: MediaProviderKey; jobId?: string; sceneId?: string; code: ProviderErrorCode; message: string; durationMs: number }
  | { type: 'provider_skipped'; provider: MediaProviderKey; jobId?: string; sceneId?: string; reason: string }
  | { type: 'provider_fallback'; from: MediaProviderKey; to: MediaProviderKey | null; jobId?: string; sceneId?: string; reason: string }
  | { type: 'source_plan'; jobId?: string; sceneId?: string; intent: string; providers: MediaProviderKey[]; rationale: string }
  | { type: 'media_selected'; provider: MediaProviderKey; jobId?: string; sceneId?: string; itemId: string; title: string; classification: MediaClassification; license: LicenseDecisionStatus }
  | { type: 'media_rejected'; provider: MediaProviderKey; jobId?: string; sceneId?: string; itemId: string; title: string; reason: string }
  | { type: 'download_started'; provider: MediaProviderKey; jobId?: string; itemId: string; url: string }
  | { type: 'download_progress'; provider: MediaProviderKey; jobId?: string; itemId: string; receivedBytes: number; totalBytes?: number; pct?: number }
  | { type: 'download_completed'; provider: MediaProviderKey; jobId?: string; itemId: string; filePath: string; bytes: number; durationMs: number }
  | { type: 'download_failed'; provider: MediaProviderKey; jobId?: string; itemId: string; reason: string; durationMs: number };

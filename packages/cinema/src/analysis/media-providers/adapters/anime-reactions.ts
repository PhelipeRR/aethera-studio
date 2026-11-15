import { classifyProviderItem } from '../classification.js';
import { healthFromProbe, nowIso, requestJson } from '../http.js';
import type {
  LicenseInfo,
  MediaKind,
  MediaProviderAdapter,
  ProviderDescriptor,
  ProviderMediaItem,
  ProviderSearchPage,
  ProviderSearchRequest,
} from '../types.js';

// nekos.best --------------------------------------------------------------------------------------------------------

/**
 * nekos.best v2 (verified 2026-11-15). ToS (17.02.2026) forbid commercial use, monetisation, rehosting and automated
 * downloading — so this adapter is discovery/preview only: items carry `acquisition: none` and a blocking license.
 */
export const NEKOS_BEST_DESCRIPTOR: ProviderDescriptor = {
  id: 'nekos_best',
  name: 'nekos.best',
  category: 'anime_reaction',
  kinds: ['gif', 'image'],
  docsUrl: 'https://docs.nekos.best/',
  credentialFields: [],
  knownLimits: '/search: 7 req / 5 s; /:categoria: 200 req/min (headers x-rate-limit-*).',
  enabledByDefault: true,
  defaultPriority: 60,
  capabilities: { search: true, categories: true, pagination: false, preview: true, automatedAcquisition: false, metadataOnly: false },
  termsSummary:
    'Termos proíbem uso comercial, monetização, rehospedagem e download automatizado; conteúdo pertence aos artistas. Somente pré-visualização/referência — nunca adquirido automaticamente.',
  rateLimit: { requests: 6, perMs: 5_000, maxConcurrent: 1 },
};

const NEKOS_TOS = 'https://docs.nekos.best/legal/tos';

interface NekosResult {
  results?: Array<{ url: string; anime_name?: string; artist_name?: string; artist_href?: string; source_url?: string; dimensions?: { width?: number; height?: number } }>;
}

export class NekosBestAdapter implements MediaProviderAdapter {
  readonly descriptor = NEKOS_BEST_DESCRIPTOR;
  private endpointCache: Record<string, { format: string }> | null = null;
  constructor(private readonly options: { fetchImpl?: typeof fetch } = {}) {}

  isConfigured(): boolean {
    return true;
  }

  private common(signal?: AbortSignal) {
    return { ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}), ...(signal ? { signal } : {}) };
  }

  async categories(signal?: AbortSignal): Promise<string[]> {
    if (!this.endpointCache) {
      const { data } = await requestJson<Record<string, { format: string }>>('nekos_best', 'https://nekos.best/api/v2/endpoints', this.common(signal));
      this.endpointCache = data;
    }
    return Object.keys(this.endpointCache);
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    const perPage = Math.max(1, Math.min(20, request.perPage ?? 6));
    const categories = await this.categories(request.signal);
    const words = request.query.toLowerCase().split(/[^a-z]+/);
    const category = request.category && categories.includes(request.category) ? request.category : words.find((w) => categories.includes(w));
    const wantGif = !request.kinds || request.kinds.includes('gif');
    const url = category
      ? `https://nekos.best/api/v2/${category}?amount=${perPage}`
      : `https://nekos.best/api/v2/search?${new URLSearchParams({ query: request.query.slice(0, 150), type: wantGif ? '2' : '1', amount: String(perPage) })}`;
    const { data } = await requestJson<NekosResult>('nekos_best', url, this.common(request.signal));
    const items = (data.results ?? []).map((r): ProviderMediaItem => {
      const gif = /\.gif$/i.test(r.url);
      const kind: MediaKind = gif ? 'gif' : 'image';
      const cls = classifyProviderItem({ provider: 'nekos_best', hint: gif ? 'anime_gif' : 'anime_image', kind, title: r.anime_name ?? '' });
      const itemId = r.url.split('/').slice(-2).join('_').replace(/\.\w+$/, '');
      const license: LicenseInfo = {
        licenseId: 'nekos_best_tos',
        licenseName: 'nekos.best Terms of Service',
        licenseUrl: NEKOS_TOS,
        ...(r.artist_name ? { author: r.artist_name, attributionText: `${r.artist_name}${r.source_url ? ` (${r.source_url})` : ''}` } : {}),
        ...(r.artist_href ? { authorUrl: r.artist_href } : {}),
        commercialUse: 'forbidden',
        automatedDownload: 'forbidden',
        attributionRequired: 'recommended',
        restrictions: ['non_commercial_only', 'no_automated_download', 'third_party_rights'],
        notes: 'O serviço não detém os direitos; uso comercial, rehospedagem e download automatizado proibidos.',
      };
      return {
        id: `nekos_best:${itemId}`,
        provider: 'nekos_best',
        providerItemId: itemId,
        kind,
        title: r.anime_name ? `${r.anime_name}${category ? ` — ${category}` : ''}` : `Reação ${category ?? ''}`.trim(),
        pageUrl: r.source_url ?? r.url,
        previewUrl: r.url,
        ...(r.dimensions?.width ? { width: r.dimensions.width } : {}),
        ...(r.dimensions?.height ? { height: r.dimensions.height } : {}),
        fileFormat: gif ? 'gif' : 'png',
        acquisition: { method: 'none', reason: 'Termos do nekos.best proíbem download automatizado e uso comercial.' },
        classification: cls.classification,
        classificationConfidence: cls.confidence,
        classificationEvidence: cls.evidence,
        // FAQ: "All images and GIFs in the API are created by human artists."
        aiGenerated: false,
        license,
        provenance: { provider: 'nekos_best', providerItemId: itemId, retrievedAt: nowIso(), apiEndpoint: category ? `/api/v2/${category}` : '/api/v2/search', subject: { ...(r.anime_name ? { animeTitle: r.anime_name } : {}) } },
        tags: [category ?? '', r.anime_name ?? ''].filter(Boolean),
      };
    });
    return { items, page: 1, perPage, hasMore: false };
  }

  healthCheck(signal?: AbortSignal) {
    return healthFromProbe('nekos_best', async () => (await this.categories(signal)).length);
  }
}

// kawaii.red ---------------------------------------------------------------------------------------------------------

/** kawaii.red GIF API (anonymous token works; personal token adds stats). No license or source data is returned. */
export const KAWAII_RED_DESCRIPTOR: ProviderDescriptor = {
  id: 'kawaii_red',
  name: 'Kawaii API (kawaii.red)',
  category: 'anime_reaction',
  kinds: ['gif'],
  docsUrl: 'https://docs.kawaii.red/',
  credentialFields: [{ key: 'token', label: 'Token (opcional — "anonymous" funciona)', secret: true, optional: true }],
  knownLimits: 'Limites não documentados; 1 GIF aleatório por requisição.',
  enabledByDefault: true,
  defaultPriority: 70,
  capabilities: { search: false, categories: true, pagination: false, preview: true, automatedAcquisition: true, metadataOnly: false },
  termsSummary: 'Sem licença nem autoria nas respostas; conteúdo de terceiros — sempre revisão humana antes do uso.',
  rateLimit: { requests: 20, perMs: 60_000, maxConcurrent: 2 },
};

export class KawaiiRedAdapter implements MediaProviderAdapter {
  readonly descriptor = KAWAII_RED_DESCRIPTOR;
  private endpoints: string[] | null = null;
  constructor(private readonly options: { token?: () => string | null; fetchImpl?: typeof fetch } = {}) {}

  isConfigured(): boolean {
    return true;
  }

  private token(): string {
    return this.options.token?.()?.trim() || 'anonymous';
  }

  private common(signal?: AbortSignal) {
    const token = this.token();
    return { ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}), ...(signal ? { signal } : {}), redact: token === 'anonymous' ? [] : [token] };
  }

  async categories(signal?: AbortSignal): Promise<string[]> {
    if (!this.endpoints) {
      const { data } = await requestJson<{ response?: string[] }>('kawaii_red', `https://kawaii.red/api/gif/endpoints/token=${encodeURIComponent(this.token())}/`, this.common(signal));
      this.endpoints = (data.response ?? []).filter((e) => /^[a-z]+$/.test(e));
    }
    return this.endpoints;
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    const endpoints = await this.categories(request.signal);
    const words = request.query.toLowerCase().split(/[^a-z]+/);
    const category = request.category && endpoints.includes(request.category) ? request.category : words.find((w) => endpoints.includes(w));
    const perPage = Math.max(1, Math.min(6, request.perPage ?? 3));
    if (!category) return { items: [], page: 1, perPage, hasMore: false };
    const urls = new Set<string>();
    for (let i = 0; i < perPage; i += 1) {
      const { data } = await requestJson<{ response?: string; error?: string }>('kawaii_red', `https://kawaii.red/api/gif/${category}/token=${encodeURIComponent(this.token())}/`, this.common(request.signal));
      if (data.response && /^https:\/\//.test(data.response)) urls.add(data.response);
    }
    const items = [...urls].map((url): ProviderMediaItem => {
      const itemId = url.split('/').slice(-2).join('_').replace(/\.\w+$/, '');
      const cls = classifyProviderItem({ provider: 'kawaii_red', hint: 'anime_gif', kind: 'gif', title: category });
      return {
        id: `kawaii_red:${itemId}`,
        provider: 'kawaii_red',
        providerItemId: itemId,
        kind: 'gif',
        title: `Reação — ${category}`,
        pageUrl: url,
        previewUrl: url,
        fileFormat: 'gif',
        acquisition: { method: 'direct_http', url },
        classification: cls.classification,
        classificationConfidence: cls.confidence,
        classificationEvidence: cls.evidence,
        aiGenerated: 'unknown',
        license: {
          licenseId: 'unknown',
          licenseName: 'Sem licença declarada (kawaii.red)',
          licenseUrl: 'https://docs.kawaii.red/',
          commercialUse: 'unknown',
          automatedDownload: 'unknown',
          attributionRequired: 'recommended',
          restrictions: ['third_party_rights', 'unknown_terms'],
        },
        provenance: { provider: 'kawaii_red', providerItemId: itemId, retrievedAt: nowIso(), apiEndpoint: `/api/gif/${category}` },
        tags: [category],
      };
    });
    return { items, page: 1, perPage, hasMore: false };
  }

  healthCheck(signal?: AbortSignal) {
    return healthFromProbe('kawaii_red', async () => (await this.categories(signal)).length);
  }
}

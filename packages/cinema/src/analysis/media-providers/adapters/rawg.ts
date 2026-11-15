import { healthFromProbe, nowIso, requestJson } from '../http.js';
import { MediaProviderError, type MediaProviderAdapter, type ProviderDescriptor, type ProviderMediaItem, type ProviderSearchPage, type ProviderSearchRequest } from '../types.js';

/** Legacy RAWG adapter: disabled by default and never required; only store art as low-confidence promotional artwork. */
export const RAWG_DESCRIPTOR: ProviderDescriptor = {
  id: 'rawg',
  name: 'RAWG (legado)',
  category: 'game_metadata',
  kinds: ['image'],
  docsUrl: 'https://api.rawg.io/docs/',
  credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
  knownLimits: '20.000 requisições/mês no plano gratuito; exige atribuição e link para RAWG.',
  enabledByDefault: false,
  defaultPriority: 120,
  capabilities: { search: true, categories: false, pagination: true, preview: true, automatedAcquisition: true, metadataOnly: true },
  termsSummary: 'Provedor legado: dados de comunidade, imagens com direitos dos publishers; atribuição obrigatória. Desabilitado por padrão.',
  rateLimit: { requests: 4, perMs: 1_000, maxConcurrent: 2 },
};

interface RawgGames {
  next?: string | null;
  count?: number;
  results?: Array<{ id: number; slug: string; name: string; background_image?: string | null }>;
}

export class RawgLegacyAdapter implements MediaProviderAdapter {
  readonly descriptor = RAWG_DESCRIPTOR;
  constructor(private readonly options: { apiKey: () => string | null; fetchImpl?: typeof fetch }) {}

  isConfigured(): boolean {
    return Boolean(this.options.apiKey());
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    const key = this.options.apiKey();
    if (!key) throw new MediaProviderError('auth_missing', 'rawg', 'API key do RAWG não configurada.', false);
    const page = request.page ?? 1;
    const perPage = Math.min(40, request.perPage ?? 10);
    const params = new URLSearchParams({ key, search: request.query, page: String(page), page_size: String(perPage) });
    const { data } = await requestJson<RawgGames>('rawg', `https://api.rawg.io/api/games?${params}`, {
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
      redact: [key],
    });
    const items = (data.results ?? [])
      .flatMap((g) => (g.background_image ? [{ ...g, image: g.background_image }] : []))
      .map((g): ProviderMediaItem => ({
        id: `rawg:${g.id}`,
        provider: 'rawg',
        providerItemId: String(g.id),
        kind: 'image',
        title: `${g.name} — arte (RAWG)`,
        pageUrl: `https://rawg.io/games/${g.slug}`,
        previewUrl: g.image,
        acquisition: { method: 'direct_http', url: g.image },
        classification: 'promotional_artwork',
        classificationConfidence: 0.6,
        classificationEvidence: ['Imagem de fundo do registro RAWG (curadoria comunitária).'],
        aiGenerated: 'unknown',
        license: {
          licenseId: 'publisher_promotional',
          licenseName: 'Material promocional (via RAWG)',
          licenseUrl: 'https://rawg.io/apidocs',
          attributionText: 'Dados e imagem via RAWG.io',
          commercialUse: 'unknown',
          automatedDownload: 'allowed',
          attributionRequired: true,
          restrictions: ['editorial_only', 'attribution_required'],
        },
        provenance: { provider: 'rawg', providerItemId: String(g.id), retrievedAt: nowIso(), apiEndpoint: '/api/games', subject: { gameTitle: g.name, gameId: `rawg:${g.id}` } },
        tags: [g.name],
      }));
    return { items, page, perPage, hasMore: Boolean(data.next), ...(data.count !== undefined ? { totalHint: data.count } : {}) };
  }

  healthCheck(signal?: AbortSignal) {
    return healthFromProbe('rawg', async () => (await this.search({ query: 'portal', perPage: 1, ...(signal ? { signal } : {}) })).items.length);
  }
}

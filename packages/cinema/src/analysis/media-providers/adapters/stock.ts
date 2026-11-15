import { classifyProviderItem, detectAiGenerated } from '../classification.js';
import { healthFromProbe, nowIso, requestJson } from '../http.js';
import {
  MediaProviderError,
  type LicenseInfo,
  type MediaProviderAdapter,
  type ProviderDescriptor,
  type ProviderMediaItem,
  type ProviderSearchPage,
  type ProviderSearchRequest,
} from '../types.js';

// Pexels ------------------------------------------------------------------------------------------------------------

export const PEXELS_DESCRIPTOR: ProviderDescriptor = {
  id: 'pexels',
  name: 'Pexels',
  category: 'stock',
  kinds: ['video', 'image'],
  docsUrl: 'https://www.pexels.com/api/documentation/',
  credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
  knownLimits: '200 requisições/hora e 20.000/mês por chave (padrão).',
  enabledByDefault: true,
  defaultPriority: 40,
  capabilities: { search: true, categories: false, pagination: true, preview: true, automatedAcquisition: true, metadataOnly: false },
  termsSummary:
    'Pexels License: uso gratuito, inclusive comercial; sem venda de cópias não alteradas, sem sugerir endosso; atribuição a Pexels/fotógrafo exigida pelos termos da API.',
  rateLimit: { requests: 3, perMs: 60_000, maxConcurrent: 2 },
};

const pexelsLicense = (author?: string, authorUrl?: string, pageUrl?: string): LicenseInfo => ({
  licenseId: 'pexels_license',
  licenseName: 'Pexels License',
  licenseUrl: 'https://www.pexels.com/license/',
  ...(author ? { author, attributionText: `${author} via Pexels${pageUrl ? ` (${pageUrl})` : ''}` } : { attributionText: 'via Pexels' }),
  ...(authorUrl ? { authorUrl } : {}),
  commercialUse: 'allowed',
  automatedDownload: 'allowed',
  attributionRequired: true,
  restrictions: ['attribution_required', 'no_resale_unmodified', 'no_endorsement_implication', 'no_redistribution_as_stock', 'identifiable_people'],
});

interface PexelsPhotos {
  page: number;
  per_page: number;
  total_results?: number;
  next_page?: string;
  photos?: Array<{ id: number; width: number; height: number; url: string; photographer?: string; photographer_url?: string; alt?: string; src?: { original?: string; large2x?: string; medium?: string } }>;
}
interface PexelsVideos {
  page: number;
  per_page: number;
  total_results?: number;
  next_page?: string;
  videos?: Array<{ id: number; width: number; height: number; url: string; image?: string; duration?: number; user?: { name?: string; url?: string }; video_files?: Array<{ quality?: string; file_type?: string; width?: number; height?: number; link: string }> }>;
}

export class PexelsAdapter implements MediaProviderAdapter {
  readonly descriptor = PEXELS_DESCRIPTOR;
  constructor(private readonly options: { apiKey: () => string | null; fetchImpl?: typeof fetch }) {}

  isConfigured(): boolean {
    return Boolean(this.options.apiKey());
  }

  private headers(): { headers: Record<string, string>; key: string } {
    const key = this.options.apiKey();
    if (!key) throw new MediaProviderError('auth_missing', 'pexels', 'API key do Pexels não configurada.', false);
    return { headers: { Authorization: key }, key };
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    const { headers, key } = this.headers();
    const page = request.page ?? 1;
    const perPage = Math.min(80, request.perPage ?? 10);
    const kinds = request.kinds ?? ['video', 'image'];
    const q = new URLSearchParams({ query: request.query, page: String(page), per_page: String(perPage), orientation: 'landscape' });
    const common = { headers, ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}), ...(request.signal ? { signal: request.signal } : {}), redact: [key] };
    const items: ProviderMediaItem[] = [];
    let hasMore = false;
    let total = 0;
    if (kinds.includes('video')) {
      const { data } = await requestJson<PexelsVideos>('pexels', `https://api.pexels.com/videos/search?${q}`, common);
      hasMore ||= Boolean(data.next_page);
      total += data.total_results ?? 0;
      for (const v of data.videos ?? []) {
        // Prefer ≤1080p MP4 to keep downloads reasonable.
        const files = (v.video_files ?? []).filter((f) => (f.file_type ?? '').includes('mp4')).sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
        const file = files.find((f) => (f.height ?? 0) <= 1080) ?? files[files.length - 1];
        if (!file) continue;
        const cls = classifyProviderItem({ provider: 'pexels', hint: 'stock_video', kind: 'video', title: v.url });
        items.push(stockItem('pexels', `video_${v.id}`, 'videos/search', {
          kind: 'video', title: titleFromPexelsUrl(v.url, 'Vídeo Pexels'), pageUrl: v.url, ...(v.image ? { previewUrl: v.image } : {}),
          width: file.width ?? v.width, height: file.height ?? v.height, ...(v.duration ? { durationSec: v.duration } : {}),
          acquisition: { method: 'direct_http', url: file.link }, fileFormat: 'mp4',
          classification: cls.classification, classificationConfidence: cls.confidence, classificationEvidence: cls.evidence, aiGenerated: cls.aiGenerated,
          license: pexelsLicense(v.user?.name, v.user?.url, v.url), tags: [],
        }));
      }
    }
    if (kinds.includes('image')) {
      const { data } = await requestJson<PexelsPhotos>('pexels', `https://api.pexels.com/v1/search?${q}`, common);
      hasMore ||= Boolean(data.next_page);
      total += data.total_results ?? 0;
      for (const p of data.photos ?? []) {
        const url = p.src?.large2x ?? p.src?.original;
        if (!url) continue;
        const cls = classifyProviderItem({ provider: 'pexels', hint: 'stock_photo', kind: 'image', title: p.alt ?? '' });
        items.push(stockItem('pexels', `photo_${p.id}`, 'v1/search', {
          kind: 'image', title: p.alt || titleFromPexelsUrl(p.url, 'Foto Pexels'), pageUrl: p.url, ...(p.src?.medium ? { previewUrl: p.src.medium } : {}),
          width: p.width, height: p.height, acquisition: { method: 'direct_http', url }, fileFormat: 'jpg',
          classification: cls.classification, classificationConfidence: cls.confidence, classificationEvidence: cls.evidence, aiGenerated: cls.aiGenerated,
          license: pexelsLicense(p.photographer, p.photographer_url, p.url), tags: [],
        }));
      }
    }
    return { items, page, perPage, hasMore, totalHint: total };
  }

  healthCheck(signal?: AbortSignal) {
    return healthFromProbe('pexels', async () => (await this.search({ query: 'technology', perPage: 1, kinds: ['image'], ...(signal ? { signal } : {}) })).items.length);
  }
}

function titleFromPexelsUrl(url: string, fallback: string): string {
  const slug = url.match(/\/(?:photo|video)\/([a-z0-9-]+?)-\d+\/?$/i)?.[1];
  return slug ? slug.replace(/-/g, ' ') : fallback;
}

// Pixabay -----------------------------------------------------------------------------------------------------------

export const PIXABAY_DESCRIPTOR: ProviderDescriptor = {
  id: 'pixabay',
  name: 'Pixabay',
  category: 'stock',
  kinds: ['video', 'image'],
  docsUrl: 'https://pixabay.com/api/docs/',
  credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
  knownLimits: '100 requisições / 60 s por chave; respostas devem ser cacheadas por 24 h; sem hotlink permanente.',
  enabledByDefault: true,
  defaultPriority: 50,
  capabilities: { search: true, categories: true, pagination: true, preview: true, automatedAcquisition: true, metadataOnly: false },
  termsSummary:
    'Pixabay Content License: uso gratuito, inclusive comercial; proibido vender sem alteração, redistribuir como stock, ou uso que sugira endosso; mostrar origem Pixabay ao exibir resultados.',
  rateLimit: { requests: 90, perMs: 60_000, maxConcurrent: 2 },
};

export const PIXABAY_CATEGORIES = ['backgrounds', 'fashion', 'nature', 'science', 'education', 'feelings', 'health', 'people', 'religion', 'places', 'animals', 'industry', 'computer', 'food', 'sports', 'transportation', 'travel', 'buildings', 'business', 'music'];

const pixabayLicense = (user?: string, pageUrl?: string): LicenseInfo => ({
  licenseId: 'pixabay_content_license',
  licenseName: 'Pixabay Content License',
  licenseUrl: 'https://pixabay.com/service/license-summary/',
  ...(user ? { author: user, attributionText: `${user} via Pixabay${pageUrl ? ` (${pageUrl})` : ''}` } : {}),
  commercialUse: 'allowed',
  automatedDownload: 'allowed',
  attributionRequired: 'recommended',
  restrictions: ['no_resale_unmodified', 'no_endorsement_implication', 'no_redistribution_as_stock', 'no_hotlinking', 'identifiable_people'],
});

interface PixabayImages {
  totalHits?: number;
  hits?: Array<{ id: number; pageURL: string; type?: string; tags?: string; previewURL?: string; webformatURL?: string; largeImageURL?: string; imageWidth?: number; imageHeight?: number; user?: string }>;
}
interface PixabayVideos {
  totalHits?: number;
  hits?: Array<{ id: number; pageURL: string; type?: string; tags?: string; duration?: number; user?: string; videos?: Record<string, { url?: string; width?: number; height?: number; size?: number; thumbnail?: string }> }>;
}

export class PixabayAdapter implements MediaProviderAdapter {
  readonly descriptor = PIXABAY_DESCRIPTOR;
  constructor(private readonly options: { apiKey: () => string | null; fetchImpl?: typeof fetch }) {}

  isConfigured(): boolean {
    return Boolean(this.options.apiKey());
  }

  async categories(): Promise<string[]> {
    return PIXABAY_CATEGORIES;
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    const key = this.options.apiKey();
    if (!key) throw new MediaProviderError('auth_missing', 'pixabay', 'API key do Pixabay não configurada.', false);
    const page = request.page ?? 1;
    const perPage = Math.max(3, Math.min(200, request.perPage ?? 10));
    const kinds = request.kinds ?? ['video', 'image'];
    const base = new URLSearchParams({ key, q: request.query.slice(0, 100), page: String(page), per_page: String(perPage), safesearch: 'true' });
    if (request.category && PIXABAY_CATEGORIES.includes(request.category)) base.set('category', request.category);
    const common = { ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}), ...(request.signal ? { signal: request.signal } : {}), redact: [key] };
    const items: ProviderMediaItem[] = [];
    let total = 0;
    let hasMore = false;
    if (kinds.includes('video')) {
      const { data } = await requestJson<PixabayVideos>('pixabay', `https://pixabay.com/api/videos/?${base}`, common);
      total += data.totalHits ?? 0;
      hasMore ||= (data.totalHits ?? 0) > page * perPage;
      for (const h of data.hits ?? []) {
        const v = h.videos?.large?.url ? h.videos.large : h.videos?.medium?.url ? h.videos.medium : h.videos?.small;
        if (!v?.url) continue;
        const tags = (h.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
        const cls = classifyProviderItem({ provider: 'pixabay', hint: h.type === 'animation' ? 'stock_animation' : 'stock_video', kind: 'video', title: h.tags ?? '', tags });
        items.push(stockItem('pixabay', `video_${h.id}`, 'api/videos', {
          kind: 'video', title: tags.slice(0, 4).join(', ') || 'Vídeo Pixabay', pageUrl: h.pageURL, ...(v.thumbnail ? { previewUrl: v.thumbnail } : {}),
          ...(v.width ? { width: v.width } : {}), ...(v.height ? { height: v.height } : {}), ...(h.duration ? { durationSec: h.duration } : {}),
          acquisition: { method: 'direct_http', url: v.url }, fileFormat: 'mp4',
          classification: cls.classification, classificationConfidence: cls.confidence, classificationEvidence: cls.evidence, aiGenerated: cls.aiGenerated,
          license: pixabayLicense(h.user, h.pageURL), tags,
        }));
      }
    }
    if (kinds.includes('image')) {
      const { data } = await requestJson<PixabayImages>('pixabay', `https://pixabay.com/api/?${base}&image_type=all`, common);
      total += data.totalHits ?? 0;
      hasMore ||= (data.totalHits ?? 0) > page * perPage;
      for (const h of data.hits ?? []) {
        const url = h.largeImageURL ?? h.webformatURL;
        if (!url) continue;
        const tags = (h.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
        const illustration = h.type === 'illustration' || h.type === 'vector/svg' || h.type === 'vector';
        const cls = classifyProviderItem({ provider: 'pixabay', hint: illustration ? 'stock_illustration' : 'stock_photo', kind: 'image', title: h.tags ?? '', tags });
        items.push(stockItem('pixabay', `image_${h.id}`, 'api', {
          kind: 'image', title: tags.slice(0, 4).join(', ') || 'Imagem Pixabay', pageUrl: h.pageURL, ...(h.webformatURL ? { previewUrl: h.webformatURL } : {}),
          ...(h.imageWidth ? { width: h.imageWidth } : {}), ...(h.imageHeight ? { height: h.imageHeight } : {}),
          acquisition: { method: 'direct_http', url }, fileFormat: 'jpg',
          classification: cls.classification, classificationConfidence: cls.confidence, classificationEvidence: cls.evidence,
          aiGenerated: detectAiGenerated(h.tags ?? '', tags) ? true : cls.aiGenerated,
          license: pixabayLicense(h.user, h.pageURL), tags,
        }));
      }
    }
    return { items, page, perPage, hasMore, totalHint: total };
  }

  healthCheck(signal?: AbortSignal) {
    return healthFromProbe('pixabay', async () => (await this.search({ query: 'computer', perPage: 3, kinds: ['image'], ...(signal ? { signal } : {}) })).items.length);
  }
}

function stockItem(
  provider: 'pexels' | 'pixabay',
  providerItemId: string,
  apiEndpoint: string,
  rest: Omit<ProviderMediaItem, 'id' | 'provider' | 'providerItemId' | 'provenance'>,
): ProviderMediaItem {
  return { id: `${provider}:${providerItemId}`, provider, providerItemId, provenance: { provider, providerItemId, retrievedAt: nowIso(), apiEndpoint }, ...rest };
}

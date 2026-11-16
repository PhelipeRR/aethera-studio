import { isAnimeSubjectOrGenre } from '../../anime-source-adapters.js';
import { classifyProviderItem } from '../classification.js';
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

/**
 * YouTube Data API v3: `search.list` (100 quota units) + `videos.list` (1 unit) for duration, license and channel.
 * Only official channels (matched against publishers known from IGDB/Steam) count as official trailers.
 */
export const YOUTUBE_DESCRIPTOR: ProviderDescriptor = {
  id: 'youtube',
  name: 'YouTube Data API v3',
  category: 'video_platform',
  kinds: ['video'],
  docsUrl: 'https://developers.google.com/youtube/v3/docs/search/list',
  credentialFields: [{ key: 'apiKey', label: 'API key (Google Cloud)', secret: true }],
  knownLimits: 'Cota padrão 10.000 unidades/dia; cada pesquisa custa 100 unidades (~100 pesquisas/dia).',
  enabledByDefault: true,
  defaultPriority: 30,
  capabilities: { search: true, categories: false, pagination: true, preview: true, automatedAcquisition: true, metadataOnly: false },
  termsSummary:
    'Licença padrão do YouTube não concede reutilização. Vídeos Creative Commons (CC BY) são liberados com atribuição; trailers de canais oficiais seguem a política editorial; demais vão para revisão humana.',
  rateLimit: { requests: 5, perMs: 1_000, maxConcurrent: 2 },
};

interface SearchResponse {
  nextPageToken?: string;
  pageInfo?: { totalResults?: number };
  items?: Array<{ id?: { videoId?: string } }>;
}
interface VideosResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; description?: string; channelTitle?: string; channelId?: string; tags?: string[]; thumbnails?: { high?: { url?: string } } };
    contentDetails?: { duration?: string; definition?: string };
    status?: { license?: 'youtube' | 'creativeCommon'; embeddable?: boolean; privacyStatus?: string };
  }>;
}

export function parseIsoDuration(value: string | undefined): number | undefined {
  const m = value?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

export class YouTubeAdapter implements MediaProviderAdapter {
  readonly descriptor = YOUTUBE_DESCRIPTOR;
  private readonly pageTokens = new Map<string, string>();

  constructor(private readonly options: { apiKey: () => string | null; fetchImpl?: typeof fetch; regionCode?: string }) {}

  isConfigured(): boolean {
    return Boolean(this.options.apiKey());
  }

  private key(): string {
    const key = this.options.apiKey();
    if (!key) throw new MediaProviderError('auth_missing', 'youtube', 'API key do YouTube não configurada.', false);
    return key;
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    const key = this.key();
    const page = request.page ?? 1;
    const perPage = Math.min(50, request.perPage ?? 10);
    const tokenKey = `${request.query.toLowerCase()}|${perPage}|${page}`;
    const pageToken = page > 1 ? this.pageTokens.get(tokenKey) : undefined;
    if (page > 1 && !pageToken) return { items: [], page, perPage, hasMore: false };
    const params = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: String(perPage), q: request.query, key, safeSearch: 'moderate', videoEmbeddable: 'any' });
    if (pageToken) params.set('pageToken', pageToken);
    if (this.options.regionCode) params.set('regionCode', this.options.regionCode);
    const common = { ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}), ...(request.signal ? { signal: request.signal } : {}), redact: [key] };
    const { data } = await requestJson<SearchResponse>('youtube', `https://www.googleapis.com/youtube/v3/search?${params}`, common);
    if (data.nextPageToken) this.pageTokens.set(`${request.query.toLowerCase()}|${perPage}|${page + 1}`, data.nextPageToken);
    const ids = (data.items ?? []).map((i) => i.id?.videoId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return { items: [], page, perPage, hasMore: false };
    const vp = new URLSearchParams({ part: 'snippet,contentDetails,status', id: ids.join(','), key });
    const { data: videos } = await requestJson<VideosResponse>('youtube', `https://www.googleapis.com/youtube/v3/videos?${vp}`, common);
    const publishers = request.context?.knownPublishers ?? [];
    // Anime scenes classify anime footage (episode clips, openings, PVs) instead of trailer/gameplay/stock.
    const animeContext = isAnimeSubjectOrGenre(`${request.context?.prompt ?? ''} ${(request.context?.entities ?? []).join(' ')} ${request.query}`, request.context?.genre);
    const items: ProviderMediaItem[] = (videos.items ?? []).map((v) => {
      const sn = v.snippet ?? {};
      const title = sn.title ?? v.id;
      const cls = classifyProviderItem({ provider: 'youtube', hint: 'youtube_video', kind: 'video', title, description: sn.description ?? '', tags: sn.tags ?? [], ...(sn.channelTitle ? { channelTitle: sn.channelTitle } : {}), officialPublishers: publishers, animeContext });
      const official = cls.confidence >= 0.8 && (cls.classification === 'official_game_trailer' || cls.classification === 'authentic_gameplay' || cls.classification === 'anime_footage');
      const cc = v.status?.license === 'creativeCommon';
      const license: LicenseInfo = cc
        ? { licenseId: 'cc-by-3.0', licenseName: 'Creative Commons BY (YouTube)', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', ...(sn.channelTitle ? { author: sn.channelTitle, attributionText: `"${title}" por ${sn.channelTitle} (CC BY) — YouTube` } : {}), commercialUse: 'allowed', automatedDownload: 'unknown', attributionRequired: true, restrictions: ['attribution_required'] }
        : official
          ? { licenseId: 'publisher_promotional', licenseName: 'Trailer oficial do publisher (licença padrão YouTube)', licenseUrl: 'https://www.youtube.com/t/terms', ...(sn.channelTitle ? { author: sn.channelTitle } : {}), commercialUse: 'unknown', automatedDownload: 'unknown', attributionRequired: 'recommended', restrictions: ['editorial_only', 'no_endorsement_implication'] }
          : { licenseId: 'unknown', licenseName: 'Licença padrão do YouTube', licenseUrl: 'https://www.youtube.com/t/terms', ...(sn.channelTitle ? { author: sn.channelTitle } : {}), commercialUse: 'unknown', automatedDownload: 'unknown', attributionRequired: 'recommended', restrictions: ['third_party_rights', 'unknown_terms'] };
      const durationSec = parseIsoDuration(v.contentDetails?.duration);
      return {
        id: `youtube:${v.id}`,
        provider: 'youtube',
        providerItemId: v.id,
        kind: 'video',
        title,
        ...(sn.description ? { description: sn.description.slice(0, 600) } : {}),
        pageUrl: `https://www.youtube.com/watch?v=${v.id}`,
        ...(sn.thumbnails?.high?.url ? { previewUrl: sn.thumbnails.high.url } : {}),
        ...(v.contentDetails?.definition === 'hd' ? { width: 1280, height: 720 } : {}),
        ...(durationSec !== undefined ? { durationSec } : {}),
        acquisition: { method: 'yt_dlp', url: `https://www.youtube.com/watch?v=${v.id}` },
        classification: cls.classification,
        classificationConfidence: cls.confidence,
        classificationEvidence: cls.evidence,
        aiGenerated: cls.aiGenerated,
        license,
        provenance: {
          provider: 'youtube',
          providerItemId: v.id,
          retrievedAt: nowIso(),
          apiEndpoint: 'youtube/v3/search+videos',
          subject: { ...(sn.channelTitle ? { channelTitle: sn.channelTitle } : {}), ...(publishers.length ? { publisher: publishers } : {}) },
        },
        tags: sn.tags ?? [],
      } satisfies ProviderMediaItem;
    });
    return { items, page, perPage, hasMore: Boolean(data.nextPageToken), ...(data.pageInfo?.totalResults !== undefined ? { totalHint: data.pageInfo.totalResults } : {}) };
  }

  healthCheck(signal?: AbortSignal) {
    // videos.list costs 1 quota unit — the cheapest real authenticated call.
    return healthFromProbe('youtube', async () => {
      const key = this.key();
      const { data } = await requestJson<VideosResponse>('youtube', `https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`, {
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
        ...(signal ? { signal } : {}),
        redact: [key],
      });
      return data.items?.length ?? 0;
    });
  }
}

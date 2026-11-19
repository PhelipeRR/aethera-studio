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

/**
 * Steam Storefront API (public, no key): `storesearch` to find the app, `appdetails` for trailers, screenshots and
 * store art. Trailers are served as HLS/DASH only (verified 2026-11-15), so they are acquired through yt-dlp/ffmpeg.
 */
export const STEAM_DESCRIPTOR: ProviderDescriptor = {
  id: 'steam',
  name: 'Steam Storefront',
  category: 'game_media',
  kinds: ['video', 'image'],
  docsUrl: 'https://wiki.teamfortress.com/wiki/User:RJackson/StorefrontAPI',
  credentialFields: [],
  knownLimits: '~200 requisições / 5 min por IP em appdetails (não documentado oficialmente).',
  enabledByDefault: true,
  defaultPriority: 10,
  capabilities: { search: true, categories: false, pagination: true, preview: true, automatedAcquisition: true, metadataOnly: false },
  termsSummary:
    'Trailers, screenshots e artes pertencem aos publishers. Material promocional: uso editorial somente com autorização explícita do usuário; caso contrário, revisão humana.',
  rateLimit: { requests: 35, perMs: 60_000, maxConcurrent: 2 },
};

interface SteamSearchResponse {
  items?: Array<{ type?: string; name?: string; id?: number }>;
}
interface SteamAppData {
  name?: string;
  type?: string;
  steam_appid?: number;
  short_description?: string;
  header_image?: string;
  capsule_image?: string;
  developers?: string[];
  publishers?: string[];
  screenshots?: Array<{ id?: number; path_thumbnail?: string; path_full?: string }>;
  movies?: Array<{ id?: number; name?: string; thumbnail?: string; hls_h264?: string; dash_h264?: string; mp4?: { max?: string; '480'?: string }; webm?: { max?: string } }>;
}

const steamLicense = (publishers: string[]): LicenseInfo => ({
  licenseId: 'publisher_promotional',
  licenseName: 'Material promocional (Steam Store)',
  licenseUrl: 'https://store.steampowered.com/subscriber_agreement/',
  ...(publishers.length ? { author: publishers.join(', '), attributionText: `© ${publishers.join(', ')} — via Steam` } : {}),
  commercialUse: 'unknown',
  automatedDownload: 'allowed',
  attributionRequired: 'recommended',
  restrictions: ['editorial_only', 'no_endorsement_implication'],
  notes: 'Conteúdo protegido por direitos autorais do publisher; Steam não concede licença de reutilização.',
});

export class SteamAdapter implements MediaProviderAdapter {
  readonly descriptor = STEAM_DESCRIPTOR;
  constructor(private readonly options: { fetchImpl?: typeof fetch; country?: string; language?: string; appsPerQuery?: number } = {}) {}

  isConfigured(): boolean {
    return true;
  }

  async findApps(term: string, signal?: AbortSignal): Promise<Array<{ id: number; name: string }>> {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=${this.options.language ?? 'english'}&cc=${this.options.country ?? 'US'}`;
    const { data } = await requestJson<SteamSearchResponse>('steam', url, { ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}), ...(signal ? { signal } : {}) });
    return (data.items ?? []).flatMap((i) => (i.type === 'app' && typeof i.id === 'number' && i.name ? [{ id: i.id, name: i.name }] : []));
  }

  async appDetails(appId: number, signal?: AbortSignal): Promise<SteamAppData | null> {
    const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${this.options.language ?? 'english'}`;
    const { data } = await requestJson<Record<string, { success?: boolean; data?: SteamAppData }>>('steam', url, {
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      ...(signal ? { signal } : {}),
    });
    const entry = data[String(appId)];
    return entry?.success && entry.data ? entry.data : null;
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    const terms = [request.query, request.context?.entities?.[0], request.query.split(/\s+/).slice(0, 3).join(' ')]
      .map((t) => t?.trim())
      .filter((t, i, arr): t is string => Boolean(t) && arr.indexOf(t) === i);
    let apps: Array<{ id: number; name: string }> = [];
    for (const term of terms) {
      apps = await this.findApps(term, request.signal);
      if (apps.length > 0) break;
    }
    const items: ProviderMediaItem[] = [];
    const kinds = new Set<MediaKind>(request.kinds ?? ['video', 'image']);
    for (const app of apps.slice(0, this.options.appsPerQuery ?? 2)) {
      const details = await this.appDetails(app.id, request.signal);
      if (!details || (details.type && details.type !== 'game' && details.type !== 'dlc')) continue;
      items.push(...this.itemsFromApp(app.id, details, kinds));
    }
    const page = request.page ?? 1;
    const perPage = request.perPage ?? 10;
    const slice = items.slice((page - 1) * perPage, page * perPage);
    return { items: slice, page, perPage, hasMore: items.length > page * perPage, totalHint: items.length };
  }

  itemsFromApp(appId: number, d: SteamAppData, kinds: Set<MediaKind>): ProviderMediaItem[] {
    const publishers = [...new Set([...(d.publishers ?? []), ...(d.developers ?? [])])];
    const gameTitle = d.name ?? String(appId);
    const pageUrl = `https://store.steampowered.com/app/${appId}/`;
    const retrievedAt = nowIso();
    const base = (providerItemId: string, apiEndpoint: string) => ({
      provider: 'steam' as const,
      providerItemId,
      id: `steam:${providerItemId}`,
      pageUrl,
      license: steamLicense(publishers),
      provenance: { provider: 'steam' as const, providerItemId, retrievedAt, apiEndpoint, subject: { gameTitle, gameId: String(appId), publisher: publishers } },
      tags: [gameTitle],
    });
    const videos: ProviderMediaItem[] = [];
    const images: ProviderMediaItem[] = [];
    if (kinds.has('video')) {
      for (const m of d.movies ?? []) {
        const direct = m.mp4?.max ?? m.mp4?.['480'];
        const stream = m.hls_h264;
        const acquisition = direct ? ({ method: 'direct_http', url: direct } as const) : stream ? ({ method: 'hls', url: stream } as const) : null;
        if (!acquisition) continue;
        const title = `${gameTitle} — ${m.name ?? 'Trailer'}`;
        const cls = classifyProviderItem({ provider: 'steam', hint: 'steam_movie', kind: 'video', title: m.name ?? 'Trailer', officialPublishers: publishers });
        videos.push({
          ...base(`movie_${m.id ?? videos.length}`, 'appdetails.movies'),
          kind: 'video',
          title,
          ...(m.thumbnail ? { previewUrl: m.thumbnail } : {}),
          acquisition,
          fileFormat: direct ? 'mp4' : 'hls',
          classification: cls.classification,
          classificationConfidence: cls.confidence,
          classificationEvidence: cls.evidence,
          aiGenerated: cls.aiGenerated,
        });
      }
    }
    if (kinds.has('image')) {
      for (const s of d.screenshots ?? []) {
        if (!s.path_full) continue;
        const cls = classifyProviderItem({ provider: 'steam', hint: 'steam_screenshot', kind: 'image', title: gameTitle });
        images.push({
          ...base(`ss_${appId}_${s.id ?? images.length}`, 'appdetails.screenshots'),
          kind: 'image',
          title: `${gameTitle} — screenshot ${(s.id ?? 0) + 1}`,
          ...(s.path_thumbnail ? { previewUrl: s.path_thumbnail } : {}),
          ...(/1920x1080/.test(s.path_full) ? { width: 1920, height: 1080 } : {}),
          acquisition: { method: 'direct_http', url: s.path_full },
          fileFormat: 'jpg',
          classification: cls.classification,
          classificationConfidence: cls.confidence,
          classificationEvidence: cls.evidence,
          aiGenerated: cls.aiGenerated,
        });
      }
      if (d.header_image) {
        const cls = classifyProviderItem({ provider: 'steam', hint: 'steam_store_art', kind: 'image', title: gameTitle });
        images.push({
          ...base(`header_${appId}`, 'appdetails.header_image'),
          kind: 'image',
          title: `${gameTitle} — arte da loja`,
          previewUrl: d.header_image,
          acquisition: { method: 'direct_http', url: d.header_image },
          fileFormat: 'jpg',
          classification: cls.classification,
          classificationConfidence: cls.confidence,
          classificationEvidence: cls.evidence,
          aiGenerated: cls.aiGenerated,
        });
      }
    }
    // Keep top trailers first while ensuring official screenshots fit inside the first page (perPage=8).
    return [...videos.slice(0, 3), ...images.slice(0, 4), ...videos.slice(3), ...images.slice(4)];
  }

  healthCheck(signal?: AbortSignal) {
    return healthFromProbe('steam', async () => (await this.findApps('portal', signal)).length);
  }
}

import { classifyProviderItem } from '../classification.js';
import { healthFromProbe, nowIso } from '../http.js';
import {
  MediaProviderError,
  type LicenseInfo,
  type MediaProviderAdapter,
  type ProviderDescriptor,
  type ProviderErrorCode,
  type ProviderMediaItem,
  type ProviderSearchPage,
  type ProviderSearchRequest,
} from '../types.js';

/**
 * IGDB adapter. It does not talk to IGDB itself: the desktop injects the existing `IgdbClient` (orchestrator, Twitch
 * OAuth + 4 req/s limiter + retry) through this port, so there is a single IGDB client in the codebase.
 */
export interface IgdbGameLike {
  id: number;
  name: string;
  url?: string;
  first_release_date?: number;
  involved_companies?: Array<{ company?: { name: string }; developer?: boolean; publisher?: boolean }>;
  screenshots?: Array<{ image_id: string }>;
  artworks?: Array<{ image_id: string }>;
  parent_game?: number;
  version_parent?: number;
}

export interface IgdbPort {
  configured(): boolean;
  searchGames(title: string, signal?: AbortSignal): Promise<IgdbGameLike[]>;
  gameVideos(gameId: number, signal?: AbortSignal): Promise<Array<{ name: string; videoId: string }>>;
}

export const IGDB_DESCRIPTOR: ProviderDescriptor = {
  id: 'igdb',
  name: 'IGDB (Twitch)',
  category: 'game_metadata',
  kinds: ['image', 'video'],
  docsUrl: 'https://api-docs.igdb.com/',
  credentialFields: [
    { key: 'clientId', label: 'Client ID (Twitch)', secret: false },
    { key: 'clientSecret', label: 'Client Secret (Twitch)', secret: true },
  ],
  knownLimits: '4 requisições/s e 8 abertas simultâneas (limite oficial).',
  enabledByDefault: true,
  defaultPriority: 20,
  capabilities: { search: true, categories: false, pagination: true, preview: true, automatedAcquisition: true, metadataOnly: false },
  termsSummary:
    'Metadados sob os termos da Twitch Developer Agreement; screenshots/artworks pertencem aos publishers (uso editorial requer autorização). Vídeos apontam para o YouTube.',
  rateLimit: { requests: 4, perMs: 1_000, maxConcurrent: 4 },
};

const IMG = (size: string, id: string) => `https://images.igdb.com/igdb/image/upload/t_${size}/${id}.jpg`;

function igdbLicense(publishers: string[]): LicenseInfo {
  return {
    licenseId: 'publisher_promotional',
    licenseName: 'Material promocional (via IGDB)',
    licenseUrl: 'https://www.twitch.tv/p/legal/developer-agreement/',
    ...(publishers.length ? { author: publishers.join(', '), attributionText: `© ${publishers.join(', ')} — dados IGDB.com` } : {}),
    commercialUse: 'unknown',
    automatedDownload: 'allowed',
    attributionRequired: 'recommended',
    restrictions: ['editorial_only', 'no_endorsement_implication'],
  };
}

function mapError(error: unknown): unknown {
  const code = (error as { code?: string }).code;
  const map: Record<string, ProviderErrorCode> = {
    auth_required: 'auth_missing',
    auth_failed: 'auth_failed',
    rate_limited: 'rate_limited',
    unavailable: 'unavailable',
    invalid_response: 'invalid_response',
    cancelled: 'cancelled',
  };
  if (code && map[code]) {
    const retryable = Boolean((error as { retryable?: boolean }).retryable);
    return new MediaProviderError(map[code], 'igdb', error instanceof Error ? error.message : String(error), retryable);
  }
  return error;
}

export class IgdbAdapter implements MediaProviderAdapter {
  readonly descriptor = IGDB_DESCRIPTOR;
  constructor(private readonly port: IgdbPort) {}

  isConfigured(): boolean {
    return this.port.configured();
  }

  async search(request: ProviderSearchRequest): Promise<ProviderSearchPage> {
    try {
      const term = request.context?.entities?.[0]?.trim() || request.query;
      const games = (await this.port.searchGames(term, request.signal)).filter((g) => g.parent_game === undefined && g.version_parent === undefined);
      const items: ProviderMediaItem[] = [];
      const wantVideo = !request.kinds || request.kinds.includes('video');
      const wantImage = !request.kinds || request.kinds.includes('image');
      for (const game of games.slice(0, 2)) {
        const publishers = [...new Set((game.involved_companies ?? []).flatMap((c) => (c.company && (c.publisher || c.developer) ? [c.company.name] : [])))];
        const pageUrl = game.url ?? `https://www.igdb.com/games/${game.id}`;
        const retrievedAt = nowIso();
        const subject = { gameTitle: game.name, gameId: `igdb:${game.id}`, publisher: publishers };
        const make = (providerItemId: string, endpoint: string, partial: Omit<ProviderMediaItem, 'id' | 'provider' | 'providerItemId' | 'pageUrl' | 'license' | 'provenance' | 'tags'>): ProviderMediaItem => ({
          id: `igdb:${providerItemId}`,
          provider: 'igdb',
          providerItemId,
          pageUrl,
          license: igdbLicense(publishers),
          provenance: { provider: 'igdb', providerItemId, retrievedAt, apiEndpoint: endpoint, subject },
          tags: [game.name],
          ...partial,
        });
        if (wantImage) {
          for (const s of game.screenshots ?? []) {
            const cls = classifyProviderItem({ provider: 'igdb', hint: 'igdb_screenshot', kind: 'image', title: game.name });
            items.push(make(`ss_${s.image_id}`, 'games.screenshots', {
              kind: 'image', title: `${game.name} — screenshot`, previewUrl: IMG('screenshot_med', s.image_id), width: 1280, height: 720,
              acquisition: { method: 'direct_http', url: IMG('screenshot_huge', s.image_id) }, fileFormat: 'jpg',
              classification: cls.classification, classificationConfidence: cls.confidence, classificationEvidence: cls.evidence, aiGenerated: cls.aiGenerated,
            }));
          }
          for (const a of game.artworks ?? []) {
            const cls = classifyProviderItem({ provider: 'igdb', hint: 'igdb_artwork', kind: 'image', title: game.name });
            items.push(make(`art_${a.image_id}`, 'games.artworks', {
              kind: 'image', title: `${game.name} — artwork`, previewUrl: IMG('screenshot_med', a.image_id), width: 1920, height: 1080,
              acquisition: { method: 'direct_http', url: IMG('1080p', a.image_id) }, fileFormat: 'jpg',
              classification: cls.classification, classificationConfidence: cls.confidence, classificationEvidence: cls.evidence, aiGenerated: cls.aiGenerated,
            }));
          }
        }
        if (wantVideo) {
          for (const v of await this.port.gameVideos(game.id, request.signal)) {
            const cls = classifyProviderItem({ provider: 'igdb', hint: 'igdb_video', kind: 'video', title: v.name });
            items.push({
              ...make(`video_${v.videoId}`, 'game_videos', {
                kind: 'video', title: `${game.name} — ${v.name || 'vídeo'}`, previewUrl: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
                acquisition: { method: 'yt_dlp', url: `https://www.youtube.com/watch?v=${v.videoId}` },
                classification: cls.classification, classificationConfidence: cls.confidence, classificationEvidence: cls.evidence, aiGenerated: cls.aiGenerated,
              }),
              pageUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
            });
          }
        }
      }
      const page = request.page ?? 1;
      const perPage = request.perPage ?? 10;
      return { items: items.slice((page - 1) * perPage, page * perPage), page, perPage, hasMore: items.length > page * perPage, totalHint: items.length };
    } catch (error) {
      throw mapError(error);
    }
  }

  healthCheck(signal?: AbortSignal) {
    return healthFromProbe('igdb', async () => {
      try {
        return (await this.port.searchGames('Portal 2', signal)).length;
      } catch (error) {
        throw mapError(error);
      }
    });
  }
}

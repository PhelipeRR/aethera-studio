import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  classifyProviderItem,
  checkSourceFidelity,
  createDefaultMediaProviderAdapters,
  evaluateLicense,
  HuggingFaceDatasetsAdapter,
  IgdbAdapter,
  KawaiiRedAdapter,
  MediaProviderError,
  MediaProviderRegistry,
  NekosBestAdapter,
  PexelsAdapter,
  PixabayAdapter,
  planSceneSources,
  runAutonomousMediaAcquisition,
  searchResilientMediaSources,
  SlidingWindowRateLimiter,
  SteamAdapter,
  withRetry,
  YouTubeAdapter,
  type Clock,
  type MediaProviderAdapter,
  type ProviderMediaItem,
  type ProviderTelemetryEvent,
} from '../src/index.js';

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
function fakeFetch(routes: Array<[RegExp, Route]>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    for (const [re, route] of routes) if (re.test(url)) return route(url, init);
    return json({ error: 'no route' }, 404);
  }) as typeof fetch;
}

/** Fake clock: sleeping advances time instantly so rate-limit/retry tests are deterministic and fast. */
function fakeClock(): Clock & { t: number; sleeps: number[] } {
  const c = {
    t: 1_000_000,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

// Shapes copied from real responses captured on 2026-11-15 (trimmed).
const STEAM_SEARCH = { total: 1, items: [{ type: 'app', name: 'Cyberpunk 2077', id: 1091500 }] };
const STEAM_DETAILS = {
  '1091500': {
    success: true,
    data: {
      type: 'game',
      name: 'Cyberpunk 2077',
      steam_appid: 1091500,
      developers: ['CD PROJEKT RED'],
      publishers: ['CD PROJEKT RED'],
      header_image: 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1091500/header.jpg?t=1',
      screenshots: [
        { id: 0, path_thumbnail: 'https://cdn/ss_a.600x338.jpg?t=1', path_full: 'https://cdn/ss_a.1920x1080.jpg?t=1' },
        { id: 1, path_thumbnail: 'https://cdn/ss_b.600x338.jpg?t=1', path_full: 'https://cdn/ss_b.1920x1080.jpg?t=1' },
      ],
      movies: [
        {
          id: 257474176,
          name: 'Cyberpunk 2077 | Edgerunners 2 Update Launch Trailer',
          thumbnail: 'https://cdn/movie_600x337.jpg',
          dash_h264: 'https://video.akamai.steamstatic.com/store_trailers/1091500/x/dash_h264.mpd?t=1',
          hls_h264: 'https://video.akamai.steamstatic.com/store_trailers/1091500/x/hls_264_master.m3u8?t=1',
        },
      ],
    },
  },
};

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('Steam adapter', () => {
  it('maps trailers (HLS), screenshots and store art with provenance and official classes', async () => {
    const steam = new SteamAdapter({ fetchImpl: fakeFetch([[/storesearch/, () => json(STEAM_SEARCH)], [/appdetails/, () => json(STEAM_DETAILS)]]) });
    const page = await steam.search({ query: 'Cyberpunk 2077', perPage: 10 });
    expect(page.items).toHaveLength(4);
    const trailer = page.items.find((i) => i.kind === 'video')!;
    expect(trailer.acquisition).toEqual({ method: 'hls', url: expect.stringContaining('.m3u8') });
    expect(trailer.classification).toBe('official_game_trailer');
    expect(trailer.provenance.subject?.gameTitle).toBe('Cyberpunk 2077');
    expect(trailer.license.licenseId).toBe('publisher_promotional');
    const shot = page.items.find((i) => i.classification === 'official_screenshot')!;
    expect(shot.width).toBe(1920);
    expect(page.items.some((i) => i.classification === 'promotional_artwork')).toBe(true);
  });

  it('paginates over the flattened media list', async () => {
    const steam = new SteamAdapter({ fetchImpl: fakeFetch([[/storesearch/, () => json(STEAM_SEARCH)], [/appdetails/, () => json(STEAM_DETAILS)]]) });
    const p1 = await steam.search({ query: 'Cyberpunk 2077', perPage: 3, page: 1 });
    const p2 = await steam.search({ query: 'Cyberpunk 2077', perPage: 3, page: 2 });
    expect(p1.items).toHaveLength(3);
    expect(p1.hasMore).toBe(true);
    expect(p2.items).toHaveLength(1);
    expect(p2.hasMore).toBe(false);
  });
});

describe('IGDB adapter (port over the existing IgdbClient)', () => {
  it('turns screenshots, artworks and game videos into identity-grade items', async () => {
    const igdb = new IgdbAdapter({
      configured: () => true,
      searchGames: async () => [
        { id: 1877, name: 'Cyberpunk 2077', involved_companies: [{ company: { name: 'CD Projekt RED' }, developer: true }], screenshots: [{ image_id: 'sc1' }], artworks: [{ image_id: 'ar1' }] },
      ],
      gameVideos: async () => [{ name: 'Gameplay Reveal', videoId: 'abcdefghijk' }],
    });
    const page = await igdb.search({ query: 'Cyberpunk 2077' });
    expect(page.items.map((i) => i.classification).sort()).toEqual(['authentic_gameplay', 'official_screenshot', 'promotional_artwork']);
    expect(page.items.find((i) => i.kind === 'video')!.acquisition).toEqual({ method: 'yt_dlp', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
    expect(page.items[0]!.acquisition.url).toContain('images.igdb.com/igdb/image/upload/t_');
  });

  it('maps IgdbClient errors to typed provider errors', async () => {
    const err = Object.assign(new Error('auth_required: configure'), { code: 'auth_required', retryable: false });
    const igdb = new IgdbAdapter({ configured: () => true, searchGames: async () => { throw err; }, gameVideos: async () => [] });
    await expect(igdb.search({ query: 'x' })).rejects.toMatchObject({ code: 'auth_missing', provider: 'igdb' });
  });
});

describe('YouTube adapter', () => {
  const routes = (calls: string[]) =>
    fakeFetch(
      [
        [/youtube\/v3\/search/, () => json({ nextPageToken: 'NEXT', pageInfo: { totalResults: 99 }, items: [{ id: { videoId: 'v1' } }, { id: { videoId: 'v2' } }, { id: { videoId: 'v3' } }] })],
        [
          /youtube\/v3\/videos/,
          () =>
            json({
              items: [
                { id: 'v1', snippet: { title: 'Cyberpunk 2077 — Official Launch Trailer', channelTitle: 'CD PROJEKT RED' }, contentDetails: { duration: 'PT2M30S', definition: 'hd' }, status: { license: 'youtube' } },
                { id: 'v2', snippet: { title: 'Cyberpunk 2077 Trailer REACTION', channelTitle: 'Random Reacts' }, contentDetails: { duration: 'PT12M' }, status: { license: 'youtube' } },
                { id: 'v3', snippet: { title: 'Night City drive gameplay no commentary', channelTitle: 'CC Gamer' }, contentDetails: { duration: 'PT5M' }, status: { license: 'creativeCommon' } },
              ],
            }),
        ],
      ],
      calls,
    );

  it('recognises official channels, parses durations, CC license and keeps page tokens', async () => {
    const calls: string[] = [];
    const yt = new YouTubeAdapter({ apiKey: () => 'SECRET-YT-KEY', fetchImpl: routes(calls) });
    const page = await yt.search({ query: 'Cyberpunk 2077 trailer', context: { knownPublishers: ['CD PROJEKT RED'] } });
    const [official, reaction, cc] = page.items;
    expect(official!.classification).toBe('official_game_trailer');
    expect(official!.classificationConfidence).toBeGreaterThanOrEqual(0.9);
    expect(official!.license.licenseId).toBe('publisher_promotional');
    expect(official!.durationSec).toBe(150);
    expect(reaction!.classificationConfidence).toBeLessThan(0.6);
    expect(reaction!.license.licenseId).toBe('unknown');
    expect(cc!.license.licenseId).toBe('cc-by-3.0');
    expect(page.hasMore).toBe(true);
    await yt.search({ query: 'Cyberpunk 2077 trailer', page: 2 });
    expect(calls.some((c) => c.includes('pageToken=NEXT'))).toBe(true);
  });

  it('never leaks the API key in error messages', async () => {
    const yt = new YouTubeAdapter({
      apiKey: () => 'SECRET-YT-KEY',
      fetchImpl: fakeFetch([[/./, (url) => new Response(`bad key ${new URL(url).searchParams.get('key')}`, { status: 400 })]]),
    });
    const err = await yt.search({ query: 'x' }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(MediaProviderError);
    expect(err.message).not.toContain('SECRET-YT-KEY');
  });

  it('reports missing key without a network call', async () => {
    const calls: string[] = [];
    const yt = new YouTubeAdapter({ apiKey: () => null, fetchImpl: fakeFetch([], calls) });
    expect(yt.isConfigured()).toBe(false);
    await expect(yt.search({ query: 'x' })).rejects.toMatchObject({ code: 'auth_missing' });
    expect(calls).toHaveLength(0);
  });
});

describe('Pexels & Pixabay adapters', () => {
  it('Pexels sends the key as Authorization header and records photographer attribution', async () => {
    let auth = '';
    const fetchImpl = fakeFetch([
      [/videos\/search/, () => json({ page: 1, per_page: 2, total_results: 1, videos: [{ id: 7, width: 3840, height: 2160, url: 'https://www.pexels.com/video/server-room-7/', image: 'https://img/7.jpg', duration: 14, user: { name: 'Ana', url: 'https://www.pexels.com/@ana' }, video_files: [{ quality: 'uhd', file_type: 'video/mp4', width: 3840, height: 2160, link: 'https://v/7-uhd.mp4' }, { quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://v/7-hd.mp4' }] }] })],
      [/v1\/search/, (_u, init) => { auth = String((init?.headers as Record<string, string>).Authorization); return json({ page: 1, per_page: 2, total_results: 1, photos: [{ id: 9, width: 4000, height: 3000, url: 'https://www.pexels.com/photo/laptop-9/', photographer: 'Bruno', photographer_url: 'https://www.pexels.com/@bruno', alt: 'Laptop on desk', src: { large2x: 'https://p/9.jpg', medium: 'https://p/9m.jpg' } }] }); }],
    ]);
    const pexels = new PexelsAdapter({ apiKey: () => 'PX-KEY', fetchImpl });
    const page = await pexels.search({ query: 'technology' });
    expect(auth).toBe('PX-KEY');
    const video = page.items.find((i) => i.kind === 'video')!;
    expect(video.acquisition.url).toBe('https://v/7-hd.mp4');
    expect(video.classification).toBe('stock_video');
    const photo = page.items.find((i) => i.kind === 'image')!;
    expect(photo.license.attributionText).toContain('Bruno via Pexels');
    expect(evaluateLicense(photo.license).status).toBe('allowed_with_restrictions');
  });

  it('Pixabay flags AI-tagged illustrations and caps the query at 100 chars', async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch(
      [
        [/api\/videos/, () => json({ totalHits: 0, hits: [] })],
        [/pixabay\.com\/api\/\?/, () => json({ totalHits: 2, hits: [
          { id: 1, pageURL: 'https://pixabay.com/1', type: 'photo', tags: 'computer, code', largeImageURL: 'https://px/1.jpg', imageWidth: 1920, imageHeight: 1280, user: 'u1' },
          { id: 2, pageURL: 'https://pixabay.com/2', type: 'illustration', tags: 'ai generated, robot', largeImageURL: 'https://px/2.jpg', user: 'u2' },
        ] })],
      ],
      calls,
    );
    const pixabay = new PixabayAdapter({ apiKey: () => 'PB-KEY', fetchImpl });
    const page = await pixabay.search({ query: 'x'.repeat(150) });
    expect(new URL(calls[0]!).searchParams.get('q')).toHaveLength(100);
    expect(page.items[0]!.classification).toBe('stock_image');
    expect(page.items[1]!.classification).toBe('ai_generated');
    expect(page.items[1]!.aiGenerated).toBe(true);
  });
});

describe('Anime & reactions adapters', () => {
  it('nekos.best is preview-only: no automated acquisition and blocked license for commercial production', async () => {
    const nekos = new NekosBestAdapter({
      fetchImpl: fakeFetch([
        [/endpoints/, () => json({ hug: { format: 'gif' }, neko: { format: 'png' } })],
        [/\/api\/v2\/hug/, () => json({ results: [{ anime_name: 'Naruto', url: 'https://nekos.best/api/v2/hug/abc.gif', dimensions: { width: 498, height: 280 } }] })],
      ]),
    });
    const page = await nekos.search({ query: 'anime hug reaction' });
    const item = page.items[0]!;
    expect(item.classification).toBe('anime_reaction_gif');
    expect(item.acquisition.method).toBe('none');
    expect(evaluateLicense(item.license, { commercialUse: true, allowEditorialPromotionalUse: true, automatedAcquisition: true }).status).toBe('blocked');
  });

  it('kawaii.red uses the anonymous token and marks unknown license', async () => {
    const calls: string[] = [];
    const kawaii = new KawaiiRedAdapter({
      fetchImpl: fakeFetch(
        [
          [/endpoints/, () => json({ response: ['.htaccess', 'hug', 'cry'] })],
          [/gif\/hug/, () => json({ response: `https://api.kawaii.red/gif/hug/hug${calls.length}.gif` })],
        ],
        calls,
      ),
    });
    const page = await kawaii.search({ query: 'hug', perPage: 2 });
    expect(calls[0]).toContain('token=anonymous');
    expect(page.items).toHaveLength(2);
    expect(evaluateLicense(page.items[0]!.license).status).toBe('pending_human_review');
  });
});

describe('Hugging Face datasets adapter', () => {
  it('discovers datasets, filters gated/private ones and never offers acquisition', async () => {
    const hf = new HuggingFaceDatasetsAdapter({
      fetchImpl: fakeFetch([[/api\/datasets/, () => json([
        { id: 'a/open', cardData: { license: 'cc-by-4.0' }, tags: ['modality:video', 'size_categories:n<1K'] },
        { id: 'b/nc', cardData: { license: 'cc-by-nc-4.0' }, tags: ['modality:video'] },
        { id: 'c/gated', gated: 'auto', tags: [] },
        { id: 'd/unknown', tags: ['modality:video'] },
      ])]]),
    });
    const page = await hf.search({ query: 'gameplay' });
    expect(page.items.map((i) => i.providerItemId)).toEqual(['a/open', 'b/nc', 'd/unknown']);
    for (const i of page.items) {
      expect(i.classification).toBe('dataset_media');
      expect(i.acquisition.method).toBe('none');
      expect(i.license.restrictions).toContain('third_party_rights');
    }
    // even a permissive card license is not a uniform license for its files
    expect(evaluateLicense(page.items[0]!.license, { commercialUse: true, allowEditorialPromotionalUse: false, automatedAcquisition: false }).status).toBe('pending_human_review');
    expect(evaluateLicense(page.items[1]!.license).status).toBe('blocked');
  });
});

describe('licensing policy', () => {
  const promo = { licenseId: 'publisher_promotional', licenseName: 'Promo', commercialUse: 'unknown' as const, automatedDownload: 'allowed' as const, attributionRequired: 'recommended' as const, restrictions: ['editorial_only' as const] };
  it('publisher promotional media waits for review unless the user opted in to editorial use', () => {
    expect(evaluateLicense(promo).status).toBe('pending_human_review');
    expect(evaluateLicense(promo, { commercialUse: true, allowEditorialPromotionalUse: true, automatedAcquisition: true }).status).toBe('allowed_with_restrictions');
  });
  it('unknown terms are never approved automatically; ND licenses are blocked', () => {
    expect(evaluateLicense({ ...promo, licenseId: 'unknown', restrictions: ['unknown_terms'] }).status).toBe('pending_human_review');
    expect(evaluateLicense({ ...promo, licenseId: 'cc-by-nd-4.0', commercialUse: 'allowed' }).status).toBe('blocked');
  });
});

describe('classification', () => {
  it('AI signals override every official class', () => {
    expect(classifyProviderItem({ provider: 'steam', hint: 'steam_screenshot', kind: 'image', title: 'AI generated concept' }).classification).toBe('ai_generated');
    expect(classifyProviderItem({ provider: 'youtube', hint: 'youtube_video', kind: 'video', title: 'Elden Ring 2 trailer made with Midjourney' }).classification).toBe('ai_generated');
  });
  it('fan-made trailers never reach identity-grade confidence', () => {
    const r = classifyProviderItem({ provider: 'youtube', hint: 'youtube_video', kind: 'video', title: 'GTA 7 Fan Made Trailer', channelTitle: 'Rockstar Games', officialPublishers: ['Rockstar Games'] });
    expect(r.confidence).toBeLessThan(0.6);
  });
});

describe('scene source selection & source fidelity (Scene Grounding pre-gate)', () => {
  it('plans providers by scene context', () => {
    expect(planSceneSources({ prompt: 'Análise de Cyberpunk 2077', entities: ['Cyberpunk 2077'] }).providers.slice(0, 2)).toEqual(['steam', 'igdb']);
    expect(planSceneSources({ prompt: 'TOP 10 jogos de 2027', genre: 'top_list' }).intent).toBe('game_ranking');
    expect(planSceneSources({ prompt: 'Como a tecnologia mudou o trabalho', narrationText: 'servidores e data center' }).providers).toEqual(['pexels', 'pixabay']);
    expect(planSceneSources({ prompt: 'anime', genre: 'anime', narrationText: 'aquela reação de vergonha' }).intent).toBe('anime_reaction');
    expect(planSceneSources({ prompt: 'Naruto vs Sasuke', genre: 'anime', entities: ['Naruto'] }).intent).toBe('anime_identity');
  });

  const item = (over: Partial<ProviderMediaItem>): ProviderMediaItem => ({
    id: 'x:1', provider: 'pexels', providerItemId: '1', kind: 'image', title: 't', pageUrl: 'https://p', acquisition: { method: 'direct_http', url: 'https://p/1.jpg' },
    classification: 'stock_image', classificationConfidence: 0.9, classificationEvidence: [], aiGenerated: 'unknown',
    license: { licenseId: 'pexels_license', licenseName: 'Pexels', commercialUse: 'allowed', automatedDownload: 'allowed', attributionRequired: true, restrictions: [] },
    provenance: { provider: 'pexels', providerItemId: '1', retrievedAt: '', apiEndpoint: '' }, tags: [], ...over,
  });

  it('stock or AI media never stands in for a specific game; wrong game is rejected', () => {
    const ctx = { prompt: 'Cyberpunk 2077 Johnny Silverhand', entities: ['Cyberpunk 2077', 'Johnny Silverhand'] };
    const plan = planSceneSources(ctx);
    expect(checkSourceFidelity(item({}), plan, ctx)).toMatchObject({ pass: false, code: 'class_not_allowed_for_scene' });
    expect(checkSourceFidelity(item({ classification: 'official_screenshot', aiGenerated: true }), plan, ctx)).toMatchObject({ pass: false, code: 'ai_generated_for_identity_scene' });
    expect(checkSourceFidelity(item({ classification: 'official_screenshot', provenance: { provider: 'steam', providerItemId: '1', retrievedAt: '', apiEndpoint: '', subject: { gameTitle: 'The Witcher 3' } } }), plan, ctx)).toMatchObject({ pass: false, code: 'subject_mismatch' });
    // Fan/concept material (near-certain non-authentic) is dropped before download...
    expect(checkSourceFidelity(item({ classification: 'official_game_trailer', classificationConfidence: 0.05 }), plan, ctx)).toMatchObject({ pass: false, code: 'low_classification_confidence' });
    // ...but an unverified channel is not proof of inauthenticity: official origin raises confidence, frames decide.
    expect(checkSourceFidelity(item({ classification: 'official_game_trailer', classificationConfidence: 0.35 }), plan, ctx).pass).toBe(true);
    expect(checkSourceFidelity(item({ classification: 'official_screenshot', provenance: { provider: 'steam', providerItemId: '1', retrievedAt: '', apiEndpoint: '', subject: { gameTitle: 'Cyberpunk 2077' } } }), plan, ctx).pass).toBe(true);
  });
});

describe('resilience primitives', () => {
  it('rate limiter spaces requests to the window', async () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter({ requests: 2, perMs: 1000, maxConcurrent: 5 }, clock);
    const starts: number[] = [];
    await Promise.all([1, 2, 3, 4, 5].map(() => limiter.run(async () => { starts.push(clock.t); })));
    expect(starts.filter((t) => t - starts[0]! < 1000)).toHaveLength(2);
    expect(starts[4]! - starts[0]!).toBeGreaterThanOrEqual(2000);
  });

  it('retry honours Retry-After on 429 and gives up on non-retryable errors', async () => {
    const clock = fakeClock();
    let n = 0;
    const result = await withRetry('pexels', async () => {
      n += 1;
      if (n < 3) throw new MediaProviderError('rate_limited', 'pexels', '429', true, 1500);
      return 'ok';
    }, { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 5000 }, clock);
    expect(result).toBe('ok');
    expect(clock.sleeps).toEqual([1500, 1500]);
    let m = 0;
    await expect(withRetry('pexels', async () => { m += 1; throw new MediaProviderError('auth_failed', 'pexels', '401', false); }, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }, clock)).rejects.toMatchObject({ code: 'auth_failed' });
    expect(m).toBe(1);
  });

  it('circuit breaker opens after consecutive failures and half-opens after cooldown', () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 1000 }, clock);
    cb.recordFailure();
    expect(cb.canPass()).toBe(true);
    cb.recordFailure();
    expect(cb.canPass()).toBe(false);
    clock.t += 1000;
    expect(cb.current()).toBe('half_open');
    cb.recordSuccess();
    expect(cb.current()).toBe('closed');
  });
});

function staticAdapter(id: 'steam' | 'igdb' | 'youtube' | 'pexels' | 'pixabay', items: ProviderMediaItem[] | (() => Promise<never>), configured = true): MediaProviderAdapter {
  const d = createDefaultMediaProviderAdapters().find((a) => a.descriptor.id === id)!.descriptor;
  return {
    descriptor: d,
    isConfigured: () => configured,
    search: async () => (typeof items === 'function' ? items() : { items, page: 1, perPage: items.length, hasMore: false }),
    healthCheck: async () => ({ connectivity: 'ok', detail: 'ok', checkedAt: '' }),
  };
}
const stock = (n: number, url = `https://cdn/${n}.mp4`): ProviderMediaItem => ({
  id: `pexels:${n}`, provider: 'pexels', providerItemId: String(n), kind: 'video', title: `server room ${n}`, pageUrl: `https://www.pexels.com/video/${n}`,
  acquisition: { method: 'direct_http', url }, classification: 'stock_video', classificationConfidence: 0.9, classificationEvidence: [], aiGenerated: 'unknown',
  width: 1920, height: 1080, durationSec: 12,
  license: { licenseId: 'pexels_license', licenseName: 'Pexels License', commercialUse: 'allowed', automatedDownload: 'allowed', attributionRequired: true, restrictions: ['attribution_required'] },
  provenance: { provider: 'pexels', providerItemId: String(n), retrievedAt: '', apiEndpoint: 'videos/search' }, tags: [],
});

describe('MediaProviderRegistry', () => {
  it('falls back to the next provider when one is down, logs the fallback for the right job, and deduplicates', async () => {
    const events: ProviderTelemetryEvent[] = [];
    const clock = fakeClock();
    const registry = new MediaProviderRegistry({
      clock,
      adapters: [
        staticAdapter('pexels', async () => { throw new MediaProviderError('unavailable', 'pexels', 'HTTP 503', true); }),
        staticAdapter('pixabay', [{ ...stock(1), provider: 'pixabay', id: 'pixabay:1' }, { ...stock(2, 'https://cdn/1.mp4'), provider: 'pixabay', id: 'pixabay:2' }]),
      ],
      onEvent: (e) => events.push(e),
    });
    const res = await registry.searchForScene('server room', { jobId: 'job-42', sceneId: 's1', prompt: 'tecnologia de servidores' });
    expect(res.attempts.map((a) => [a.provider, a.status])).toEqual([['pexels', 'error'], ['pixabay', 'ok']]);
    expect(res.accepted).toHaveLength(1);
    expect(res.rejected[0]).toMatchObject({ stage: 'duplicate' });
    expect(events.filter((e) => e.type === 'provider_retry')).toHaveLength(2);
    const fb = events.find((e) => e.type === 'provider_fallback');
    expect(fb).toMatchObject({ from: 'pexels', to: 'pixabay', jobId: 'job-42' });
    expect(events.every((e) => !('jobId' in e) || e.jobId === 'job-42')).toBe(true);
  });

  it('keeps distinct assets that share a store page (regression: Steam trailers)', async () => {
    const a = { ...stock(1), pageUrl: 'https://store.steampowered.com/app/1/' };
    const b = { ...stock(2), pageUrl: 'https://store.steampowered.com/app/1/' };
    const registry = new MediaProviderRegistry({ adapters: [staticAdapter('pexels', [a, b])] });
    const res = await registry.searchForScene('server', { prompt: 'tecnologia' });
    expect(res.accepted).toHaveLength(2);
  });

  it('skips providers without credentials or disabled by the user and reports them', async () => {
    const registry = new MediaProviderRegistry({
      adapters: [staticAdapter('pexels', [stock(1)], false), staticAdapter('pixabay', [stock(2)])],
      settings: () => ({ providers: { pixabay: { enabled: false, priority: 1 } }, allowEditorialPromotionalUse: false, commercialUse: true }),
    });
    const res = await registry.searchForScene('city', { prompt: 'cidade' });
    expect(res.attempts.map((a) => a.status)).toEqual(['skipped_disabled', 'skipped_no_auth']); // user priority 1 puts pixabay first
    expect(res.accepted).toHaveLength(0);
    const status = registry.status();
    expect(status.find((s) => s.id === 'pexels')!.connectivity).toBe('auth_missing');
    expect(status.find((s) => s.id === 'pixabay')!.connectivity).toBe('disabled');
  });

  it('opens the circuit after repeated failures and stops calling the provider', async () => {
    let calls = 0;
    const registry = new MediaProviderRegistry({
      clock: fakeClock(),
      adapters: [staticAdapter('pexels', async () => { calls += 1; throw new MediaProviderError('unavailable', 'pexels', '503', true); })],
    });
    await registry.searchForScene('a', { prompt: 'tecnologia' });
    const before = calls;
    const res = await registry.searchForScene('b', { prompt: 'tecnologia' });
    expect(res.attempts[0]!.status).toBe('circuit_open');
    expect(calls).toBe(before);
  });

  it('caches identical requests', async () => {
    let calls = 0;
    const adapter = staticAdapter('pexels', [stock(1)]);
    const search = adapter.search.bind(adapter);
    adapter.search = async (r) => { calls += 1; return search(r); };
    const registry = new MediaProviderRegistry({ adapters: [adapter] });
    await registry.search('pexels', { query: 'City' });
    const second = await registry.search('pexels', { query: 'city' });
    expect(calls).toBe(1);
    expect(second.fromCache).toBe(true);
  });

  it('downloads with real byte progress and supports cancellation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-dl-'));
    tmpDirs.push(dir);
    const payload = Buffer.alloc(300_000, 7);
    const events: ProviderTelemetryEvent[] = [];
    const clock = { now: (() => { let t = 0; return () => (t += 300); })(), sleep: async () => undefined };
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          for (let i = 0; i < payload.length; i += 50_000) {
            if (signal?.aborted) { controller.error(new Error('aborted')); return; }
            controller.enqueue(payload.subarray(i, i + 50_000));
            await new Promise((r) => setTimeout(r, 1));
          }
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-length': String(payload.length), 'content-type': 'video/mp4' } });
    }) as typeof fetch;
    const registry = new MediaProviderRegistry({ adapters: [], fetchImpl, clock, onEvent: (e) => events.push(e) });
    const res = await registry.acquire(stock(5, 'https://cdn/5'), dir, { jobId: 'job-7' });
    expect(readFileSync(res.filePath).length).toBe(payload.length);
    expect(res.filePath.endsWith('.mp4')).toBe(true);
    const progress = events.filter((e) => e.type === 'download_progress');
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toMatchObject({ pct: 100, jobId: 'job-7' });

    const ac = new AbortController();
    ac.abort();
    await expect(registry.acquire(stock(6, 'https://cdn/6.mp4'), dir, { signal: ac.signal })).rejects.toBeInstanceOf(MediaProviderError);
    expect(existsSync(join(dir, 'pexels_6.mp4'))).toBe(false);
    expect(events.some((e) => e.type === 'download_failed' && e.itemId === 'pexels:6')).toBe(true);
  });

  it('refuses to acquire items whose provider forbids automated download', async () => {
    const registry = new MediaProviderRegistry({ adapters: [] });
    const item = { ...stock(1), acquisition: { method: 'none' as const, reason: 'ToS' } };
    await expect(registry.acquire(item, tmpdir())).rejects.toMatchObject({ code: 'license_blocked' });
  });
});

describe('pipeline compatibility', () => {
  it('searchResilientMediaSources keeps legacy behaviour when no registry is injected', async () => {
    const res = await searchResilientMediaSources('x', { localMediaDirs: [], fetchImpl: (async () => json({}, 404)) as unknown as typeof fetch });
    expect(res.providerStatuses.map((s) => s.provider)).toEqual(['local_library', 'youtube_data_api', 'wikimedia_commons', 'internet_archive']);
  });

  it('registry media flows through acquisition; relevance-approved media with unknown license goes to human review, not approval', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-pipe-'));
    tmpDirs.push(dir);
    const body = Buffer.alloc(4096, 1);
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith('https://cdn/')) return new Response(Buffer.concat([body, Buffer.from(u)]), { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(body.length + u.length) } });
      return json({}, 404);
    }) as typeof fetch;
    const allowed = stock(1, 'https://cdn/server-room-1.mp4');
    const unknown = {
      ...stock(2, 'https://cdn/server-room-2.mp4'),
      license: { licenseId: 'unknown', licenseName: 'Desconhecida', commercialUse: 'unknown' as const, automatedDownload: 'unknown' as const, attributionRequired: false, restrictions: ['unknown_terms' as const] },
    };
    const registry = new MediaProviderRegistry({ adapters: [staticAdapter('pexels', [allowed, unknown])], fetchImpl });
    const audit = await runAutonomousMediaAcquisition({
      projectId: 'p-mp',
      prompt: 'Como a tecnologia de servidores mudou a internet',
      mediaDir: dir,
      segments: [{ segmentId: 's1', subject: 'server room', narrationText: 'Um data center moderno com servidores', entities: ['server room'], expectedDurationSec: 60 }],
      probeDurationFn: async () => 12,
      // Scene Grounding v3: metadata alone is never scene footage, so both candidates carry
      // distributed frame evidence; this test isolates the license gate.
      analyzeFrames: async (_uri, timestampsSec) =>
        timestampsSec.map((timestampSec) => ({
          timestampSec,
          visualCategory: 'interview_documentary' as const,
          detectedEntities: ['server room'],
          detectedActions: [],
          description: 'Corredor de data center com racks de servidores iluminados (server room).',
          confidence: 0.9,
        })),
      requireVisualVerification: false,
      checkpointPath: false,
      limits: { maxRounds: 1, maxDurationMs: 20_000 },
      deps: { localMediaDirs: [], fetchImpl, mediaProviders: { registry, context: { jobId: 'p-mp' } } },
    });
    expect(audit.candidatesByProvider.pexels).toBe(2);
    expect(audit.acquiredFilesCount).toBe(2);
    const approvedIds = audit.approvedMediaDetails.map((d) => d.sourceUrl);
    expect(approvedIds).toContain('https://cdn/server-room-1.mp4');
    expect(approvedIds).not.toContain('https://cdn/server-room-2.mp4');
    expect(audit.approvedMediaDetails[0]!.provenance).toMatchObject({ provider: 'pexels', licenseId: 'pexels_license', classification: 'stock_video' });
    expect(audit.pendingLicenseReview).toHaveLength(1);
    expect(audit.rejectedCandidates.some((r) => r.rejectionCode === 'license_pending_human_review')).toBe(true);
    // the individual relevance decision of the pending item is preserved
    expect(audit.relevanceDecisions).toHaveLength(2);
  });
});

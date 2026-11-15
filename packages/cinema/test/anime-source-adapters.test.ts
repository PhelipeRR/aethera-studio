import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  evaluateMediaRelevance,
  isAnimeSubjectOrGenre,
  SakugabooruSourceAdapter,
  searchResilientMediaSources,
  TraceMoeProvenanceAdapter,
} from '../src/index.js';

const tempDirs: string[] = [];
function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-anime-adapters-'));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Anime Source Adapters (trace.moe & Sakugabooru) + Scene Grounding Isolation', () => {
  it('identifies anime provenance via trace.moe, persists cache on disk, handles rate-limit/timeout, and falls back gracefully', async () => {
    const dir = makeTmp();
    const cachePath = join(dir, 'trace-moe-cache.json');
    let fetchCalls = 0;

    const mockFetch: typeof fetch = (async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        // Simulate transient 429 on first attempt -> should retry and succeed
        return new Response(JSON.stringify({ error: 'Too Many Requests' }), {
          status: 429,
          headers: { 'retry-after': '0.01' },
        });
      }
      return new Response(
        JSON.stringify({
          frameCount: 100,
          result: [
            {
              anilist: {
                id: 813,
                idMal: 813,
                title: { english: 'Dragon Ball Z', romaji: 'Dragon Ball Z', native: 'ドラゴンボールZ' },
                synonyms: ['DBZ'],
                isAdult: false,
              },
              filename: '[Fansub] Dragon Ball Z - 095.mp4',
              episode: 95,
              from: 742.5,
              to: 745.1,
              similarity: 0.9412,
              video: 'https://api.trace.moe/video/813/95',
              image: 'https://api.trace.moe/image/813/95',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-ratelimit-remaining': '98',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        },
      );
    }) as typeof fetch;

    const adapter1 = new TraceMoeProvenanceAdapter({
      fetchImpl: mockFetch,
      cachePath,
      minIntervalMs: 0,
      maxRetries: 2,
    });
    const frameBuf = Buffer.from('fake-dbz-ssj-frame-bytes');
    const res1 = await adapter1.identifyFrame({ frameBuffer: frameBuf });
    expect(res1.status).toBe('ok');
    expect(res1.fromCache).toBe(false);
    expect(res1.topMatch?.workTitle).toBe('Dragon Ball Z');
    expect(res1.topMatch?.episode).toBe(95);
    expect(res1.topMatch?.identifiers.anilistId).toBe(813);
    expect(res1.topMatch?.identifiers.malId).toBe(813);
    expect(res1.topMatch?.provenanceOnly).toBe(true);
    expect(fetchCalls).toBe(2);

    // Second instance with same cachePath MUST hit persistent disk cache without calling fetch
    const adapter2 = new TraceMoeProvenanceAdapter({
      fetchImpl: (async () => {
        throw new Error('network should not be called on cache hit');
      }) as unknown as typeof fetch,
      cachePath,
      minIntervalMs: 0,
    });
    const res2 = await adapter2.identifyFrame({ frameBuffer: frameBuf });
    expect(res2.status).toBe('ok');
    expect(res2.fromCache).toBe(true);
    expect(res2.topMatch?.evidence.fromCache).toBe(true);
    expect(res2.topMatch?.workTitle).toBe('Dragon Ball Z');

    // Unavailable / timeout fallback must never throw
    const failingAdapter = new TraceMoeProvenanceAdapter({
      fetchImpl: (async () => {
        throw new Error('connect ETIMEDOUT');
      }) as unknown as typeof fetch,
      minIntervalMs: 0,
      maxRetries: 0,
    });
    const resFail = await failingAdapter.identifyFrame({ frameBuffer: Buffer.from('other-frame') });
    expect(resFail.status).toBe('unavailable');
    expect(resFail.matches).toEqual([]);
    expect(resFail.error).toContain('ETIMEDOUT');

    // No match case
    const noMatchAdapter = new TraceMoeProvenanceAdapter({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ frameCount: 10, result: [] }), { status: 200 })) as typeof fetch,
      minIntervalMs: 0,
    });
    const resEmpty = await noMatchAdapter.identifyFrame({ frameBuffer: Buffer.from('unknown-frame') });
    expect(resEmpty.status).toBe('no_match');
    expect(resEmpty.matches).toEqual([]);
  });

  it('rejects wrong anime via trace.moe provenance and never auto-approves without VisionRouter visual action proof', async () => {
    const narutoProvenance = new TraceMoeProvenanceAdapter({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            result: [
              {
                anilist: { id: 20, idMal: 20, title: { english: 'Naruto', romaji: 'Naruto' }, isAdult: false },
                episode: 133,
                from: 310,
                to: 313,
                similarity: 0.93,
              },
            ],
          }),
          { status: 200 },
        )) as typeof fetch,
      minIntervalMs: 0,
    });

    // 1. Wrong anime identified by trace.moe -> MUST reject even if metadata title claims DBZ
    const wrongAnimeDecision = await evaluateMediaRelevance(
      {
        mediaId: 'clip_wrong_anime',
        uri: 'clip.mp4',
        title: 'Dragon Ball Z luta épica',
        origin: 'yt_dlp',
        durationSec: 20,
      },
      {
        segmentId: 'seg_dbz',
        prompt: 'Análise de Dragon Ball Z Saga Freeza',
        narrationText: 'Goku se transforma em Super Saiyajin em Namek.',
        genre: 'anime_essay',
        expectedEntities: ['Dragon Ball Z', 'Goku'],
      },
      {
        requireVisualVerification: true,
        animeProvenance: narutoProvenance,
        provenanceFrameBuffer: Buffer.from('naruto-frame'),
        analyzeFrames: async (_uri, timestampsSec) =>
          timestampsSec.map((t) => ({
            timestampSec: t,
            description: 'Anime battle scene in Dragon Ball Z',
            detectedEntities: ['Dragon Ball Z', 'Goku'],
            detectedActions: ['transforma', 'fight'],
            visualCategory: 'anime_animation',
            confidence: 0.88,
          })),
      },
    );
    expect(wrongAnimeDecision.accepted).toBe(false);
    expect(wrongAnimeDecision.rejectionCode).toBe('wrong_anime_or_entity');
    expect(wrongAnimeDecision.animeProvenance?.workTitle).toBe('Naruto');
    expect(wrongAnimeDecision.animeProvenance?.matchesExpectedWork).toBe(false);

    // 2. Correct anime provenance WITHOUT visual verification -> MUST NOT auto-approve!
    const dbzProvenance = new TraceMoeProvenanceAdapter({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            result: [
              {
                anilist: { id: 813, idMal: 813, title: { english: 'Dragon Ball Z' }, isAdult: false },
                episode: 95,
                from: 742,
                to: 745,
                similarity: 0.95,
              },
            ],
          }),
          { status: 200 },
        )) as typeof fetch,
      minIntervalMs: 0,
    });
    const unverifiedDecision = await evaluateMediaRelevance(
      {
        mediaId: 'clip_dbz_unverified',
        uri: 'dbz.mp4',
        title: 'Dragon Ball Z ep 95',
        origin: 'sakugabooru',
        durationSec: 15,
      },
      {
        segmentId: 'seg_dbz',
        prompt: 'Análise de Dragon Ball Z Saga Freeza',
        narrationText: 'Goku se transforma em Super Saiyajin em Namek.',
        genre: 'anime_essay',
        expectedEntities: ['Dragon Ball Z', 'Goku'],
      },
      {
        requireVisualVerification: true,
        animeProvenance: dbzProvenance,
        provenanceFrameBuffer: Buffer.from('dbz-frame'),
      },
    );
    expect(unverifiedDecision.accepted).toBe(false);
    expect(unverifiedDecision.rejectionCode).toBe('unverified_no_visual_evidence');

    // 3. Correct anime provenance + VisionRouter visual proof -> approved with provenance attached
    const verifiedDecision = await evaluateMediaRelevance(
      {
        mediaId: 'clip_dbz_verified',
        uri: 'dbz.mp4',
        title: 'Dragon Ball Z Goku Super Saiyajin',
        origin: 'sakugabooru',
        durationSec: 20,
      },
      {
        segmentId: 'seg_dbz',
        prompt: 'Análise de Dragon Ball Z Saga Freeza',
        narrationText: 'Goku se transforma em Super Saiyajin em Namek.',
        genre: 'anime_essay',
        expectedEntities: ['Dragon Ball Z', 'Goku'],
      },
      {
        requireVisualVerification: true,
        animeProvenance: dbzProvenance,
        provenanceFrameBuffer: Buffer.from('dbz-frame'),
        analyzeFrames: async (_uri, timestampsSec) =>
          timestampsSec.map((t) => ({
            timestampSec: t,
            description: 'Dragon Ball Z: Goku transforms into Super Saiyan on Namek',
            detectedEntities: ['Dragon Ball Z', 'Goku'],
            detectedActions: ['transforma', 'fight'],
            visualCategory: 'anime_animation',
            confidence: 0.92,
          })),
      },
    );
    expect(verifiedDecision.accepted).toBe(true);
    expect(verifiedDecision.correspondenceLevel).toBe('exact_match');
    expect(verifiedDecision.animeProvenance?.workTitle).toBe('Dragon Ball Z');
    expect(verifiedDecision.animeProvenance?.matchesExpectedWork).toBe(true);
  });

  it('searches Sakugabooru with tag normalization & safe filtering, and keeps gaming pipelines isolated', async () => {
    const dir = makeTmp();
    let sakugaCalls = 0;
    const sakuga = new SakugabooruSourceAdapter({
      cachePath: join(dir, 'sakuga-cache.json'),
      minIntervalMs: 0,
      fetchImpl: (async (url: string | URL) => {
        sakugaCalls += 1;
        expect(String(url)).toContain('rating%3As');
        return new Response(
          JSON.stringify([
            {
              id: 314232,
              tags: 'animated dragon_ball_z effects masahiro_shimanuki',
              file_ext: 'mp4',
              file_url: 'https://www.sakugabooru.com/data/673378fc55b02f4476a7363cf11eeca4.mp4',
              preview_url: 'https://www.sakugabooru.com/data/preview/673378fc55b02f4476a7363cf11eeca4.jpg',
              rating: 's',
              status: 'active',
              file_size: 10328548,
            },
            {
              id: 999999,
              tags: 'unsafe_item',
              file_ext: 'mp4',
              file_url: 'https://www.sakugabooru.com/data/unsafe.mp4',
              rating: 'e',
              status: 'active',
            },
          ]),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    // Gaming topic MUST NOT trigger Sakugabooru
    expect(isAnimeSubjectOrGenre('Cyberpunk 2077 Sandevistan gameplay', 'gameplay_essay')).toBe(false);
    const gamingSearch = await searchResilientMediaSources(
      'Cyberpunk 2077 Sandevistan',
      {
        localMediaDirs: [],
        animeMediaSource: sakuga,
        fetchImpl: (async () => new Response(JSON.stringify({}), { status: 404 })) as typeof fetch,
      },
      undefined,
      { genre: 'gameplay_essay', prompt: 'Os 10 melhores upgrades de cibernética em Cyberpunk 2077' },
    );
    expect(sakugaCalls).toBe(0);
    expect(gamingSearch.providerStatuses.some((s) => s.provider === 'sakugabooru')).toBe(false);

    // Anime topic MUST trigger Sakugabooru and filter out non-safe posts
    const animeSearch = await searchResilientMediaSources(
      'Dragon Ball Z',
      {
        localMediaDirs: [],
        animeMediaSource: sakuga,
        fetchImpl: (async () => new Response(JSON.stringify({}), { status: 404 })) as typeof fetch,
      },
      undefined,
      { genre: 'anime_essay', prompt: 'Análise de animação em Dragon Ball Z' },
    );
    expect(sakugaCalls).toBe(1);
    expect(animeSearch.candidates.some((c) => c.origin === 'sakugabooru')).toBe(true);
    expect(animeSearch.candidates.filter((c) => c.origin === 'sakugabooru')).toHaveLength(1);
  });
});

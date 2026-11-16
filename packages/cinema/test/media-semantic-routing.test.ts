import { describe, expect, it } from 'vitest';
import {
  assessCandidate,
  assessIdentity,
  assessRights,
  buildSemanticQueries,
  checkSourceFidelity,
  classifyProviderItem,
  expandScriptOrientedQueries,
  inferContentDomain,
  MediaProviderError,
  MediaProviderRegistry,
  planSceneSources,
  resolveRightsStatus,
  scoreItem,
  searchResilientMediaSources,
  YouTubeAdapter,
  type MediaProviderAdapter,
  type MediaProviderKey,
  type ProviderMediaItem,
  type ProviderSearchRequest,
  type SceneSourceContext,
} from '../src/index.js';
import { YOUTUBE_DESCRIPTOR } from '../src/analysis/media-providers/adapters/youtube.js';

/**
 * Regression suite for the anime-acquisition incident: anime scenes routed to Steam/IGDB as `game_specific`, and the
 * reference video "Frieren & Fern vs Frieren | Full Fight" (youtube 6gNGCDYOvDs) rejected as `stock_video`.
 */

const REFERENCE_ID = '6gNGCDYOvDs';
const REFERENCE_TITLE = 'Frieren & Fern vs Frieren | Full Fight';

/** Scene of an anime project produced with the `gameplay_essay` narrative format (the format that triggered the bug). */
const frierenScene: SceneSourceContext & { query: string } = {
  prompt: 'Os animes com os sistemas de magia mais criativos',
  genre: 'gameplay_essay',
  narrationText: 'Em Frieren, a magia é estudada como uma ciência acumulada ao longo de séculos.',
  entities: ['Frieren', 'Fern'],
  query: 'Frieren Fern fight',
};

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function youtubeFetch(videos: Array<{ id: string; title: string; channel: string; license?: 'youtube' | 'creativeCommon' }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('/youtube/v3/search')) return json({ items: videos.map((v) => ({ id: { videoId: v.id } })) });
    if (url.includes('/youtube/v3/videos')) {
      return json({
        items: videos.map((v) => ({
          id: v.id,
          snippet: { title: v.title, channelTitle: v.channel },
          contentDetails: { duration: 'PT6M12S', definition: 'hd' },
          status: { license: v.license ?? 'youtube' },
        })),
      });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
}

function recordingAdapter(id: MediaProviderKey, items: ProviderMediaItem[] | (() => never), calls: string[]): MediaProviderAdapter {
  return {
    descriptor: { ...YOUTUBE_DESCRIPTOR, id, name: id, category: id === 'steam' || id === 'igdb' ? 'game_media' : id === 'youtube' ? 'video_platform' : 'stock' },
    isConfigured: () => true,
    search: async (r: ProviderSearchRequest) => {
      calls.push(`${id}:${r.query}`);
      if (typeof items === 'function') items();
      return { items: items as ProviderMediaItem[], page: 1, perPage: 10, hasMore: false };
    },
    healthCheck: async () => ({ connectivity: 'ok', detail: 'ok', checkedAt: '' }),
  };
}

const ytItem = (over: Partial<ProviderMediaItem> & { title: string; id?: string }): ProviderMediaItem => {
  const vid = over.id?.replace('youtube:', '') ?? 'abc';
  return {
    provider: 'youtube',
    providerItemId: vid,
    kind: 'video',
    pageUrl: `https://www.youtube.com/watch?v=${vid}`,
    acquisition: { method: 'yt_dlp', url: `https://www.youtube.com/watch?v=${vid}` },
    classification: 'anime_footage',
    classificationConfidence: 0.55,
    classificationEvidence: [],
    aiGenerated: 'unknown',
    license: { licenseId: 'unknown', licenseName: 'Licença padrão do YouTube', commercialUse: 'unknown', automatedDownload: 'unknown', attributionRequired: 'recommended', restrictions: ['third_party_rights', 'unknown_terms'] },
    provenance: { provider: 'youtube', providerItemId: vid, retrievedAt: '', apiEndpoint: 'youtube/v3/search+videos', subject: { channelTitle: 'Some Clips' } },
    tags: [],
    ...over,
    id: `youtube:${vid}`,
  };
};

describe('content domain is independent of the narrative format', () => {
  it('an anime essay produced with the gameplay_essay format is the anime domain', () => {
    const d = inferContentDomain(frierenScene);
    expect(d.domain).toBe('anime');
    expect(d.evidence.join(' ')).toMatch(/formato não é domínio/);
  });

  it('a top list about anime magic systems is anime, not a game ranking', () => {
    const ctx = { prompt: 'Top 5 animes com sistemas de magia', genre: 'top_list', entities: ['Magi'], narrationText: 'Em Magi, o Rukh alimenta a magia.', query: 'Magi Aladdin magic' };
    expect(inferContentDomain(ctx).domain).toBe('anime');
    expect(planSceneSources(ctx).intent).toBe('anime_identity');
  });

  it('keeps game, technology and movie routing', () => {
    expect(planSceneSources({ prompt: 'Análise de Cyberpunk 2077', entities: ['Cyberpunk 2077'] }).domain).toBe('game');
    expect(planSceneSources({ prompt: 'Como a tecnologia mudou o trabalho', narrationText: 'servidores' }).providers).toEqual(['pexels', 'pixabay']);
    const movie = planSceneSources({ prompt: 'Os melhores filmes de ficção científica', entities: ['Interstellar'] });
    expect(movie.intent).toBe('screen_identity');
    expect(movie.providers).not.toContain('steam');
  });

  it('an explicit project domain wins over inference', () => {
    expect(inferContentDomain({ prompt: 'jogo de cartas', projectDomain: 'anime' }).domain).toBe('anime');
  });

  it('a named subject with unknown domain never defaults to game sources', () => {
    const plan = planSceneSources({ prompt: 'Os sistemas de magia mais criativos', entities: ['Magi'], narrationText: 'Em Magi, o Rukh alimenta a magia.' });
    expect(plan.intent).toBe('named_subject');
    expect(plan.providers).not.toContain('steam');
    expect(plan.providers).not.toContain('igdb');
  });
});

describe('source routing (Frieren must not go to Steam by default)', () => {
  it('plans YouTube only for the anime scene — no Steam/IGDB', () => {
    const plan = planSceneSources(frierenScene);
    expect(plan.intent).toBe('anime_identity');
    expect(plan.providers).toEqual(['youtube']);
    expect(plan.researchProviders).toEqual([]);
  });

  it('the registry never queries Steam or IGDB for the anime scene', async () => {
    const calls: string[] = [];
    const registry = new MediaProviderRegistry({
      adapters: [
        recordingAdapter('steam', [], calls),
        recordingAdapter('igdb', [], calls),
        recordingAdapter('youtube', [ytItem({ id: REFERENCE_ID, title: REFERENCE_TITLE })], calls),
      ],
    });
    const res = await registry.searchForScene(frierenScene.query, frierenScene, { minResults: 1 });
    expect(calls.every((c) => c.startsWith('youtube:'))).toBe(true);
    expect(res.attempts.map((a) => a.provider)).toEqual(['youtube']);
  });
});

describe('reference video 6gNGCDYOvDs is not rejected prematurely as stock', () => {
  it('YouTube adapter classifies it as anime footage in an anime project with the gameplay_essay format', async () => {
    const yt = new YouTubeAdapter({ apiKey: () => 'k', fetchImpl: youtubeFetch([{ id: REFERENCE_ID, title: REFERENCE_TITLE, channel: 'Some Clips' }]) });
    const page = await yt.search({ query: frierenScene.query, context: frierenScene });
    const item = page.items[0]!;
    expect(item.classification).toBe('anime_footage');
    expect(item.classification).not.toBe('stock_video');
    // Third-party upload: rights not inferred from the title.
    expect(item.license.licenseId).toBe('unknown');
  });

  it('without any context a video-platform result is unclassified, never stock', () => {
    const cls = classifyProviderItem({ provider: 'youtube', hint: 'youtube_video', kind: 'video', title: REFERENCE_TITLE });
    expect(cls.classification).toBe('unclassified_video');
  });

  it('end-to-end through the registry: kept as a plausible anime_footage candidate pending frames and rights review', async () => {
    const yt = new YouTubeAdapter({ apiKey: () => 'k', fetchImpl: youtubeFetch([{ id: REFERENCE_ID, title: REFERENCE_TITLE, channel: 'Some Clips' }]) });
    const registry = new MediaProviderRegistry({ adapters: [yt] });
    const res = await registry.searchForScene(frierenScene.query, frierenScene, { minResults: 1 });
    expect(res.rejected.filter((r) => r.stage === 'source_fidelity')).toEqual([]);
    const accepted = res.accepted.find((a) => a.item.providerItemId === REFERENCE_ID)!;
    expect(accepted).toBeDefined();
    const a = accepted.assessment!;
    expect(a.mediaType).toBe('anime_footage');
    expect(a.verdict).toBe('pending_analysis'); // never auto-approved
    expect(a.identity.status).toBe('probable'); // title is a hint, not proof
    expect(a.identity.requiresVisualConfirmation).toBe(true);
    expect(a.rights.requiresReview).toBe(true);
    expect(a.rights.inferredFromTitle).toBe(false);
    expect(accepted.license.status).toBe('pending_human_review');
  });

  it('an unknown-type video is kept for analysis, not rejected', () => {
    const plan = planSceneSources(frierenScene);
    const unknown = ytItem({ id: 'u1', title: 'Fern zoltraak 4k', classification: 'unclassified_video', classificationConfidence: 0.3 });
    const verdict = checkSourceFidelity(unknown, plan, frierenScene);
    expect(verdict.pass).toBe(true);
    expect(verdict.assessment.mediaType).toBe('unknown');
    expect(verdict.assessment.uncertain).toBe(true);
    const noMention = ytItem({ id: 'u2', title: 'Full fight 1080p', classification: 'unclassified_video', classificationConfidence: 0.3 });
    const v2 = checkSourceFidelity(noMention, plan, frierenScene);
    expect(v2.pass).toBe(true);
    expect(v2.assessment.identity.status).toBe('unknown');
    expect(v2.assessment.maxEditorialRole).toBe('contextual_broll');
  });
});

describe('identity and editorial role', () => {
  const plan = planSceneSources(frierenScene);

  it('a game related to the anime never proves the anime scene', async () => {
    const cls = classifyProviderItem({ provider: 'youtube', hint: 'youtube_video', kind: 'video', title: 'Frieren mobile game gameplay', animeContext: true });
    expect(cls.classification).toBe('authentic_gameplay');
    const game = ytItem({ id: 'g1', title: 'Frieren mobile game gameplay', classification: cls.classification, classificationConfidence: cls.confidence });
    const verdict = checkSourceFidelity(game, plan, frierenScene);
    expect(verdict.assessment.canProveScene).toBe(false);
    expect(verdict.assessment.maxEditorialRole).toBe('contextual_broll');
  });

  it('a different work asserted by the provider is rejected', () => {
    const other = ytItem({ id: 'n1', title: 'Epic fight', provenance: { provider: 'youtube', providerItemId: 'n1', retrievedAt: '', apiEndpoint: '', subject: { animeTitle: 'Naruto Shippuden' } } });
    expect(checkSourceFidelity(other, plan, frierenScene)).toMatchObject({ pass: false, code: 'subject_mismatch' });
  });

  it('a different work detected by visual analysis is a mismatch; a low-confidence detection stays ambiguous', () => {
    const item = ytItem({ id: 'x', title: REFERENCE_TITLE });
    expect(assessIdentity(item, frierenScene, { detectedWork: 'Black Clover', confidence: 0.85, source: 'vision' }).status).toBe('mismatch');
    const weak = assessIdentity(item, frierenScene, { detectedWork: 'Black Clover', confidence: 0.3, source: 'vision' });
    expect(weak.status).toBe('probable');
    expect(weak.ambiguities.length).toBeGreaterThan(0);
    expect(assessIdentity(item, frierenScene, { detectedWork: 'Frieren', confidence: 0.9, source: 'vision' }).status).toBe('confirmed_by_analysis');
  });

  it('anime footage of the right work may become literal evidence only after frames; event not in metadata is flagged', () => {
    const ctx = { ...frierenScene, work: { canonicalTitle: 'Frieren', event: 'Aura execution' } };
    const a = assessCandidate(ytItem({ id: REFERENCE_ID, title: REFERENCE_TITLE }), { domain: 'anime', requiresIdentity: true, allowedMediaTypes: plan.allowedMediaTypes, allowedClasses: plan.allowedClasses, label: 'anime_identity' }, ctx);
    expect(a.maxEditorialRole).toBe('literal_evidence');
    expect(a.narrativeCorrespondence).toBe('work_only');
    expect(a.reasons.join(' ')).toMatch(/não citam o acontecimento/);
  });

  it('textual similarity alone does not match identity ("Magi" is not "Magicka")', () => {
    const ctx = { prompt: 'animes de magia', entities: ['Magi'] };
    const magicka = ytItem({ id: 'm', title: 'Magicka 2 gameplay' });
    expect(assessIdentity(magicka, ctx).status).toBe('unknown');
    const lic = { status: 'pending_human_review' as const, reasons: [], obligations: [] };
    expect(scoreItem(magicka, lic, ctx)).toBe(scoreItem(ytItem({ id: 'm', title: 'Random 2 gameplay' }), lic, ctx));
  });
});

describe('provenance and rights are never inferred from the title', () => {
  it('an "official"-looking title on an unknown channel keeps unknown rights', () => {
    const item = ytItem({ id: 'o1', title: 'Frieren OFFICIAL licensed clip (free to use)' });
    const r = assessRights(item);
    expect(r.verifiedPermissions).toEqual([]);
    expect(r.requiresReview).toBe(true);
    expect(r.owner).toBeUndefined();
  });

  it('a known anime distributor channel raises identity confidence but does not grant publisher rights', async () => {
    const yt = new YouTubeAdapter({ apiKey: () => 'k', fetchImpl: youtubeFetch([{ id: 'c1', title: 'Frieren Season 2 Official Trailer', channel: 'Crunchyroll' }]) });
    const item = (await yt.search({ query: 'Frieren trailer', context: frierenScene })).items[0]!;
    expect(item.classification).toBe('anime_footage');
    expect(item.classificationConfidence).toBeGreaterThanOrEqual(0.8);
    expect(item.license.licenseId).toBe('unknown');
    expect(resolveRightsStatus({ origin: 'youtube', providerItem: item }).rightsStatus).toBe('unresolved_third_party');
  });

  it('CC license attested by the provider API is a verified permission', async () => {
    const yt = new YouTubeAdapter({ apiKey: () => 'k', fetchImpl: youtubeFetch([{ id: 'cc', title: 'Frieren fan animation', channel: 'Indie', license: 'creativeCommon' }]) });
    const item = (await yt.search({ query: 'Frieren', context: frierenScene })).items[0]!;
    const r = assessRights(item);
    expect(r.basis).toBe('provider_license_metadata');
    expect(r.verifiedPermissions).toContain('commercial_use');
  });
});

describe('recovery and provider fallback', () => {
  it('reformulates with canonical/alternative titles and characters, bounded and without repeating strategies', async () => {
    const calls: string[] = [];
    const ctx = { ...frierenScene, work: { canonicalTitle: 'Sousou no Frieren', alternativeTitles: ["Frieren: Beyond Journey's End"], characters: ['Fern'], event: 'Frieren vs clone' } };
    const registry = new MediaProviderRegistry({ adapters: [recordingAdapter('youtube', [], calls)] });
    const res = await registry.searchForScene(ctx.query, ctx, { minResults: 1, maxRecoveryQueries: 3 });
    expect(res.recovery.length).toBe(3);
    expect(new Set(res.recovery.map((r) => r.strategy)).size).toBe(3);
    expect(new Set(calls).size).toBe(calls.length); // no repeated query
    expect(res.recovery[0]!.query).toContain('Sousou no Frieren');
  });

  it('builds queries from the work and the desired media type, empty when no work is known', () => {
    const qs = buildSemanticQueries({ entities: ['Frieren', 'Fern'], work: { language: 'pt' } }, 'anime');
    expect(qs.map((q) => q.query)).toContain('Frieren anime scene');
    expect(qs.some((q) => q.strategy === 'language')).toBe(true);
    expect(buildSemanticQueries({ prompt: 'tecnologia' }, 'technology')).toEqual([]);
  });

  it('a failing provider falls back to the next one for named subjects', async () => {
    const calls: string[] = [];
    const registry = new MediaProviderRegistry({
      adapters: [
        recordingAdapter('youtube', () => { throw new MediaProviderError('unavailable', 'youtube', 'HTTP 503', false); }, calls),
        recordingAdapter('pexels', [], calls),
      ],
    });
    const ctx = { prompt: 'Os sistemas de magia mais criativos', entities: ['Magi'] };
    const res = await registry.searchForScene('Magi magic', ctx, { minResults: 1, maxRecoveryQueries: 0 });
    expect(res.attempts.map((a) => [a.provider, a.status])).toEqual([['youtube', 'error'], ['pexels', 'empty']]);
  });

  it('searchResilientMediaSources keeps working when the registry fails and records the error', async () => {
    const registry = new MediaProviderRegistry({ adapters: [] });
    registry.searchForScene = async () => { throw new Error('boom'); };
    const res = await searchResilientMediaSources('Frieren fight', { mediaProviders: { registry }, fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch }, undefined, {
      genre: 'gameplay_essay',
      prompt: frierenScene.prompt,
    });
    expect(res.providerStatuses.some((s) => s.status === 'error' && /boom/.test(s.detail ?? ''))).toBe(true);
    expect(res.providerStatuses.some((s) => s.provider === 'wikimedia_commons')).toBe(true);
  });
});

describe('query expansion uses the domain, not the format', () => {
  it('anime essay in gameplay_essay format gets anime queries, not "boss fight gameplay"', () => {
    const qs = expandScriptOrientedQueries({
      prompt: 'Os animes com os sistemas de magia mais criativos',
      genre: 'gameplay_essay',
      segments: [{ segmentId: 's1', subject: 'Frieren', narrationText: 'Frieren e Fern enfrentam cópias', entities: ['Frieren', 'Fern'] } as never],
    });
    expect(qs.some((q) => /anime/.test(q))).toBe(true);
    expect(qs.some((q) => /boss fight gameplay/.test(q))).toBe(false);
  });
});

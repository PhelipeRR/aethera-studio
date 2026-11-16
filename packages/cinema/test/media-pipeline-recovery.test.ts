import { describe, expect, it } from 'vitest';
import {
  buildContextualSceneQueries,
  canonicalQueryKey,
  classifyProviderItem,
  dedupeEquivalentQueries,
  detectReferenceWorks,
  estimateNarrationSec,
  resolveRightsStatus,
  resolveSceneSubject,
  usableSourceIntervals,
  type MediaRelevanceDecision,
  type ResearchEntityFact,
} from '../src/index.js';

const fact = (entityName: string, extra: Partial<ResearchEntityFact> = {}): ResearchEntityFact => ({
  entityName,
  workTitle: entityName,
  role: 'anime',
  verifiedFacts: [],
  mechanicsOrEvents: [],
  uncertainties: [],
  sources: [],
  ...extra,
});

const beat = (stage: 'hook' | 'promise' | 'progression' | 'cta', spokenText: string) => ({
  segmentId: 's',
  beatId: 'b',
  stage,
  title: 'Cena 9',
  spokenText,
  estimatedDurationSec: 0,
  approved: true,
});

describe('contextual media queries', () => {
  it('treats reordered, accented or stopword variants as the same query', () => {
    expect(canonicalQueryKey('Jujutsu Kaisen expansão de domínio anime')).toBe(canonicalQueryKey('anime domínio expansao Jujutsu Kaisen'));
    const deduped = dedupeEquivalentQueries(['Mashle anime fight scene', 'mashle  FIGHT scene anime', 'Mashle anime opening']);
    expect(deduped).toEqual(['Mashle anime fight scene', 'Mashle anime opening']);
    expect(dedupeEquivalentQueries(['Mashle anime opening'], new Set([canonicalQueryKey('anime opening mashle')]))).toEqual([]);
  });

  it('always names the work and never falls back to "Cena N" style queries', () => {
    const queries = buildContextualSceneQueries({ work: 'Fairy Tail', keywords: ['Natsu'], actionTerms: ['dragon slayer'], domain: 'anime', max: 6 });
    expect(queries.length).toBeGreaterThan(2);
    expect(queries.every((q) => q.includes('Fairy Tail'))).toBe(true);
    expect(queries.some((q) => /cena \d/i.test(q))).toBe(false);
  });

  it('estimates narration time from the words actually written', () => {
    const text = Array.from({ length: 117 }, () => 'palavra').join(' ') + '.';
    expect(estimateNarrationSec(text, 'pt-BR')).toBeGreaterThan(45);
    expect(estimateNarrationSec(text, 'pt-BR')).toBeLessThan(56);
  });

  it('detects a reference work in "para quem gostou de" prompts', () => {
    expect(detectReferenceWorks('TOP 5 Animes com Sistemas de Magia Incríveis para Quem Gostou de Black Clover')).toContain('Black Clover');
  });
});

describe('scene subject resolution', () => {
  const entities = [fact('Fairy Tail'), fact('Mashle: Magic and Muscles'), fact('Fullmetal Alchemist: Brotherhood'), fact('Hunter x Hunter')];

  it('picks the work the narration talks about most, not the first in list order', () => {
    const r = resolveSceneSubject({
      beat: beat('progression', 'E no topo da lista, Fullmetal Alchemist: Brotherhood transforma a alquimia em ciência com custo real: a troca equivalente define cada transmutação.'),
      entities,
      workTitle: 'Animes com Sistemas de Magia',
    });
    expect(r.entity?.entityName).toBe('Fullmetal Alchemist: Brotherhood');
    expect(r.resolution).toBe('entity');
  });

  it('a progression beat without a mention inherits the previous work; a list intro is an overview', () => {
    const inherited = resolveSceneSubject({
      beat: beat('progression', 'Cada feitiço cobra um preço, e é isso que torna as lutas tensas.'),
      entities,
      workTitle: 'x',
      previous: entities[1]!,
    });
    expect(inherited).toMatchObject({ resolution: 'inherited' });
    expect(inherited.entity?.entityName).toBe('Mashle: Magic and Muscles');
    const overview = resolveSceneSubject({ beat: beat('promise', 'Hoje separei cinco animes com sistemas de magia únicos.'), entities, workTitle: 'x' });
    expect(overview.resolution).toBe('overview');
  });
});

describe('verified coverage intervals', () => {
  const asset = { mediaId: 'm1', uri: 'a.mp4', durationSec: 120, compatible: true };
  const decision = (overrides: Partial<MediaRelevanceDecision>): MediaRelevanceDecision =>
    ({
      mediaId: 'm1',
      accepted: true,
      score: 0.9,
      reason: 'ok',
      matchedEntities: ['gojo'],
      visualVerificationStatus: 'visually_verified',
      matchedIntervals: [{ segmentId: 's', startSec: 10, endSec: 16 }],
      visualEvidence: [],
      ...overrides,
    }) as MediaRelevanceDecision;

  it('counts only the intervals frames prove, never the whole file', () => {
    expect(usableSourceIntervals(asset, decision({}))).toEqual([{ startSec: 10, endSec: 16 }]);
  });

  it('consistent identity across sampled frames proves the span between them', () => {
    const ev = [5, 30, 60, 90].map((t) => ({ timestampSec: t, description: 'Gojo em combate', detectedEntities: ['Gojo'], confidence: 0.9 }));
    const out = usableSourceIntervals(asset, decision({ visualEvidence: ev as MediaRelevanceDecision['visualEvidence'] }));
    expect(out).toEqual([{ startSec: 3.5, endSec: 92.5 }]);
  });
});

describe('rights and classification', () => {
  it('anime footage from a third-party upload is a candidate with explicit unresolved rights', () => {
    const third = classifyProviderItem({ provider: 'youtube', hint: 'youtube_video', kind: 'video', title: 'Jujutsu Kaisen Gojo domain expansion scene', channelTitle: 'Random Clips', animeContext: true });
    expect(third.classification).toBe('anime_footage');
    expect(third.confidence).toBeGreaterThanOrEqual(0.5);
    const official = classifyProviderItem({ provider: 'youtube', hint: 'youtube_video', kind: 'video', title: 'Jujutsu Kaisen Season 2 Trailer', channelTitle: 'Crunchyroll', animeContext: true });
    expect(official.confidence).toBeGreaterThanOrEqual(0.8);
    expect(resolveRightsStatus({ origin: 'yt_dlp' }).rightsStatus).toBe('unresolved_third_party');
    expect(resolveRightsStatus({ origin: 'local_library' }).rightsStatus).toBe('licensed');
  });
});

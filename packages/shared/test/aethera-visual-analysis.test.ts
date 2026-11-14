import { describe, expect, it } from 'vitest';
import { assessSource, relevanceDecision, sceneNatures, segmentAnalysisSchema, type NarrationRelevance, type SegmentAnalysis } from '../src/index.js';

const analysis = (overrides: Partial<SegmentAnalysis> = {}): SegmentAnalysis => segmentAnalysisSchema.parse({
  schemaVersion: 1, nature: 'action', natureConfidence: 0.9,
  description: 'Uma figura de armadura enfrenta uma criatura grande numa arena de pedra.',
  frames: [{ atMs: 1_000, observed: 'Figura de armadura desvia de um golpe.', visibleText: [] }, { atMs: 3_000, observed: 'Barra de vida no topo.', visibleText: [{ text: 'MALENIA', region: 'top' }] }],
  entities: [{ name: 'figura de armadura', type: 'character', basis: 'observed', evidence: 'visível nos dois quadros', confidence: 0.9 }, { name: 'Elden Ring', type: 'work', basis: 'inferred', evidence: 'estilo visual e interface', confidence: 0.6 }],
  actions: [{ description: 'combate corpo a corpo', basis: 'observed', confidence: 0.9 }],
  environment: { description: 'arena de pedra', basis: 'observed', confidence: 0.8 },
  overlays: { burnedText: false, watermark: false, webcam: false },
  limitations: [], confidence: 0.85, ...overrides,
});

const judgement = (overrides: Partial<NarrationRelevance> = {}): NarrationRelevance => ({ verdict: 'represents', matched: [{ aspect: 'combate', evidence: 'combate corpo a corpo observado' }], missing: [], subjectOnly: false, confidence: 0.85, ...overrides });

describe('universal visual analysis contract', () => {
  it('uses a category-neutral vocabulary of scene natures', () => {
    expect(sceneNatures).toEqual(expect.arrayContaining(['action', 'exploration', 'interface', 'cinematic', 'dialogue', 'text_card', 'document', 'unknown']));
    expect(sceneNatures).not.toEqual(expect.arrayContaining(['gameplay', 'combat', 'menu_ui']));
  });

  it('keeps observation and inference apart and records the visible text region', () => {
    const parsed = analysis();
    expect(parsed.entities.find((entity) => entity.name === 'Elden Ring')?.basis).toBe('inferred');
    expect(parsed.frames[1]?.visibleText[0]).toEqual({ text: 'MALENIA', region: 'top' });
    expect(() => segmentAnalysisSchema.parse({ ...parsed, entities: [{ ...parsed.entities[0], basis: 'guess' }] })).toThrow();
  });

  it('accepts only a match backed by observed content, never by the subject name alone', () => {
    expect(relevanceDecision(judgement(), analysis())).toMatchObject({ decision: 'accept' });
    expect(relevanceDecision(judgement({ subjectOnly: true }), analysis())).toMatchObject({ decision: 'review', reason: expect.stringMatching(/nome|assunto/iu) });
    expect(relevanceDecision(judgement({ matched: [] }), analysis())).toMatchObject({ decision: 'review' });
  });

  it('rejects what does not represent the speech and sends uncertainty to a person', () => {
    expect(relevanceDecision(judgement({ verdict: 'does_not_represent', matched: [], missing: ['paisagem'] }), analysis())).toMatchObject({ decision: 'reject' });
    expect(relevanceDecision(judgement({ verdict: 'uncertain' }), analysis())).toMatchObject({ decision: 'review' });
    expect(relevanceDecision(judgement({ confidence: 0.5 }), analysis())).toMatchObject({ decision: 'review' });
    expect(relevanceDecision(judgement({ verdict: 'partial' }), analysis())).toMatchObject({ decision: 'review' });
    expect(relevanceDecision(judgement(), analysis({ nature: 'unknown', confidence: 0.3 }))).toMatchObject({ decision: 'review' });
  });
});

describe('source assessment (E7): does the media look like what it was acquired as?', () => {
  const withText = (texts: string[], webcam = false): SegmentAnalysis => analysis({ frames: [{ atMs: 0, observed: 'quadro', visibleText: texts.map((text) => ({ text, region: 'overlay' as const })) }], overlays: { burnedText: texts.length > 0, watermark: false, webcam } });

  it('flags a promo whose segments carry the same overlay text again and again (a third-party demo badge)', () => {
    const demo = [withText(['RTX ON']), withText(['RTX ON', '128 FPS']), withText(['rtx on']), withText(['DLSS 3']), withText([]), withText(['RTX ON'])];
    expect(assessSource({ declaredKind: 'official_promo', analyses: demo })).toMatchObject({ status: 'divergent_suspected', persistentTexts: ['rtx on'] });
    const trailer = [withText(['THE GOLDEN ORDER IS BROKEN']), withText(['AND THEY WILL DIE.']), withText([]), withText(['BRANDISH THE ELDEN RING']), withText([])];
    expect(assessSource({ declaredKind: 'official_promo', analyses: trailer })).toMatchObject({ status: 'consistent', persistentTexts: [] });
  });

  it('flags third-party commentary by webcam, expects interface text in footage, and does not judge from too few segments', () => {
    const stream = Array.from({ length: 5 }, () => withText(['Fechado'], true));
    expect(assessSource({ declaredKind: 'footage', analyses: stream })).toMatchObject({ status: 'third_party_commentary', webcamRatio: 1 });
    const hud = Array.from({ length: 5 }, () => withText(['Fechado']));
    expect(assessSource({ declaredKind: 'footage', analyses: hud }).status).toBe('consistent');
    expect(assessSource({ declaredKind: 'official_promo', analyses: [withText(['RTX ON']), withText(['RTX ON'])] }).status).toBe('insufficient_evidence');
  });
});

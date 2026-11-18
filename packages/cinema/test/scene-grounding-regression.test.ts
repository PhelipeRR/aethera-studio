import { describe, expect, it } from 'vitest';
import { buildSceneMediaApproval } from '../src/analysis/media-approval.js';
import { isMultiWorkPrompt } from '../src/editorial/contextual-media-queries.js';
import { extractNarrativeVisualExpectation, type MediaRelevanceDecision } from '../src/qc/media-relevance-gate.js';

describe('Scene Grounding & Multi-Work Regression Fixes', () => {
  it('does not reject a Cyberpunk 2077 trailer as Identidade incompatível when VisionRouter reports generic scene descriptors or "v"', () => {
    const baseDecision: MediaRelevanceDecision = {
      mediaId: 'auto_steam_2',
      accepted: true,
      score: 0.72,
      relevanceTier: 'exact_match',
      correspondenceLevel: 'exact_match',
      editorialStatus: 'approved_for_scene',
      assemblyEligible: true,
      visualVerificationStatus: 'visually_verified',
      visualConfidence: 0.8,
      sampledTimestampsSec: [2, 8, 14],
      matchedEntities: ['cyberpunk', '2077'],
      matchedActions: [],
      matchedIntervals: [{ segmentId: 'scene_01', startSec: 0, endSec: 15, provingTimestampsSec: [2, 8], provingDescriptions: ['Neon city'] }],
      visualEvidence: [
        { timestampSec: 2, description: 'Cidade noturna com painéis luminosos em neon', detectedEntities: ['cidade noturna com painéis luminosos'], detectedActions: [], confidence: 0.8 },
        { timestampSec: 8, description: 'Pessoa de cabelo vermelho e implantes cibernéticos', detectedEntities: ['pessoa de cabelo vermelho', 'v'], detectedActions: [], confidence: 0.8 },
      ],
      reason: 'Verificado.',
      visualCategory: 'cinematic',
    };

    const { approval, effectiveDecision } = buildSceneMediaApproval(
      {
        mediaId: 'auto_steam_2',
        title: 'Cyberpunk 2077 — Official Trailer',
        origin: 'steam',
        url: 'https://video.akamai.steamstatic.com/store_trailers/1091500/trailer.mp4',
      },
      baseDecision,
      {
        sceneId: 'scene_01',
        entities: ['Cyberpunk 2077'],
        work: { canonicalTitle: 'Cyberpunk 2077', alternativeTitles: ['Cyberpunk'], domain: 'gaming' },
        projectDomain: 'gaming',
      },
    );

    expect(approval.identity.approval).not.toBe('rejected');
    expect(effectiveDecision.rejectionCode).not.toBe('wrong_anime_or_entity');
  });

  it('does not trigger morte_sacrificio on "Red Dead Redemption 2" or transformacao on "transformou simples pixels"', () => {
    const rdrExpectation = extractNarrativeVisualExpectation({
      segmentId: 'scene_rdr2',
      narrationText: 'Décadas depois, os polígonos simples deram lugar à simulação física impressionante de Red Dead Redemption 2, onde a neve de Ambarino, a lama e a luz volumétrica reagem.',
      expectedEntities: ['Red Dead Redemption 2'],
      prompt: 'A Evolução dos Games: Do Pixel ao Realismo',
    });
    expect(rdrExpectation.actionsAndEvents).not.toContain('morte_sacrificio');
    expect(rdrExpectation.requiresSpecificEventVisual).toBe(false);

    const introExpectation = extractNarrativeVisualExpectation({
      segmentId: 'scene_intro',
      narrationText: 'Hoje vamos acompanhar a jornada visual que transformou simples pixels da era clássica nos mundos abertos tridimensionais.',
      expectedEntities: ['Super Mario Bros'],
      prompt: 'A Evolução dos Games: Do Pixel ao Realismo',
    });
    expect(introExpectation.actionsAndEvents).not.toContain('transformacao');
    expect(introExpectation.requiresSpecificEventVisual).toBe(false);
  });

  it('detects multi-work essay prompts mentioning multiple distinct games without requiring top-10 ranking keywords', () => {
    const essayPrompt =
      'Crie um vídeo cinematográfico sobre a evolução dos videogames: mostre Super Mario Bros. e Sonic na era clássica, Super Mario 64 e GTA San Andreas na revolução 3D, e Cyberpunk 2077 e Red Dead Redemption 2 no realismo moderno.';
    expect(isMultiWorkPrompt(essayPrompt)).toBe(true);
  });
});

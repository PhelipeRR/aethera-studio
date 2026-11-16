import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AetheraEvolutionCore,
  computeVisionDecisionCacheKey,
  DEFAULT_PT_BR_PRONUNCIATION_ENTRIES,
  directNarrationSegments,
  evaluateMediaRelevance,
  evaluateNarrationAudioQuality,
  evaluateRenderedVisualCritic,
  expandScriptOrientedQueries,
  extractNarrativeVisualExpectation,
  isCacheEntryCompatibleWithProject,
  planMediaCoverage,
  planTargetedSegmentRegeneration,
  recordApprovedPronunciationRule,
  recordSceneGroundingNegativeExample,
  undoSceneGroundingNegativeExample,
  findMatchingSceneGroundingNegativeExample,
  isAssemblyEligibleDecision,
  runAutonomousMediaAcquisition,
  sampleDistributedFrameTimestamps,
  SCENE_GROUNDING_POLICY_VERSION,
  scoreCandidateRelevancePriority,
  searchResilientMediaSources,
  selectRelevantDownloadWindow,
  triageCandidateMetadata,
} from '../src/index.js';

describe('Media Relevance Gate & Visual Critic Blocking', () => {
  it('does not treat a title card or its visible text as anime footage proof', async () => {
    const decision = await evaluateMediaRelevance(
      {
        mediaId: 'auto_yt_dlp_5',
        uri: 'C:/media/black-clover-title-card.mp4',
        title: 'Black Clover Asta anime title card',
        durationSec: 93,
      },
      {
        segmentId: 'scene_01',
        prompt: 'TOP 5 animes com sistemas de magia',
        narrationText: 'Black Clover abre a lista com um sistema de magia baseado em grimórios.',
        genre: 'anime_essay',
        expectedEntities: ['Black Clover', 'Asta'],
        expectsAnimeWork: true,
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async (_uri, timestampsSec) => timestampsSec.map((timestampSec) => ({
          timestampSec,
          visualCategory: 'motion_graphic' as const,
          detectedEntities: ['black clover'],
          detectedActions: [],
          description: 'Cartão de título branco sobre fundo preto; nenhum personagem visível.',
          visibleText: ['BLACK CLOVER'],
          confidence: 0.95,
        })),
      },
    );

    expect(decision.matchedEntities).not.toContain('Black Clover');
    expect(decision.accepted).toBe(false);
    expect(isAssemblyEligibleDecision(decision)).toBe(false);
  });

  it('keeps same-universe context explicit without making it scene footage', async () => {
    const decision = await evaluateMediaRelevance(
      {
        mediaId: 'auto_steam_1',
        uri: 'C:/media/elden-ring-generic-combat.mp4',
        title: 'Elden Ring gameplay combat showcase',
        durationSec: 90,
      },
      {
        segmentId: 'scene_02',
        prompt: 'Análise dos chefes de Elden Ring',
        narrationText: 'Malenia usa Waterfowl Dance na primeira fase.',
        genre: 'gameplay_essay',
        expectedEntities: ['Elden Ring', 'Malenia'],
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async (_uri, timestampsSec) => timestampsSec.map((timestampSec) => ({
          timestampSec,
          visualCategory: 'gameplay' as const,
          detectedEntities: ['elden ring'],
          detectedActions: ['batalha_confronto'],
          description: 'Combate genérico em Elden Ring; Malenia e Waterfowl Dance não aparecem.',
          confidence: 0.9,
        })),
      },
    );

    expect(decision.accepted).toBe(true);
    expect(decision.editorialStatus).toBe('contextual');
    expect(decision.correspondenceLevel).toBe('universe_only_coincidence');
    expect(decision.eligibleSegmentIds).toEqual([]);
    expect(isAssemblyEligibleDecision(decision)).toBe(false);
  });

  it('does not promote a single proving frame to approved_for_scene', async () => {
    const decision = await evaluateMediaRelevance(
      {
        mediaId: 'auto_yt_dlp_4',
        uri: 'C:/media/black-clover-clip.mp4',
        title: 'Black Clover Asta gameplay anime clip',
        durationSec: 30,
      },
      {
        segmentId: 'scene_04',
        prompt: 'Análise de Black Clover',
        narrationText: 'Asta desperta uma nova forma durante a batalha.',
        genre: 'anime_essay',
        expectedEntities: ['Black Clover', 'Asta'],
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async (_uri, timestampsSec) => timestampsSec.map((timestampSec, index) => ({
          timestampSec,
          visualCategory: 'anime_animation' as const,
          detectedEntities: index === 1 ? ['asta'] : ['black clover'],
          detectedActions: index === 1 ? ['transformacao'] : [],
          description: index === 1 ? 'Asta desperta uma forma nova.' : 'Plano de anime sem o acontecimento narrado.',
          confidence: 0.9,
        })),
      },
    );

    expect(decision.editorialStatus).toBe('visually_verified');
    expect(decision.accepted).toBe(true);
    expect(decision.eligibleSegmentIds).toEqual([]);
    expect(isAssemblyEligibleDecision(decision)).toBe(false);
    expect((decision.matchedIntervals ?? []).reduce((sum, interval) => sum + interval.endSec - interval.startSec, 0)).toBeLessThan(8);
  });

  it('samples distributed timestamps across a clip instead of only frame 0', () => {
    const stamps = sampleDistributedFrameTimestamps(90, 4);
    expect(stamps).toHaveLength(4);
    expect(stamps[0]).toBeGreaterThan(0);
    expect(stamps[3]).toBeGreaterThan(stamps[1]!);
  });

  it('rejects unrelated real-person footage for an anime script and blocks editorial approval in Visual Critic', async () => {
    const decision = await evaluateMediaRelevance(
      {
        mediaId: 'shot_1_real_person',
        uri: 'C:/media/vlog_pessoa_real.mp4',
        title: 'Reaction Vlog Talking Head Review',
        durationSec: 90,
      },
      {
        segmentId: 'shot_1',
        prompt: 'Análise completa de Attack on Titan e Eren Yeager',
        narrationText: 'No primeiro episódio de Attack on Titan, Eren Yeager vê a muralha cair.',
        genre: 'anime_essay',
        expectedEntities: ['attack', 'titan', 'eren', 'yeager'],
        expectsAnimeWork: true,
      },
      {
        analyzeFrames: async (_uri, stamps) =>
          stamps.map((ts) => ({
            timestampSec: ts,
            visualCategory: 'real_person_camera',
            description: 'Pessoa real falando para webcam',
            confidence: 0.94,
          })),
      },
    );

    expect(decision.accepted).toBe(false);
    expect(decision.rejectionCode).toBe('unrelated_real_person');

    const critic = await evaluateRenderedVisualCritic({
      projectId: 'anime-test',
      scenes: [{ sceneId: 'shot_1', startSec: 0, durationSec: 8, sourceMediaId: 'shot_1_real_person' }],
      mediaRelevanceDecisions: [decision],
    });

    expect(critic.passed).toBe(false);
    expect(critic.editorialQualityApproved).toBe(false);
    expect(critic.proposedRepairs.some((r) => r.action === 'retry_media_research')).toBe(true);
  });

  it('allows real-person interview/live-action/BTS when justified by the script', async () => {
    const decision = await evaluateMediaRelevance(
      {
        mediaId: 'bts_creator',
        uri: 'C:/media/entrevista_diretor.mp4',
        title: 'Entrevista exclusiva com o diretor de Attack on Titan nos bastidores',
        durationSec: 120,
      },
      {
        segmentId: 'seg_interview',
        prompt: 'Bastidores e entrevista com o diretor de Attack on Titan',
        narrationText: 'Em entrevista de bastidores, o diretor explicou a cena de Attack on Titan.',
        expectedEntities: ['attack', 'titan', 'diretor'],
        expectsAnimeWork: true,
      },
      {
        analyzeFrames: async (_uri, stamps) =>
          stamps.map((ts) => ({
            timestampSec: ts,
            visualCategory: 'interview_documentary',
            detectedEntities: ['attack', 'titan', 'diretor'],
            confidence: 0.9,
          })),
      },
    );

    expect(decision.accepted).toBe(true);
  });

  it('rejects generic anime-style clips without entity match, wrong game clips, and cross-project cache leaks', async () => {
    const genericAnime = await evaluateMediaRelevance(
      {
        mediaId: 'generic_anime',
        uri: 'C:/media/naruto_amv.mp4',
        title: 'Naruto Shippuden AMV Fight',
        durationSec: 60,
        visualCategoryHint: 'anime_animation',
      },
      {
        segmentId: 'seg_1',
        prompt: 'Análise de Fullmetal Alchemist Brotherhood',
        narrationText: 'Edward Elric busca a pedra filosofal em Fullmetal Alchemist.',
        expectedEntities: ['fullmetal', 'alchemist', 'edward', 'elric'],
        expectsAnimeWork: true,
      },
    );
    expect(genericAnime.accepted).toBe(false);
    expect(genericAnime.rejectionCode).toBe('generic_anime_style_without_entity');

    const wrongGame = await evaluateMediaRelevance(
      {
        mediaId: 'wrong_game',
        uri: 'C:/media/minecraft_gameplay.mp4',
        title: 'Minecraft Survival Gameplay',
        durationSec: 120,
        visualCategoryHint: 'gameplay',
      },
      {
        segmentId: 'seg_game',
        prompt: 'Análise de Elden Ring Shadow of the Erdtree',
        narrationText: 'Elden Ring exige leitura de padrões de chefes.',
        expectedEntities: ['elden', 'ring'],
      },
    );
    expect(wrongGame.accepted).toBe(false);
    expect(wrongGame.rejectionCode).toBe('wrong_game_or_topic');

    const cacheCheck = isCacheEntryCompatibleWithProject(
      { projectId: 'old-proj', topic: 'Minecraft', query: 'Minecraft' },
      { projectId: 'new-proj', prompt: 'Elden Ring', expectedEntities: ['elden', 'ring'] },
    );
    expect(cacheCheck.compatible).toBe(false);
  });
});

describe('Media Coverage Planner & Anti-Repetition Engine', () => {
  it('reproduces 10-min anime video with only two 1m30s clips and blocks repetitive assembly', () => {
    const segments = Array.from({ length: 10 }, (_, i) => ({
      segmentId: `seg_${i + 1}`,
      subject: `Capítulo ${i + 1}`,
      narrationText: `Discussão sobre o capítulo ${i + 1} do anime.`,
      expectedDurationSec: 60,
    }));

    const assets = [
      { mediaId: 'vid_1', uri: 'slot_1.mp4', durationSec: 90, compatible: true },
      { mediaId: 'vid_2', uri: 'slot_2.mp4', durationSec: 90, compatible: true },
    ];

    const plannedUsages = segments.map((s, i) => ({
      clipId: `clip_${i + 1}`,
      segmentId: s.segmentId,
      mediaId: i % 2 === 0 ? 'vid_1' : 'vid_2',
      sourceStartSec: 0,
      sourceEndSec: 60,
      timelineDurationSec: 60,
      cropOrZoomApplied: i >= 2,
    }));

    const report = planMediaCoverage({
      segments,
      assets,
      plannedUsages,
      format: 'analysis',
    });

    expect(report.gatePassed).toBe(false);
    expect(report.coverageRatio).toBeLessThan(0.5);
    expect(report.repetition.violations.some((v) => v.kind === 'disguised_loop_transform')).toBe(true);
  });

  it('approves diverse media across multiple subjects and supports intentional repetition', () => {
    const segments = [
      { segmentId: 's1', subject: 'Goku', narrationText: 'Goku transforma', expectedDurationSec: 10 },
      { segmentId: 's2', subject: 'Vegeta', narrationText: 'Vegeta treina', expectedDurationSec: 10 },
      { segmentId: 's3', subject: 'Freeza', narrationText: 'Freeza invade', expectedDurationSec: 10 },
      { segmentId: 's4', subject: 'Namek', narrationText: 'Planeta Namek', expectedDurationSec: 10 },
    ];
    const assets = segments.map((s, i) => ({
      mediaId: `m_${i + 1}`,
      uri: `${s.subject}.mp4`,
      durationSec: 45,
      relevantToEntities: [s.subject.toLowerCase()],
      compatible: true,
    }));
    const plannedUsages = segments.map((s, i) => ({
      clipId: `c_${i + 1}`,
      segmentId: s.segmentId,
      mediaId: `m_${i + 1}`,
      sourceStartSec: 0,
      sourceEndSec: 10,
      timelineDurationSec: 10,
    }));

    const okReport = planMediaCoverage({ segments, assets, plannedUsages, format: 'documentary' });
    expect(okReport.gatePassed).toBe(true);
    expect(okReport.coverageRatio).toBe(1);

    const intentional = planMediaCoverage({
      segments: [segments[0]!, segments[1]!],
      assets: [assets[0]!],
      plannedUsages: [
        { clipId: 'c1', segmentId: 's1', mediaId: 'm_1', sourceStartSec: 0, sourceEndSec: 20, timelineDurationSec: 20, intentionalReuse: true, reuseJustification: 'Comparação visual' },
        { clipId: 'c2', segmentId: 's2', mediaId: 'm_1', sourceStartSec: 0, sourceEndSec: 20, timelineDurationSec: 20, intentionalReuse: true, reuseJustification: 'Comparação visual' },
      ],
      format: 'intentional_repetition',
      intentionalRepetition: true,
    });
    expect(intentional.repetition.passed).toBe(true);

    const queries = expandScriptOrientedQueries({
      prompt: 'História de Dragon Ball',
      segments,
      genre: 'anime_essay',
      uncoveredSegmentIds: ['s2', 's3'],
    });
    expect(queries.length).toBeGreaterThanOrEqual(2);
  });

  it('regression: a 2.6s proven interval cannot masquerade as a 44s scene', () => {
    const report = planMediaCoverage({
      format: 'analysis',
      requireRelevanceApproval: true,
      relevanceDecisions: [
        {
          mediaId: 'auto_yt_dlp_8',
          accepted: true,
          assemblyEligible: true,
          editorialStatus: 'approved_for_scene',
          correspondenceLevel: 'exact_match',
          visualVerificationStatus: 'visually_verified',
          score: 0.85,
          reason: 'Somente o intervalo comprovado foi aprovado.',
          sampledTimestampsSec: [1.1, 1.8],
          matchedEntities: ['Black Clover'],
          matchedIntervals: [{ startSec: 0, endSec: 2.6, segmentId: 'scene_08' }],
          eligibleSegmentIds: ['scene_08'],
          visualCategory: 'anime_animation',
        },
      ],
      segments: [
        {
          segmentId: 'scene_08',
          subject: 'Black Clover',
          narrationText: 'A cena apresenta o acontecimento narrado.',
          entities: ['Black Clover'],
          expectedDurationSec: 44,
        },
      ],
      assets: [{ mediaId: 'auto_yt_dlp_8', uri: 'auto_yt_dlp_8.mp4', durationSec: 44, compatible: true }],
      plannedUsages: [
        {
          clipId: 'clip_08',
          segmentId: 'scene_08',
          mediaId: 'auto_yt_dlp_8',
          sourceStartSec: 0,
          sourceEndSec: 44,
          timelineDurationSec: 44,
        },
      ],
    });

    const scene = report.segments[0]!;
    expect(scene.usableDurationSec).toBe(2.6);
    expect(scene.relevantIntervals).toEqual([{ mediaId: 'auto_yt_dlp_8', startSec: 0, endSec: 2.6 }]);
    expect(scene.covered).toBe(false);
    expect(report.coverageRatio).toBeLessThan(0.1);
  });
});

describe('AI Voice Director, Pronunciation Dictionary & Audio Quality Gate', () => {
  it('preserves pt-BR punctuation, applies Pronunciation Dictionary for "cabeça", and supports targeted regeneration', () => {
    const plan = directNarrationSegments({
      segments: [
        { segmentId: 'seg_1', text: 'Você já pensou no que passa pela cabeça de um herói?' },
        { segmentId: 'seg_2', text: 'Quando o jogo de RPG começa, cada decisão importa!' },
      ],
      voiceId: '9190edfa',
      dictionary: DEFAULT_PT_BR_PRONUNCIATION_ENTRIES,
    });

    expect(plan.segments[0]?.editorialText).toContain('cabeça');
    expect(plan.segments[0]?.ttsInputText).toContain('?');
    expect(plan.segments[0]?.appliedDictionaryIds).toContain('ptbr-cabeca');

    const quality = evaluateNarrationAudioQuality([
      {
        segmentId: 'seg_1',
        editorialText: plan.segments[0]!.editorialText,
        wavPath: 'seg1.wav',
        durationSec: 4.5,
        peakDb: -1.5,
        meanVolumeDb: -16,
        silenceAfterSec: 0.35,
        asrTranscript: 'Voce ja pensou no que passa pela cabeca de um heroi',
      },
      {
        segmentId: 'seg_2',
        editorialText: plan.segments[1]!.editorialText,
        wavPath: 'seg2.wav',
        durationSec: 0.4,
        peakDb: 0.0,
        meanVolumeDb: -8,
      },
    ]);

    expect(quality.passed).toBe(false);
    expect(quality.requiresHumanListeningCheck).toBe(true);
    expect(quality.failingSegmentIds).toEqual(['seg_2']);

    const regen = planTargetedSegmentRegeneration(plan, quality.failingSegmentIds);
    expect(regen.regenerateSegments.map((s) => s.segmentId)).toEqual(['seg_2']);
    expect(regen.preservedSegments.map((s) => s.segmentId)).toEqual(['seg_1']);

    const tmp = mkdtempSync(join(tmpdir(), 'aethera-voice-acad-'));
    const evolution = new AetheraEvolutionCore(join(tmp, 'evo.json'));
    const rule = recordApprovedPronunciationRule(evolution, {
      term: 'cabeça',
      feedbackNote: 'A palavra cabeça foi pronunciada incorretamente.',
      expectedPronunciation: 'pronúncia brasileira natural aprovada',
      scope: 'voice',
      voiceId: '9190edfa',
      language: 'pt-BR',
    });
    expect(rule.kind).toBe('procedural');
    expect(rule.tags).toContain('audio_rule');
    expect(rule.tags).toContain('scope:voice');
  });

  it('regression: planMediaCoverage never counts rejected or unapproved media as valid coverage', () => {
    const report = planMediaCoverage({
      segments: [
        { segmentId: 's1', subject: 'Goku', narrationText: 'Goku em Namek', expectedDurationSec: 10 },
        { segmentId: 's2', subject: 'Freeza', narrationText: 'Freeza ataca', expectedDurationSec: 10 },
      ],
      assets: [
        { mediaId: 'bad_gdc', uri: 'gdc.mp4', durationSec: 120 },
        { mediaId: 'ok_anime', uri: 'goku.mp4', durationSec: 10 },
        { mediaId: 'unknown_compatible', uri: 'unknown.mp4', durationSec: 10, compatible: true },
      ],
      plannedUsages: [
        { clipId: 'c1', segmentId: 's1', mediaId: 'bad_gdc', sourceStartSec: 0, sourceEndSec: 10, timelineDurationSec: 10 },
        { clipId: 'c2', segmentId: 's2', mediaId: 'ok_anime', sourceStartSec: 0, sourceEndSec: 10, timelineDurationSec: 10 },
        { clipId: 'c3', segmentId: 's1', mediaId: 'unknown_compatible', sourceStartSec: 0, sourceEndSec: 10, timelineDurationSec: 10 },
      ],
      relevanceDecisions: [
        {
          mediaId: 'bad_gdc',
          accepted: false,
          score: 0.05,
          rejectionCode: 'wrong_anime_or_entity',
          reason: 'Palestra GDC incompatível com Dragon Ball.',
          sampledTimestampsSec: [5, 30],
          matchedEntities: [],
          visualCategory: 'real_person',
        },
        {
          mediaId: 'ok_anime',
          accepted: true,
          score: 0.92,
          reason: 'Cena de Goku em Namek confirmada.',
          sampledTimestampsSec: [2, 6],
          matchedEntities: ['goku'],
          visualCategory: 'anime',
        },
      ],
      requireRelevanceApproval: true,
    });

    expect(report.gatePassed).toBe(false);
    expect(report.uniqueAssetCount).toBe(1);
    expect(report.coverageRatio).toBe(0.5);
    expect(report.incompatibleMedia.some((m) => m.mediaId === 'bad_gdc')).toBe(true);
    expect(report.incompatibleMedia.some((m) => m.mediaId === 'unknown_compatible')).toBe(true);
    expect(report.gateReasons.some((r) => r.includes('mídia rejeitada/incompatível'))).toBe(true);
  });

  it('resilient media acquisition does not depend solely on yt-dlp when anti-bot blocks YouTube', async () => {
    const mockFetch = (async () =>
      new Response(JSON.stringify({ query: { pages: { '1': { title: 'File:Anime.png', imageinfo: [{ url: 'https://upload.wikimedia.org/anime.png', mime: 'image/png' }] } } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;

    const result = await searchResilientMediaSources(
      'Dragon Ball Goku',
      {
        fetchImpl: mockFetch,
        ytDlpSearchFn: async () => {
          throw new Error("Sign in to confirm you're not a bot");
        },
      },
    );

    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.some((c) => c.origin === 'wikimedia_commons')).toBe(true);
    expect(
      result.providerStatuses.some(
        (s) => s.provider === 'yt_dlp' && s.status === 'blocked_auth_or_antibot',
      ),
    ).toBe(true);
  });

  it('autonomous acquisition expands queries across rounds, auto-resolves gaps, and sends only unresolved gaps to Review Room', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'aethera-auto-acq-'));
    const { writeFileSync } = await import('node:fs');
    const gokuFile = join(tmp, 'goku.png');
    const vegetaFile = join(tmp, 'vegeta.png');
    const unrelatedFile = join(tmp, 'podcast.png');
    writeFileSync(gokuFile, Buffer.alloc(2048, 1));
    writeFileSync(vegetaFile, Buffer.alloc(2048, 2));
    writeFileSync(unrelatedFile, Buffer.alloc(2048, 3));

    let searchCalls = 0;
    const audit = await runAutonomousMediaAcquisition({
      projectId: 'auto_test_1',
      prompt: 'Dragon Ball Z Saga Freeza',
      genre: 'anime',
      format: 'analysis',
      mediaDir: tmp,
      segments: [
        { segmentId: 's1', subject: 'Goku', narrationText: 'Goku enfrenta Freeza', entities: ['goku', 'freeza'], expectedDurationSec: 10 },
        { segmentId: 's2', subject: 'Vegeta', narrationText: 'Vegeta em Namek', entities: ['vegeta'], expectedDurationSec: 10 },
        { segmentId: 's3', subject: 'Piccolo', narrationText: 'Piccolo em Namek', entities: ['piccolo'], expectedDurationSec: 10 },
      ],
      probeDurationFn: async () => 12,
      analyzeFrames: async (uri, timestampsSec) => {
        const isPodcast = uri.includes('podcast');
        const isVegeta = uri.includes('vegeta');
        return timestampsSec.map((timestampSec) => ({
          timestampSec,
          visualCategory: isPodcast ? ('real_person_camera' as const) : ('anime_animation' as const),
          detectedEntities: isPodcast ? [] : isVegeta ? ['vegeta'] : ['goku', 'freeza'],
          detectedActions: isPodcast ? [] : isVegeta ? [] : ['batalha_confronto'],
          description: isPodcast
            ? 'Podcast com pessoa real; nenhum anime visível.'
            : isVegeta
              ? 'Vegeta em Namek.'
              : 'Goku enfrenta Freeza em uma cena de anime.',
          confidence: 0.92,
        }));
      },
      limits: { maxRounds: 2, maxDurationMs: 15_000, maxQueriesTotal: 10 },
      deps: {
        localMediaDirs: [],
        fetchImpl: (async () => new Response(JSON.stringify({}), { status: 404 })) as unknown as typeof fetch,
        ytDlpSearchFn: async (q) => {
          searchCalls += 1;
          if (q.toLowerCase().includes('goku')) {
            return [
              { url: 'https://example.com/goku', title: 'Dragon Ball Z Goku vs Freeza', durationSec: 12 },
              { url: 'https://example.com/podcast', title: 'Podcast entrevista tecnologia', durationSec: 12 },
            ];
          }
          // Vegeta só aparece na rodada 2 (consulta ampliada)
          if (searchCalls > 3 && q.toLowerCase().includes('vegeta')) {
            return [{ url: 'https://example.com/vegeta', title: 'Dragon Ball Z Vegeta Namek', durationSec: 12 }];
          }
          return [];
        },
        ytDlpAcquireFn: async (url) => {
          if (url.endsWith('/goku')) return gokuFile;
          if (url.endsWith('/vegeta')) return vegetaFile;
          if (url.endsWith('/podcast')) return unrelatedFile;
          return null;
        },
      },
    });

    expect(audit.roundsExecuted).toBe(2);
    expect(audit.candidatesFoundCount).toBe(3);
    expect(audit.acquiredFilesCount).toBe(2);
    expect(audit.observability?.triageEliminatedCount).toBe(1);
    expect(audit.approvedForAssemblyCount).toBe(2);
    expect(audit.rejectedCandidates).toHaveLength(1);
    expect(audit.autoResolvedGaps.some((g) => g.segmentId === 's2' && g.resolvedInRound === 2)).toBe(true);
    expect(audit.unresolvedGapsForReview.map((g) => g.segmentId)).toEqual(['s3']);
  });

  it('audit: accepts same-universe DBZ Vegeta clip without false negative, rejects other anime, and enforces deadline + deduplication', async () => {
    const dbzPrompt = 'Análise completa de Dragon Ball Z: Saga Freeza em Namekusei';
    const seg2 = {
      segmentId: 'seg_2',
      prompt: dbzPrompt,
      narrationText: 'Gohan e Kuririn enfrentam os soldados de Freeza em Namekusei.',
      genre: 'anime',
      expectedEntities: ['gohan', 'kuririn', 'freeza'],
    };

    // Mesmo universo narrativo (DBZ / Vegeta) não deve ser rejeitado por falso negativo
    const vegetaDecision = await evaluateMediaRelevance(
      {
        mediaId: 'yt_vegeta',
        uri: 'yt_slot_7.mp4',
        title: 'DBZ Vegeta fica muito irado !',
        origin: 'yt_dlp',
        durationSec: 155,
      },
      seg2,
    );
    expect(vegetaDecision.accepted).toBe(true);
    expect(vegetaDecision.relevanceTier).toBe('same_universe_context');

    // Outro anime (Naruto) deve ser rejeitado
    const narutoDecision = await evaluateMediaRelevance(
      {
        mediaId: 'yt_naruto',
        uri: 'naruto.mp4',
        title: 'Naruto Shippuden Sasuke vs Itachi AMV',
        origin: 'yt_dlp',
        durationSec: 120,
        visualCategoryHint: 'anime_animation',
      },
      seg2,
    );
    expect(narutoDecision.accepted).toBe(false);
    expect(narutoDecision.rejectionCode).toBe('generic_anime_style_without_entity');

    // Deadline previsível + deduplicação SHA-256
    const tmp = mkdtempSync(join(tmpdir(), 'aethera-deadline-'));
    const { writeFileSync } = await import('node:fs');
    const dupA = join(tmp, 'dupA.mp4');
    const dupB = join(tmp, 'dupB.mp4');
    const sameBytes = Buffer.from('identical-video-payload-bytes'.repeat(100));
    writeFileSync(dupA, sameBytes);
    writeFileSync(dupB, sameBytes);

    const audit = await runAutonomousMediaAcquisition({
      projectId: 'deadline_test',
      prompt: dbzPrompt,
      genre: 'anime',
      mediaDir: tmp,
      segments: [
        { segmentId: 's1', subject: 'Goku', narrationText: 'Goku em Namek', entities: ['goku'], expectedDurationSec: 30 },
        { segmentId: 's2', subject: 'Freeza', narrationText: 'Freeza ataca', entities: ['freeza'], expectedDurationSec: 30 },
      ],
      limits: { maxRounds: 2, maxDurationMs: 1200, perOperationTimeoutMs: 400 },
      analyzeFrames: async (_uri, timestampsSec, segment) =>
        timestampsSec.map((timestampSec) => ({
          timestampSec,
          visualCategory: 'anime_animation' as const,
          detectedEntities: segment.expectedEntities ?? [],
          detectedActions: [],
          description: `Frame de anime com ${(segment.expectedEntities ?? []).join(', ')}.`,
          confidence: 0.9,
        })),
      deps: {
        localMediaDirs: [],
        fetchImpl: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch,
        ytDlpSearchFn: async (_q, _c, sig) => {
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 600);
            sig?.addEventListener('abort', () => {
              clearTimeout(t);
              reject(new Error('aborted'));
            });
          });
          return [
            { url: 'https://example.com/a', title: 'Dragon Ball Z Goku', durationSec: 15 },
            { url: 'https://example.com/b', title: 'Dragon Ball Z Goku Mirror', durationSec: 15 },
          ];
        },
        ytDlpAcquireFn: async (url) => (url.endsWith('/a') ? dupA : dupB),
      },
    });

    expect(audit.elapsedMs).toBeLessThan(2200);
    expect(audit.stoppedReason).toBe('deadline_exceeded');
    expect(audit.duplicateFilesSkipped).toBe(1);
    expect(audit.approvedForAssemblyCount).toBe(1);
  });

  it('distinguishes exact_match, contextual_support, universe_only_coincidence, and unverified_metadata_only in DBZ scenes', async () => {
    const dbzPrompt = 'Análise de Dragon Ball Z: Saga Namek';

    const specificExpectation = extractNarrativeVisualExpectation({
      segmentId: 'seg_kuririn',
      narrationText: 'A morte de Kuririn desperta a primeira transformação de Goku em Super Saiyajin contra Freeza.',
      expectedEntities: ['goku', 'kuririn', 'freeza', 'super saiyajin'],
    });
    expect(specificExpectation.requiresSpecificEventVisual).toBe(true);
    expect(specificExpectation.actionsAndEvents.length).toBeGreaterThan(0);

    // 1. Cena exata visualmente verificada (exact_match + visually_verified)
    const exactDecision = await evaluateMediaRelevance(
      {
        mediaId: 'dbz_exact_ssj',
        uri: 'file:///tmp/goku_ssj_namek.mp4',
        title: 'Goku transforma em Super Saiyajin após Kuririn',
        origin: 'local_library',
        durationSec: 40,
      },
      {
        segmentId: 'seg_kuririn',
        prompt: dbzPrompt,
        narrationText: 'A morte de Kuririn desperta a primeira transformação de Goku em Super Saiyajin.',
        genre: 'anime',
        expectedEntities: ['goku', 'kuririn', 'super saiyajin'],
      },
      {
        analyzeFrames: async () => [
          { timestampSec: 8, visualCategory: 'anime_animation', detectedEntities: ['goku', 'kuririn'], detectedActions: ['morte'], description: 'Kuririn cai em Namek', confidence: 0.91 },
          { timestampSec: 22, visualCategory: 'anime_animation', detectedEntities: ['goku', 'super saiyajin'], detectedActions: ['transformacao'], description: 'Goku se transforma em Super Saiyajin', confidence: 0.94 },
        ],
      },
    );
    expect(exactDecision.accepted).toBe(true);
    expect(exactDecision.correspondenceLevel).toBe('exact_match');
    expect(exactDecision.visualVerificationStatus).toBe('visually_verified');
    expect(exactDecision.eligibleSegmentIds).toEqual(['seg_kuririn']);
    expect(exactDecision.matchedIntervals?.length).toBeGreaterThan(0);

    // 2. Cena do mesmo anime, mas evento errado para segmento que exige acontecimento específico -> universe_only_coincidence (não satisfaz cobertura)
    const wrongEventDecision = await evaluateMediaRelevance(
      {
        mediaId: 'dbz_vegeta_zarbon',
        uri: 'file:///tmp/vegeta_zarbon.mp4',
        title: 'Dragon Ball Z Vegeta vs Zarbon',
        origin: 'local_library',
        durationSec: 30,
      },
      {
        segmentId: 'seg_kuririn',
        prompt: dbzPrompt,
        narrationText: 'A morte de Kuririn desperta a transformação de Goku em Super Saiyajin.',
        genre: 'anime',
        expectedEntities: ['goku', 'kuririn', 'super saiyajin'],
      },
      {
        analyzeFrames: async () => [
          { timestampSec: 6, visualCategory: 'anime_animation', detectedEntities: ['vegeta', 'zarbon'], detectedActions: ['batalha'], description: 'Vegeta enfrenta Zarbon', confidence: 0.89 },
          { timestampSec: 18, visualCategory: 'anime_animation', detectedEntities: ['vegeta', 'zarbon'], detectedActions: ['batalha'], description: 'Vegeta ataca Zarbon', confidence: 0.87 },
        ],
      },
    );
    expect(wrongEventDecision.accepted).toBe(true);
    expect(wrongEventDecision.relevanceTier).toBe('same_universe_context');
    expect(wrongEventDecision.correspondenceLevel).toBe('universe_only_coincidence');
    expect(wrongEventDecision.eligibleSegmentIds).toEqual([]);

    // 3. Cena contextual do mesmo anime para segmento descritivo sem evento específico -> contextual_support
    const contextualDecision = await evaluateMediaRelevance(
      {
        mediaId: 'dbz_namek_landscape',
        uri: 'file:///tmp/namek_sky.mp4',
        title: 'Dragon Ball Z Planeta Namek cenário',
        origin: 'local_library',
        durationSec: 25,
      },
      {
        segmentId: 'seg_ambientacao',
        prompt: dbzPrompt,
        narrationText: 'Os guerreiros observam o horizonte em busca das esferas.',
        genre: 'anime',
        expectedEntities: ['gohan', 'kuririn'],
      },
      {
        analyzeFrames: async () => [
          // Coverage counts only what frames prove: evidence spread across the clip proves its whole span.
          { timestampSec: 2, visualCategory: 'anime_animation', detectedEntities: ['namek', 'dragon ball'], description: 'Paisagem de Namek com céu verde', confidence: 0.85 },
          { timestampSec: 10, visualCategory: 'anime_animation', detectedEntities: ['namek', 'dragon ball'], description: 'Horizonte de Namek', confidence: 0.85 },
          { timestampSec: 18, visualCategory: 'anime_animation', detectedEntities: ['namek', 'dragon ball'], description: 'Céu verde de Namek', confidence: 0.85 },
        ],
      },
    );
    expect(contextualDecision.accepted).toBe(true);
    expect(contextualDecision.correspondenceLevel).toBe('contextual_support');
    expect(contextualDecision.visualVerificationStatus).toBe('visually_verified');

    // 4. Candidato apenas com metadados e sem frames analisados -> unverified_metadata_only (rejeitado se requireVisualVerification=true)
    const metadataOnlyDecision = await evaluateMediaRelevance(
      {
        mediaId: 'dbz_metadata_only',
        uri: 'file:///tmp/goku_namek_meta.mp4',
        title: 'Dragon Ball Z Goku em Namek',
        origin: 'youtube_data_api',
        durationSec: 30,
      },
      {
        segmentId: 'seg_kuririn',
        prompt: dbzPrompt,
        narrationText: 'Goku enfrenta Freeza em Namek.',
        genre: 'anime',
        expectedEntities: ['goku', 'freeza'],
      },
      {
        requireVisualVerification: true,
      },
    );
    expect(metadataOnlyDecision.accepted).toBe(false);
    expect(metadataOnlyDecision.correspondenceLevel).toBe('unverified');
    expect(metadataOnlyDecision.visualVerificationStatus).toBe('unverified_metadata_only');
    expect(metadataOnlyDecision.rejectionCode).toBe('unverified_no_visual_evidence');

    // Coverage Planner não deve cobrir seg_kuririn usando apenas wrongEventDecision (universe_only_coincidence)
    const coverage = planMediaCoverage({
      format: 'analysis',
      requireRelevanceApproval: true,
      relevanceDecisions: [wrongEventDecision, contextualDecision],
      segments: [
        {
          segmentId: 'seg_kuririn',
          subject: 'Morte de Kuririn e Super Saiyajin',
          narrationText: 'A morte de Kuririn desperta a transformação de Goku em Super Saiyajin.',
          entities: ['goku', 'kuririn', 'super saiyajin'],
          expectedDurationSec: 20,
        },
        {
          segmentId: 'seg_ambientacao',
          subject: 'Ambientação de Namek',
          narrationText: 'Os guerreiros observam o horizonte em busca das esferas.',
          entities: ['gohan', 'kuririn'],
          expectedDurationSec: 20,
        },
      ],
      assets: [
        {
          mediaId: 'dbz_vegeta_zarbon',
          uri: 'file:///tmp/vegeta_zarbon.mp4',
          durationSec: 30,
          compatible: true,
          relevantToEntities: ['vegeta', 'zarbon'],
        },
        {
          mediaId: 'dbz_namek_landscape',
          uri: 'file:///tmp/namek_sky.mp4',
          durationSec: 25,
          compatible: true,
          relevantToEntities: ['dragon ball', 'namek'],
        },
      ],
    });

    const segKuririnCov = coverage.segments.find((s) => s.segmentId === 'seg_kuririn');
    const segAmbientCov = coverage.segments.find((s) => s.segmentId === 'seg_ambientacao');
    expect(segKuririnCov?.covered).toBe(false);
    expect(segKuririnCov?.usableDurationSec).toBe(0);
    expect(segAmbientCov?.covered).toBe(false);
    expect(coverage.contextualMedia.some((m) => m.mediaId === 'dbz_namek_landscape')).toBe(true);
  });

  it('funnel audit: separates lifecycle states, classifies download failures, preserves pending_visual_verification on VisionRouter error, and resumes from checkpoint', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-funnel-audit-'));
    const mediaDir = join(dir, 'media');
    mkdirSync(mediaDir, { recursive: true });
    const okClip = join(mediaDir, 'goku_raditz.mp4');
    writeFileSync(okClip, Buffer.alloc(2048, 7));

    let searchCalls = 0;
    let downloadCalls = 0;

    // Run 1: 1 download succeeds, 1 download fails (timeout), VisionRouter throws infra error -> must NOT mark as rejected!
    const run1 = await runAutonomousMediaAcquisition({
      projectId: 'proj_funnel_1',
      prompt: 'Dragon Ball Z Chegada de Raditz',
      genre: 'anime',
      mediaDir,
      requireVisualVerification: true,
      limits: { maxRounds: 1, maxDurationMs: 10_000 },
      segments: [
        {
          segmentId: 'slot_1',
          subject: 'Chegada de Raditz',
          narrationText: 'Raditz chega à Terra enfrentando Goku e Piccolo.',
          entities: ['raditz', 'goku', 'piccolo'],
          expectedDurationSec: 20,
        },
      ],
      deps: {
        ytDlpSearchFn: async () => {
          searchCalls += 1;
          return [
            { url: 'https://youtube.com/watch?v=ok_raditz', title: 'Dragon Ball Z Chegada de Raditz Goku e Piccolo', durationSec: 25 },
            { url: 'https://youtube.com/watch?v=timeout_vid', title: 'Dragon Ball Z Raditz luta', durationSec: 30 },
          ];
        },
        ytDlpAcquireFn: async (url) => {
          downloadCalls += 1;
          if (url.includes('timeout_vid')) {
            throw new Error('network: Read timed out');
          }
          return okClip;
        },
      },
      analyzeFrames: async () => {
        throw new Error('VisionRouter sem provedor visual válido [claude:unavailable; codex:error(timeout)]');
      },
    });

    expect(run1.acquiredFilesCount).toBe(1);
    expect(run1.approvedForAssemblyCount).toBe(0);
    // Crucial: downloaded file whose vision provider failed must stay pending_visual_verification, NOT rejected!
    expect(run1.rejectedCandidates).toHaveLength(0);
    expect(run1.funnelMetrics.pendingVerificationCount).toBe(1);
    expect(run1.funnelMetrics.counts.pending_visual_verification).toBe(1);
    expect(run1.funnelMetrics.counts.failed).toBe(1);
    expect(run1.funnelMetrics.failureReasons.timeout).toBe(1);
    expect(run1.funnelMetrics.visionDiagnostics.callsAttempted).toBe(1);
    expect(run1.funnelMetrics.visionDiagnostics.callsFailed).toBe(1);

    // Run 2: resume pending_visual_verification ONLY from checkpoint without re-searching or re-downloading
    const searchBefore = searchCalls;
    const downloadBefore = downloadCalls;
    const run2 = await runAutonomousMediaAcquisition({
      projectId: 'proj_funnel_1',
      prompt: 'Dragon Ball Z Chegada de Raditz',
      genre: 'anime',
      mediaDir,
      stageMode: 'verify_pending_only',
      requireVisualVerification: true,
      limits: { maxRounds: 1, maxDurationMs: 10_000 },
      segments: [
        {
          segmentId: 'slot_1',
          subject: 'Chegada de Raditz',
          narrationText: 'Raditz chega à Terra enfrentando Goku e Piccolo.',
          entities: ['raditz', 'goku', 'piccolo'],
          expectedDurationSec: 20,
        },
      ],
      deps: {
        ytDlpSearchFn: async () => {
          searchCalls += 1;
          return [];
        },
        ytDlpAcquireFn: async () => {
          downloadCalls += 1;
          return null;
        },
      },
      analyzeFrames: async () => [
        {
          timestampSec: 5,
          visualCategory: 'anime_animation',
          detectedEntities: ['raditz', 'goku', 'piccolo'],
          detectedActions: ['luta'],
          description: 'Anime Dragon Ball Z: Raditz enfrentando Goku e Piccolo',
          confidence: 0.91,
        },
      ],
    });

    expect(searchCalls).toBe(searchBefore);
    expect(downloadCalls).toBe(downloadBefore);
    expect(run2.budgetBreakdown?.resumedFromCheckpoint).toBe(true);
    expect(run2.approvedForAssemblyCount).toBe(0);
    expect(run2.funnelMetrics.pendingVerificationCount).toBe(0);
    expect(run2.funnelMetrics.counts.contextual).toBe(1);
    expect(run2.funnelMetrics.counts.verified).toBe(0);
    expect(run2.funnelMetrics.conversionRates.downloadedToVerifiedRate).toBe(0);
  });

  it('selects only the specific timestamp interval where the narrated event visibly occurs and refines densely', async () => {
    const analyzeCalls: number[][] = [];
    const decision = await evaluateMediaRelevance(
      {
        mediaId: 'clip_ssj_transform',
        uri: 'C:/tmp/goku_namek.mp4',
        title: 'Dragon Ball Z Namekusei Batalha',
        origin: 'youtube',
        durationSec: 45,
      },
      {
        segmentId: 'slot_ssj',
        prompt: 'Dragon Ball Z Saga Freeza',
        genre: 'anime',
        narrationText: 'Goku se transforma em Super Saiyajin após a morte de Kuririn.',
        expectedEntities: ['goku', 'super saiyajin', 'kuririn'],
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async (_uri, timestampsSec) => {
          analyzeCalls.push(timestampsSec);
          return timestampsSec.map((t) => {
            if (Math.abs(t - 38.7) <= 0.3 || Math.abs(t - 37.2) <= 0.3) {
              return {
                timestampSec: t,
                visualCategory: 'anime_animation' as const,
                detectedEntities: ['goku', 'super saiyajin'],
                detectedActions: ['transformacao'],
                description: 'Goku gritando em fúria se transforma em Super Saiyajin com cabelo loiro e aura dourada.',
                confidence: 0.96,
              };
            }
            return {
              timestampSec: t,
              visualCategory: 'anime_animation' as const,
              detectedEntities: ['freeza'],
              detectedActions: [],
              description: 'Freeza parado em cenário rochoso observando ao longe.',
              confidence: 0.9,
            };
          });
        },
      },
    );

    expect(analyzeCalls.length).toBe(2);
    expect(decision.accepted).toBe(true);
    expect(decision.editorialStatus).toBe('visually_verified');
    expect(decision.correspondenceLevel).toBe('contextual_support');
    expect(decision.eligibleSegmentIds).toEqual([]);
    expect(decision.matchedIntervals).toBeDefined();
    expect(decision.matchedIntervals!.length).toBe(1);
    expect(decision.matchedIntervals![0]!.startSec).toBeGreaterThanOrEqual(36.0);
    expect(decision.matchedIntervals![0]!.endSec).toBeLessThan(40.2);
    expect(decision.matchedIntervals![0]!.provingTimestampsSec?.length).toBeGreaterThan(0);
    expect(decision.matchedIntervals![0]!.provingDescriptions?.[0]).toContain('Super Saiyajin');
  });

  it('does not approve same-universe Dragon Ball clips when frames do not depict the required Raditz arrival event', async () => {
    const decision = await evaluateMediaRelevance(
      {
        mediaId: 'clip_snake_way',
        uri: 'C:/tmp/goku_kaioh.mp4',
        title: 'Goku chega Ao fim do caminho da serpente e Encontra o Planeta do Sr kaioh',
        origin: 'youtube',
        durationSec: 45,
      },
      {
        segmentId: 'slot_1',
        prompt: 'Dragon Ball Z história completa',
        genre: 'anime',
        narrationText: 'A chegada de Raditz à Terra revela a origem Saiyajin de Goku.',
        expectedEntities: ['raditz', 'goku'],
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async () => [
          {
            timestampSec: 4.5,
            visualCategory: 'anime_animation',
            detectedEntities: ['goku'],
            detectedActions: [],
            description: 'Goku correndo por um caminho longo nas nuvens amarelas.',
            confidence: 0.9,
          },
          {
            timestampSec: 20,
            visualCategory: 'anime_animation',
            detectedEntities: ['goku', 'sr kaioh'],
            detectedActions: [],
            description: 'Goku conversando com o Sr. Kaioh em um pequeno planeta verde.',
            confidence: 0.91,
          },
        ],
      },
    );

    expect(decision.correspondenceLevel).toBe('universe_only_coincidence');
    expect(decision.eligibleSegmentIds).toEqual([]);
  });

  it('records Scene Grounding mismatches with confidence/scope guards, blocks false matches, and supports undo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-sg-neg-'));
    const evolution = new AetheraEvolutionCore(join(dir, 'evolution.json'));

    const lowConfSkipped = recordSceneGroundingNegativeExample(evolution, {
      projectId: 'proj_dbz_1',
      segmentId: 'slot_1',
      mediaTitle: 'Clipe Ambíguo',
      mediaSha256: 'lowconf123',
      workScope: 'dragon ball z',
      eventScope: 'raditz chegada_desembarque',
      expectedContext: 'raditz, chegada_desembarque',
      observedVisualSummary: 'Leitura incerta',
      mismatchReason: 'Baixa confiança',
      visualConfidence: 0.55,
      genre: 'anime',
    });
    expect(lowConfSkipped.recorded).toBe(false);

    const autoHypothesis = recordSceneGroundingNegativeExample(evolution, {
      projectId: 'proj_dbz_1',
      segmentId: 'slot_1',
      mediaTitle: 'DRAGON BALL GT Vegeta mata nappa denovo dublado',
      mediaSha256: 'deadbeef1234',
      workScope: 'dragon ball',
      eventScope: 'raditz chegada_desembarque',
      expectedContext: 'raditz, chegada_desembarque',
      observedVisualSummary: 'Vegeta derrotando Nappa em Dragon Ball GT',
      mismatchReason: 'Cena de Dragon Ball GT com Vegeta e Nappa não corresponde à chegada de Raditz.',
      visualConfidence: 0.92,
      origin: 'automatic',
      genre: 'anime',
    });
    expect(autoHypothesis.recorded).toBe(true);
    expect(autoHypothesis.promotedToBlocking).toBe(false);

    // Single automatic hypothesis must NOT permanently block by itself
    const beforeConfirmation = findMatchingSceneGroundingNegativeExample(evolution, {
      mediaTitle: 'DRAGON BALL GT Vegeta mata nappa denovo dublado',
      mediaSha256: 'deadbeef1234',
      workScope: 'dragon ball',
      eventScope: 'raditz chegada_desembarque',
      expectedContext: 'raditz | ações: chegada_desembarque',
      genre: 'anime',
    });
    expect(beforeConfirmation.matched).toBe(false);

    // Human review / confirmed correction promotes to blocking rule
    const recorded = recordSceneGroundingNegativeExample(evolution, {
      projectId: 'proj_dbz_1',
      segmentId: 'slot_1',
      mediaTitle: 'DRAGON BALL GT Vegeta mata nappa denovo dublado',
      mediaSha256: 'deadbeef1234',
      workScope: 'dragon ball',
      eventScope: 'raditz chegada_desembarque',
      expectedContext: 'raditz, chegada_desembarque',
      observedVisualSummary: 'Vegeta derrotando Nappa em Dragon Ball GT',
      mismatchReason: 'Cena de Dragon Ball GT com Vegeta e Nappa não corresponde à chegada de Raditz.',
      visualConfidence: 0.92,
      origin: 'human_review',
      genre: 'anime',
    });
    expect(recorded.recorded).toBe(true);
    expect(recorded.promotedToBlocking).toBe(true);
    expect(recorded.memoryId).toBeTruthy();

    const lookup = findMatchingSceneGroundingNegativeExample(evolution, {
      mediaTitle: 'DRAGON BALL GT Vegeta mata nappa denovo dublado',
      mediaSha256: 'deadbeef1234',
      workScope: 'dragon ball',
      eventScope: 'raditz chegada_desembarque',
      expectedContext: 'raditz | ações: chegada_desembarque',
      genre: 'anime',
    });
    expect(lookup.matched).toBe(true);

    const blocked = await evaluateMediaRelevance(
      {
        mediaId: 'auto_yt_dlp_1',
        uri: 'C:/tmp/vegeta_nappa_gt.mp4',
        title: 'DRAGON BALL GT Vegeta mata nappa denovo dublado',
        sha256: 'deadbeef1234',
        origin: 'yt_dlp',
        durationSec: 45,
      },
      {
        segmentId: 'slot_1',
        prompt: 'Dragon Ball Z Chegada de Raditz',
        genre: 'anime',
        narrationText: 'A chegada de Raditz à Terra inicia a saga Saiyajin.',
        expectedEntities: ['raditz'],
      },
      {
        requireVisualVerification: true,
        evolution,
        analyzeFrames: async () => {
          throw new Error('Should not invoke vision for already-recorded Academy negative example');
        },
      },
    );

    expect(blocked.accepted).toBe(false);
    expect(blocked.rejectionCode).toBe('academy_negative_example');
    expect(blocked.correspondenceLevel).toBe('rejected');

    const undone = undoSceneGroundingNegativeExample(evolution, {
      memoryId: recorded.memoryId!,
      projectId: 'proj_dbz_1',
      reason: 'Auditoria reverteu bloqueio para reavaliar clipe.',
    });
    expect(undone.undone).toBe(true);
    expect(undone.state).toBe('disabled');

    const lookupAfterUndo = findMatchingSceneGroundingNegativeExample(evolution, {
      mediaTitle: 'DRAGON BALL GT Vegeta mata nappa denovo dublado',
      mediaSha256: 'deadbeef1234',
      workScope: 'dragon ball',
      eventScope: 'raditz chegada_desembarque',
      expectedContext: 'raditz | ações: chegada_desembarque',
      genre: 'anime',
    });
    expect(lookupAfterUndo.matched).toBe(false);
  });

  it('boosts gaming gameplay/boss-fight candidates, generates multi-strategy queries, and combines multiple clips to fill 60s scene coverage', async () => {
    const seg = {
      segmentId: 'scene_malenia',
      subject: 'Malenia, Blade of Miquella',
      narrationText: 'Malenia enfrenta o jogador com Waterfowl Dance na segunda fase de Elden Ring.',
      entities: ['Elden Ring', 'Malenia, Blade of Miquella'],
      expectedDurationSec: 60,
    };
    const prompt = 'Crie um vídeo cinematográfico sobre os 10 chefes mais difíceis de Elden Ring';

    const gameplayScore = scoreCandidateRelevancePriority(
      {
        url: 'https://example.com/malenia-gameplay',
        title: 'Elden Ring Malenia Boss Fight Gameplay No Commentary 4K',
        origin: 'yt_dlp',
        license: 'external_reference',
        directDownloadable: false,
        durationSec: 45,
      },
      seg,
      prompt,
    );
    const nonGameplayScore = scoreCandidateRelevancePriority(
      {
        url: 'https://example.com/podcast',
        title: 'Podcast react Elden Ring',
        origin: 'yt_dlp',
        license: 'external_reference',
        directDownloadable: false,
        durationSec: 45,
      },
      seg,
      prompt,
    );
    expect(gameplayScore).toBeGreaterThan(nonGameplayScore);
    expect(gameplayScore).toBeGreaterThan(5);

    const expandedQueries = expandScriptOrientedQueries({
      prompt,
      segments: [seg],
      genre: 'gameplay_essay',
      uncoveredSegmentIds: ['scene_malenia'],
      maxQueries: 8,
    });
    expect(expandedQueries.some((q) => /boss fight|gameplay/i.test(q))).toBe(true);
    expect(expandedQueries.some((q) => /luta chefe/i.test(q))).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'aethera-multiclip-'));
    const clipA = join(dir, 'malenia_part1.mp4');
    const clipB = join(dir, 'malenia_part2.mp4');
    writeFileSync(clipA, Buffer.from('malenia-clip-part-1-bytes'.repeat(80)));
    writeFileSync(clipB, Buffer.from('malenia-clip-part-2-bytes'.repeat(80)));

    const audit = await runAutonomousMediaAcquisition({
      projectId: 'proj_elden_multiclip',
      prompt,
      genre: 'gameplay_essay',
      format: 'analysis',
      segments: [seg],
      mediaDir: dir,
      checkpointPath: false,
      requireVisualVerification: true,
      probeDurationFn: async () => 32,
      analyzeFrames: async (_uri, timestampsSec) =>
        timestampsSec.map((t) => ({
          timestampSec: t,
          summary: 'Elden Ring Malenia boss fight gameplay combat in Haligtree',
          detectedEntities: ['Elden Ring', 'Malenia'],
          detectedActions: ['boss fight', 'combat'],
          visualCategory: 'gameplay',
          confidence: 0.9,
          provider: 'test_vision',
        })),
      deps: {
        ytDlpSearchFn: async () => [
          {
            url: 'https://example.com/malenia-1',
            title: 'Elden Ring Malenia Boss Fight Part 1',
            durationSec: 32,
          },
          {
            url: 'https://example.com/malenia-2',
            title: 'Elden Ring Malenia Phase 2 Gameplay',
            durationSec: 32,
          },
        ],
        ytDlpAcquireFn: async (targetUrl) => (targetUrl.endsWith('-1') ? clipA : clipB),
        fetchImpl: async () => new Response(JSON.stringify({}), { status: 200 }),
      },
    });

    expect(audit.approvedAssets.length).toBe(2);
    expect(audit.coverageReport.segments[0]?.covered).toBe(true);
    // Usable time is the span the sampled frames prove (first/last proving frame), not the raw file length.
    expect(audit.coverageReport.segments[0]?.usableDurationSec).toBeGreaterThanOrEqual(59);
    expect(audit.coverageReport.segments[0]?.usableDurationSec).toBeLessThanOrEqual(60);
    expect(audit.coverageReport.segments[0]?.relevantIntervals.length).toBe(2);
    expect(audit.unresolvedGapsForReview).toEqual([]);
  });

  it('selects relevant intervals anywhere in long videos via chapters/timestamps and blocks generic combat without entity proof', async () => {
    const maleniaSeg = {
      segmentId: 'seg_malenia',
      subject: 'Malenia, Blade of Miquella',
      narrationText: 'Malenia enfrenta o jogador na segunda fase de Elden Ring.',
      entities: ['Elden Ring', 'Malenia'],
      expectedDurationSec: 60,
    };

    const chapterWin = selectRelevantDownloadWindow(
      {
        url: 'https://youtube.com/watch?v=bosses',
        title: 'All Elden Ring Bosses',
        origin: 'yt_dlp',
        license: 'external_reference',
        durationSec: 1200,
        chapters: [
          { startSec: 0, endSec: 180, title: 'Intro & Margit' },
          { startSec: 640, endSec: 780, title: 'Malenia Blade of Miquella Boss Fight' },
        ],
      },
      maleniaSeg,
    );
    expect(chapterWin.source).toBe('chapter_match');
    expect(chapterWin.startSec).toBe(640);
    expect(chapterWin.sectionArg).toBe('*10:40-11:55');

    const descWin = selectRelevantDownloadWindow(
      {
        url: 'https://youtube.com/watch?v=cyberpunk',
        title: 'Best Cyberpunk 2077 Cyberware Builds',
        description: '00:00 Intro\n04:20 Sandevistan Slow Motion Showcase\n08:10 Mantis Blades',
        origin: 'yt_dlp',
        license: 'external_reference',
        durationSec: 700,
      },
      {
        segmentId: 'seg_sandevistan',
        subject: 'Sandevistan',
        narrationText: 'O implante Sandevistan desacelera o tempo em Cyberpunk 2077.',
        entities: ['Cyberpunk 2077', 'Sandevistan'],
        expectedDurationSec: 45,
      },
    );
    expect(descWin.source).toBe('description_timestamp');
    expect(descWin.startSec).toBe(260);
    expect(descWin.sectionArg).toBe('*4:20-5:20');

    const midpointWin = selectRelevantDownloadWindow(
      {
        url: 'https://youtube.com/watch?v=long',
        title: 'Elden Ring Gameplay',
        origin: 'yt_dlp',
        license: 'external_reference',
        durationSec: 800,
      },
      maleniaSeg,
    );
    expect(midpointWin.source).toBe('temporal_midpoint');
    expect(midpointWin.startSec).toBe(200);

    // Scene Grounding MUST NOT approve generic Elden Ring combat/fight/gameplay without proving Malenia
    const genericCombatDecision = await evaluateMediaRelevance(
      {
        mediaId: 'generic_elden_combat',
        uri: 'elden_combat.mp4',
        title: 'Elden Ring Gameplay Combat Fight',
        origin: 'yt_dlp',
        durationSec: 60,
      },
      {
        segmentId: 'seg_malenia',
        prompt: 'Crie um vídeo sobre os 10 chefes mais difíceis de Elden Ring',
        narrationText: 'Malenia enfrenta o jogador com Waterfowl Dance.',
        genre: 'gameplay_essay',
        expectedEntities: ['Elden Ring', 'Malenia'],
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async (_uri, timestampsSec) =>
          timestampsSec.map((t) => ({
            timestampSec: t,
            summary: 'Elden Ring player fighting generic knight in Limgrave combat gameplay',
            detectedEntities: ['Elden Ring'],
            detectedActions: ['fight', 'combat', 'gameplay'],
            visualCategory: 'gameplay',
            confidence: 0.85,
            provider: 'test_vision',
          })),
      },
    );
    expect(genericCombatDecision.correspondenceLevel).toBe('universe_only_coincidence');
    expect(genericCombatDecision.eligibleSegmentIds).toEqual([]);
  });

  it('enforces strict exact_match threshold, no whole-video extrapolation, triage, vision cache keys, and incremental checkpoint resume', async () => {
    // 1. Zero proving frames must NOT extrapolate [0, durationSec] when visually_verified, and score < 0.65 / universe-only must NOT be promoted to exact_match
    const noProvingFramesDecision = await evaluateMediaRelevance(
      {
        mediaId: 'cp_partial_1',
        uri: 'cp_sandevistan.mp4',
        title: 'Cyberpunk 2077 Sandevistan',
        origin: 'yt_dlp',
        durationSec: 60,
      },
      {
        segmentId: 'seg_sandevistan',
        prompt: 'Cyberpunk 2077',
        narrationText: 'O implante desacelera o tempo.',
        genre: 'cyberware_demonstration',
        expectedEntities: [],
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async (_uri, timestampsSec) =>
          timestampsSec.map((t) => ({
            timestampSec: t,
            description: 'Menu settings screen unrelated to gameplay',
            detectedEntities: [],
            detectedActions: [],
            visualCategory: 'other',
            confidence: 0.75,
            provider: 'test_vision',
          })),
      },
    );
    expect(noProvingFramesDecision.accepted).toBe(false);
    expect(noProvingFramesDecision.correspondenceLevel).toBe('rejected');
    expect(noProvingFramesDecision.matchedIntervals ?? []).toEqual([]);

    const universeOnlyDecision = await evaluateMediaRelevance(
      {
        mediaId: 'cp_universe_only',
        uri: 'cp_generic.mp4',
        title: 'Cyberpunk 2077 gameplay',
        origin: 'yt_dlp',
        durationSec: 60,
      },
      {
        segmentId: 'seg_sandevistan',
        prompt: 'Os 10 melhores upgrades de cibernética em Cyberpunk 2077',
        narrationText: 'O Sandevistan desacelera o tempo durante o combate em Night City.',
        genre: 'cyberware_demonstration',
        expectedEntities: ['Cyberpunk 2077', 'Sandevistan'],
      },
      {
        requireVisualVerification: true,
        analyzeFrames: async (_uri, timestampsSec) =>
          timestampsSec.map((t) => ({
            timestampSec: t,
            description: 'Night City street driving in Cyberpunk 2077',
            detectedEntities: ['Cyberpunk 2077'],
            detectedActions: ['driving'],
            visualCategory: 'gameplay',
            confidence: 0.8,
            provider: 'test_vision',
          })),
      },
    );
    expect(universeOnlyDecision.correspondenceLevel).toBe('universe_only_coincidence');
    expect(universeOnlyDecision.eligibleSegmentIds).toEqual([]);

    // 2. Vision cache key invalidates whenever hash, timestamps, intent, entities, model, or policy changes
    const baseKeyInput = {
      sha256: 'abc123',
      timestampsSec: [0, 30, 59],
      visualIntent: 'cyberware_demonstration',
      expectedEntities: ['Cyberpunk 2077', 'Sandevistan'],
      modelVersion: 'agy-vision-1',
      policyVersion: SCENE_GROUNDING_POLICY_VERSION,
    };
    const kBase = computeVisionDecisionCacheKey(baseKeyInput);
    expect(computeVisionDecisionCacheKey({ ...baseKeyInput })).toBe(kBase);
    expect(computeVisionDecisionCacheKey({ ...baseKeyInput, sha256: 'def456' })).not.toBe(kBase);
    expect(computeVisionDecisionCacheKey({ ...baseKeyInput, visualIntent: 'gameplay_boss_fight' })).not.toBe(kBase);
    expect(computeVisionDecisionCacheKey({ ...baseKeyInput, expectedEntities: ['Cyberpunk 2077', 'Mantis Blades'] })).not.toBe(kBase);
    expect(computeVisionDecisionCacheKey({ ...baseKeyInput, modelVersion: 'claude-vision-2' })).not.toBe(kBase);
    expect(computeVisionDecisionCacheKey({ ...baseKeyInput, policyVersion: 'scene-grounding-v1' })).not.toBe(kBase);

    // 3. Two-stage triage eliminates obvious spam without ever approving media alone
    const spamTriage = triageCandidateMetadata(
      {
        url: 'https://example.com/react',
        title: 'My reaction unboxing podcast tier list',
        origin: 'yt_dlp',
        license: 'external_reference',
        durationSec: 240,
      },
      {
        segmentId: 'seg_1',
        subject: 'Sandevistan',
        narrationText: 'O Sandevistan desacelera o tempo em Cyberpunk 2077.',
        expectedDurationSec: 20,
        entities: ['Cyberpunk 2077', 'Sandevistan'],
      },
      'Os 10 melhores upgrades de cibernética em Cyberpunk 2077',
    );
    expect(spamTriage.pass).toBe(false);

    // 4. Incremental checkpoint resume: Pass 1 covers seg_1, Pass 2 resumes seg_2 without re-downloading/re-analyzing seg_1
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-ckpt-resume-'));
    const f1 = join(workDir, 'sandevistan.mp4');
    const f2 = join(workDir, 'mantis.mp4');
    writeFileSync(f1, Buffer.alloc(2048, 1));
    writeFileSync(f2, Buffer.alloc(2048, 2));

    let downloadCalls = 0;
    let visionCalls = 0;
    let allowSeg2 = false;
    const segments = [
      {
        segmentId: 'seg_1',
        subject: 'Sandevistan',
        narrationText: 'O Sandevistan desacelera o tempo em Cyberpunk 2077.',
        expectedDurationSec: 20,
        entities: ['Cyberpunk 2077', 'Sandevistan'],
        preferredQueries: ['Cyberpunk 2077 Sandevistan gameplay'],
      },
      {
        segmentId: 'seg_2',
        subject: 'Mantis Blades',
        narrationText: 'As Mantis Blades cortam inimigos em combate próximo em Cyberpunk 2077.',
        expectedDurationSec: 20,
        entities: ['Cyberpunk 2077', 'Mantis Blades'],
        preferredQueries: ['Cyberpunk 2077 Mantis Blades gameplay'],
      },
    ];
    const sharedDeps = {
      localMediaDirs: [],
      fetchImpl: (async () => new Response(JSON.stringify({}), { status: 404 })) as unknown as typeof fetch,
      ytDlpSearchFn: async (query: string) => {
        if (query.toLowerCase().includes('sandevistan')) {
          return [{ url: 'https://yt.test/sande', title: 'Cyberpunk 2077 Sandevistan Gameplay', origin: 'yt_dlp' as const, license: 'external_reference', durationSec: 25 }];
        }
        if (!allowSeg2) return [];
        return [{ url: 'https://yt.test/mantis', title: 'Cyberpunk 2077 Mantis Blades Gameplay', origin: 'yt_dlp' as const, license: 'external_reference', durationSec: 25 }];
      },
      ytDlpAcquireFn: async (url: string) => {
        downloadCalls += 1;
        return url.includes('sande') ? f1 : f2;
      },
    };
    const sharedAnalyzeFrames = async (uri: string, timestampsSec: number[], seg: { expectedEntities?: string[] }) => {
      visionCalls += 1;
      const isSande = uri.includes('sande') || (seg.expectedEntities ?? []).includes('Sandevistan');
      return timestampsSec.map((t) => ({
        timestampSec: t,
        description: isSande ? 'Cyberpunk 2077 Sandevistan slow motion combat' : 'Cyberpunk 2077 Mantis Blades melee slash',
        detectedEntities: isSande ? ['Cyberpunk 2077', 'Sandevistan'] : ['Cyberpunk 2077', 'Mantis Blades'],
        detectedActions: ['combat', 'showcase'],
        visualCategory: 'gameplay',
        confidence: 0.9,
        provider: 'test_vision',
      }));
    };

    const pass1 = await runAutonomousMediaAcquisition({
      projectId: 'cp2077_resume_test',
      prompt: 'Os 10 melhores upgrades de cibernética em Cyberpunk 2077',
      genre: 'cyberware_demonstration',
      segments,
      mediaDir: workDir,
      deps: sharedDeps,
      probeDurationFn: async () => 25,
      analyzeFrames: sharedAnalyzeFrames,
      requireVisualVerification: true,
      limits: { maxRounds: 1, maxQueriesTotal: 1, discoveryConcurrency: 1, acquisitionConcurrency: 1, verificationConcurrency: 1 },
    });
    expect(pass1.coverageReport.segments.find((s) => s.segmentId === 'seg_1')?.covered).toBe(true);
    expect(pass1.coverageReport.segments.find((s) => s.segmentId === 'seg_2')?.covered).toBe(false);
    expect(downloadCalls).toBe(1);
    const visionCallsAfterPass1 = visionCalls;
    expect(visionCallsAfterPass1).toBeGreaterThanOrEqual(1);

    allowSeg2 = true;
    const pass2 = await runAutonomousMediaAcquisition({
      projectId: 'cp2077_resume_test',
      prompt: 'Os 10 melhores upgrades de cibernética em Cyberpunk 2077',
      genre: 'cyberware_demonstration',
      segments,
      mediaDir: workDir,
      deps: sharedDeps,
      probeDurationFn: async () => 25,
      analyzeFrames: sharedAnalyzeFrames,
      requireVisualVerification: true,
      limits: { maxRounds: 2, maxQueriesTotal: 4, discoveryConcurrency: 1, acquisitionConcurrency: 1, verificationConcurrency: 1 },
    });
    expect(pass2.budgetBreakdown?.resumedFromCheckpoint).toBe(true);
    expect(pass2.coverageReport.gatePassed).toBe(true);
    expect(pass2.observability?.reusedFilesFromCheckpoint).toBeGreaterThanOrEqual(1);
    expect(downloadCalls).toBe(2); // only 1 new download in Pass 2 (seg_1 was NOT re-downloaded)
    expect(visionCalls).toBe(visionCallsAfterPass1 * 2); // seg_1 was NOT re-analyzed
  });
});

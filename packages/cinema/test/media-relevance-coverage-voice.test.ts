import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AetheraEvolutionCore,
  DEFAULT_PT_BR_PRONUNCIATION_ENTRIES,
  directNarrationSegments,
  evaluateMediaRelevance,
  evaluateNarrationAudioQuality,
  evaluateRenderedVisualCritic,
  expandScriptOrientedQueries,
  isCacheEntryCompatibleWithProject,
  planMediaCoverage,
  planTargetedSegmentRegeneration,
  recordApprovedPronunciationRule,
  sampleDistributedFrameTimestamps,
} from '../src/index.js';

describe('Media Relevance Gate & Visual Critic Blocking', () => {
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
});

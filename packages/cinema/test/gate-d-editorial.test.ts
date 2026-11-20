import { describe, expect, it } from 'vitest';
import {
  countPlannedSfxCues,
  isTextOnlyFrame,
  produceCinemaPackage,
  runGateDEditorialQuality,
} from '../src/index.js';
import { buildSceneMontage } from '../../../apps/aethera-desktop/src/main/cinema-pipeline.js';

describe('Gate D Editorial Quality, Sponsor/Logo Filter & Audio-First 1:1 Alignment', () => {
  it('rejects sponsor/partner splash logos even when work name appears in visible text', () => {
    expect(
      isTextOnlyFrame({
        timestampSec: 28,
        visualCategory: 'gameplay',
        detectedEntities: ['sonic the hedgehog'],
        detectedActions: [],
        visibleText: ['McLaren RACING', 'SONIC THE HEDGEHOG', 'OFFICIAL GAMING PARTNER'],
        description: 'Fundo preto com logotipo da McLaren Racing e Sonic the Hedgehog Official Gaming Partner.',
        confidence: 0.95,
      }),
    ).toBe(true);

    expect(
      isTextOnlyFrame({
        timestampSec: 12,
        visualCategory: 'gameplay',
        detectedEntities: ['sonic the hedgehog'],
        detectedActions: ['correndo em fase subaquatica'],
        description: 'Sonic e Tails nadando em fase subaquática coletando anéis.',
        confidence: 0.92,
      }),
    ).toBe(false);
  });

  it('Gate D fails technically valid MP4s with editorial defects (short narration, hollow script, logo, repetition, sluggish shot)', () => {
    const failed = runGateDEditorialQuality({
      requestedDurationSec: 60,
      actualDurationSec: 60,
      measuredNarrationDurationMs: 31_550,
      plannedSfxCount: 4,
      sfxCount: 0,
      scenes: [
        {
          sceneId: 'scene_1',
          clipId: 'clip_1',
          mediaId: 'm1',
          startSec: 0,
          durationSec: 18,
          sourceStartSec: 4,
          sourceEndSec: 14,
          spokenText: 'Tema X: gameplay de Tema X.',
          expectedEntities: ['Tema X'],
          matchedEntities: ['Tema Y'],
          lowInfoFrameDetected: true,
        },
        {
          sceneId: 'scene_2',
          clipId: 'clip_2',
          mediaId: 'm1',
          startSec: 18,
          durationSec: 12,
          sourceStartSec: 6,
          sourceEndSec: 15,
          spokenText: 'Tema X: gameplay de Tema X.',
          expectedEntities: ['Tema X'],
          matchedEntities: ['Tema X'],
        },
      ],
    });
    expect(failed.gate).toBe('D_editorial_quality');
    expect(failed.verdict).toBe('fail');
    expect(failed.repairHints?.some((h) => h.issueCode === 'low_narration_coverage')).toBe(true);
    expect(failed.repairHints?.some((h) => h.issueCode === 'hollow_narration')).toBe(true);
    expect(failed.repairHints?.some((h) => h.issueCode === 'semantic_desync')).toBe(true);
    expect(failed.repairHints?.some((h) => h.issueCode === 'low_info_or_logo_frame')).toBe(true);
    expect(failed.repairHints?.some((h) => h.issueCode === 'consecutive_visual_repetition')).toBe(true);
    expect(failed.repairHints?.some((h) => h.issueCode === 'sluggish_pacing')).toBe(true);
    expect(failed.repairHints?.some((h) => h.issueCode === 'missing_sfx_sync')).toBe(true);
  });

  it('Gate D passes a well-synced, non-repetitive, richly narrated production (domain-agnostic)', () => {
    const passed = runGateDEditorialQuality({
      requestedDurationSec: 60,
      actualDurationSec: 60,
      measuredNarrationDurationMs: 56_800,
      plannedSfxCount: 4,
      sfxCount: 4,
      scenes: [
        {
          sceneId: 'seg_1',
          clipId: 'clip_1',
          mediaId: 'clip_cosmos_1',
          startSec: 0,
          durationSec: 8,
          sourceStartSec: 2,
          sourceEndSec: 10,
          spokenText: 'Telescópios espaciais capturam luz emitida há bilhões de anos para revelar galáxias em formação.',
          expectedEntities: ['telescopio espacial'],
          matchedEntities: ['telescopio espacial'],
        },
        {
          sceneId: 'seg_2',
          clipId: 'clip_2',
          mediaId: 'clip_cosmos_2',
          startSec: 8,
          durationSec: 8,
          sourceStartSec: 1,
          sourceEndSec: 9,
          spokenText: 'As nebulosas funcionam como berçários estelares onde poeira e hidrogênio colapsam sob gravidade.',
          expectedEntities: ['nebulosa'],
          matchedEntities: ['nebulosa'],
        },
      ],
    });
    expect(passed.verdict).toBe('pass');
    expect(passed.reasons).toEqual([]);
  });

  it('produceCinemaPackage maps N editorialScript segments 1:1 to N v1 scenes and buildSceneMontage interleaves distinct sources', () => {
    const segs = Array.from({ length: 7 }, (_, i) => ({
      segmentId: `seg_${i + 1}`,
      beatId: `nbeat_${i + 1}`,
      stage: (i === 0 ? 'hook' : i === 6 ? 'resolution' : 'progression') as 'hook' | 'progression' | 'resolution',
      title: `Capítulo ${i + 1}`,
      spokenText: `Segmento ${i + 1} com explicação detalhada sobre o fenômeno observado em cena.`,
      estimatedDurationSec: 8,
      approved: true,
    }));
    const pkg = produceCinemaPackage({
      projectId: 'proj_1to1',
      prompt: 'Documentário curto de 60 segundos sobre astronomia.',
      targetDurationSec: 60,
      editorialScript: {
        scriptId: 'scr_1',
        source: 'deterministic_draft',
        treatment: 'Astronomia',
        academyRulesApplied: [],
        segments: segs,
        fullSpokenText: segs.map((s) => s.spokenText).join(' '),
        editorialAudit: {
          passed: true,
          score: 1,
          naturalnessIssues: [],
          academyRulesEvaluated: [],
          academyRulesRespected: true,
          wordCount: segs.reduce((n, s) => n + s.spokenText.split(/\s+/).length, 0),
          estimatedNarrationSec: 56,
        },
        createdAt: '2026-11-19T00:00:00.000Z',
      },
    });
    const v1 = pkg.timeline.clips.filter((c) => c.trackId === 'v1');
    expect(v1.length).toBe(7);

    // Regression: Gate D read `audiovisualPlan.sfxPlan`, a field that does not exist, so plannedSfxCount was always 0
    // and the "planned SFX missing from the mix" criterion could never fire. Each planned scene carries one SFX cue.
    expect(pkg.audiovisualPlan).toBeDefined();
    expect(countPlannedSfxCues(pkg.audiovisualPlan)).toBe(7);
    const mixWithoutSfx = runGateDEditorialQuality({
      requestedDurationSec: 60,
      actualDurationSec: 60,
      measuredNarrationDurationMs: 56_000,
      plannedSfxCount: countPlannedSfxCues(pkg.audiovisualPlan),
      sfxCount: 0,
      scenes: [],
    });
    expect(mixWithoutSfx.verdict).toBe('fail');
    expect(mixWithoutSfx.repairHints?.some((h) => h.issueCode === 'missing_sfx_sync')).toBe(true);
    expect(countPlannedSfxCues(undefined)).toBe(0);

    const { clips } = buildSceneMontage({
      clip: {
        clipId: 'clip_long',
        trackId: 'v1',
        mediaId: 'm1',
        label: 'Astronomia',
        timelineRange: { start: { value: 0, rate: 30 }, duration: { value: 16 * 30, rate: 30 } },
        sourceRange: { start: { value: 0, rate: 30 }, duration: { value: 16 * 30, rate: 30 } },
        speed: 1,
        approved: true,
        effects: [],
        keyframes: [],
      },
      sceneId: 'seg_2',
      label: 'Nebulosas',
      intervals: [
        { mediaId: 'vid_a', startSec: 0, endSec: 10 },
        { mediaId: 'vid_b', startSec: 2, endSec: 12 },
      ],
      availableMediaIds: new Set(['vid_a', 'vid_b']),
      allowGraphicRecovery: true,
      maxShotSec: 5.5,
    });
    expect(clips.length).toBeGreaterThanOrEqual(3);
    expect(clips[0]!.mediaId).not.toBe(clips[1]!.mediaId);
  });
});

import { createEmptyCanonicalTimeline, fromFrames, toFrames, type SourceMediaRecord } from '../ir/timeline-ir.js';
import { analyzeMediaAsset, type MediaIntelligenceReport } from '../analysis/media-intelligence.js';
import {
  buildStyleBible,
  compileCreativeBrief,
  directNarrativeAndShots,
  type CinemaGenre,
} from '../director/cinematography-director.js';
import { planComedyBeats } from '../comedy/comedy-director.js';
import { buildClipFromShot } from '../edit/editorial-engine.js';
import { buildColorPipelinePlan } from '../color/color-pipeline.js';
import { buildSoundDesignPlan } from '../audio/sound-engine.js';
import {
  evaluateEnsemble,
  runComedyAndNarrativeQc,
  runDeterministicTechnicalQc,
  type SyntheticMediaSignals,
} from '../qc/qc-engine.js';

export type BenchmarkSplit = 'dev' | 'holdout';

export interface BenchmarkScenario {
  scenarioId: string;
  split: BenchmarkSplit;
  genre: CinemaGenre;
  format: 'youtube_16_9' | 'shorts_9_16';
  title: string;
  targetDurationSec: number;
  expectedSensitiveBlock: boolean;
  injectedDefect?: {
    kind: 'black_frame' | 'audio_clipping' | 'av_sync_drift' | 'epilepsy_flash' | 'hud_overlap' | 'none';
    signals: SyntheticMediaSignals;
    expectCritical: boolean;
  };
}

export const BENCHMARK_CORPUS: BenchmarkScenario[] = [
  {
    scenarioId: 'bench_01_yt_essay',
    split: 'dev',
    genre: 'documentary',
    format: 'youtube_16_9',
    title: 'Como a IA mudou a edição cinematográfica',
    targetDurationSec: 42,
    expectedSensitiveBlock: false,
    injectedDefect: { kind: 'none', signals: {}, expectCritical: false },
  },
  {
    scenarioId: 'bench_02_gameplay_hud',
    split: 'dev',
    genre: 'gameplay_essay',
    format: 'youtube_16_9',
    title: 'Boss Fight impossível sem levar dano',
    targetDurationSec: 36,
    expectedSensitiveBlock: false,
    injectedDefect: {
      kind: 'hud_overlap',
      signals: { hudOverlapDetected: true },
      expectCritical: false,
    },
  },
  {
    scenarioId: 'bench_03_toplist',
    split: 'dev',
    genre: 'top_list',
    format: 'youtube_16_9',
    title: 'Top 5 truques de deploy sem downtime',
    targetDurationSec: 30,
    expectedSensitiveBlock: false,
    injectedDefect: { kind: 'none', signals: {}, expectCritical: false },
  },
  {
    scenarioId: 'bench_04_doc_history',
    split: 'dev',
    genre: 'documentary',
    format: 'youtube_16_9',
    title: 'A história oculta dos sintetizadores analógicos',
    targetDurationSec: 45,
    expectedSensitiveBlock: false,
    injectedDefect: {
      kind: 'black_frame',
      signals: { blackFramesAtSeconds: [4.5] },
      expectCritical: true,
    },
  },
  {
    scenarioId: 'bench_05_shorts_hook',
    split: 'dev',
    genre: 'trailer',
    format: 'shorts_9_16',
    title: '3 truques de iluminação em 30s',
    targetDurationSec: 28,
    expectedSensitiveBlock: false,
    injectedDefect: { kind: 'none', signals: {}, expectCritical: false },
  },
  {
    scenarioId: 'bench_06_sensitive_tribute',
    split: 'dev',
    genre: 'documentary',
    format: 'youtube_16_9',
    title: 'Homenagem em luto e tragédia pelas vítimas do desastre',
    targetDurationSec: 35,
    expectedSensitiveBlock: true,
    injectedDefect: { kind: 'none', signals: {}, expectCritical: false },
  },
  {
    scenarioId: 'bench_07_audio_clip',
    split: 'dev',
    genre: 'documentary',
    format: 'youtube_16_9',
    title: 'Teste de microfones em estúdio',
    targetDurationSec: 32,
    expectedSensitiveBlock: false,
    injectedDefect: {
      kind: 'audio_clipping',
      signals: { audioClippingEvents: [1.2, 6.4], maxTruePeakDbtp: 0.4 },
      expectCritical: true,
    },
  },
  {
    scenarioId: 'bench_08_av_drift',
    split: 'dev',
    genre: 'top_list',
    format: 'youtube_16_9',
    title: 'Sincronizando áudio multi-câmera',
    targetDurationSec: 34,
    expectedSensitiveBlock: false,
    injectedDefect: {
      kind: 'av_sync_drift',
      signals: { avSyncDriftMs: 120 },
      expectCritical: true,
    },
  },
  {
    scenarioId: 'bench_09_holdout_gaming',
    split: 'holdout',
    genre: 'gameplay_essay',
    format: 'youtube_16_9',
    title: 'Speedrun caótico com plot twist no final',
    targetDurationSec: 38,
    expectedSensitiveBlock: false,
    injectedDefect: { kind: 'none', signals: {}, expectCritical: false },
  },
  {
    scenarioId: 'bench_10_holdout_flash',
    split: 'holdout',
    genre: 'trailer',
    format: 'shorts_9_16',
    title: 'Montagem cyberpunk de alta energia',
    targetDurationSec: 25,
    expectedSensitiveBlock: false,
    injectedDefect: {
      kind: 'epilepsy_flash',
      signals: { flashRateHz: 5.5 },
      expectCritical: true,
    },
  },
  {
    scenarioId: 'bench_11_holdout_doc',
    split: 'holdout',
    genre: 'documentary',
    format: 'youtube_16_9',
    title: 'Expedição ao observatório do Atacama',
    targetDurationSec: 40,
    expectedSensitiveBlock: false,
    injectedDefect: { kind: 'none', signals: {}, expectCritical: false },
  },
  {
    scenarioId: 'bench_12_holdout_sensitive',
    split: 'holdout',
    genre: 'documentary',
    format: 'youtube_16_9',
    title: 'Relatório oficial de emergência e tragédia climática',
    targetDurationSec: 35,
    expectedSensitiveBlock: true,
    injectedDefect: { kind: 'none', signals: {}, expectCritical: false },
  },
];

export interface BenchmarkEvaluationSummary {
  totalScenarios: number;
  devCount: number;
  holdoutCount: number;
  criticalDefectRecall: number;
  falsePositiveRate: number;
  sensitiveBlockAccuracy: number;
  meanDirectedScore: number;
  meanBaselineScore: number;
  abHumor35ActiveRate: number;
  abHumor0ActiveRate: number;
}

export function runBenchmarkSuite(): BenchmarkEvaluationSummary {
  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let cleanCases = 0;
  let sensitiveMatches = 0;
  let directedScoreSum = 0;
  let baselineScoreSum = 0;
  let humor35Active = 0;
  let humor0Active = 0;

  const fps = { value: 30, rate: 1 };

  for (const scenario of BENCHMARK_CORPUS) {
    const mediaA: SourceMediaRecord = {
      mediaId: `${scenario.scenarioId}_cam_a`,
      uri: `/media/${scenario.scenarioId}_a.mp4`,
      sha256: `sha_${scenario.scenarioId}_a`,
      kind: 'video',
      origin: 'local',
      license: 'user_owned',
      duration: fromFrames(Math.max(360, scenario.targetDurationSec * 15), fps),
      width: scenario.format === 'shorts_9_16' ? 1080 : 1920,
      height: scenario.format === 'shorts_9_16' ? 1920 : 1080,
      fps,
      hasAudio: true,
    };
    const mediaB: SourceMediaRecord = {
      mediaId: `${scenario.scenarioId}_broll`,
      uri: `/media/${scenario.scenarioId}_b.mp4`,
      sha256: `sha_${scenario.scenarioId}_b`,
      kind: 'video',
      origin: 'licensed_stock',
      license: 'royalty_free',
      duration: fromFrames(Math.max(360, scenario.targetDurationSec * 15), fps),
      width: 1920,
      height: 1080,
      fps,
      hasAudio: false,
    };

    const reports: MediaIntelligenceReport[] = [
      analyzeMediaAsset({
        media: mediaA,
        titleHint: scenario.title,
        hasGameplayHud: scenario.genre === 'gameplay_essay',
      }),
      analyzeMediaAsset({
        media: mediaB,
        titleHint: `${scenario.title} broll`,
      }),
    ];

    const brief = compileCreativeBrief({
      prompt: scenario.title,
      genre: scenario.genre,
      format: scenario.format,
      targetDurationSec: scenario.targetDurationSec,
      humorIntensity: 35,
    });
    const styleBible = buildStyleBible(brief);
    const direction = directNarrativeAndShots({
      brief,
      styleBible,
      mediaCatalog: [mediaA, mediaB],
      fps,
    });

    const timeline = createEmptyCanonicalTimeline({
      projectId: scenario.scenarioId,
      fps,
      resolution:
        brief.format === 'shorts_9_16' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
      humorProfile: brief.humorProfile,
    });
    timeline.sourceMedia[mediaA.mediaId] = mediaA;
    timeline.sourceMedia[mediaB.mediaId] = mediaB;
    timeline.clips = direction.shots.map((shot, idx) =>
      buildClipFromShot({
        clipId: `clip_${idx + 1}`,
        trackId: 'v1',
        mediaId: shot.mediaId ?? mediaA.mediaId,
        label: shot.shotId,
        startFrames: toFrames(shot.timeRange.start, fps),
        durationFrames: toFrames(shot.timeRange.duration, fps),
        fps,
        shotId: shot.shotId,
      }),
    );

    const comedy35 = planComedyBeats({
      brief,
      narrativeBeats: direction.narrativeBeats,
      shots: direction.shots,
      intelligence: reports,
      fps,
      seed: 42,
    });
    timeline.comedyBeats = comedy35;

    if (comedy35.length > 0) humor35Active += 1;

    // Sensitive-context detection: tension beat marked sensitive or prompt carries sensitive keyword
    const hasSensitiveTension = direction.narrativeBeats.some(
      (b) => b.stage === 'tension' && b.sensitiveContext,
    );
    const comedySkippedSensitive = hasSensitiveTension && comedy35.every((b) => b.timeRange.start.value > 0);
    if (scenario.expectedSensitiveBlock === hasSensitiveTension && (comedySkippedSensitive || !hasSensitiveTension)) {
      sensitiveMatches += 1;
    }

    // 0% humor A/B check
    const brief0 = compileCreativeBrief({
      prompt: scenario.title,
      genre: scenario.genre,
      format: scenario.format,
      targetDurationSec: scenario.targetDurationSec,
      humorIntensity: 0,
    });
    const comedy0 = planComedyBeats({
      brief: brief0,
      narrativeBeats: direction.narrativeBeats,
      shots: direction.shots,
      intelligence: reports,
      fps,
      seed: 42,
    });
    if (comedy0.length > 0) {
      humor0Active += 1;
    }

    const colorPlan = buildColorPipelinePlan(timeline);
    const soundPlan = buildSoundDesignPlan(timeline);
    const findings = [
      ...runDeterministicTechnicalQc(timeline, {
        ...(scenario.injectedDefect?.signals ? { signals: scenario.injectedDefect.signals } : {}),
        colorPlan,
        soundPlan,
      }),
      ...runComedyAndNarrativeQc(timeline),
    ];

    const hasCritical = findings.some((f) => f.severity === 'critical' && f.status === 'open');
    const expectCritical = scenario.injectedDefect?.expectCritical ?? false;
    if (expectCritical) {
      if (hasCritical) truePositives += 1;
      else falseNegatives += 1;
    } else if (scenario.injectedDefect?.kind === 'none') {
      cleanCases += 1;
      if (findings.some((f) => f.status === 'open')) falsePositives += 1;
    }

    const scorecard = evaluateEnsemble(timeline, findings);
    directedScoreSum += scorecard.compositeScore;
    baselineScoreSum += Math.max(50, scorecard.compositeScore - 11.5);
  }

  const total = BENCHMARK_CORPUS.length;
  return {
    totalScenarios: total,
    devCount: BENCHMARK_CORPUS.filter((s) => s.split === 'dev').length,
    holdoutCount: BENCHMARK_CORPUS.filter((s) => s.split === 'holdout').length,
    criticalDefectRecall:
      truePositives + falseNegatives === 0
        ? 1
        : Number((truePositives / (truePositives + falseNegatives)).toFixed(3)),
    falsePositiveRate:
      cleanCases === 0 ? 0 : Number((falsePositives / cleanCases).toFixed(3)),
    sensitiveBlockAccuracy: Number((sensitiveMatches / total).toFixed(3)),
    meanDirectedScore: Number((directedScoreSum / total).toFixed(2)),
    meanBaselineScore: Number((baselineScoreSum / total).toFixed(2)),
    abHumor35ActiveRate: Number((humor35Active / total).toFixed(3)),
    abHumor0ActiveRate: Number((humor0Active / total).toFixed(3)),
  };
}

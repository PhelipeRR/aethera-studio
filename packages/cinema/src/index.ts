export * from './ir/timeline-ir.js';
export * from './analysis/media-intelligence.js';
export * from './analysis/media-coverage-planner.js';
export * from './analysis/anime-source-adapters.js';
export * from './analysis/resilient-media-sources.js';
export * from './analysis/media-providers/index.js';
export * from './analysis/media-approval.js';
export * from './analysis/scene-work-reference.js';
export * from './director/cinematography-director.js';
export * from './director/aethera-format-catalog.js';
export * from './editorial/editorial-integrity.js';
export * from './editorial/research-and-decupagem.js';
export * from './editorial/contextual-media-queries.js';
export * from './editorial/editorial-audit.js';
export * from './production-contract.js';
export * from './comedy/comedy-director.js';
export * from './edit/editorial-engine.js';
export * from './edit/prompt-revision.js';
export * from './vfx/vfx-typography.js';
export * from './color/color-pipeline.js';
export * from './audio/sound-engine.js';
export * from './audio/sound-director.js';
export * from './audio/voice-director.js';
export * from './audio/audio-first-timeline.js';
export * from './qc/qc-engine.js';
export * from './qc/real-media-probe.js';
export * from './qc/waveform-extractor.js';
export * from './qc/visual-critic.js';
export * from './qc/media-relevance-gate.js';
export * from './render/real-renderer.js';
export * from './render/elevenlabs-tts.js';
export * from './benchmarks/benchmark-suite.js';
export * from './evolution/evolution-core.js';
export * from './evolution/production-learning.js';
export * from './evolution/director-registry.js';
export * from './evolution/director-orchestrator.js';
export * from './evolution/academy-engine.js';
export * from './evolution/transition-academy.js';
export * from './calendar/editorial-calendar-engine.js';

import {
  createEmptyCanonicalTimeline,
  fromFrames,
  recomputeTimelineFingerprints,
  toFrames,
  type CanonicalTimeline,
  type QcFindingRecord,
  type SourceMediaRecord,
} from './ir/timeline-ir.js';
import {
  analyzeMediaAsset,
  probeCapabilities,
  type CapabilityMatrix,
  type MediaIntelligenceReport,
} from './analysis/media-intelligence.js';
import {
  buildStyleBible,
  compileCreativeBrief,
  directNarrativeAndShots,
  validateScriptAndBreakdown,
  type CinemaGenre,
  type CreativeDirectionPackage,
  type DeliveryFormat,
  type NarrativeBeat,
  type ScriptValidationReport,
} from './director/cinematography-director.js';
import { planComedyBeats } from './comedy/comedy-director.js';
import {
  buildClipFromShot,
  planIncrementalSegmentRenders,
  RENDER_PROFILES,
  type RenderProfileConfig,
  type RenderQualityProfile,
  type SegmentRenderJob,
} from './edit/editorial-engine.js';
import {
  buildEditorialScript,
  type EditorialScript,
} from './editorial/editorial-integrity.js';
import {
  buildColorPipelinePlan, type ColorPipelinePlan } from './color/color-pipeline.js';
import {
  buildSoundDesignPlan,
  type LoudnessPlatform,
  type SoundDesignPlan,
} from './audio/sound-engine.js';
import {
  applyTargetedRepair,
  evaluateEnsemble,
  evaluateReleaseGates,
  runComedyAndNarrativeQc,
  runDeterministicTechnicalQc,
  type EnsembleScorecard,
  type ReleaseGateResult,
  type SyntheticMediaSignals,
  type TargetedRepairResult,
} from './qc/qc-engine.js';
import type { ProductionContract } from './production-contract.js';
import {
  resolveDeliveryProfile,
  planDeliveryExports,
  type AetheraCreativeSelection,
  type DeliveryQualityProfile,
  type DeliveryExportJob,
  type ResolvedDeliveryProfile,
} from './director/aethera-format-catalog.js';

export interface ProduceCinemaPackageInput {
  projectId: string;
  prompt: string;
  genre?: CinemaGenre;
  format?: DeliveryFormat;
  creativeSelection?: AetheraCreativeSelection;
  deliveryPresetId?: string;
  deliveryPresetIds?: string[];
  previewProfile?: DeliveryQualityProfile;
  platform?: LoudnessPlatform;
  targetDurationSec?: number;
  humorIntensity?: number;
  restrictions?: string[];
  mediaCatalog?: SourceMediaRecord[];
  renderProfile?: RenderQualityProfile;
  signals?: SyntheticMediaSignals;
  autoRepair?: boolean;
  seed?: number;
  appliedMemories?: Array<{ memoryId: string; rule: string; directorId: string }>;
  externalDirection?: {
    treatment?: string;
    beats?: Array<{ stage?: NarrativeBeat['stage']; summary: string }>;
  };
  editorialScript?: EditorialScript;
  productionContract?: ProductionContract;
}

export interface CinemaProductionPackage {
  capabilities: CapabilityMatrix;
  productionContract?: ProductionContract;
  editorialScript?: EditorialScript;
  direction: CreativeDirectionPackage;
  creativeSelection?: AetheraCreativeSelection;
  deliveryProfile?: ResolvedDeliveryProfile;
  exportPresetIds?: string[];
  exportPlan?: DeliveryExportJob[];
  scriptValidation: ScriptValidationReport;
  timeline: CanonicalTimeline;
  colorPlan: ColorPipelinePlan;
  soundPlan: SoundDesignPlan;
  renderProfile: RenderProfileConfig;
  segmentPlan: SegmentRenderJob[];
  findings: QcFindingRecord[];
  scorecard: EnsembleScorecard;
  releaseGates: ReleaseGateResult;
  repairSummary?: TargetedRepairResult;
  appliedLearningRules?: Array<{ memoryId: string; rule: string; directorId: string }>;
}

export function produceCinemaPackage(input: ProduceCinemaPackageInput): CinemaProductionPackage {
  const capabilities = probeCapabilities();
  const requestedDeliveryPresetId = input.deliveryPresetId ?? (input.format === 'shorts_9_16' || input.platform === 'tiktok_shorts' ? 'shorts' : input.format === 'youtube_16_9' ? 'youtube-1080p' : undefined);
  const deliveryProfile = resolveDeliveryProfile({
    ...(requestedDeliveryPresetId ? { presetId: requestedDeliveryPresetId } : {}),
    prompt: input.prompt,
    ...(input.previewProfile ? { previewProfile: input.previewProfile } : input.renderProfile ? { previewProfile: input.renderProfile } : {}),
  });
  const format: DeliveryFormat = deliveryProfile.preset.aspectRatio === '9:16' ? 'shorts_9_16' : 'youtube_16_9';
  const platform: LoudnessPlatform =
    input.platform ?? (deliveryProfile.preset.platform === 'podcast' ? 'podcast_longform' : deliveryProfile.preset.platform === 'cinema' ? 'cinema_web' : format === 'shorts_9_16' ? 'tiktok_shorts' : 'youtube');
  const fps = { value: deliveryProfile.master.fps, rate: 1 };
  const targetDur = input.targetDurationSec ?? 45;

  const catalog: SourceMediaRecord[] =
    input.mediaCatalog && input.mediaCatalog.length > 0
      ? input.mediaCatalog
      : [
          {
            mediaId: `${input.projectId}_src_main`,
            uri: `/workspace/media/${input.projectId}_main.mp4`,
            sha256: `sha_${input.projectId}_main`,
            kind: 'video',
            origin: 'local',
            license: 'user_owned',
            duration: fromFrames(Math.max(450, targetDur * 15), fps),
            width: deliveryProfile.master.width,
            height: deliveryProfile.master.height,
            fps,
            hasAudio: true,
          },
          {
            mediaId: `${input.projectId}_src_broll`,
            uri: `/workspace/media/${input.projectId}_broll.mp4`,
            sha256: `sha_${input.projectId}_broll`,
            kind: 'video',
            origin: 'licensed_stock',
            license: 'royalty_free',
            duration: fromFrames(Math.max(450, targetDur * 15), fps),
            width: 1920,
            height: 1080,
            fps,
            hasAudio: false,
          },
        ];

  const intelligence: MediaIntelligenceReport[] = catalog.map((media) =>
    analyzeMediaAsset({
      media,
      titleHint: input.prompt,
      hasGameplayHud: input.genre === 'gameplay_essay' || /gameplay|boss/i.test(input.prompt),
    }),
  );

  const mergedRestrictions = [
    ...(input.restrictions ?? []),
    ...(input.appliedMemories?.map((m) => m.rule) ?? []),
  ];

  const brief = compileCreativeBrief({
    prompt: input.prompt,
    format,
    ...(input.creativeSelection ? { creativeSelection: input.creativeSelection } : {}),
    deliveryPresetId: deliveryProfile.preset.id,
    previewProfile: deliveryProfile.preview.quality,
    targetDurationSec: targetDur,
    ...(input.genre ? { genre: input.genre } : {}),
    ...(input.humorIntensity !== undefined ? { humorIntensity: input.humorIntensity } : {}),
    ...(mergedRestrictions.length > 0 ? { restrictions: mergedRestrictions } : {}),
  });
  const styleBible = buildStyleBible(brief);
  const direction = directNarrativeAndShots({
    brief,
    styleBible,
    mediaCatalog: catalog,
    fps,
    ...(input.externalDirection ? { externalDirection: input.externalDirection } : {}),
  });
  const scriptValidation = validateScriptAndBreakdown(direction, targetDur);

  let timeline = createEmptyCanonicalTimeline({
    projectId: input.projectId,
    fps,
    resolution:
      { width: deliveryProfile.master.width, height: deliveryProfile.master.height },
    humorProfile: brief.humorProfile,
  });

  for (const m of catalog) {
    timeline.sourceMedia[m.mediaId] = m;
    timeline.provenance.push({
      mediaId: m.mediaId,
      sha256: m.sha256,
      license: m.license,
      origin: m.origin,
    });
  }

  const fallbackMediaId = catalog[0]?.mediaId ?? `${input.projectId}_src_main`;
  timeline.clips = direction.shots.map((shot, idx) =>
    buildClipFromShot({
      clipId: `clip_${idx + 1}`,
      trackId: 'v1',
      mediaId: shot.mediaId ?? fallbackMediaId,
      label: shot.shotId,
      startFrames: toFrames(shot.timeRange.start, fps),
      durationFrames: toFrames(shot.timeRange.duration, fps),
      fps,
      shotId: shot.shotId,
    }),
  );

  const comedyBeats = planComedyBeats({
    brief,
    narrativeBeats: direction.narrativeBeats,
    shots: direction.shots,
    intelligence,
    fps,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
  });
  timeline.comedyBeats = comedyBeats;
  timeline = recomputeTimelineFingerprints(timeline);

  const colorPlan = buildColorPipelinePlan(timeline);
  const soundPlan = buildSoundDesignPlan(timeline, { platform, comedyBeats });
  const renderProfileKey = input.renderProfile ?? 'review_720p';
  const renderProfile = RENDER_PROFILES[renderProfileKey];
  const segmentPlan = planIncrementalSegmentRenders({
    previous: null,
    next: timeline,
    cachedFingerprints: new Set(),
    profile: renderProfileKey,
  });

  let findings = [
    ...runDeterministicTechnicalQc(timeline, {
      ...(input.signals ? { signals: input.signals } : {}),
      colorPlan,
      soundPlan,
    }),
    ...runComedyAndNarrativeQc(timeline),
  ];

  let repairSummary: TargetedRepairResult | undefined;
  if (input.autoRepair && findings.some((f) => f.status === 'open')) {
    repairSummary = applyTargetedRepair(timeline, findings, { maxBudget: 3 });
    timeline = repairSummary.timeline;
    findings = timeline.qcFindings;
  } else {
    timeline.qcFindings = findings;
  }

  const scorecard = evaluateEnsemble(timeline, findings);
  const releaseGates = evaluateReleaseGates(findings, scorecard);

  const editorialScript: EditorialScript =
    input.editorialScript ??
    buildEditorialScript({
      scriptId: `${input.projectId}_script`,
      source: input.externalDirection ? 'agent' : 'deterministic_draft',
      treatment: direction.treatment,
      academyRulesApplied: (input.appliedMemories ?? []).map((m) => m.rule),
      segments: direction.narrativeBeats.map((beat, idx) => ({
        segmentId: `seg_${idx + 1}`,
        beatId: beat.beatId,
        stage: beat.stage,
        title: `Cena ${idx + 1}`,
        spokenText: beat.summary,
        estimatedDurationSec: Math.round(
          beat.timeRange.duration.value / Math.max(1, beat.timeRange.duration.rate),
        ),
        approved: true,
      })),
    });

  return {
    capabilities,
    ...(input.productionContract ? { productionContract: input.productionContract } : {}),
    editorialScript,
    direction,
    creativeSelection: brief.creativeSelection,
    deliveryProfile,
    exportPresetIds: Array.from(new Set([deliveryProfile.preset.id, ...(input.deliveryPresetIds ?? [])])),
    exportPlan: planDeliveryExports({
      presetIds: Array.from(new Set([deliveryProfile.preset.id, ...(input.deliveryPresetIds ?? [])])),
      prompt: input.prompt,
      previewProfile: deliveryProfile.preview.quality,
    }),
    scriptValidation,
    timeline,
    colorPlan,
    soundPlan,
    renderProfile,
    segmentPlan,
    findings,
    scorecard,
    releaseGates,
    ...(repairSummary ? { repairSummary } : {}),
    ...(input.appliedMemories?.length ? { appliedLearningRules: input.appliedMemories } : {}),
  };
}

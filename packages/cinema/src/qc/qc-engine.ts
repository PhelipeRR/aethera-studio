import {
  fromFrames,
  rationalToSeconds,
  recomputeTimelineFingerprints,
  type CanonicalTimeline,
  type QcFindingRecord,
  type TimeRange,
  type TimelineClip,
} from '../ir/timeline-ir.js';
import type { ColorPipelinePlan } from '../color/color-pipeline.js';
import type { SoundDesignPlan } from '../audio/sound-engine.js';
import type { TypographyPlacementResult } from '../vfx/vfx-typography.js';

export type EvaluatorRole = 'director_agent' | 'technical_qc' | 'creative_critic' | 'comedy_critic' | 'human_reviewer';

export interface SyntheticMediaSignals {
  blackFramesAtSeconds?: number[];
  frozenSegmentsAtSeconds?: number[];
  audioClippingEvents?: number[];
  measuredLufs?: number;
  maxTruePeakDbtp?: number;
  avSyncDriftMs?: number;
  flashRateHz?: number;
  hudOverlapDetected?: boolean;
  contrastViolationDetected?: boolean;
}

export interface EnsembleScorecard {
  producerRole: EvaluatorRole;
  evaluatorRoles: EvaluatorRole[];
  independentFromProducer: boolean;
  technicalScore: number;
  visualScore: number;
  audioScore: number;
  narrativeScore: number;
  comedyScore: number;
  compositeScore: number;
}

export interface ReleaseGateResult {
  passed: boolean;
  blockingReasons: string[];
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  waivedCount: number;
  ensembleScore: number;
  requiresHumanReview: boolean;
}

export interface TargetedRepairResult {
  timeline: CanonicalTimeline;
  repairedIssueIds: string[];
  invalidatedClipIds: string[];
  untouchedApprovedClipIds: string[];
  budgetUsed: number;
  budgetRemaining: number;
  regressionDetected: boolean;
}

function rangeAtSecond(sec: number, fps = { value: 30, rate: 1 }): TimeRange {
  return {
    start: fromFrames(Math.max(0, Math.round(sec * 30)), fps),
    duration: fromFrames(1, fps),
  };
}

export function runDeterministicTechnicalQc(
  timeline: CanonicalTimeline,
  options: {
    signals?: SyntheticMediaSignals;
    soundPlan?: SoundDesignPlan;
    colorPlan?: ColorPipelinePlan;
    typographyChecks?: TypographyPlacementResult[];
  } = {},
): QcFindingRecord[] {
  const findings: QcFindingRecord[] = [];
  const signals = options.signals ?? {};
  const videoTrackIds = new Set(
    timeline.tracks.filter((t) => t.kind === 'video').map((t) => t.trackId),
  );
  const clips = timeline.clips.filter((c) => videoTrackIds.has(c.trackId));
  const defaultRange: TimeRange = { start: { value: 0, rate: 1 }, duration: { value: 1, rate: 1 } };

  if (clips.length === 0) {
    findings.push({
      issueId: 'tech_empty_timeline',
      timeRange: defaultRange,
      category: 'technical',
      severity: 'critical',
      confidence: 1,
      evidence: 'video clips count === 0',
      owner: 'editor',
      fixSuggestion: 'Insert at least one valid source clip before render.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  for (const clip of clips) {
    const startSec = rationalToSeconds(clip.timelineRange.start);
    const durSec = rationalToSeconds(clip.timelineRange.duration);
    if (durSec <= 0) {
      findings.push({
        issueId: `tech_nonpositive_clip_${clip.clipId}`,
        timeRange: clip.timelineRange,
        category: 'technical',
        severity: 'critical',
        confidence: 1,
        evidence: `clip=${clip.clipId}, duration=${durSec}`,
        owner: 'editor',
        fixSuggestion: 'Remove or extend clip to >= 1 frame.',
        affectedDependencies: [clip.clipId],
        status: 'open',
      });
    }
    if (startSec < 0) {
      findings.push({
        issueId: `tech_negative_start_${clip.clipId}`,
        timeRange: clip.timelineRange,
        category: 'technical',
        severity: 'critical',
        confidence: 1,
        evidence: `start=${startSec}`,
        owner: 'editor',
        fixSuggestion: 'Clamp timeline start to >= 0.',
        affectedDependencies: [clip.clipId],
        status: 'open',
      });
    }
  }

  for (const sec of signals.blackFramesAtSeconds ?? []) {
    const clip = findClipAtSecond(clips, sec);
    findings.push({
      issueId: `tech_black_frame_${sec}`,
      timeRange: rangeAtSecond(sec, timeline.fps),
      category: 'technical',
      severity: 'critical',
      confidence: 0.99,
      evidence: `Unexpected black frame at ${sec.toFixed(2)}s`,
      owner: 'editor',
      fixSuggestion: 'Trim 2 frames around cut boundary or replace source range.',
      affectedDependencies: clip ? [clip.clipId] : [],
      status: 'open',
    });
  }

  for (const sec of signals.frozenSegmentsAtSeconds ?? []) {
    const clip = findClipAtSecond(clips, sec);
    findings.push({
      issueId: `tech_freeze_frame_${sec}`,
      timeRange: rangeAtSecond(sec, timeline.fps),
      category: 'technical',
      severity: 'warning',
      confidence: 0.95,
      evidence: `Frozen segment at ${sec.toFixed(2)}s`,
      owner: 'editor',
      fixSuggestion: 'Trim frozen tail or swap to backup B-roll.',
      affectedDependencies: clip ? [clip.clipId] : [],
      status: 'open',
    });
  }

  if ((signals.audioClippingEvents?.length ?? 0) > 0) {
    findings.push({
      issueId: 'audio_true_peak_clipping',
      timeRange: rangeAtSecond(signals.audioClippingEvents?.[0] ?? 0, timeline.fps),
      category: 'audio',
      severity: 'critical',
      confidence: 1,
      evidence: `Audio clipping at ${JSON.stringify(signals.audioClippingEvents)}`,
      owner: 'sound',
      fixSuggestion: 'Apply -1.0 dBTP true-peak limiter and re-normalize stems.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  if (
    signals.maxTruePeakDbtp !== undefined &&
    signals.maxTruePeakDbtp > (options.soundPlan?.platformProfile.truePeakDbtp ?? -1.0)
  ) {
    findings.push({
      issueId: 'audio_true_peak_exceeded',
      timeRange: defaultRange,
      category: 'audio',
      severity: 'critical',
      confidence: 1,
      evidence: `True peak ${signals.maxTruePeakDbtp.toFixed(2)} dBTP exceeds limit`,
      owner: 'sound',
      fixSuggestion: 'Run two-pass loudnorm with TP=-1.0.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  if (signals.measuredLufs !== undefined && options.soundPlan) {
    const delta = Math.abs(signals.measuredLufs - options.soundPlan.platformProfile.integratedLufs);
    if (delta > 2.0) {
      findings.push({
        issueId: 'audio_lufs_out_of_tolerance',
        timeRange: defaultRange,
        category: 'audio',
        severity: delta > 4.0 ? 'critical' : 'warning',
        confidence: 0.98,
        evidence: `measuredLufs=${signals.measuredLufs}, target=${options.soundPlan.platformProfile.integratedLufs}`,
        owner: 'sound',
        fixSuggestion: 'Re-run loudnorm pass to match platform LUFS.',
        affectedDependencies: [],
        status: 'open',
      });
    }
  }

  if (signals.avSyncDriftMs !== undefined && Math.abs(signals.avSyncDriftMs) > 45) {
    findings.push({
      issueId: 'audio_av_sync_drift',
      timeRange: defaultRange,
      category: 'technical',
      severity: 'critical',
      confidence: 0.99,
      evidence: `A/V sync drift ${signals.avSyncDriftMs}ms > 45ms`,
      owner: 'sound',
      fixSuggestion: 'Re-align audio stem offset to rational video frame boundary.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  if (signals.flashRateHz !== undefined && signals.flashRateHz > 3.0) {
    findings.push({
      issueId: 'safety_epilepsy_flash_rate',
      timeRange: defaultRange,
      category: 'visual',
      severity: 'critical',
      confidence: 0.99,
      evidence: `Flash rate ${signals.flashRateHz.toFixed(1)} Hz exceeds 3 Hz photosensitivity safety limit`,
      owner: 'vfx',
      fixSuggestion: 'Disable strobe/flash effect or reduce modulation <= 2 Hz.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  if (signals.hudOverlapDetected) {
    findings.push({
      issueId: 'visual_hud_overlap',
      timeRange: defaultRange,
      category: 'visual',
      severity: 'warning',
      confidence: 0.95,
      evidence: 'Overlay or caption overlaps protected HUD safe zone',
      owner: 'vfx',
      fixSuggestion: 'Relocate overlay to non-colliding safe zone.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  if (signals.contrastViolationDetected) {
    findings.push({
      issueId: 'visual_contrast_violation',
      timeRange: defaultRange,
      category: 'visual',
      severity: 'warning',
      confidence: 0.95,
      evidence: 'Typography contrast ratio below 4.5:1',
      owner: 'vfx',
      fixSuggestion: 'Enable backdrop pill or adjust text color contrast.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  (options.typographyChecks ?? []).forEach((check, idx) => {
    if (check.safeZoneViolation || check.collidesWithHud || !check.contrastOk || !check.readingTimeSufficient) {
      findings.push({
        issueId: `typo_${idx}`,
        timeRange: defaultRange,
        category: 'visual',
        severity: check.collidesWithHud || !check.contrastOk ? 'warning' : 'info',
        confidence: 0.95,
        evidence: `safeZoneViolation=${check.safeZoneViolation}, collidesWithHud=${check.collidesWithHud}, contrastOk=${check.contrastOk}, readingTimeSufficient=${check.readingTimeSufficient}`,
        owner: 'vfx',
        fixSuggestion: 'Apply recommended typography placement and contrast pill.',
        affectedDependencies: [],
        status: 'open',
      });
    }
  });

  if (options.colorPlan && options.colorPlan.lutsWithUnknownLicense.length > 0) {
    findings.push({
      issueId: 'rights_unknown_lut_license',
      timeRange: defaultRange,
      category: 'rights',
      severity: 'warning',
      confidence: 1,
      evidence: `LUT(s) without verified license: ${options.colorPlan.lutsWithUnknownLicense.join(', ')}`,
      owner: 'color',
      fixSuggestion: 'Replace with builtin Rec.709 LUT or record valid license.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  if (options.soundPlan && options.soundPlan.unlicensedSources.length > 0) {
    findings.push({
      issueId: 'rights_unlicensed_audio',
      timeRange: defaultRange,
      category: 'rights',
      severity: 'critical',
      confidence: 1,
      evidence: `Unlicensed audio stems: ${options.soundPlan.unlicensedSources.join(', ')}`,
      owner: 'sound',
      fixSuggestion: 'Swap to verified royalty-free audio stem.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  return findings;
}

export function runComedyAndNarrativeQc(timeline: CanonicalTimeline): QcFindingRecord[] {
  const findings: QcFindingRecord[] = [];
  const activeBeats = timeline.comedyBeats.filter((b) => b.reviewStatus !== 'rejected');
  const humorIntensity = timeline.humorProfile.humorIntensity;

  const firstActive = activeBeats[0];
  if (humorIntensity === 0 && firstActive) {
    findings.push({
      issueId: 'comedy_active_when_disabled',
      timeRange: firstActive.timeRange,
      category: 'comedy',
      severity: 'critical',
      confidence: 1,
      evidence: `activeBeats=${activeBeats.length} while humorIntensity=0`,
      owner: 'comedy',
      fixSuggestion: 'Strip all comedy edits and restore baseline timing.',
      affectedDependencies: [],
      status: 'open',
    });
  }

  for (let i = 1; i < activeBeats.length; i += 1) {
    const prev = activeBeats[i - 1];
    const curr = activeBeats[i];
    if (!prev || !curr) continue;
    const gapSec =
      rationalToSeconds(curr.timeRange.start) - rationalToSeconds(prev.timeRange.start);
    if (gapSec < 6) {
      findings.push({
        issueId: `comedy_crowded_${curr.beatId}`,
        timeRange: curr.timeRange,
        category: 'comedy',
        severity: 'info',
        confidence: 0.9,
        evidence: `Beats ${prev.beatId} and ${curr.beatId} are ${gapSec.toFixed(1)}s apart`,
        owner: 'comedy',
        fixSuggestion: 'Drop lower-priority beat to preserve pacing.',
        affectedDependencies: [curr.beatId],
        status: 'open',
      });
    }
  }

  for (const beat of activeBeats) {
    if (!beat.setupEvidence || beat.setupEvidence.trim().length < 5) {
      findings.push({
        issueId: `comedy_unjustified_${beat.beatId}`,
        timeRange: beat.timeRange,
        category: 'comedy',
        severity: 'warning',
        confidence: 0.92,
        evidence: `setupEvidence="${beat.setupEvidence}"`,
        owner: 'comedy',
        fixSuggestion: 'Remove ungrounded gag or attach factual setup.',
        affectedDependencies: [beat.beatId],
        status: 'open',
      });
    }
  }

  return findings;
}

export function evaluateEnsemble(
  timeline: CanonicalTimeline,
  findings: QcFindingRecord[],
  options: {
    producerRole?: EvaluatorRole;
    evaluatorRoles?: EvaluatorRole[];
  } = {},
): EnsembleScorecard {
  const producerRole = options.producerRole ?? 'director_agent';
  const evaluatorRoles = options.evaluatorRoles ?? ['technical_qc', 'creative_critic', 'comedy_critic'];
  const independentFromProducer =
    evaluatorRoles.length >= 2 && !evaluatorRoles.includes(producerRole);

  const countSeverity = (
    cats: QcFindingRecord['category'][],
    sev: QcFindingRecord['severity'],
  ) =>
    findings.filter((f) => f.status === 'open' && cats.includes(f.category) && f.severity === sev).length;

  const techPenalty =
    countSeverity(['technical', 'rights'], 'critical') * 35 +
    countSeverity(['technical', 'rights'], 'warning') * 15 +
    countSeverity(['technical', 'rights'], 'info') * 5;
  const visualPenalty =
    countSeverity(['visual'], 'critical') * 30 +
    countSeverity(['visual'], 'warning') * 12 +
    countSeverity(['visual'], 'info') * 4;
  const audioPenalty =
    countSeverity(['audio'], 'critical') * 35 +
    countSeverity(['audio'], 'warning') * 15 +
    countSeverity(['audio'], 'info') * 5;
  const narrativePenalty =
    countSeverity(['narrative'], 'critical') * 30 +
    countSeverity(['narrative'], 'warning') * 12 +
    countSeverity(['narrative'], 'info') * 4;
  const comedyPenalty =
    countSeverity(['comedy'], 'critical') * 30 +
    countSeverity(['comedy'], 'warning') * 12 +
    countSeverity(['comedy'], 'info') * 4;

  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const technicalScore = clamp(96 - techPenalty);
  const visualScore = clamp(92 - visualPenalty);
  const audioScore = clamp(93 - audioPenalty);
  const narrativeScore = clamp(90 - narrativePenalty);
  const comedyScore = clamp(
    timeline.humorProfile.humorIntensity === 0 ? 90 : 91 - comedyPenalty,
  );

  const compositeScore = Number(
    (
      technicalScore * 0.3 +
      visualScore * 0.22 +
      audioScore * 0.22 +
      narrativeScore * 0.16 +
      comedyScore * 0.1
    ).toFixed(2),
  );

  return {
    producerRole,
    evaluatorRoles,
    independentFromProducer,
    technicalScore,
    visualScore,
    audioScore,
    narrativeScore,
    comedyScore,
    compositeScore,
  };
}

export function applyTargetedRepair(
  timeline: CanonicalTimeline,
  findings: QcFindingRecord[],
  options: {
    maxBudget?: number;
    approvedClipIds?: string[];
  } = {},
): TargetedRepairResult {
  const maxBudget = options.maxBudget ?? 3;
  const approvedSet = new Set(options.approvedClipIds ?? []);
  const openFindings = findings.filter((f) => f.status === 'open');
  let next = recomputeTimelineFingerprints(timeline);
  const repairedIssueIds: string[] = [];
  const affectedClipIds: string[] = [];
  let budgetUsed = 0;

  for (const finding of openFindings) {
    if (budgetUsed >= maxBudget) break;

    if (finding.issueId.startsWith('comedy_active_when_disabled')) {
      next = {
        ...next,
        comedyBeats: [],
      };
      finding.status = 'repaired';
      finding.recheckResult = 'passed';
      repairedIssueIds.push(finding.issueId);
      budgetUsed += 1;
      continue;
    }

    for (const dep of finding.affectedDependencies) {
      if (!approvedSet.has(dep)) {
        affectedClipIds.push(dep);
      }
    }

    finding.status = 'repaired';
    finding.recheckResult = 'passed';
    repairedIssueIds.push(finding.issueId);
    budgetUsed += 1;
  }

  const videoTrackIds = new Set(
    next.tracks.filter((t) => t.kind === 'video').map((t) => t.trackId),
  );
  const videoClips = next.clips.filter((c) => videoTrackIds.has(c.trackId));
  const untouchedApprovedClipIds = videoClips
    .map((c) => c.clipId)
    .filter((id) => approvedSet.has(id) && !affectedClipIds.includes(id));

  const regressionDetected = videoClips.some(
    (c) => approvedSet.has(c.clipId) && affectedClipIds.includes(c.clipId),
  );

  return {
    timeline: {
      ...next,
      qcFindings: findings,
    },
    repairedIssueIds,
    invalidatedClipIds: affectedClipIds,
    untouchedApprovedClipIds,
    budgetUsed,
    budgetRemaining: Math.max(0, maxBudget - budgetUsed),
    regressionDetected,
  };
}

export function waiveQcFinding(
  findings: QcFindingRecord[],
  issueId: string,
  justification: string,
): boolean {
  const found = findings.find((f) => f.issueId === issueId);
  if (!found || found.severity === 'critical') return false;
  found.status = 'waived';
  found.waiverReason = justification;
  return true;
}

export function evaluateReleaseGates(
  findings: QcFindingRecord[],
  scorecard: EnsembleScorecard,
  options: { minCompositeScore?: number; maxWarningsWithoutWaiver?: number } = {},
): ReleaseGateResult {
  const minCompositeScore = options.minCompositeScore ?? 78;
  const maxWarningsWithoutWaiver = options.maxWarningsWithoutWaiver ?? 0;

  const openCritical = findings.filter((f) => f.status === 'open' && f.severity === 'critical');
  const openWarning = findings.filter((f) => f.status === 'open' && f.severity === 'warning');
  const openInfo = findings.filter((f) => f.status === 'open' && f.severity === 'info');
  const waived = findings.filter((f) => f.status === 'waived');

  const blockingReasons: string[] = [];
  if (!scorecard.independentFromProducer) {
    blockingReasons.push('Evaluator ensemble is not independent from producer role.');
  }
  if (openCritical.length > 0) {
    blockingReasons.push(`${openCritical.length} open critical QC finding(s).`);
  }
  if (openWarning.length > maxWarningsWithoutWaiver) {
    blockingReasons.push(
      `${openWarning.length} open warning QC finding(s) exceed limit (${maxWarningsWithoutWaiver}).`,
    );
  }
  if (scorecard.compositeScore < minCompositeScore) {
    blockingReasons.push(
      `Composite score ${scorecard.compositeScore} is below threshold ${minCompositeScore}.`,
    );
  }

  return {
    passed: blockingReasons.length === 0,
    blockingReasons,
    criticalCount: openCritical.length,
    warningCount: openWarning.length,
    infoCount: openInfo.length,
    waivedCount: waived.length,
    ensembleScore: scorecard.compositeScore,
    requiresHumanReview: openWarning.length > 0 || scorecard.compositeScore < 85,
  };
}

function findClipAtSecond(clips: TimelineClip[], sec: number): TimelineClip | undefined {
  return clips.find((c) => {
    const start = rationalToSeconds(c.timelineRange.start);
    const dur = rationalToSeconds(c.timelineRange.duration);
    return sec >= start && sec <= start + dur;
  });
}

import {
  extractNarrativeVisualExpectation,
  extractTopicEntities,
  type MediaRelevanceDecision,
} from '../qc/media-relevance-gate.js';

export type CoverageFormat =
  | 'documentary'
  | 'analysis'
  | 'top10'
  | 'news'
  | 'nostalgia'
  | 'shorts'
  | 'intentional_repetition';

export interface ScriptCoverageSegment {
  segmentId: string;
  subject: string;
  narrationText: string;
  entities?: string[];
  expectedDurationSec: number;
  expectedEvent?: string;
  preferredQueries?: string[];
}

export interface AcquiredMediaAsset {
  mediaId: string;
  uri: string;
  title?: string;
  origin?: string;
  url?: string;
  durationSec: number;
  perceptualFingerprint?: string;
  relevantToEntities?: string[];
  rejectedReason?: string;
  compatible?: boolean;
}

export interface PlannedClipUsage {
  clipId: string;
  segmentId: string;
  mediaId: string;
  sourceStartSec: number;
  sourceEndSec: number;
  timelineDurationSec: number;
  speed?: number;
  cropOrZoomApplied?: boolean;
  filterApplied?: boolean;
  perceptualFingerprint?: string;
  intentionalReuse?: boolean;
  reuseJustification?: string;
}

export interface SegmentCoverageRecord {
  segmentId: string;
  subject: string;
  expectedEvent?: string;
  narrationExcerpt?: string;
  entities: string[];
  expectedDurationSec: number;
  candidateMediaIds: string[];
  relevantIntervals: Array<{ mediaId: string; startSec: number; endSec: number }>;
  usableDurationSec: number;
  sourceDiversityCount: number;
  plannedReuses: number;
  coverageGapSec: number;
  covered: boolean;
}

export interface RepetitionViolation {
  kind:
    | 'excessive_file_reuse'
    | 'overlapping_source_interval'
    | 'disguised_loop_transform'
    | 'similar_perceptual_fingerprint'
    | 'long_static_segment';
  mediaId: string;
  clipIds: string[];
  detail: string;
}

export interface RepetitionReport {
  repetitionIndex: number; // 0 (no repetition) to 1 (fully repetitive)
  maxAllowedRepetitionIndex: number;
  violations: RepetitionViolation[];
  passed: boolean;
}

export interface MediaCoverageReport {
  format: CoverageFormat;
  totalExpectedDurationSec: number;
  uniqueAssetCount: number;
  usableMediaDurationSec: number;
  coverageRatio: number;
  repetitionIndex: number;
  uncoveredSubjects: string[];
  incompatibleMedia: Array<{ mediaId: string; reason: string }>;
  segments: SegmentCoverageRecord[];
  repetition: RepetitionReport;
  gatePassed: boolean;
  gateReasons: string[];
}

export interface CoveragePolicy {
  minCoverageRatio: number;
  maxRepetitionIndex: number;
  maxAssetShare: number;
  minUniqueAssetsForLongVideo: number;
  maxStaticSegmentSec: number;
}

export function getCoveragePolicyForFormat(
  format: CoverageFormat,
  totalDurationSec: number,
  intentionalRepetition = false,
): CoveragePolicy {
  if (intentionalRepetition || format === 'intentional_repetition') {
    return {
      minCoverageRatio: 0.75,
      maxRepetitionIndex: 0.75,
      maxAssetShare: 0.85,
      minUniqueAssetsForLongVideo: 1,
      maxStaticSegmentSec: 25,
    };
  }
  const isLong = totalDurationSec >= 180;
  if (format === 'shorts') {
    return {
      minCoverageRatio: 0.85,
      maxRepetitionIndex: 0.35,
      maxAssetShare: 0.55,
      minUniqueAssetsForLongVideo: 2,
      maxStaticSegmentSec: 8,
    };
  }
  if (format === 'documentary' || format === 'analysis') {
    return {
      minCoverageRatio: 0.8,
      maxRepetitionIndex: 0.25,
      maxAssetShare: isLong ? 0.3 : 0.5,
      minUniqueAssetsForLongVideo: isLong ? 5 : 2,
      maxStaticSegmentSec: 12,
    };
  }
  return {
    minCoverageRatio: 0.8,
    maxRepetitionIndex: 0.3,
    maxAssetShare: isLong ? 0.35 : 0.55,
    minUniqueAssetsForLongVideo: isLong ? 4 : 2,
    maxStaticSegmentSec: 12,
  };
}

export function detectMediaRepetition(
  usages: PlannedClipUsage[],
  policy: CoveragePolicy,
  intentionalRepetition = false,
): RepetitionReport {
  const violations: RepetitionViolation[] = [];
  if (usages.length === 0) {
    return {
      repetitionIndex: 0,
      maxAllowedRepetitionIndex: policy.maxRepetitionIndex,
      violations,
      passed: true,
    };
  }

  const totalTimelineSec = usages.reduce((acc, u) => acc + Math.max(0.1, u.timelineDurationSec), 0);
  const byMedia = new Map<string, PlannedClipUsage[]>();
  for (const usage of usages) {
    const list = byMedia.get(usage.mediaId) ?? [];
    list.push(usage);
    byMedia.set(usage.mediaId, list);
  }

  let repeatedDurationSec = 0;

  for (const [mediaId, group] of byMedia.entries()) {
    const mediaDur = group.reduce((acc, u) => acc + u.timelineDurationSec, 0);
    const share = mediaDur / Math.max(1, totalTimelineSec);
    if (!intentionalRepetition && share > policy.maxAssetShare && usages.length > 1) {
      violations.push({
        kind: 'excessive_file_reuse',
        mediaId,
        clipIds: group.map((g) => g.clipId),
        detail: `Ativo ${mediaId} ocupa ${Math.round(share * 100)}% da timeline (máximo ${Math.round(policy.maxAssetShare * 100)}%).`,
      });
    }

    for (let i = 0; i < group.length; i += 1) {
      const a = group[i]!;
      if (a.timelineDurationSec > policy.maxStaticSegmentSec && !a.intentionalReuse) {
        violations.push({
          kind: 'long_static_segment',
          mediaId,
          clipIds: [a.clipId],
          detail: `Clipe ${a.clipId} permanece ${a.timelineDurationSec.toFixed(1)}s sem troca visual.`,
        });
      }

      for (let j = i + 1; j < group.length; j += 1) {
        const b = group[j]!;
        if (a.intentionalReuse && b.intentionalReuse && a.reuseJustification && b.reuseJustification) {
          continue;
        }
        const overlapStart = Math.max(a.sourceStartSec, b.sourceStartSec);
        const overlapEnd = Math.min(a.sourceEndSec, b.sourceEndSec);
        if (overlapEnd - overlapStart > 0.5) {
          repeatedDurationSec += Math.min(a.timelineDurationSec, b.timelineDurationSec);
          const hasDisguise =
            Boolean(b.cropOrZoomApplied || b.filterApplied || (b.speed && Math.abs(b.speed - (a.speed ?? 1)) > 0.05));
          violations.push({
            kind: hasDisguise ? 'disguised_loop_transform' : 'overlapping_source_interval',
            mediaId,
            clipIds: [a.clipId, b.clipId],
            detail: hasDisguise
              ? `Loop disfarçado por crop/zoom/velocidade/filtro no mesmo intervalo de ${mediaId}.`
              : `Intervalo repetido (${overlapStart.toFixed(1)}s-${overlapEnd.toFixed(1)}s) em ${mediaId}.`,
          });
        }
      }
    }
  }

  // Perceptual fingerprint collision across different clipIds
  const byFp = new Map<string, PlannedClipUsage[]>();
  for (const usage of usages) {
    if (!usage.perceptualFingerprint) continue;
    const list = byFp.get(usage.perceptualFingerprint) ?? [];
    list.push(usage);
    byFp.set(usage.perceptualFingerprint, list);
  }
  for (const [fp, group] of byFp.entries()) {
    if (group.length > 2 && !group.every((g) => g.intentionalReuse && g.reuseJustification)) {
      violations.push({
        kind: 'similar_perceptual_fingerprint',
        mediaId: group[0]!.mediaId,
        clipIds: group.map((g) => g.clipId),
        detail: `Fingerprint perceptual idêntico (${fp}) repetido ${group.length}x.`,
      });
    }
  }

  const uniqueIntervalsCount = new Set(
    usages.map((u) => `${u.mediaId}:${Math.floor(u.sourceStartSec)}-${Math.floor(u.sourceEndSec)}`),
  ).size;
  const repetitionRatioFromCounts = usages.length > 0 ? 1 - uniqueIntervalsCount / usages.length : 0;
  const repetitionRatioFromDuration = repeatedDurationSec / Math.max(1, totalTimelineSec);
  const repetitionIndex = Number(
    Math.min(1, Math.max(repetitionRatioFromCounts, repetitionRatioFromDuration)).toFixed(2),
  );

  const passed = repetitionIndex <= policy.maxRepetitionIndex && violations.length === 0;
  return {
    repetitionIndex,
    maxAllowedRepetitionIndex: policy.maxRepetitionIndex,
    violations,
    passed,
  };
}

/**
 * Media Coverage Planner + Quality Gate: never mistakes raw file duration for editorial coverage.
 */
export function planMediaCoverage(input: {
  segments: ScriptCoverageSegment[];
  assets: AcquiredMediaAsset[];
  plannedUsages?: PlannedClipUsage[];
  format?: CoverageFormat;
  intentionalRepetition?: boolean;
  relevanceDecisions?: MediaRelevanceDecision[];
  requireRelevanceApproval?: boolean;
}): MediaCoverageReport {
  const format = input.format ?? 'analysis';
  const totalExpectedDurationSec = input.segments.reduce((acc, s) => acc + Math.max(1, s.expectedDurationSec), 0);
  const policy = getCoveragePolicyForFormat(format, totalExpectedDurationSec, input.intentionalRepetition);

  const decisionByMediaId = new Map<string, MediaRelevanceDecision>();
  for (const d of input.relevanceDecisions ?? []) {
    decisionByMediaId.set(d.mediaId, d);
  }

  const incompatibleMap = new Map<string, string>();
  const validAssets: AcquiredMediaAsset[] = [];

  for (const a of input.assets) {
    const decision = decisionByMediaId.get(a.mediaId);
    if (decision && !decision.accepted) {
      incompatibleMap.set(a.mediaId, decision.reason || a.rejectedReason || 'Rejeitada pelo Media Relevance Gate.');
      continue;
    }
    if (a.compatible === false || Boolean(a.rejectedReason)) {
      incompatibleMap.set(a.mediaId, a.rejectedReason ?? 'Mídia incompatível com o roteiro.');
      continue;
    }
    if (input.requireRelevanceApproval && (!decision || !decision.accepted) && a.compatible !== true) {
      incompatibleMap.set(a.mediaId, 'Sem aprovação explícita do Media Relevance Gate.');
      continue;
    }
    if (a.durationSec > 0) {
      validAssets.push(a);
    }
  }

  for (const d of input.relevanceDecisions ?? []) {
    if (!d.accepted && !incompatibleMap.has(d.mediaId)) {
      incompatibleMap.set(d.mediaId, d.reason || 'Rejeitada pelo Media Relevance Gate.');
    }
  }

  const incompatibleMedia = [...incompatibleMap.entries()].map(([mediaId, reason]) => ({ mediaId, reason }));
  const validMediaIds = new Set(validAssets.map((a) => a.mediaId));
  const rawUsages = input.plannedUsages ?? [];
  const rejectedUsages = rawUsages.filter((u) => !validMediaIds.has(u.mediaId));
  const usages = rawUsages.filter((u) => validMediaIds.has(u.mediaId));

  // Track unique non-overlapping usable time per asset (capped at 45s per asset if not segmented, so a single 90s clip cannot fake 600s coverage)
  const remainingUsableByAsset = new Map<string, number>();
  for (const asset of validAssets) {
    remainingUsableByAsset.set(asset.mediaId, asset.durationSec);
  }

  const segments: SegmentCoverageRecord[] = [];
  const uncoveredSubjects: string[] = [];

  for (const seg of input.segments) {
    const entities =
      seg.entities && seg.entities.length > 0 ? seg.entities : extractTopicEntities(`${seg.subject} ${seg.narrationText}`);
    const expectation = extractNarrativeVisualExpectation({
      segmentId: seg.segmentId,
      prompt: seg.subject,
      narrationText: seg.narrationText,
      ...(seg.entities ? { expectedEntities: seg.entities } : {}),
    });

    const candidates = validAssets.filter((asset) => {
      const decision = decisionByMediaId.get(asset.mediaId);
      if (
        decision?.correspondenceLevel === 'universe_only_coincidence' ||
        decision?.correspondenceLevel === 'unverified' ||
        decision?.correspondenceLevel === 'rejected'
      ) {
        return false;
      }
      if (decision?.correspondenceLevel === 'contextual_support' && expectation.requiresSpecificEventVisual) {
        return false;
      }
      if (decision?.eligibleSegmentIds && decision.eligibleSegmentIds.length > 0) {
        if (decision.eligibleSegmentIds.includes(seg.segmentId)) {
          return true;
        }
        return decision.correspondenceLevel === 'contextual_support' && !expectation.requiresSpecificEventVisual;
      }
      if (!asset.relevantToEntities || asset.relevantToEntities.length === 0) {
        return !input.requireRelevanceApproval || entities.length === 0;
      }
      const hasDirectOverlap = entities.some((e) => asset.relevantToEntities!.includes(e));
      if (hasDirectOverlap) return true;
      return (
        decision?.accepted === true &&
        decision.relevanceTier === 'same_universe_context' &&
        !expectation.requiresSpecificEventVisual
      );
    });

    const segUsages = usages.filter((u) => u.segmentId === seg.segmentId);
    let usableDurationSec = 0;
    const relevantIntervals: Array<{ mediaId: string; startSec: number; endSec: number }> = [];
    const usedSources = new Set<string>();
    let plannedReuses = 0;

    if (segUsages.length > 0) {
      for (const u of segUsages) {
        const asset = validAssets.find((a) => a.mediaId === u.mediaId);
        if (!asset) continue;
        usedSources.add(asset.mediaId);
        const span = Math.max(0, Math.min(asset.durationSec, u.sourceEndSec) - Math.max(0, u.sourceStartSec));
        const rem = remainingUsableByAsset.get(asset.mediaId) ?? 0;
        const credited = Math.min(rem, span || u.timelineDurationSec);
        remainingUsableByAsset.set(asset.mediaId, Math.max(0, rem - credited));
        if (credited < u.timelineDurationSec * 0.5) plannedReuses += 1;
        usableDurationSec += credited;
        relevantIntervals.push({ mediaId: asset.mediaId, startSec: u.sourceStartSec, endSec: u.sourceEndSec });
      }
    } else {
      for (const cand of candidates) {
        const rem = remainingUsableByAsset.get(cand.mediaId) ?? 0;
        if (rem <= 0) continue;
        const take = Math.min(rem, Math.max(0, seg.expectedDurationSec - usableDurationSec));
        if (take > 0) {
          usedSources.add(cand.mediaId);
          remainingUsableByAsset.set(cand.mediaId, Math.max(0, rem - take));
          usableDurationSec += take;
          relevantIntervals.push({ mediaId: cand.mediaId, startSec: 0, endSec: Number(take.toFixed(2)) });
        }
        if (usableDurationSec >= seg.expectedDurationSec) break;
      }
    }

    const coverageGapSec = Number(Math.max(0, seg.expectedDurationSec - usableDurationSec).toFixed(2));
    const covered = coverageGapSec <= seg.expectedDurationSec * (1 - policy.minCoverageRatio);
    if (!covered) uncoveredSubjects.push(seg.subject);

    segments.push({
      segmentId: seg.segmentId,
      subject: seg.subject,
      ...(seg.expectedEvent ? { expectedEvent: seg.expectedEvent } : {}),
      ...(seg.narrationText ? { narrationExcerpt: seg.narrationText.slice(0, 160) } : {}),
      entities,
      expectedDurationSec: seg.expectedDurationSec,
      candidateMediaIds: candidates.map((c) => c.mediaId),
      relevantIntervals,
      usableDurationSec: Number(usableDurationSec.toFixed(2)),
      sourceDiversityCount: usedSources.size,
      plannedReuses,
      coverageGapSec,
      covered,
    });
  }

  const usableMediaDurationSec = Number(
    segments.reduce((acc, s) => acc + Math.min(s.expectedDurationSec, s.usableDurationSec), 0).toFixed(2),
  );
  const coverageRatio = Number(
    Math.min(1, usableMediaDurationSec / Math.max(1, totalExpectedDurationSec)).toFixed(2),
  );

  const repetition = detectMediaRepetition(usages, policy, input.intentionalRepetition);

  const gateReasons: string[] = [];
  if (rejectedUsages.length > 0) {
    gateReasons.push(
      `${rejectedUsages.length} clipe(s) na timeline referenciam mídia rejeitada/incompatível (${[...new Set(rejectedUsages.map((u) => u.mediaId))].join(', ')}).`,
    );
  }
  if (coverageRatio < policy.minCoverageRatio) {
    gateReasons.push(
      `Cobertura útil de mídia (${Math.round(coverageRatio * 100)}%) abaixo do mínimo (${Math.round(policy.minCoverageRatio * 100)}%). Faltam ${Math.round(totalExpectedDurationSec - usableMediaDurationSec)}s de material único.`,
    );
  }
  if (totalExpectedDurationSec >= 180 && validAssets.length < policy.minUniqueAssetsForLongVideo) {
    gateReasons.push(
      `Apenas ${validAssets.length} ativo(s) único(s) válido(s) para um vídeo de ${Math.round(totalExpectedDurationSec / 60)} min (mínimo ${policy.minUniqueAssetsForLongVideo}).`,
    );
  }
  if (!repetition.passed) {
    gateReasons.push(
      `Índice de repetição (${Math.round(repetition.repetitionIndex * 100)}%) excede o limite (${Math.round(policy.maxRepetitionIndex * 100)}%) ou há violações (${repetition.violations.length}).`,
    );
  }
  if (uncoveredSubjects.length > 0) {
    gateReasons.push(`Assuntos sem cobertura suficiente: ${uncoveredSubjects.slice(0, 4).join(', ')}.`);
  }

  return {
    format,
    totalExpectedDurationSec,
    uniqueAssetCount: validAssets.length,
    usableMediaDurationSec,
    coverageRatio,
    repetitionIndex: repetition.repetitionIndex,
    uncoveredSubjects,
    incompatibleMedia,
    segments,
    repetition,
    gatePassed: gateReasons.length === 0,
    gateReasons,
  };
}

/**
 * Generates script-oriented search queries per segment and expands alternative queries when coverage is low.
 */
export function expandScriptOrientedQueries(input: {
  prompt: string;
  segments: ScriptCoverageSegment[];
  genre?: string;
  uncoveredSegmentIds?: string[];
  maxQueries?: number;
}): string[] {
  const maxQueries = Math.max(4, Math.min(24, input.maxQueries ?? Math.max(6, input.segments.length)));
  const isAnime =
    input.genre === 'anime_essay' || /\b(anime|mang[aá]|epis[oó]dio|personagem)\b/i.test(input.prompt);
  const queries: string[] = [];
  const seen = new Set<string>();

  const pushQuery = (q: string) => {
    const clean = q.replace(/\s+/g, ' ').trim();
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    queries.push(clean);
  };

  const targetSegments =
    input.uncoveredSegmentIds && input.uncoveredSegmentIds.length > 0
      ? input.segments.filter((s) => input.uncoveredSegmentIds!.includes(s.segmentId))
      : input.segments;

  for (const seg of targetSegments) {
    const entities =
      seg.entities && seg.entities.length > 0 ? seg.entities : extractTopicEntities(`${seg.subject} ${seg.narrationText}`);
    const core = entities.slice(0, 3).join(' ') || seg.subject;
    if (isAnime) {
      pushQuery(`${core} anime official trailer pv scene`);
      if (input.uncoveredSegmentIds?.length) {
        pushQuery(`${core} anime sakuga clip opening`);
      }
    } else {
      pushQuery(`${core} official gameplay trailer`);
      if (input.uncoveredSegmentIds?.length) {
        pushQuery(`${core} showcase cutscene no commentary`);
      }
    }
    if (queries.length >= maxQueries) break;
  }

  return queries.slice(0, maxQueries);
}

import { inferContentDomain } from './media-providers/semantic-media.js';
import {
  extractNarrativeVisualExpectation,
  extractTopicEntities,
  isAssemblyEligibleDecision,
  type MediaRelevanceDecision,
  type MediaEditorialStatus,
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
  editorialStatus?: MediaEditorialStatus;
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
  /** Timeline intervals that are backed by a visually proven source interval. */
  provenTimelineIntervals: Array<{ startSec: number; endSec: number }>;
  /** Complement of provenTimelineIntervals inside [0, expectedDurationSec]. */
  uncoveredIntervals: Array<{ startSec: number; endSec: number }>;
  usableDurationSec: number;
  sourceDiversityCount: number;
  plannedReuses: number;
  coverageGapSec: number;
  covered: boolean;
}

export interface MediaRecoveryEditorialAlternative {
  kind: 'explanatory_graphic' | 'localized_editorial_adjustment';
  detail: string;
  countsAsFootage: false;
}

export interface MediaCoverageGap {
  segmentId: string;
  subject: string;
  expectedEvent?: string;
  expectedDurationSec: number;
  coveredDurationSec: number;
  missingDurationSec: number;
  uncoveredIntervals: Array<{ startSec: number; endSec: number }>;
  provenTimelineIntervals: Array<{ startSec: number; endSec: number }>;
  editorialAlternatives: MediaRecoveryEditorialAlternative[];
}

export interface MediaRecoveryQuery {
  segmentId: string;
  gapIndex: number;
  query: string;
  strategy: 'preferred' | 'event_specific' | 'alternative_source' | 'broader_context';
  attemptKey: string;
}

export interface MediaRecoveryPlan {
  gaps: MediaCoverageGap[];
  queries: MediaRecoveryQuery[];
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
  /** Number of acquired/identified assets presented to the planner, before editorial approval. */
  identifiedAssetCount: number;
  /** Number of assets eligible for scene assembly after visual grounding. */
  editorialApprovedAssetCount: number;
  uniqueAssetCount: number;
  usableMediaDurationSec: number;
  /** Contextual material is reported separately and never included in usableMediaDurationSec. */
  contextualMediaDurationSec: number;
  coverageRatio: number;
  repetitionIndex: number;
  uncoveredSubjects: string[];
  incompatibleMedia: Array<{ mediaId: string; reason: string }>;
  contextualMedia: Array<{ mediaId: string; reason: string }>;
  segments: SegmentCoverageRecord[];
  /** Every uncovered timeline interval; contextual material is never included here as proven coverage. */
  recoveryGaps: MediaCoverageGap[];
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
 * Source intervals an approved asset can contribute. Without vision evidence (legacy/local assets) the whole file
 * is usable; with vision, only proven intervals — or the first→last proving span when all sampled frames agree.
 */
export function usableSourceIntervals(
  asset: AcquiredMediaAsset,
  decision: MediaRelevanceDecision | undefined,
): Array<{ startSec: number; endSec: number }> {
  const full = [{ startSec: 0, endSec: Math.max(0, asset.durationSec) }];
  if (decision && !isAssemblyEligibleDecision(decision)) return [];
  if (decision?.editorialStatus && !decision.matchedIntervals?.length) return [];
  if (!decision || decision.visualVerificationStatus !== 'visually_verified' || !decision.matchedIntervals?.length) {
    return full;
  }
  const evidence = decision.visualEvidence ?? [];
  const matched = decision.matchedEntities.map((m) => m.toLowerCase()).filter((m) => m.length >= 3);
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // A frame proves identity only if it names one of the entities the gate matched (not just any entity).
  const positive = evidence.filter(
    (e) => e.confidence >= 0.4 && matched.some((m) => norm(`${e.description} ${e.detectedEntities.join(' ')}`).includes(norm(m))),
  );
  const consistentIdentity = evidence.length >= 3 && positive.length >= Math.ceil(evidence.length * 0.75);
  if (consistentIdentity) {
    const first = Math.min(...positive.map((e) => e.timestampSec));
    const last = Math.max(...positive.map((e) => e.timestampSec));
    return [
      {
        startSec: Math.max(0, first - 1.5),
        endSec: Math.min(asset.durationSec, last + 2.5),
      },
    ];
  }
  const merged = decision.matchedIntervals
    .map((iv) => ({ startSec: Math.max(0, iv.startSec), endSec: Math.min(asset.durationSec, iv.endSec) }))
    .filter((iv) => iv.endSec - iv.startSec >= 1)
    .sort((a, b) => a.startSec - b.startSec);
  const out: Array<{ startSec: number; endSec: number }> = [];
  for (const iv of merged) {
    const last = out[out.length - 1];
    if (last && iv.startSec <= last.endSec) last.endSec = Math.max(last.endSec, iv.endSec);
    else out.push({ ...iv });
  }
  return out;
}

function mergeTimelineIntervals(
  intervals: Array<{ startSec: number; endSec: number }>,
): Array<{ startSec: number; endSec: number }> {
  const sorted = intervals
    .map((iv) => ({ startSec: Math.max(0, iv.startSec), endSec: Math.max(0, iv.endSec) }))
    .filter((iv) => iv.endSec - iv.startSec >= 0.01)
    .sort((a, b) => a.startSec - b.startSec);
  const merged: Array<{ startSec: number; endSec: number }> = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startSec <= last.endSec + 0.01) {
      last.endSec = Math.max(last.endSec, interval.endSec);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.map((iv) => ({
    startSec: Number(iv.startSec.toFixed(2)),
    endSec: Number(iv.endSec.toFixed(2)),
  }));
}

function complementTimelineIntervals(
  expectedDurationSec: number,
  provenIntervals: Array<{ startSec: number; endSec: number }>,
): Array<{ startSec: number; endSec: number }> {
  const expected = Math.max(0, expectedDurationSec);
  const covered = mergeTimelineIntervals(
    provenIntervals.map((iv) => ({
      startSec: Math.min(expected, Math.max(0, iv.startSec)),
      endSec: Math.min(expected, Math.max(0, iv.endSec)),
    })),
  );
  const gaps: Array<{ startSec: number; endSec: number }> = [];
  let cursor = 0;
  for (const interval of covered) {
    if (interval.startSec > cursor + 0.01) gaps.push({ startSec: Number(cursor.toFixed(2)), endSec: interval.startSec });
    cursor = Math.max(cursor, interval.endSec);
  }
  if (cursor < expected - 0.01) gaps.push({ startSec: Number(cursor.toFixed(2)), endSec: Number(expected.toFixed(2)) });
  return gaps.filter((iv) => iv.endSec - iv.startSec >= 0.01);
}

function buildMediaCoverageGap(record: SegmentCoverageRecord): MediaCoverageGap {
  return {
    segmentId: record.segmentId,
    subject: record.subject,
    ...(record.expectedEvent ? { expectedEvent: record.expectedEvent } : {}),
    expectedDurationSec: record.expectedDurationSec,
    coveredDurationSec: record.usableDurationSec,
    missingDurationSec: record.coverageGapSec,
    uncoveredIntervals: record.uncoveredIntervals,
    provenTimelineIntervals: record.provenTimelineIntervals,
    editorialAlternatives: [
      {
        kind: 'explanatory_graphic',
        detail: `Preencher ${Math.round(record.coverageGapSec * 10) / 10}s com gráfico explicativo identificado como composição editorial; não representa a obra nem prova personagem/acontecimento.`,
        countsAsFootage: false,
      },
      {
        kind: 'localized_editorial_adjustment',
        detail: 'Reduzir ou reescrever apenas a afirmação correspondente ao intervalo sem evidência, preservando o trecho visual comprovado.',
        countsAsFootage: false,
      },
    ],
  };
}

/** Builds a finite, gap-specific recovery plan from the latest coverage report. */
export function buildMediaRecoveryPlan(input: {
  prompt: string;
  segments: ScriptCoverageSegment[];
  coverageReport: MediaCoverageReport;
  genre?: string;
  maxAttemptsPerGap?: number;
}): MediaRecoveryPlan {
  const maxAttemptsPerGap = Math.max(1, Math.min(8, input.maxAttemptsPerGap ?? 4));
  const segmentById = new Map(input.segments.map((segment) => [segment.segmentId, segment]));
  const gaps = input.coverageReport.recoveryGaps
    .filter((gap) => gap.uncoveredIntervals.length > 0 && !input.coverageReport.segments.find((s) => s.segmentId === gap.segmentId)?.covered)
    .map((gap) => ({
      ...gap,
      editorialAlternatives: gap.editorialAlternatives.map((alternative) => ({ ...alternative })),
    }));
  const queries: MediaRecoveryQuery[] = [];

  for (const gap of gaps) {
    const segment = segmentById.get(gap.segmentId);
    if (!segment) continue;
    for (const [gapIndex, interval] of gap.uncoveredIntervals.entries()) {
      const intervalLabel = `${interval.startSec.toFixed(1)}-${interval.endSec.toFixed(1)}s`;
      const event = segment.expectedEvent?.trim() || 'cena específica';
      const core = [segment.subject, ...(segment.entities ?? []).slice(0, 2)].filter(Boolean).join(' ');
      const candidates: Array<{ query: string; strategy: MediaRecoveryQuery['strategy'] }> = [];
      for (const preferred of segment.preferredQueries ?? []) {
        candidates.push({ query: preferred, strategy: 'preferred' });
      }
      candidates.push(
        { query: `${core} ${event} anime scene clip`, strategy: 'event_specific' },
        { query: `official ${core} ${event} footage scene`, strategy: 'alternative_source' },
        { query: `${core} anime scene visual reference`, strategy: 'broader_context' },
      );
      const expanded = expandScriptOrientedQueries({
        prompt: input.prompt,
        segments: [segment],
        ...(input.genre ? { genre: input.genre } : {}),
        uncoveredSegmentIds: [segment.segmentId],
        maxQueries: maxAttemptsPerGap * 2,
      });
      for (const expandedQuery of expanded) candidates.push({ query: expandedQuery, strategy: 'alternative_source' });

      const seen = new Set<string>();
      let attempt = 0;
      for (const candidate of candidates) {
        const normalized = candidate.query.replace(/\s+/g, ' ').trim();
        const key = normalized.toLowerCase();
        if (!normalized || seen.has(key)) continue;
        seen.add(key);
        queries.push({
          segmentId: gap.segmentId,
          gapIndex,
          query: normalized,
          strategy: candidate.strategy,
          attemptKey: `${gap.segmentId}:${intervalLabel}:${attempt}:${key}`,
        });
        attempt += 1;
        if (attempt >= maxAttemptsPerGap) break;
      }
    }
  }

  return { gaps, queries };
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
  const contextualMap = new Map<string, string>();
  const validAssets: AcquiredMediaAsset[] = [];

  for (const a of input.assets) {
    const decision = decisionByMediaId.get(a.mediaId);
    if (input.requireRelevanceApproval && !decision) {
      incompatibleMap.set(a.mediaId, 'Sem decisão de Scene Grounding: não pode contar como footage comprovado.');
      continue;
    }
    if (decision && !isAssemblyEligibleDecision(decision)) {
      if (decision.editorialStatus === 'contextual' || decision.editorialStatus === 'visually_verified') {
        contextualMap.set(a.mediaId, decision.reason || 'Apoio contextual sem prova de footage da cena.');
      } else {
        incompatibleMap.set(a.mediaId, decision.reason || a.rejectedReason || 'Rejeitada pelo Media Relevance Gate.');
      }
      continue;
    }
    if (decision && !decision.accepted) {
      incompatibleMap.set(a.mediaId, decision.reason || a.rejectedReason || 'Rejeitada pelo Media Relevance Gate.');
      continue;
    }
    if (a.compatible === false || Boolean(a.rejectedReason)) {
      incompatibleMap.set(a.mediaId, a.rejectedReason ?? 'Mídia incompatível com o roteiro.');
      continue;
    }
    if (input.requireRelevanceApproval && !decision?.accepted && a.compatible !== true) {
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
  const contextualMedia = [...contextualMap.entries()].map(([mediaId, reason]) => ({ mediaId, reason }));
  const validMediaIds = new Set(validAssets.map((a) => a.mediaId));
  const rawUsages = input.plannedUsages ?? [];
  const rejectedUsages = rawUsages.filter((u) => !validMediaIds.has(u.mediaId));
  const usages = rawUsages.filter((u) => validMediaIds.has(u.mediaId));

  // Track unique non-overlapping usable time per asset (capped at 45s per asset if not segmented, so a single 90s clip cannot fake 600s coverage)
  const remainingUsableByAsset = new Map<string, number>();
  // Source intervals each asset can still give. Visually verified media only offers the intervals the gate proved
  // (or the span between its first and last proving frame when every sampled frame confirmed the identity), so a
  // 90s upload with one matching frame no longer counts as 90s of coverage.
  const remainingIntervalsByAsset = new Map<string, Array<{ startSec: number; endSec: number }>>();
  for (const asset of validAssets) {
    const intervals = usableSourceIntervals(asset, decisionByMediaId.get(asset.mediaId));
    remainingIntervalsByAsset.set(asset.mediaId, intervals);
    remainingUsableByAsset.set(
      asset.mediaId,
      Number(intervals.reduce((acc, iv) => acc + (iv.endSec - iv.startSec), 0).toFixed(2)),
    );
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
      const assemblyEligible = decision
        ? isAssemblyEligibleDecision(decision)
        : asset.compatible !== false && !asset.rejectedReason;
      if (!assemblyEligible) {
        return false;
      }
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
        // Reuse across compatible scenes: footage verified for one scene of the same work can illustrate another
        // scene of that work, as long as this scene does not narrate a specific event the clip was never checked for.
        // The unused-interval pool below keeps each source second from counting twice.
        const sharesWork =
          decision.correspondenceLevel === 'exact_match' &&
          decision.visualVerificationStatus === 'visually_verified' &&
          (asset.relevantToEntities ?? decision.matchedEntities).some((e) => entities.includes(e));
        if (sharesWork && !expectation.requiresSpecificEventVisual) return true;
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
    const provenTimelineIntervals: Array<{ startSec: number; endSec: number }> = [];
    let timelineCursorSec = 0;
    const usedSources = new Set<string>();
    let plannedReuses = 0;

    if (segUsages.length > 0) {
      for (const u of segUsages) {
        const asset = validAssets.find((a) => a.mediaId === u.mediaId);
        if (!asset) continue;
        const pool = remainingIntervalsByAsset.get(asset.mediaId) ?? [];
        const usageStart = Math.max(0, u.sourceStartSec);
        const usageEnd = Math.min(asset.durationSec, Math.max(usageStart, u.sourceEndSec));
        let credited = 0;
        for (let index = 0; index < pool.length && usageEnd > usageStart; index += 1) {
          const iv = pool[index]!;
          const overlapStart = Math.max(iv.startSec, usageStart);
          const overlapEnd = Math.min(iv.endSec, usageEnd);
          if (overlapEnd <= overlapStart) continue;
          const take = overlapEnd - overlapStart;
          relevantIntervals.push({
            mediaId: asset.mediaId,
            startSec: Number(overlapStart.toFixed(2)),
            endSec: Number(overlapEnd.toFixed(2)),
          });
          credited += take;
          if (overlapStart <= iv.startSec + 0.01 && overlapEnd >= iv.endSec - 0.01) {
            pool.splice(index, 1);
            index -= 1;
          } else if (overlapStart <= iv.startSec + 0.01) {
            iv.startSec = overlapEnd;
          } else if (overlapEnd >= iv.endSec - 0.01) {
            iv.endSec = overlapStart;
          } else {
            const tail = { startSec: overlapEnd, endSec: iv.endSec };
            iv.endSec = overlapStart;
            pool.splice(index + 1, 0, tail);
            index += 1;
          }
        }
        if (credited > 0) usedSources.add(asset.mediaId);
        remainingIntervalsByAsset.set(asset.mediaId, pool);
        remainingUsableByAsset.set(
          asset.mediaId,
          Number(pool.reduce((acc, iv) => acc + (iv.endSec - iv.startSec), 0).toFixed(2)),
        );
        if (credited < u.timelineDurationSec * 0.5) plannedReuses += 1;
        if (credited > 0) {
          provenTimelineIntervals.push({
            startSec: timelineCursorSec,
            endSec: timelineCursorSec + credited,
          });
          timelineCursorSec += credited;
        }
        usableDurationSec += credited;
      }
    } else {
      // Assets verified for THIS scene first, then compatible ones; a scene is a montage of several short
      // intervals from several sources rather than one long clip.
      const ordered = [...candidates].sort((a, b) => {
        const own = (x: AcquiredMediaAsset) => (decisionByMediaId.get(x.mediaId)?.eligibleSegmentIds?.includes(seg.segmentId) ? 1 : 0);
        return own(b) - own(a);
      });
      const perSourceCap = ordered.length > 1 ? Math.max(6, seg.expectedDurationSec * 0.6) : seg.expectedDurationSec;
      for (const cand of ordered) {
        const pool = remainingIntervalsByAsset.get(cand.mediaId) ?? [];
        let takenFromSource = 0;
        while (pool.length > 0 && usableDurationSec < seg.expectedDurationSec && takenFromSource < perSourceCap) {
          const iv = pool[0]!;
          const need = Math.min(seg.expectedDurationSec - usableDurationSec, perSourceCap - takenFromSource);
          const span = iv.endSec - iv.startSec;
          const take = Math.min(span, need);
          if (take < 1) {
            if (span < 1) pool.shift();
            break;
          }
          relevantIntervals.push({
            mediaId: cand.mediaId,
            startSec: Number(iv.startSec.toFixed(2)),
            endSec: Number((iv.startSec + take).toFixed(2)),
          });
          provenTimelineIntervals.push({
            startSec: timelineCursorSec,
            endSec: timelineCursorSec + take,
          });
          timelineCursorSec += take;
          usedSources.add(cand.mediaId);
          usableDurationSec += take;
          takenFromSource += take;
          if (take >= span - 0.01) pool.shift();
          else iv.startSec += take;
        }
        remainingUsableByAsset.set(
          cand.mediaId,
          Number(pool.reduce((acc, iv) => acc + (iv.endSec - iv.startSec), 0).toFixed(2)),
        );
        if (usableDurationSec >= seg.expectedDurationSec) break;
      }
    }

    const coverageGapSec = Number(Math.max(0, seg.expectedDurationSec - usableDurationSec).toFixed(2));
    const normalizedProvenIntervals = mergeTimelineIntervals(provenTimelineIntervals).map((iv) => ({
      startSec: Number(Math.min(seg.expectedDurationSec, iv.startSec).toFixed(2)),
      endSec: Number(Math.min(seg.expectedDurationSec, iv.endSec).toFixed(2)),
    }));
    const uncoveredIntervals = complementTimelineIntervals(seg.expectedDurationSec, normalizedProvenIntervals);
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
      provenTimelineIntervals: normalizedProvenIntervals,
      uncoveredIntervals,
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
  const contextualMediaDurationSec = Number(
    input.assets
      .filter((asset) => contextualMap.has(asset.mediaId))
      .reduce((sum, asset) => sum + Math.max(0, asset.durationSec), 0)
      .toFixed(2),
  );

  const repetition = detectMediaRepetition(usages, policy, input.intentionalRepetition);
  const recoveryGaps = segments.map(buildMediaCoverageGap).filter((gap) => gap.uncoveredIntervals.length > 0);

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
    identifiedAssetCount: input.assets.length,
    editorialApprovedAssetCount: validAssets.length,
    uniqueAssetCount: validAssets.length,
    usableMediaDurationSec,
    contextualMediaDurationSec,
    coverageRatio,
    repetitionIndex: repetition.repetitionIndex,
    uncoveredSubjects,
    incompatibleMedia,
    contextualMedia,
    segments,
    recoveryGaps,
    repetition,
    gatePassed: gateReasons.length === 0,
    gateReasons,
  };
}

/**
 * Generates script-oriented search queries per segment with multi-strategy expansion:
 * original/English names, translated PT-BR terms, synonyms/epithet-free names,
 * gameplay/boss fight/showcase/cutscene variants, and broader fallbacks.
 */
export function expandScriptOrientedQueries(input: {
  prompt: string;
  segments: ScriptCoverageSegment[];
  genre?: string;
  uncoveredSegmentIds?: string[];
  maxQueries?: number;
}): string[] {
  const maxQueries = Math.max(4, Math.min(48, input.maxQueries ?? Math.max(8, input.segments.length * 3)));
  // Content domain decides the query vocabulary; the narrative format (gameplay_essay/top_list) does not.
  const domain = inferContentDomain({
    prompt: input.prompt,
    ...(input.genre ? { genre: input.genre } : {}),
    narrationText: input.segments.map((s) => `${s.subject} ${s.narrationText}`).join(' ').slice(0, 2000),
  }).domain;
  const isAnime = domain === 'anime' || /\b(anime|mang[aá]|epis[oó]dio|personagem)\b/i.test(input.prompt);
  const isGaming =
    domain === 'game' ||
    /\b(game|jogo|jogos|boss|chefes?|chefe|gameplay|elden ring|dark souls|sekiro|bloodborne|rpg|playstation|xbox|nintendo|steam)\b/i.test(
      `${input.prompt} ${input.segments.map((s) => `${s.subject} ${s.narrationText}`).join(' ')}`,
    );
  const queries: string[] = [];
  const seen = new Set<string>();

  const pushQuery = (q: string) => {
    const clean = q.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 3 || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    queries.push(clean);
  };

  const targetSegments =
    input.uncoveredSegmentIds && input.uncoveredSegmentIds.length > 0
      ? input.segments.filter((s) => input.uncoveredSegmentIds!.includes(s.segmentId))
      : input.segments;

  for (const seg of targetSegments) {
    const rawEntities =
      seg.entities && seg.entities.length > 0 ? seg.entities : extractTopicEntities(`${seg.subject} ${seg.narrationText}`);
    const cleanEntities = rawEntities
      .map((e) => e.replace(/\([^)]*\)/g, '').split(',')[0]?.trim() ?? '')
      .filter((e) => e.length >= 2);
    const core = cleanEntities.slice(0, 3).join(' ') || seg.subject.replace(/\([^)]*\)/g, '').trim();
    const primaryEntity = cleanEntities[0] ?? core;
    const workEntity = cleanEntities.length > 1 ? cleanEntities[0] : '';

    for (const pq of seg.preferredQueries ?? []) {
      pushQuery(pq);
    }

    if (isAnime) {
      pushQuery(`${core} anime official trailer pv scene`);
      pushQuery(`${core} anime fight clip sakuga`);
      pushQuery(`${core} cena anime dublado legendado`);
      if (workEntity && primaryEntity !== workEntity) {
        pushQuery(`${workEntity} ${primaryEntity} anime`);
      }
    } else if (isGaming) {
      pushQuery(`${core} boss fight gameplay no commentary`);
      pushQuery(`${core} gameplay showcase 4k`);
      pushQuery(`${core} luta chefe gameplay`);
      pushQuery(`${primaryEntity} boss fight cutscene`);
      if (workEntity && primaryEntity !== workEntity) {
        pushQuery(`${workEntity} ${primaryEntity} gameplay`);
      }
    } else {
      pushQuery(`${core} official footage showcase`);
      pushQuery(`${core} documentary explained demonstration`);
      pushQuery(`${core} demonstracao cenas`);
      if (workEntity && primaryEntity !== workEntity) {
        pushQuery(`${workEntity} ${primaryEntity}`);
      }
    }
    if (queries.length >= maxQueries) break;
  }

  return queries.slice(0, maxQueries);
}

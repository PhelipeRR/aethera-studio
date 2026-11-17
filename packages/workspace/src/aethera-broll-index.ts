import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { brollIndexSchema, type BrollIndex, type BrollSemanticStatus, type BrollTechnicalStatus, type MediaSegment } from '@neuralbridge/shared';

const exec = promisify(execFile);
export const BROLL_INDEX_VERSION = 'p2.1';

export interface TemporalSample { atMs: number; meanLuma: number; meanDiff: number }
export interface TemporalClassification {
  technicalStatus: BrollTechnicalStatus;
  flashFrameTimesMs: number[];
  reasons: string[];
}

export interface BrollContinuity {
  valid: boolean;
  gapsMs: number[];
}

export interface BrollSemanticDecision {
  technicalStatus: BrollTechnicalStatus;
  semanticStatus: BrollSemanticStatus;
  reason: string;
}

export function stableBrollSegmentId(input: { sourceHash: string; startMs: number; endMs: number; indexVersion: string }): string {
  if (!input.sourceHash || input.endMs <= input.startMs || input.startMs < 0) throw new Error('invalid: B-roll interval identity.');
  const digest = createHash('sha256').update(JSON.stringify([input.indexVersion, input.sourceHash, input.startMs, input.endMs])).digest('hex');
  return `broll_${digest}`;
}

export function representativeKeyframeTimes(startMs: number, endMs: number, requestedCount = 3): number[] {
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs) throw new Error('invalid: B-roll interval.');
  const count = Math.min(5, Math.max(1, Math.min(requestedCount, Math.floor((endMs - startMs) / 500) || 1)));
  return Array.from({ length: count }, (_, index) => Math.floor(startMs + ((endMs - startMs) * (index + 0.5)) / count));
}

export function classifyTemporalSamples(samples: readonly TemporalSample[]): TemporalClassification {
  if (samples.length === 0) return { technicalStatus: 'technical_blocked', flashFrameTimesMs: [], reasons: ['no_temporal_samples'] };
  const black = samples.every((sample) => sample.meanLuma <= 20);
  const frozen = samples.length > 1 && samples.every((sample) => sample.meanDiff < 0.1);
  const flashFrameTimesMs: number[] = [];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1] as TemporalSample;
    const current = samples[index] as TemporalSample;
    const next = samples[index + 1] as TemporalSample;
    if (current.meanDiff >= 40 && previous.meanDiff <= 12 && next.meanDiff <= 12 && Math.abs(previous.meanLuma - next.meanLuma) <= 24) flashFrameTimesMs.push(current.atMs);
  }
  const reasons = [
    ...(black ? ['black_frame'] : []),
    ...(frozen ? ['frozen_interval'] : []),
    ...(flashFrameTimesMs.length ? ['flash_frame_candidate'] : []),
  ];
  return { technicalStatus: black || frozen ? 'technical_blocked' : 'technical_valid', flashFrameTimesMs, reasons };
}

export function discardFlashKeyframeTimes(timesMs: readonly number[], flashFrameTimesMs: readonly number[], guardMs = 120): number[] {
  return timesMs.filter((time) => !flashFrameTimesMs.some((flash) => Math.abs(time - flash) <= guardMs));
}

/**
 * Checks that the frames used to describe an interval cover the requested source range without a missing span.
 * The edge tolerance is deliberately wider than one sample period so ordinary CFR rounding is not treated as a gap.
 */
export function validateBrollContinuity(input: {
  startMs: number;
  endMs: number;
  samples: readonly Pick<TemporalSample, 'atMs'>[];
  samplePeriodMs?: number;
}): BrollContinuity {
  if (input.startMs < 0 || input.endMs <= input.startMs || input.samples.length === 0) return { valid: false, gapsMs: [Math.max(0, input.endMs - input.startMs)] };
  const period = Math.max(1, input.samplePeriodMs ?? 100);
  const sorted = [...input.samples].map((sample) => sample.atMs).filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return { valid: false, gapsMs: [input.endMs - input.startMs] };
  const gaps: number[] = [];
  const edgeTolerance = Math.round(period * 1.5);
  const internalTolerance = Math.round(period * 2.5);
  const firstGap = sorted[0]! - input.startMs;
  if (firstGap > edgeTolerance) gaps.push(Math.round(firstGap));
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index]! - sorted[index - 1]! - period;
    if (gap > internalTolerance) gaps.push(Math.round(gap));
  }
  const lastGap = input.endMs - sorted.at(-1)! - period;
  if (lastGap > edgeTolerance) gaps.push(Math.round(lastGap));
  return { valid: gaps.length === 0, gapsMs: gaps };
}

/**
 * Keeps provider outages in the technical lane. Editorial rejection is only possible when an explicit editorial
 * decision is supplied; absent visual evidence is never promoted to a rejection or an approval.
 */
export function classifyBrollSemanticDecision(input: {
  mediaAvailable: boolean;
  technicalBlocked: boolean;
  semanticConfidence: number | null;
  attempts: readonly { outcome: string }[];
  editorialDecision?: 'accept' | 'reject' | 'review';
}): BrollSemanticDecision {
  if (!input.mediaAvailable) return { technicalStatus: 'media_unavailable', semanticStatus: 'not_evaluated', reason: 'media_unavailable' };
  if (input.technicalBlocked || (!Number.isFinite(input.semanticConfidence) && input.attempts.length > 0 && input.attempts.every((attempt) => ['unavailable', 'error', 'over_budget'].includes(attempt.outcome)))) {
    return { technicalStatus: 'technical_blocked', semanticStatus: 'not_evaluated', reason: 'vision_provider_unavailable' };
  }
  if (input.editorialDecision === 'reject') return { technicalStatus: 'technical_valid', semanticStatus: 'editorial_rejected', reason: 'editorial_decision_rejected' };
  if (input.editorialDecision === 'review') return { technicalStatus: 'technical_valid', semanticStatus: 'needs_review', reason: 'editorial_review_required' };
  if (input.semanticConfidence !== null && input.semanticConfidence > 0) return { technicalStatus: 'technical_valid', semanticStatus: 'semantic_adequate', reason: 'visual_evidence_available' };
  return { technicalStatus: 'technical_valid', semanticStatus: 'needs_review', reason: 'semantic_evidence_insufficient' };
}

export function canReuseBrollIndex(index: BrollIndex, expected: { sourceHash: string; indexVersion: string }): boolean {
  const parsed = brollIndexSchema.safeParse(index);
  return parsed.success && parsed.data.status === 'complete' && parsed.data.sourceHash === expected.sourceHash && parsed.data.indexVersion === expected.indexVersion;
}

/** Partial indexes survive an interrupted run. Only deterministic, source-matching intervals are resumed. */
export function resumableBrollSegments(index: BrollIndex, expected: { sourceHash: string; indexVersion: string }): Map<string, MediaSegment> {
  const parsed = brollIndexSchema.safeParse(index);
  if (!parsed.success || parsed.data.status !== 'indexing' || parsed.data.sourceHash !== expected.sourceHash || parsed.data.indexVersion !== expected.indexVersion) return new Map();
  return new Map(parsed.data.segments.filter((segment) => segment.broll?.sourceHash === expected.sourceHash && segment.broll.indexVersion === expected.indexVersion && segment.id === stableBrollSegmentId({ sourceHash: expected.sourceHash, startMs: segment.startMs, endMs: segment.endMs, indexVersion: expected.indexVersion })).map((segment) => [segment.id, segment]));
}

export async function makeBrollContactSheet(input: { ffmpeg: string; framePaths: readonly string[]; outputPath: string; labels: readonly string[] }): Promise<void> {
  if (input.framePaths.length === 0 || input.framePaths.length !== input.labels.length) throw new Error('invalid: contact sheet needs one label per frame.');
  if (input.framePaths.some((path) => !existsSync(path))) throw new Error('not_found: keyframe missing for contact sheet.');
  mkdirSync(dirname(input.outputPath), { recursive: true });
  const filters = input.framePaths.map((_, index) => `[${index}:v]scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=0x0c0e14[v${index}]`).join(';');
  const layout = input.framePaths.map((_, index) => `${(index % 4) * 320}_${Math.floor(index / 4) * 180}`).join('|');
  const streamLabels = input.framePaths.map((_, index) => `[v${index}]`).join('');
  const filter = `${filters};${streamLabels}xstack=inputs=${input.framePaths.length}:layout=${layout}:fill=0x0c0e14,format=yuv420p[out]`;
  await exec(input.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...input.framePaths.flatMap((path) => ['-i', path]), '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-q:v', '2', input.outputPath], { windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
}

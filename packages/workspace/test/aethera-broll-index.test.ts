import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  BROLL_INDEX_VERSION,
  canReuseBrollIndex,
  classifyTemporalSamples,
  classifyBrollSemanticDecision,
  discardFlashKeyframeTimes,
  makeBrollContactSheet,
  representativeKeyframeTimes,
  stableBrollSegmentId,
  resumableBrollSegments,
  validateBrollContinuity,
} from '../src/aethera-broll-index.js';

it('creates deterministic interval identities and interior representative times', () => {
  expect(stableBrollSegmentId({ sourceHash: 'a'.repeat(64), startMs: 1_000, endMs: 4_000, indexVersion: BROLL_INDEX_VERSION }))
    .toBe(stableBrollSegmentId({ sourceHash: 'a'.repeat(64), startMs: 1_000, endMs: 4_000, indexVersion: BROLL_INDEX_VERSION }));
  expect(stableBrollSegmentId({ sourceHash: 'a'.repeat(64), startMs: 1_000, endMs: 4_000, indexVersion: BROLL_INDEX_VERSION }))
    .not.toBe(stableBrollSegmentId({ sourceHash: 'a'.repeat(64), startMs: 1_001, endMs: 4_000, indexVersion: BROLL_INDEX_VERSION }));
  expect(representativeKeyframeTimes(1_000, 4_000, 3)).toEqual([1_500, 2_500, 3_500]);
  expect(representativeKeyframeTimes(0, 200, 5)).toEqual([100]);
});

it('flags an isolated flash without rejecting a moving interval', () => {
  const result = classifyTemporalSamples([
    { atMs: 0, meanLuma: 110, meanDiff: 6 },
    { atMs: 100, meanLuma: 245, meanDiff: 75 },
    { atMs: 200, meanLuma: 112, meanDiff: 7 },
    { atMs: 300, meanLuma: 115, meanDiff: 8 },
  ]);
  expect(result.flashFrameTimesMs).toEqual([100]);
  expect(result.technicalStatus).toBe('technical_valid');
  expect(result.reasons).toContain('flash_frame_candidate');
});

it('discards keyframe times inside a confirmed flash window', () => {
  expect(discardFlashKeyframeTimes([500, 1_000, 1_500], [1_000])).toEqual([500, 1_500]);
  expect(discardFlashKeyframeTimes([1_000], [1_000])).toEqual([]);
});

it('blocks black or frozen intervals while preserving valid static thresholds as evidence', () => {
  expect(classifyTemporalSamples([
    { atMs: 0, meanLuma: 16, meanDiff: 0 },
    { atMs: 100, meanLuma: 16, meanDiff: 0 },
  ]).technicalStatus).toBe('technical_blocked');
  expect(classifyTemporalSamples([
    { atMs: 0, meanLuma: 100, meanDiff: 0 },
    { atMs: 100, meanLuma: 100, meanDiff: 0 },
  ]).technicalStatus).toBe('technical_blocked');
});

it('reuses only a complete index with the same source fingerprint and index version', () => {
  const base = { schemaVersion: 1 as const, indexVersion: BROLL_INDEX_VERSION, assetId: 'asset', sourceHash: 'a'.repeat(64), sourcePath: 'media/a.mp4', durationMs: 2_000, cutsSeconds: [0, 2], contactSheetPath: null, segments: [], status: 'complete' as const, diagnostics: [] };
  expect(canReuseBrollIndex(base, { sourceHash: 'a'.repeat(64), indexVersion: BROLL_INDEX_VERSION })).toBe(true);
  expect(canReuseBrollIndex(base, { sourceHash: 'b'.repeat(64), indexVersion: BROLL_INDEX_VERSION })).toBe(false);
  expect(canReuseBrollIndex({ ...base, status: 'indexing' }, { sourceHash: base.sourceHash, indexVersion: base.indexVersion })).toBe(false);
});

it('resumes only compatible partial intervals and never resumes a completed provider outage', () => {
  const segment = {
    schemaVersion: 1 as const, id: stableBrollSegmentId({ sourceHash: 'a'.repeat(64), startMs: 0, endMs: 2_000, indexVersion: BROLL_INDEX_VERSION }), assetId: 'asset', startMs: 0, endMs: 2_000, frameHashes: ['frame'], kind: 'unknown' as const, description: 'observed', tags: [], embeddingRefs: [], quality: { blur: 0, motion: 0.5, overlayText: false, watermark: false, black: false, frozen: false }, analyzedBy: { provider: 'test', model: 'test', confidence: 0 }, broll: { indexVersion: BROLL_INDEX_VERSION, sourceHash: 'a'.repeat(64), keyframes: [{ atMs: 1_000, hash: 'frame', relativePath: 'frame.jpg' }], technicalStatus: 'technical_valid' as const, semanticStatus: 'semantic_adequate' as const, flashFrameTimesMs: [], continuity: { valid: true, gapsMs: [] }, diagnostics: [] },
  };
  const partial = { schemaVersion: 1 as const, indexVersion: BROLL_INDEX_VERSION, assetId: 'asset', sourceHash: 'a'.repeat(64), sourcePath: 'media/a.mp4', durationMs: 2_000, cutsSeconds: [0, 2], contactSheetPath: null, segments: [segment], status: 'indexing' as const, diagnostics: [] };
  expect([...resumableBrollSegments(partial, { sourceHash: 'a'.repeat(64), indexVersion: BROLL_INDEX_VERSION }).keys()]).toEqual([segment.id]);
  expect(resumableBrollSegments({ ...partial, status: 'technical_blocked' }, { sourceHash: partial.sourceHash, indexVersion: partial.indexVersion })).toEqual(new Map());
});

it('blocks incomplete temporal coverage but accepts ordinary CFR rounding', () => {
  expect(validateBrollContinuity({ startMs: 0, endMs: 500, samples: [{ atMs: 0 }, { atMs: 100 }, { atMs: 200 }, { atMs: 300 }, { atMs: 400 }] })).toEqual({ valid: true, gapsMs: [] });
  expect(validateBrollContinuity({ startMs: 0, endMs: 1_000, samples: [{ atMs: 0 }, { atMs: 100 }, { atMs: 700 }, { atMs: 800 }, { atMs: 900 }] })).toEqual({ valid: false, gapsMs: [500] });
  expect(validateBrollContinuity({ startMs: 0, endMs: 500, samples: [] }).valid).toBe(false);
});

it('keeps provider outages technical and requires an explicit editorial decision for rejection', () => {
  expect(classifyBrollSemanticDecision({ mediaAvailable: true, technicalBlocked: false, semanticConfidence: null, attempts: [{ outcome: 'unavailable' }, { outcome: 'timeout' }] })).toMatchObject({ technicalStatus: 'technical_valid', semanticStatus: 'needs_review' });
  expect(classifyBrollSemanticDecision({ mediaAvailable: true, technicalBlocked: false, semanticConfidence: null, attempts: [{ outcome: 'unavailable' }, { outcome: 'error' }] })).toMatchObject({ technicalStatus: 'technical_blocked', semanticStatus: 'not_evaluated' });
  expect(classifyBrollSemanticDecision({ mediaAvailable: true, technicalBlocked: false, semanticConfidence: 0.9, attempts: [{ outcome: 'ok' }], editorialDecision: 'reject' })).toMatchObject({ technicalStatus: 'technical_valid', semanticStatus: 'editorial_rejected' });
  expect(classifyBrollSemanticDecision({ mediaAvailable: false, technicalBlocked: false, semanticConfidence: null, attempts: [] })).toMatchObject({ technicalStatus: 'media_unavailable', semanticStatus: 'not_evaluated' });
});

it('writes an inspectable contact sheet from cached keyframes without replacing source media', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aethera-broll-sheet-'));
  const output = join(root, 'sheet.jpg');
  const first = join(root, 'first.jpg');
  const second = join(root, 'second.jpg');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=1:duration=1', '-frames:v', '1', first], { windowsHide: true });
  await promisify(execFile)('C:\\ffmpeg\\bin\\ffmpeg.exe', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1', '-frames:v', '1', second], { windowsHide: true });
  await makeBrollContactSheet({ ffmpeg: 'C:\\ffmpeg\\bin\\ffmpeg.exe', framePaths: [first, second], outputPath: output, labels: ['0.5s', '1.5s'] });
  expect(statSync(output).size).toBeGreaterThan(100);
  expect(readFileSync(output).subarray(0, 2).toString('hex')).toBe('ffd8');
});

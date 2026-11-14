import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAetheraReferenceValidation, AETHERA_REFERENCE_EVIDENCE_PATH } from '../src/aethera-reference-validation.js';
import { aetheraReferenceStageKinds, type AetheraReferenceValidationInput } from '@neuralbridge/shared';

const evidence = (sourceRoot = 'reference'): AetheraReferenceValidationInput => ({
  schemaVersion: 1, runId: 'as10-run-1', sourceRoot,
  games: ['Cyberpunk 2077', 'Elden Ring', 'Hollow Knight: Silksong'].map((title, index) => ({ title, igdbId: String(index + 1), research: { status: 'confirmed', sourceCount: 2, evidencePath: `research/${index}.json` }, media: { trailer: { path: `games/${index}/trailer.mp4`, present: true, provenancePath: `provenance/${index}-trailer.json` }, gameplay: { path: `games/${index}/gameplay.mp4`, present: true, provenancePath: `provenance/${index}-gameplay.json` } } })),
  labels: { path: 'labels/segments.json', calibrationCount: 90, testCount: 60 },
  stages: aetheraReferenceStageKinds.map((stage) => ({ stage, status: 'pass', evidence: [`evidence/${stage}.json`] })),
  render: { outputPath: 'render/final.mp4', ffprobe: { valid: true, format: 'mp4', width: 1920, height: 1080 } },
  sceneSwap: { affectedSceneIds: ['scene-1'], rerenderedSegmentIds: ['segment-1'], reusedSegmentIds: ['segment-2'], reconstructionAvoided: true },
  quality: { reportPath: 'qa/report.json', blockingIssues: 0, passed: true },
  metrics: { stageDurationsMs: Object.fromEntries(aetheraReferenceStageKinds.map((stage) => [stage, 1_000])), totalDurationMs: 10_000, downloadedBytes: 1, diskBytes: 2, providerCalls: [{ provider: 'ffmpeg-heuristics', calls: 1, costUsd: 0 }], matching: { correct: 1, total: 1 }, defects: { detected: 1, total: 1 }, peakMemoryMb: 100, segmentsReused: 1 },
});

function materializeEvidence(root: string): void {
  const paths = [
    ...['0', '1', '2'].flatMap((index) => [`research/${index}.json`, `games/${index}/trailer.mp4`, `games/${index}/gameplay.mp4`, `provenance/${index}-trailer.json`, `provenance/${index}-gameplay.json`]),
    ...aetheraReferenceStageKinds.map((stage) => `evidence/${stage}.json`),
    'manifest.json', 'labels/segments.json', 'render/final.mp4', 'qa/report.json',
  ];
  for (const path of paths) {
    const file = join(root, path);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '{}');
  }
}

describe('AS-10 reference evidence loader', () => {
  it('reports a missing envelope as blocked without inventing a run', async () => {
    const root = mkdtempSync(join(tmpdir(), 'as10-loader-'));
    const report = await loadAetheraReferenceValidation(root, new Date('2026-11-11T12:00:00.000Z'));
    expect(report.status).toBe('blocked');
    expect(report.blockers).toEqual(['evidence-file']);
    expect(report.checks[0]?.evidence[0]).toContain(AETHERA_REFERENCE_EVIDENCE_PATH);
    expect(report.runId).toBe('unknown');
  });

  it('reads the envelope and delegates the complete gate to the shared validator', async () => {
    const root = mkdtempSync(join(tmpdir(), 'as10-loader-'));
    mkdirSync(join(root, 'validation'));
    materializeEvidence(root);
    writeFileSync(join(root, AETHERA_REFERENCE_EVIDENCE_PATH), JSON.stringify(evidence(root)));
    const report = await loadAetheraReferenceValidation(root, new Date('2026-11-11T12:00:00.000Z'));
    expect(report.status).toBe('pass');
    expect(report.runId).toBe('as10-run-1');
    expect(report.generatedAt).toBe('2026-11-11T12:00:00.000Z');
  });

  it('blocks evidence that points to a missing artifact', async () => {
    const root = mkdtempSync(join(tmpdir(), 'as10-loader-'));
    mkdirSync(join(root, 'validation'));
    materializeEvidence(root);
    unlinkSync(join(root, 'games/1/gameplay.mp4'));
    writeFileSync(join(root, AETHERA_REFERENCE_EVIDENCE_PATH), JSON.stringify(evidence(root)));
    const report = await loadAetheraReferenceValidation(root);
    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('artifact-integrity');
  });

  it('blocks evidence that escapes the reference folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'as10-loader-'));
    mkdirSync(join(root, 'validation'));
    materializeEvidence(root);
    const outside = { ...evidence(root), games: evidence(root).games.map((game, index) => index === 0 ? { ...game, media: { ...game.media, trailer: { ...game.media.trailer, path: '../outside.mp4' } } } : game) };
    writeFileSync(join(root, AETHERA_REFERENCE_EVIDENCE_PATH), JSON.stringify(outside));
    const report = await loadAetheraReferenceValidation(root);
    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('artifact-integrity');
  });

  it('keeps malformed external evidence blocked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'as10-loader-'));
    mkdirSync(join(root, 'validation'));
    writeFileSync(join(root, AETHERA_REFERENCE_EVIDENCE_PATH), '{not-json');
    const report = await loadAetheraReferenceValidation(root);
    expect(report.status).toBe('blocked');
    expect(report.blockers).toEqual(['evidence-file']);
  });
});

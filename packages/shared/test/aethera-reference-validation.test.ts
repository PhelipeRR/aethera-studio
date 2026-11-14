import { describe, expect, it } from 'vitest';
import { validateAetheraReference, type AetheraReferenceValidationInput } from '../src/aethera-reference-validation.js';

const stageKinds = ['research', 'acquisition', 'frames', 'classification', 'timestamp_clips', 'scene_matching', 'narration_sync', 'render', 'scene_swap', 'quality'] as const;

const completeInput = (): AetheraReferenceValidationInput => ({
  schemaVersion: 1,
  runId: 'as10-run-1',
  sourceRoot: 'C:/dev/aethera-reference-media',
  games: ['Cyberpunk 2077', 'Elden Ring', 'Hollow Knight: Silksong'].map((title, index) => ({
    title,
    igdbId: String(index + 1),
    research: { status: 'confirmed', sourceCount: 2, evidencePath: `research/${index + 1}.json` },
    media: {
      trailer: { path: `game-${index + 1}/trailer.mp4`, present: true, provenancePath: `provenance/${index + 1}-trailer.json` },
      gameplay: { path: `game-${index + 1}/gameplay.mp4`, present: true, provenancePath: `provenance/${index + 1}-gameplay.json` },
    },
  })),
  labels: { path: 'labels/segments.json', calibrationCount: 90, testCount: 60 },
  stages: stageKinds.map((stage) => ({ stage, status: 'pass', evidence: [`evidence/${stage}.json`] })),
  render: { outputPath: 'render/final.mp4', ffprobe: { valid: true, format: 'mp4', width: 1920, height: 1080 } },
  sceneSwap: { affectedSceneIds: ['scene-2'], rerenderedSegmentIds: ['segment-2'], reusedSegmentIds: ['segment-1', 'segment-3'], reconstructionAvoided: true },
  quality: { reportPath: 'qa/report.json', blockingIssues: 0, passed: true },
  metrics: {
    stageDurationsMs: Object.fromEntries(stageKinds.map((stage) => [stage, 1_000])),
    totalDurationMs: 10_000,
    downloadedBytes: 123,
    diskBytes: 456,
    providerCalls: [{ provider: 'ffmpeg-heuristics', calls: 10, costUsd: 0 }],
    matching: { correct: 9, total: 10 },
    defects: { detected: 7, total: 7 },
    peakMemoryMb: 512,
    segmentsReused: 2,
  },
});

describe('Aethera AS-10 reference validation', () => {
  it('passes only when the complete real-run evidence is present', () => {
    const report = validateAetheraReference(completeInput());

    expect(report.status).toBe('pass');
    expect(report.blockers).toEqual([]);
    expect(report.checks.every((check) => check.status === 'pass')).toBe(true);
    expect(report.metrics.segmentsReused).toBe(2);
  });

  it('blocks the current empty external manifest without inventing evidence', () => {
    const input = completeInput();
    const report = validateAetheraReference({
      ...input,
      games: input.games.map((game) => ({ ...game, igdbId: null, research: { status: 'unconfirmed', sourceCount: 0, evidencePath: null }, media: {
        trailer: { path: null, present: false, provenancePath: null },
        gameplay: { path: null, present: false, provenancePath: null },
      }})),
      labels: { path: null, calibrationCount: 0, testCount: 0 },
      stages: input.stages.map((stage) => ({ ...stage, status: 'blocked', evidence: [] })),
      render: { outputPath: null, ffprobe: { valid: false, format: null, width: null, height: null } },
      sceneSwap: { affectedSceneIds: [], rerenderedSegmentIds: [], reusedSegmentIds: [], reconstructionAvoided: false },
      quality: { reportPath: null, blockingIssues: 0, passed: false },
      metrics: { ...input.metrics, totalDurationMs: null, downloadedBytes: null, diskBytes: null, matching: null, defects: null, peakMemoryMb: null, segmentsReused: null },
    });

    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('research-verification');
    expect(report.blockers).toContain('media-provenance');
    expect(report.blockers).toContain('pipeline-evidence');
    expect(report.blockers).toContain('render-1080p');
    expect(report.blockers).toContain('quality-report');
    expect(report.metrics.totalDurationMs).toBeNull();
  });

  it('fails when a run has explicit quality blockers or excessive rerender scope', () => {
    const input = completeInput();
    const report = validateAetheraReference({
      ...input,
      sceneSwap: { ...input.sceneSwap, affectedSceneIds: ['scene-2'], rerenderedSegmentIds: ['segment-1', 'segment-2'], reconstructionAvoided: true },
      quality: { reportPath: 'qa/report.json', blockingIssues: 1, passed: false },
    });

    expect(report.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'scene-swap-reuse')?.status).toBe('fail');
    expect(report.checks.find((check) => check.id === 'quality-report')?.status).toBe('fail');
  });
});

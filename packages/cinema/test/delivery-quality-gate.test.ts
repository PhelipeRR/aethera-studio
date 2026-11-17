import { describe, expect, it } from 'vitest';
import { evaluateDeliveryQualityGate } from '../src/qc/delivery-quality-gate.js';

const base = {
  probe: { width: 1280, height: 720, fps: 30, durationSec: 60, audioCodec: 'aac', audioSampleRate: 48_000 },
  expected: { width: 1280, height: 720, fps: 30, durationSec: 60, durationToleranceMs: 250 },
  audioFirst: { completeNarrationPreserved: true, measuredNarrationDurationMs: 59_900, finalAudioStreamDurationMs: 60_000 },
  captions: { enabled: true, coverageEndMs: 59_800, measuredNarrationDurationMs: 59_900, wordCount: 120 },
  audioSources: { music: 'asset' as const, ambience: 'asset' as const, sfx: 'asset' as const },
};

describe('delivery quality gate', () => {
  it('approves a complete measured delivery', () => {
    const report = evaluateDeliveryQualityGate(base, { requireRealAudio: true });
    expect(report.passed).toBe(true);
    expect(report.status).toBe('approved');
    expect(report.findings).toEqual([]);
  });

  it('blocks technical duration/audio failures instead of trusting FFmpeg exit code', () => {
    const report = evaluateDeliveryQualityGate({
      ...base,
      probe: { ...base.probe, durationSec: 57, audioCodec: null },
      audioFirst: { ...base.audioFirst, completeNarrationPreserved: false, finalAudioStreamDurationMs: 57_000 },
    }, { requireRealAudio: true });
    expect(report.passed).toBe(false);
    expect(report.status).toBe('technical_blocked');
    expect(report.findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(['duration', 'audio', 'narration']));
  });

  it('keeps incomplete semantic caption coverage reviewable and does not approve it silently', () => {
    const report = evaluateDeliveryQualityGate({ ...base, captions: { ...base.captions, coverageEndMs: 1_380 } }, { requireRealAudio: true });
    expect(report.passed).toBe(false);
    expect(report.status).toBe('needs_review');
    expect(report.findings.find((finding) => finding.id === 'captions')?.severity).toBe('review');
  });
});

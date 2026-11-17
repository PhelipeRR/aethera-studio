import { describe, expect, it } from 'vitest';
import {
  buildAudioFirstDurationAudit,
  measureNarrationSegmentsWithPauses,
} from '../src/audio/audio-first-timeline.js';

describe('Audio-first timeline duration audit', () => {
  it('uses the measured narration as a hard lower bound when speech is longer than planned', () => {
    const audit = buildAudioFirstDurationAudit({
      plannedTimelineDurationMs: 10_000,
      measuredNarrationDurationMs: 12_450,
    });

    expect(audit.plannedDurationMs).toBe(10_000);
    expect(audit.measuredNarrationDurationMs).toBe(12_450);
    expect(audit.finalTimelineDurationMs).toBe(12_450);
    expect(audit.narrationEndMs).toBe(12_450);
    expect(audit.adjustments).toEqual([
      expect.objectContaining({
        kind: 'extend_timeline_for_narration',
        deltaMs: 2_450,
      }),
    ]);
    expect(audit.completeNarrationPreserved).toBe(true);
  });

  it('keeps the planned tail when narration is shorter than the estimate', () => {
    const audit = buildAudioFirstDurationAudit({
      plannedTimelineDurationMs: 10_000,
      measuredNarrationDurationMs: 7_250,
    });

    expect(audit.finalTimelineDurationMs).toBe(10_000);
    expect(audit.narrationEndMs).toBe(7_250);
    expect(audit.adjustments).toEqual([
      expect.objectContaining({
        kind: 'preserve_planned_tail',
        deltaMs: 2_750,
      }),
    ]);
    expect(audit.completeNarrationPreserved).toBe(true);
  });

  it('accounts for measured segment speech and natural pauses without collapsing them', () => {
    const measured = measureNarrationSegmentsWithPauses([
      { segmentId: 'scene_1', speechDurationMs: 2_100, pauseAfterMs: 450 },
      { segmentId: 'scene_2', speechDurationMs: 3_200, pauseAfterMs: 900 },
      { segmentId: 'scene_3', speechDurationMs: 1_800, pauseAfterMs: 0 },
    ]);

    expect(measured.totalDurationMs).toBe(8_450);
    expect(measured.segments).toEqual([
      { segmentId: 'scene_1', startMs: 0, speechEndMs: 2_100, endMs: 2_550, pauseAfterMs: 450 },
      { segmentId: 'scene_2', startMs: 2_550, speechEndMs: 5_750, endMs: 6_650, pauseAfterMs: 900 },
      { segmentId: 'scene_3', startMs: 6_650, speechEndMs: 8_450, endMs: 8_450, pauseAfterMs: 0 },
    ]);
  });
});

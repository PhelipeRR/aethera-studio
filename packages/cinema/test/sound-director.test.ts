import { describe, expect, it } from 'vitest';
import {
  assertSoundDirectorApproval,
  auditAudioTimeline,
  SoundDirectorBlockedError,
  type AudioTimelineEvent,
} from '../src/audio/sound-director.js';

describe('@neuralbridge/cinema — Sound Director & Audio Timeline Audit', () => {
  it('approves consecutive narrations with clean breathing gap and ducked music', () => {
    const events: AudioTimelineEvent[] = [
      {
        sourceId: 'nar_01',
        sceneId: 'scene_01',
        bus: 'A1_narration',
        role: 'narration',
        startMs: 250,
        endMs: 4200,
        gainDb: 0,
        priority: 100,
      },
      {
        sourceId: 'nar_02',
        sceneId: 'scene_02',
        bus: 'A1_narration',
        role: 'narration',
        startMs: 4600,
        endMs: 8500,
        gainDb: 0,
        priority: 100,
      },
      {
        sourceId: 'music_01',
        sceneId: 'global',
        bus: 'A3_music',
        role: 'music',
        startMs: 0,
        endMs: 10000,
        gainDb: -16,
        priority: 40,
        duckedUnderSpeech: true,
      },
    ];

    const report = auditAudioTimeline(events, 10000);
    expect(report.approved).toBe(true);
    expect(report.conflicts).toHaveLength(0);
    expect(report.busesSummary.A1_narration.eventCount).toBe(2);
    expect(report.busesSummary.A3_music.eventCount).toBe(1);
    expect(() => assertSoundDirectorApproval(report)).not.toThrow();
  });

  it('blocks final render when two narrations overlap', () => {
    const events: AudioTimelineEvent[] = [
      {
        sourceId: 'nar_03',
        sceneId: 'scene_03',
        bus: 'A1_narration',
        role: 'narration',
        startMs: 18000,
        endMs: 23250,
        gainDb: 0,
        priority: 100,
      },
      {
        sourceId: 'nar_04',
        sceneId: 'scene_04',
        bus: 'A1_narration',
        role: 'narration',
        startMs: 22950,
        endMs: 28390,
        gainDb: 0,
        priority: 100,
      },
    ];

    const report = auditAudioTimeline(events, 60600);
    expect(report.approved).toBe(false);
    expect(report.conflicts.some((c) => c.type === 'narration_overlap' && c.severity === 'critical')).toBe(true);
    expect(() => assertSoundDirectorApproval(report)).toThrow(SoundDirectorBlockedError);
  });

  it('blocks when narration is longer than total video duration (truncation risk)', () => {
    const events: AudioTimelineEvent[] = [
      {
        sourceId: 'nar_10_outro',
        sceneId: 'scene_10',
        bus: 'A1_narration',
        role: 'narration',
        startMs: 56950,
        endMs: 63160,
        gainDb: 0,
        priority: 100,
      },
    ];

    const report = auditAudioTimeline(events, 60600);
    expect(report.approved).toBe(false);
    expect(report.conflicts.some((c) => c.type === 'narration_truncated' && c.severity === 'critical')).toBe(true);
  });

  it('blocks when gameplay dialogue (A2) overlaps primary narration (A1)', () => {
    const events: AudioTimelineEvent[] = [
      {
        sourceId: 'nar_01',
        sceneId: 'scene_01',
        bus: 'A1_narration',
        role: 'narration',
        startMs: 1000,
        endMs: 5000,
        gainDb: 0,
        priority: 100,
      },
      {
        sourceId: 'gameplay_npc_01',
        sceneId: 'scene_01',
        bus: 'A2_gameplay_dialogue',
        role: 'gameplay_dialogue',
        startMs: 3200,
        endMs: 4800,
        gainDb: -3,
        priority: 90,
      },
    ];

    const report = auditAudioTimeline(events, 8000);
    expect(report.approved).toBe(false);
    expect(report.conflicts.some((c) => c.type === 'narration_vs_gameplay_dialogue')).toBe(true);
  });

  it('flags loud simultaneous SFX and tight transition gaps as warnings', () => {
    const events: AudioTimelineEvent[] = [
      {
        sourceId: 'nar_01',
        sceneId: 'scene_01',
        bus: 'A1_narration',
        role: 'narration',
        startMs: 250,
        endMs: 4000,
        gainDb: 0,
        priority: 100,
      },
      {
        sourceId: 'nar_02',
        sceneId: 'scene_02',
        bus: 'A1_narration',
        role: 'narration',
        startMs: 4080,
        endMs: 7500,
        gainDb: 0,
        priority: 100,
      },
      {
        sourceId: 'sfx_boom',
        sceneId: 'scene_01',
        bus: 'A4_sfx',
        role: 'sfx',
        startMs: 2000,
        endMs: 2400,
        gainDb: -2,
        priority: 70,
      },
    ];

    const report = auditAudioTimeline(events, 9000, { minNarrationGapMs: 200 });
    expect(report.approved).toBe(true);
    expect(report.conflicts.some((c) => c.type === 'narration_tight_gap')).toBe(true);
    expect(report.conflicts.some((c) => c.type === 'sfx_masking_speech')).toBe(true);
  });
});

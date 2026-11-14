import { describe, expect, it } from 'vitest';
import type { SfxEvent } from '../src/aethera-audio.js';
import { buildContextualMusicPrompt, computeAdaptiveDucking, selectContextualMusicTrack } from '../src/aethera-music-director.js';
import type { TimelineDocument } from '../src/aethera-timeline.js';

function makeTimeline(label: string): TimelineDocument {
  return {
    schemaVersion: 1,
    id: 'tl-music-1',
    runId: '11111111-1111-4111-8111-111111111111',
    version: 1,
    fps: 30,
    durationMs: 25_000,
    format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 54 } },
    audio: { targetLufs: -16, truePeakDb: -1.5, stems: { narration: 0, music: -14, sfx: -6 }, musicDuckDb: -12, duck: { attackMs: 40, releaseMs: 120 } },
    tracks: [
      { id: 'graphics', kind: 'graphics', hidden: false, muted: false, locked: false, items: [{ id: 'g1', startMs: 0, durationMs: 5000, sceneIds: ['s1'], label, intent: { reason: 'diagrama do diretor' }, source: { kind: 'graphic', component: 'title', props: {} }, transform: { x: 0, y: 0, scale: 1, rotation: 0, fit: 'cover' }, keyframes: [], effects: [] }] },
      { id: 'captions', kind: 'captions', hidden: false, muted: false, locked: false, items: [{ id: 'c1', startMs: 1000, durationMs: 4000, sceneIds: ['s1'], source: { kind: 'text', text: 'Um dois', words: [{ text: 'Um', startMs: 0, endMs: 400 }, { text: 'dois', startMs: 3000, endMs: 3500 }] }, transform: { x: 0, y: 0, scale: 1, rotation: 0, fit: 'cover' }, keyframes: [], effects: [] }] },
    ],
  } as unknown as TimelineDocument;
}

describe('aethera music director (SD-2.3)', () => {
  it('builds contextual ACE-Step prompt from timeline mood and duration', () => {
    const prompt = buildContextualMusicPrompt(makeTimeline('Buraco negro no cosmos'));
    expect(prompt.genre).toBe('ambient orchestral');
    expect(prompt.bpm).toBe(84);
    expect(prompt.durationMs).toBe(25_000);
    expect(prompt.prompt).toContain('ambient orchestral');
  });

  it('selects best matching track from local library', () => {
    const track = selectContextualMusicTrack(makeTimeline('Cyberpunk neon tech'), [
      { id: 't1', relativePath: 'a.wav', sha256: 'a'.repeat(64), durationMs: 25_000, bpm: 80, mood: ['ambient'], license: { name: 'CC0', source: 'https://example.org', evidence: 'ok', scope: 'não comercial', expiresAt: null }, importedAt: '2026-11-13T00:00:00Z' },
      { id: 't2', relativePath: 'b.wav', sha256: 'b'.repeat(64), durationMs: 25_000, bpm: 118, mood: ['cinematic', 'electronic', 'tensão'], license: { name: 'CC0', source: 'https://example.org', evidence: 'ok', scope: 'não comercial', expiresAt: null }, importedAt: '2026-11-13T00:00:00Z' },
    ]);
    expect(track?.id).toBe('t2');
  });

  it('applies adaptive ducking when SFX density is high', () => {
    const sfx: SfxEvent[] = [
      { id: 's1', sfxId: 'whoosh', relativePath: 'w.wav', atMs: 1000, durationMs: 300, frame: 30, gainDb: -6, licenseEvidence: 'ok' },
      { id: 's2', sfxId: 'impacto', relativePath: 'i.wav', atMs: 1400, durationMs: 400, frame: 42, gainDb: -6, licenseEvidence: 'ok' },
    ];
    const envelopes = computeAdaptiveDucking({ timeline: makeTimeline('Buraco negro'), sfxEvents: sfx });
    expect(envelopes[0]?.gainDb).toBe(-15);
    expect(envelopes[1]?.gainDb).toBe(-12);
  });
});

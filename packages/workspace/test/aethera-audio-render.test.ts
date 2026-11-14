import { describe, expect, it } from 'vitest';
import { buildAetheraAudioFilter } from '../src/aethera-audio-render.js';
import type { AetheraAudioPlan } from '@neuralbridge/shared';

describe('aethera audio mastering filter (SD-2.3)', () => {
  it('includes aresample, alimiter and EBU R128 loudnorm in the filter graph', () => {
    const plan: AetheraAudioPlan = {
      schemaVersion: 1,
      timelineId: 'tl-1',
      targetLufs: -16,
      truePeakDb: -1.5,
      narrationGainDb: 0,
      music: { kind: 'library', trackId: 't1', license: { name: 'CC0', source: 'https://example.org', evidence: 'ok', scope: 'não comercial', expiresAt: null } },
      musicGainDb: -14,
      ducking: [{ startMs: 0, endMs: 1000, gainDb: -12, attackMs: 40, releaseMs: 120, sourceWord: 'Olá' }],
      sfx: [{ id: 'sfx-1', sfxId: 'tac', relativePath: '/sfx/tac.wav', atMs: 500, durationMs: 200, frame: 15, gainDb: -6, licenseEvidence: 'ok' }],
      rationale: 'teste',
    };

    const graph = buildAetheraAudioFilter(plan, true);
    const joined = graph.filters.join(';');
    expect(joined).toContain('aresample=48000');
    expect(joined).toContain('alimiter=limit=');
    expect(joined).toContain('loudnorm=I=-16:TP=-1.5:LRA=7');
  });
});

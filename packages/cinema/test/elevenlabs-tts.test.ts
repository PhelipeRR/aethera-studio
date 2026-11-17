import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { synthesizeElevenLabsWavWithTimestamps, wordsFromElevenLabsAlignment } from '../src/render/elevenlabs-tts.js';

describe('ElevenLabs timestamped TTS contract', () => {
  it('converts character alignment into word timestamps without estimating cadence', () => {
    expect(wordsFromElevenLabsAlignment({
      characters: ['O', 'l', 'á', ' ', 'm', 'u', 'n', 'd', 'o'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9],
    })).toEqual([
      { text: 'Olá', startMs: 0, endMs: 300 },
      { text: 'mundo', startMs: 400, endMs: 900 },
    ]);
  });

  it('parses a real provider-shaped response and writes a valid WAV', async () => {
    const out = 'artifacts/aethera-p3-smart-captions/acceptance/elevenlabs-timestamped-fixture.wav';
    const response = {
      audio_base64: Buffer.alloc(2_048, 7).toString('base64'),
      alignment: {
        characters: ['O', 'i'],
        character_start_times_seconds: [0, 0.1],
        character_end_times_seconds: [0.1, 0.2],
      },
    };
    const result = await synthesizeElevenLabsWavWithTimestamps({
      apiKey: 'test-key',
      voiceId: 'test-voice',
      text: 'Oi',
      outWavPath: out,
      fetch: async () => new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    expect(result.words).toEqual([{ text: 'Oi', startMs: 0, endMs: 200 }]);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out).subarray(0, 4).toString('ascii')).toBe('RIFF');
  });
});

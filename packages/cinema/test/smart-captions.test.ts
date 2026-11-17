import { describe, expect, it } from 'vitest';
import { compileSmartCaptions } from '../src/captions/smart-captions.js';

describe('smart captions', () => {
  it('groups measured words by pause and word limit while preserving the final word', () => {
    const result = compileSmartCaptions({
      words: [
        { text: 'Night', startMs: 100, endMs: 420 },
        { text: 'City', startMs: 450, endMs: 760 },
        { text: 'never', startMs: 1_500, endMs: 1_820 },
        { text: 'sleeps', startMs: 1_850, endMs: 2_240 },
      ],
      durationMs: 2_500,
      width: 1920,
      height: 1080,
      safeArea: { top: 64, right: 96, bottom: 96, left: 96 },
      style: 'game',
      keywords: ['City'],
      maxWordsPerCue: 2,
    });

    expect(result.cues.map((cue) => cue.text)).toEqual(['Night City', 'never sleeps']);
    expect(result.cues.at(-1)?.endMs).toBe(2_240);
    expect(result.coverage.endMs).toBe(2_240);
    expect(result.ass).toContain('Night ');
    expect(result.ass).toContain('City');
    expect(result.ass).toContain('\\c&H');
  });

  it('escapes ASS control characters and uses the configured safe area', () => {
    const result = compileSmartCaptions({
      words: [{ text: '{hack}\\line', startMs: 0, endMs: 500 }],
      durationMs: 800,
      width: 1280,
      height: 720,
      safeArea: { top: 40, right: 40, bottom: 80, left: 40 },
      style: 'anime',
    });

    expect(result.ass).toContain(',40,40,80,1');
    expect(result.ass).toContain('\\{hack\\}\\\\line');
    expect(result.ass).not.toContain('{hack}\\line');
  });

  it('rejects non-monotonic or out-of-range word timings', () => {
    expect(() => compileSmartCaptions({
      words: [{ text: 'bad', startMs: 900, endMs: 400 }],
      durationMs: 1_000,
      width: 1920,
      height: 1080,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      style: 'geek',
    })).toThrow(/timing/i);
  });
});

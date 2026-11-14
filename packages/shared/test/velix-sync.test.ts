import { describe, expect, it } from 'vitest';
import { type SpokenWord, type StoryboardScene, alignWords, narrationBlocks, portugueseNumber, storyboardNarration, syncScenes, textKey } from '../src/index.js';

const scene = (id: string, narration: string, startMs: number, endMs: number): StoryboardScene => ({ id, chapter: null, narration, startMs, endMs, claimIds: [], visualObjective: '', sceneType: 'broll', searchTerms: [], visual: { type: 'fallback', kind: 'typography', reason: '' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending' });
/** Words spoken one after another, `step` seconds each, starting at `from`. */
const speak = (text: string, from: number, step = 0.4): SpokenWord[] => text.split(/\s+/).map((w, index) => ({ w: w.replace(/[.,!?]/g, ''), s: from + index * step, e: from + index * step + step * 0.9 }));

describe('narration blocks', () => {
  it('groups whole scenes under the character limit and keys them by text', () => {
    const scenes = [scene('a', 'x'.repeat(300), 0, 1), scene('b', 'y'.repeat(300), 1, 2), scene('c', 'z'.repeat(300), 2, 3)];
    const blocks = narrationBlocks(scenes, 650);
    expect(blocks.map((block) => block.sceneIds)).toEqual([['a', 'b'], ['c']]);
    expect(blocks[0]?.key).toBe(textKey(`${'x'.repeat(300)} ${'y'.repeat(300)}`));
    expect(textKey('mesmo texto')).toBe(textKey('mesmo texto'));
    expect(textKey('mesmo texto')).not.toBe(textKey('mesmo texto!'));
    expect(() => narrationBlocks([scene('d', 'w'.repeat(700), 0, 1)], 650)).toThrow(/divida a cena/);
  });
});

describe('sync', () => {
  const first = 'O sol nasce cedo no sertão.';
  const second = 'Os painéis começam a gerar energia logo depois.';
  const third = 'À noite as baterias seguram a casa.';
  const scenes = [scene('a', first, 0, 2_000), scene('b', second, 2_000, 5_000), scene('c', third, 5_000, 8_000)];

  it('puts every scene on the real clock, contiguous from 0 to the audio length, with timed phrases', () => {
    const spoken = [...speak(first, 0.2), ...speak(second, 4.5), ...speak(third, 9)];
    const aligned = alignWords(scenes, spoken);
    const { scenes: timed, phrases, report } = syncScenes(scenes, aligned, spoken, 12_000);
    expect(timed.map((item) => [item.startMs, item.endMs])).toEqual([[0, 4_500], [4_500, 9_000], [9_000, 12_000]]);
    expect(report).toMatchObject({ matched: aligned.length, ratio: 1, blocking: false, missing: [] });
    expect(phrases.map((phrase) => [phrase.sceneId, phrase.startMs])).toEqual([['a', 200], ['b', 4_500], ['c', 9_000]]);
    // 1,5 s+ between the end of one scene's words and the next.
    expect(report.pauses.length).toBeGreaterThanOrEqual(1);
    expect(report.issues.some((issue) => issue.code === 'long_pause')).toBe(true);
  });

  it('reports missing words and an unrecognized scene instead of guessing silently, and blocks on low coverage', () => {
    const spoken = [...speak(first, 0), ...speak('Os painéis gerar energia logo depois', 2.4), ...speak('ruído', 6)];
    const aligned = alignWords(scenes, spoken);
    const { scenes: timed, report } = syncScenes(scenes, aligned, spoken, 9_000);
    expect(report.missing.find((item) => item.sceneId === 'b')?.words).toEqual(['começam', 'a']);
    expect(report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['low_coverage', 'missing_words', 'unmatched_scene']));
    expect(report.blocking).toBe(true);
    // The unrecognized last scene is placed after the previous one and ends at the audio end.
    expect(timed[2]?.startMs).toBeGreaterThan(timed[1]?.startMs ?? 0);
    expect(timed[2]?.endMs).toBe(9_000);
  });

  it('tolerates a word the recognizer added and keeps times monotonic', () => {
    const spoken = [...speak('O sol nasce hum cedo no sertão', 0), ...speak(second, 3), ...speak(third, 6)];
    const { scenes: timed, report } = syncScenes(scenes, alignWords(scenes, spoken), spoken, 9_000);
    expect(report.ratio).toBe(1);
    timed.slice(1).forEach((item, index) => expect(item.startMs).toBeGreaterThan(timed[index]?.startMs ?? -1));
    expect(storyboardNarration(scenes)).toBe(`${first} ${second} ${third}`);
  });
});

describe('spoken forms of what the transcriber writes as digits or acronyms', () => {
  it('reads integers the way the narration spells them in Portuguese', () => {
    expect(portugueseNumber(2077)).toBe('dois mil e setenta e sete');
    expect(portugueseNumber(2027)).toBe('dois mil e vinte e sete');
    expect(portugueseNumber(100)).toBe('cem');
    expect(portugueseNumber(150)).toBe('cento e cinquenta');
    expect(portugueseNumber(1000)).toBe('mil');
    expect(portugueseNumber(2150)).toBe('dois mil cento e cinquenta');
    expect(portugueseNumber(2100)).toBe('dois mil e cem');
    expect(portugueseNumber(16)).toBe('dezesseis');
    expect(portugueseNumber(0)).toBe('zero');
  });

  it('reads a one-word number as that word, so "3 jogos, Três jeitos" does not skip to the second "Três" (Voz C, E3)', () => {
    const scenes = [{ id: 'a', narration: 'Três jogos. Três jeitos diferentes.' }];
    const spoken: SpokenWord[] = [{ w: '3', s: 0.091, e: 0.21 }, { w: 'jogos,', s: 0.211, e: 0.59 }, { w: 'Três', s: 1.199, e: 1.346 }, { w: 'jeitos', s: 1.347, e: 1.543 }, { w: 'diferentes.', s: 1.544, e: 2.179 }];
    expect(alignWords(scenes, spoken).map((word) => [word.word, word.startMs])).toEqual([['Três', 91], ['jogos.', 211], ['Três', 1_199], ['jeitos', 1_347], ['diferentes.', 1_544]]);
  });

  it('aligns "Cyberpunk dois mil e setenta e sete" and "efe tê cê" with "Cyberpunk 2077" and "FTC", splitting the time', () => {
    const scenes = [{ id: 'a', narration: 'Em Cyberpunk dois mil e setenta e sete, segundo a efe tê cê.' }];
    const spoken: SpokenWord[] = [{ w: 'Em', s: 0, e: 0.2 }, { w: 'Cyberpunk', s: 0.2, e: 0.8 }, { w: '2077,', s: 0.8, e: 2.2 }, { w: 'segundo', s: 2.2, e: 2.6 }, { w: 'a', s: 2.6, e: 2.7 }, { w: 'FTC.', s: 2.7, e: 3.3 }];
    const aligned = alignWords(scenes, spoken);
    expect(aligned.every((word) => word.startMs !== null)).toBe(true);
    expect(aligned.find((word) => word.word === 'dois')).toMatchObject({ startMs: 800 });
    expect(aligned.find((word) => word.word === 'sete,')?.endMs).toBe(2_200);
    expect(aligned.find((word) => word.word === 'cê.')).toMatchObject({ endMs: 3_300 });
  });
});

import { describe, expect, it } from 'vitest';
import { measurePacingPauses, NARRATION_MIN_AUTO_SPEED, NARRATION_PACING_STYLES, paceCorrectionSpeed, speechWpm, narrationPacingSchema, pacingDirections, pacingPauseThresholds, planSentencePauses, sentenceTexts, startsSection } from '../src/index.js';

const scenes = [
  { id: 's1', narration: 'Três jogos. Três jeitos diferentes de prender você na tela.' },
  { id: 's2', narration: 'Mas aqui vai um aviso honesto.' },
  { id: 's3', narration: 'Segundo eixo: o combate. Aqui a régua é o controle.' },
  { id: 's4', narration: 'Pegue os três jogos e tire sua própria conclusão.' },
];

describe('narration pacing (E2)', () => {
  it('offers pacing styles as data; the documentary style is the reference of this demonstration, not a universal rule', () => {
    const documentary = narrationPacingSchema.parse(NARRATION_PACING_STYLES.documentary);
    expect(documentary.targetWpm).toEqual({ min: 145, max: 170, block: 185 });
    expect(Object.keys(NARRATION_PACING_STYLES)).toEqual(expect.arrayContaining(['documentary', 'conversational', 'energetic']));
    expect(NARRATION_PACING_STYLES.energetic.targetWpm.max).toBeGreaterThan(documentary.targetWpm.max);
  });

  it('pauses after every scene, longer before a new section, never after the last scene, and keeps manual directions', () => {
    const pacing = NARRATION_PACING_STYLES.documentary;
    const directions = pacingDirections(scenes, pacing, [{ sceneId: 's1', speed: 0.95, pauseAfterMs: 1_000 }]);
    expect(directions).toEqual([
      { sceneId: 's1', speed: 0.95, pauseAfterMs: 1_000 },
      { sceneId: 's2', pauseAfterMs: pacing.sectionPauseMs },
      { sceneId: 's3', pauseAfterMs: pacing.scenePauseMs },
    ]);
  });

  it('recognises a section heading and splits sentences without breaking numbers or abbreviations', () => {
    expect(startsSection('Segundo eixo: o combate.')).toBe(true);
    expect(startsSection('Em Cyberpunk, preste atenção na cidade: ruas e prédios.')).toBe(false);
    expect(sentenceTexts('Três jogos. Três jeitos! Qual vence? Fim')).toEqual(['Três jogos.', 'Três jeitos!', 'Qual vence?', 'Fim']);
    expect(sentenceTexts('Custa 1.5 mil reais. Depois cai.')).toEqual(['Custa 1.5 mil reais.', 'Depois cai.']);
  });

  it('widens the sentence ends found in the audio and leaves a colon its own gap (measured case of Voz C)', () => {
    // Real gaps of the Voz C block "Primeiro eixo: o mundo. …" (8685 ms): the 306 ms gap is the colon, the 158 ms one is "mundo.".
    const text = 'Primeiro eixo: o mundo. Todo jogo grande vende um lugar. A pergunta é simples. Esse lugar existe só como cenário, ou ele conta história sozinho?';
    const gaps = [{ startMs: 0, durationMs: 425 }, { startMs: 1133, durationMs: 306 }, { startMs: 1924, durationMs: 158 }, { startMs: 3586, durationMs: 185 }, { startMs: 5074, durationMs: 79 }, { startMs: 8560, durationMs: 125 }];
    const plan = planSentencePauses(text, { durationMs: 8685, gaps }, 280);
    expect(plan).toMatchObject({ boundaries: 3, matched: 3, alreadyLong: 0 });
    expect(plan.insertions.map((item) => [item.atMs, item.durationMs])).toEqual([[2003, 122], [3679, 95], [5114, 201]]);
    // The added pause is filled with the gap's own room tone, away from the word edges.
    expect(plan.insertions[0]?.fill).toEqual({ fromMs: 1944, toMs: 2062 });
  });

  it('corrects a block measured too fast towards the middle of the range, never below the floor (E1 review)', () => {
    const documentary = NARRATION_PACING_STYLES.documentary;
    // Scene 3 of the Voz C sample: 206 ppm at 1.0 → the speed for ~157 ppm is 0.76, held at the 0.9 floor (measured: below
    // it the voice flattens).
    expect(NARRATION_MIN_AUTO_SPEED).toBe(0.9);
    expect(paceCorrectionSpeed(206, 1, documentary)).toBe(0.9);
    expect(paceCorrectionSpeed(172, 1, documentary)).toBe(0.92);
    expect(paceCorrectionSpeed(165, 1, documentary)).toBeNull();
    expect(paceCorrectionSpeed(200, NARRATION_MIN_AUTO_SPEED, documentary)).toBeNull();
    // Rate over the speech only: the voice's silence before and after the block does not count.
    expect(speechWpm('um dois três quatro cinco seis', 3_000, [{ startMs: 0, durationMs: 500 }, { startMs: 2_500, durationMs: 500 }])).toBe(180);
  });

  it('keeps a gap that is already long, skips a boundary with no gap nearby and does nothing without boundaries', () => {
    const text = 'Uma frase curta aqui. Outra frase bem curta. A última frase.';
    const plan = planSentencePauses(text, { durationMs: 6_000, gaps: [{ startMs: 1_900, durationMs: 400 }] }, 280);
    expect(plan).toEqual({ insertions: [], boundaries: 2, matched: 1, alreadyLong: 1 });
    expect(planSentencePauses('Uma frase só, sem fim de frase interno.', { durationMs: 3_000, gaps: [{ startMs: 1_000, durationMs: 100 }] }, 280)).toEqual({ insertions: [], boundaries: 0, matched: 0, alreadyLong: 0 });
  });

  it('measures the silences after sentences and between scenes on the timed words, skipping untimed pairs', () => {
    const thresholds = pacingPauseThresholds(NARRATION_PACING_STYLES.documentary);
    expect(thresholds).toEqual({ sentenceMs: 250, sceneMs: 600 });
    const words = [
      { sceneId: 's1', word: 'Três', startMs: 0, endMs: 200 },
      { sceneId: 's1', word: 'jogos.', startMs: 220, endMs: 500 },
      { sceneId: 's1', word: 'Três', startMs: 600, endMs: 800 },
      { sceneId: 's1', word: 'jeitos.', startMs: 820, endMs: 1_100 },
      { sceneId: 's2', word: 'Mas', startMs: 1_800, endMs: 1_900 },
      { sceneId: 's2', word: 'aqui.', startMs: 1_950, endMs: null },
      { sceneId: 's2', word: 'Fim', startMs: 2_000, endMs: 2_200 },
    ];
    expect(measurePacingPauses(words, thresholds)).toEqual({ sentenceGaps: 1, shortSentenceGaps: 1, sceneGaps: 1, shortSceneGaps: 0, minSentenceMs: 100, minSceneMs: 700 });
  });
});

import { describe, expect, it } from 'vitest';
import {
  type ChapterDraft,
  type ScriptOutline,
  buildChapterContext,
  consolidateChapters,
  countWords,
  normalizeSentence,
  planChapters,
  PRODUCTION_TYPES,
  splitSentences,
  wordsForDuration,
} from '../src/index.js';

const outline: ScriptOutline = {
  title: 'Energia solar', canonicalSummary: 'Como a energia solar cresceu no Brasil.', entities: ['ANEEL'], terms: ['geração distribuída'], styleDecisions: ['frases curtas'],
  chapters: [1, 2, 3].map((n) => ({ n, title: `Capítulo ${n}`, beats: [`ponto ${n}`] })),
};
const draft = (n: number, narration: string, extra: Partial<ChapterDraft> = {}): ChapterDraft => ({ n, title: `Capítulo ${n}`, narration, summary: `resumo ${n}`, facts: [`fato ${n}`], entities: [], ...extra });

describe('long script planning', () => {
  it('splits 3.000+ words into balanced chapters within the per-call limit', () => {
    const plan = planChapters(3_200);
    expect(plan).toHaveLength(5);
    expect(plan.reduce((sum, item) => sum + item.targetWords, 0)).toBe(3_200);
    expect(Math.max(...plan.map((item) => item.targetWords)) - Math.min(...plan.map((item) => item.targetWords))).toBeLessThanOrEqual(1);
    expect(planChapters(5_000, 500)).toHaveLength(10);
    expect(planChapters(300)).toEqual([{ n: 1, targetWords: 300 }]);
    expect(() => planChapters(0)).toThrow(/inválida/);
  });

  it('derives word targets from duration and pace and keeps a type catalog', () => {
    expect(wordsForDuration(20 * 60, 'standard').estimate).toBe(2_900);
    expect(wordsForDuration(60, 'slow').estimate).toBeLessThan(wordsForDuration(60, 'fast').estimate);
    expect(Object.keys(PRODUCTION_TYPES)).toEqual(expect.arrayContaining(['documentary', 'explainer', 'news', 'tutorial']));
  });

  it('gives each chapter the canonical summary, previous summaries, the previous ending and the next beats', () => {
    const context = buildChapterContext(outline, [draft(1, 'Primeira frase do vídeo. Final do capítulo um.', { entities: ['Itaipu'] })], 2);
    expect(context.canonicalSummary).toBe(outline.canonicalSummary);
    expect(context.previousSummaries).toEqual(['1. Capítulo 1: resumo 1']);
    expect(context.previousEnding).toContain('Final do capítulo um.');
    expect(context.entities).toEqual(['ANEEL', 'Itaipu']);
    expect(context.currentBeats).toEqual(['ponto 2']);
    expect(context.nextBeats).toEqual(['ponto 3']);
    expect(() => buildChapterContext(outline, [], 9)).toThrow(/esboço/);
  });
});

describe('consolidation', () => {
  const repeated = 'A energia solar já responde por uma parte grande da matriz elétrica.';
  it('removes a sentence repeated in a later chapter and keeps short ordinary phrasing', () => {
    const result = consolidateChapters({ title: 'T', drafts: [draft(2, `Mas não é só isso. ${repeated.toUpperCase()} Novo ponto do capítulo dois aqui.`), draft(1, `${repeated} Mas não é só isso.`)] });
    expect(result.chapters.map((chapter) => chapter.n)).toEqual([1, 2]);
    expect(result.removedRepetitions).toEqual([{ chapter: 2, sentence: repeated.toUpperCase(), firstSeenIn: 1 }]);
    expect(result.chapters[1]?.narration).toBe('Mas não é só isso. Novo ponto do capítulo dois aqui.');
    expect(result.words).toBe(countWords(result.narration));
  });

  it('never rewrites an approved chapter: the repetition is reported instead', () => {
    const result = consolidateChapters({ title: 'T', drafts: [draft(1, repeated), draft(2, `${repeated} Outra coisa importante para dizer agora.`)], locked: [2] });
    expect(result.removedRepetitions).toHaveLength(0);
    expect(result.chapters[1]?.narration).toContain(repeated);
    expect(result.issues.map((issue) => issue.code)).toContain('locked_repetition');
  });

  it('reports missing, duplicated and off-target chapters', () => {
    const result = consolidateChapters({ title: 'T', drafts: [draft(1, 'um dois três quatro cinco seis sete oito nove dez.'), draft(1, 'outra versão do um com palavras suficientes aqui.')], plan: [{ n: 1, targetWords: 100 }, { n: 2, targetWords: 100 }] });
    expect(result.issues.map((issue) => issue.code).sort()).toEqual(['duplicate_chapter', 'missing_chapter', 'words_off_target']);
  });

  it('normalizes and splits sentences', () => {
    expect(normalizeSentence('  Ação, já!  ')).toBe('acao ja');
    expect(splitSentences('Um. Dois?  Três! Quatro…')).toEqual(['Um.', 'Dois?', 'Três!', 'Quatro…']);
  });
});

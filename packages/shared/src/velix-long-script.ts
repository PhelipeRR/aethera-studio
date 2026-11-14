import { z } from 'zod';

/**
 * Long scripts for an autonomous Velix production: what kind of video it is, how many words it needs, how it is split
 * into chapters, what each chapter sees of the others and how the chapters become one script without repetition.
 * Everything here is pure; the agent calls live in the orchestrator.
 */

export const PRODUCTION_TYPES = {
  documentary: { label: 'Documentário', tone: 'sóbrio e investigativo', structure: 'contexto, desenvolvimento por eixos, consequências e fechamento', pace: 'standard' },
  explainer: { label: 'Explicativo', tone: 'didático e direto', structure: 'pergunta central, conceitos em ordem crescente, exemplo concreto e resumo', pace: 'standard' },
  news: { label: 'Noticiário', tone: 'objetivo, com atribuição de fontes', structure: 'fato principal, contexto, reações, o que ainda não se sabe', pace: 'fast' },
  ranking: { label: 'Ranking / lista', tone: 'envolvente', structure: 'critério declarado, itens do último ao primeiro, desfecho no primeiro lugar', pace: 'fast' },
  commentary: { label: 'Comentário', tone: 'opinativo e marcado como opinião', structure: 'tese, argumentos com evidência, contra-argumento e conclusão', pace: 'standard' },
  tutorial: { label: 'Tutorial', tone: 'prático e passo a passo', structure: 'resultado esperado, pré-requisitos, passos numerados, erros comuns', pace: 'slow' },
  story: { label: 'História narrada', tone: 'narrativo', structure: 'situação inicial, conflito, virada e desfecho', pace: 'standard' },
} as const satisfies Record<string, { label: string; tone: string; structure: string; pace: 'slow' | 'standard' | 'fast' }>;
export type ProductionTypeId = keyof typeof PRODUCTION_TYPES;
export const productionTypeIds = Object.keys(PRODUCTION_TYPES) as ProductionTypeId[];

/** Above this the script is written chapter by chapter; at or below it a single Dossiê v1 call is enough. */
export const LONG_SCRIPT_THRESHOLD_WORDS = 2_000;
/** One chapter per call stays well inside the per-call limit (12.000 characters ≈ 1.900 words). */
export const DEFAULT_CHAPTER_WORDS = 700;
export const MAX_CHAPTERS = 60;
/** A chapter outside this ratio of its target is reported, not silently stretched. */
export const CHAPTER_WORD_TOLERANCE = 0.3;

export function countWords(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  return words.length;
}

export interface ChapterPlanItem { n: number; targetWords: number }
/** How many chapters and how many words each: the remainder is spread so no chapter is a tiny tail. */
export function planChapters(targetWords: number, chapterWords = DEFAULT_CHAPTER_WORDS): ChapterPlanItem[] {
  if (!Number.isFinite(targetWords) || targetWords <= 0) throw new Error('invalid: meta de palavras inválida.');
  const size = Math.max(150, Math.min(1_500, Math.round(chapterWords)));
  const count = Math.min(MAX_CHAPTERS, Math.max(1, Math.round(targetWords / size)));
  const base = Math.floor(targetWords / count);
  const extra = Math.round(targetWords) - base * count;
  return Array.from({ length: count }, (_, index) => ({ n: index + 1, targetWords: base + (index < extra ? 1 : 0) }));
}

const shortText = (max: number) => z.string().trim().min(1).max(max);
export const scriptOutlineSchema = z.object({
  title: shortText(160),
  canonicalSummary: shortText(2_000),
  entities: z.array(shortText(120)).max(60).default([]),
  terms: z.array(shortText(120)).max(60).default([]),
  styleDecisions: z.array(shortText(240)).max(20).default([]),
  chapters: z.array(z.object({ n: z.number().int().positive(), title: shortText(120), beats: z.array(shortText(300)).min(1).max(12) })).min(1).max(MAX_CHAPTERS),
});
export type ScriptOutline = z.infer<typeof scriptOutlineSchema>;

export const chapterDraftSchema = z.object({
  n: z.number().int().positive(),
  title: shortText(120),
  narration: z.string().trim().min(20).max(12_000),
  summary: shortText(800),
  facts: z.array(shortText(300)).max(40).default([]),
  entities: z.array(shortText(120)).max(40).default([]),
});
export type ChapterDraft = z.infer<typeof chapterDraftSchema>;

export const SCRIPT_OUTLINE_JSON_SCHEMA = {
  type: 'object',
  required: ['title', 'canonicalSummary', 'chapters'],
  properties: {
    title: { type: 'string' }, canonicalSummary: { type: 'string' }, entities: { type: 'array', items: { type: 'string' } }, terms: { type: 'array', items: { type: 'string' } }, styleDecisions: { type: 'array', items: { type: 'string' } },
    chapters: { type: 'array', items: { type: 'object', required: ['n', 'title', 'beats'], properties: { n: { type: 'integer' }, title: { type: 'string' }, beats: { type: 'array', items: { type: 'string' } } } } },
  },
} as const;
export const CHAPTER_DRAFT_JSON_SCHEMA = {
  type: 'object',
  required: ['n', 'title', 'narration', 'summary'],
  properties: { n: { type: 'integer' }, title: { type: 'string' }, narration: { type: 'string' }, summary: { type: 'string' }, facts: { type: 'array', items: { type: 'string' } }, entities: { type: 'array', items: { type: 'string' } } },
} as const;

/** What a chapter call sees: the canonical summary and the shared vocabulary, the end of what came before and what comes next. */
export interface ChapterContext {
  canonicalSummary: string;
  entities: string[];
  terms: string[];
  facts: string[];
  styleDecisions: string[];
  previousSummaries: string[];
  previousEnding: string;
  currentBeats: string[];
  nextBeats: string[];
}

const PREVIOUS_SUMMARIES = 4;
const MAX_CONTEXT_FACTS = 40;
const ENDING_WORDS = 80;

export function buildChapterContext(outline: ScriptOutline, drafts: readonly ChapterDraft[], n: number): ChapterContext {
  const chapter = outline.chapters.find((item) => item.n === n);
  if (!chapter) throw new Error(`invalid: o capítulo ${n} não está no esboço.`);
  const before = drafts.filter((draft) => draft.n < n).sort((a, b) => a.n - b.n);
  const last = before.at(-1);
  const unique = (items: string[]) => [...new Map(items.map((item) => [normalizeSentence(item), item])).values()];
  return {
    canonicalSummary: outline.canonicalSummary,
    entities: unique([...outline.entities, ...before.flatMap((draft) => draft.entities)]).slice(0, 80),
    terms: outline.terms,
    facts: unique(before.flatMap((draft) => draft.facts)).slice(-MAX_CONTEXT_FACTS),
    styleDecisions: outline.styleDecisions,
    previousSummaries: before.slice(-PREVIOUS_SUMMARIES).map((draft) => `${draft.n}. ${draft.title}: ${draft.summary}`),
    previousEnding: last ? last.narration.split(/\s+/u).slice(-ENDING_WORDS).join(' ') : '',
    currentBeats: chapter.beats,
    nextBeats: outline.chapters.find((item) => item.n === n + 1)?.beats ?? [],
  };
}

/** Case, accents, punctuation and spacing do not make a sentence new. */
export function normalizeSentence(sentence: string): string {
  return sentence.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function splitSentences(text: string): string[] {
  return text.replace(/\s+/gu, ' ').trim().split(/(?<=[.!?…])\s+(?=\S)/u).filter(Boolean);
}

/** Repeated sentences shorter than this are ordinary phrasing ("Mas não é só isso."), not repetition. */
const MIN_REPEAT_WORDS = 6;

export interface ConsolidatedChapter { n: number; title: string; narration: string; words: number; targetWords: number | null; locked: boolean }
export interface ScriptIssue { code: 'missing_chapter' | 'duplicate_chapter' | 'locked_repetition' | 'words_off_target' | 'empty_chapter'; chapter: number; message: string }
export interface ConsolidatedScript {
  title: string;
  narration: string;
  chapters: ConsolidatedChapter[];
  words: number;
  removedRepetitions: Array<{ chapter: number; sentence: string; firstSeenIn: number }>;
  issues: ScriptIssue[];
}

/**
 * Turns chapter drafts into one script. A sentence already said in an earlier chapter is removed from the later one,
 * unless the later chapter was approved (locked): an approved chapter is never rewritten silently, so the repetition
 * is reported instead.
 */
export function consolidateChapters(input: { title: string; drafts: readonly ChapterDraft[]; plan?: readonly ChapterPlanItem[]; locked?: readonly number[] }): ConsolidatedScript {
  const locked = new Set(input.locked ?? []);
  const issues: ScriptIssue[] = [];
  const byNumber = new Map<number, ChapterDraft>();
  for (const draft of input.drafts) {
    if (byNumber.has(draft.n)) issues.push({ code: 'duplicate_chapter', chapter: draft.n, message: `O capítulo ${draft.n} veio duas vezes; ficou a primeira versão.` });
    else byNumber.set(draft.n, draft);
  }
  for (const item of input.plan ?? []) if (!byNumber.has(item.n)) issues.push({ code: 'missing_chapter', chapter: item.n, message: `O capítulo ${item.n} ainda não foi escrito.` });
  const seen = new Map<string, number>();
  const removedRepetitions: ConsolidatedScript['removedRepetitions'] = [];
  const chapters: ConsolidatedChapter[] = [];
  for (const draft of [...byNumber.values()].sort((a, b) => a.n - b.n)) {
    const kept: string[] = [];
    for (const sentence of splitSentences(draft.narration)) {
      const key = normalizeSentence(sentence);
      const first = seen.get(key);
      if (first !== undefined && countWords(key) >= MIN_REPEAT_WORDS) {
        if (locked.has(draft.n)) { issues.push({ code: 'locked_repetition', chapter: draft.n, message: `O capítulo aprovado ${draft.n} repete uma frase do capítulo ${first}.` }); kept.push(sentence); }
        else removedRepetitions.push({ chapter: draft.n, sentence, firstSeenIn: first });
        continue;
      }
      if (first === undefined) seen.set(key, draft.n);
      kept.push(sentence);
    }
    const narration = kept.join(' ');
    const words = countWords(narration);
    const targetWords = input.plan?.find((item) => item.n === draft.n)?.targetWords ?? null;
    if (!words) issues.push({ code: 'empty_chapter', chapter: draft.n, message: `O capítulo ${draft.n} ficou vazio depois de remover repetições.` });
    else if (targetWords && Math.abs(words - targetWords) / targetWords > CHAPTER_WORD_TOLERANCE) issues.push({ code: 'words_off_target', chapter: draft.n, message: `O capítulo ${draft.n} tem ${words} palavras para uma meta de ${targetWords}.` });
    chapters.push({ n: draft.n, title: draft.title, narration, words, targetWords, locked: locked.has(draft.n) });
  }
  const narration = chapters.filter((chapter) => chapter.words > 0).map((chapter) => chapter.narration).join('\n\n');
  return { title: input.title, narration, chapters, words: countWords(narration), removedRepetitions, issues };
}

/** The `script` stage's result file (`producoes/<run>/roteiro/roteiro.json`). */
export const productionScriptSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(['dossie-v1', 'chapters']),
  title: z.string(),
  targetWords: z.number().int().nonnegative(),
  words: z.number().int().nonnegative(),
  narration: z.string(),
  data: z.unknown().optional(),
  chapters: z.array(z.object({ n: z.number().int(), title: z.string(), words: z.number().int(), targetWords: z.number().int().nullable(), locked: z.boolean(), narration: z.string() })).optional(),
  removedRepetitions: z.array(z.object({ chapter: z.number().int(), sentence: z.string(), firstSeenIn: z.number().int() })).optional(),
  issues: z.array(z.object({ code: z.string(), chapter: z.number().int(), message: z.string() })).optional(),
});
export type ProductionScript = z.infer<typeof productionScriptSchema>;

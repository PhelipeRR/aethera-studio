import { z } from 'zod';
import { countWords, normalizeSentence, splitSentences } from './velix-long-script.js';
import type { StoryboardScene } from './velix-storyboard.js';

/**
 * Long narration and its synchronization: the storyboard's narration is spoken in blocks with one voice, the blocks are
 * joined and measured, and the spoken words put every scene on the real clock. What did not match is reported, never
 * guessed silently.
 */

/** Below VoiceStudio's 4.096-character limit per request, with room for punctuation the engine adds. */
export const NARRATION_BLOCK_CHARS = 3_500;
/** A silence longer than this between two spoken words is a pause worth reviewing. */
export const LONG_PAUSE_MS = 1_500;
/** A scene whose real length differs from the estimate by more than this ratio is reported. */
export const SCENE_DEVIATION_RATIO = 0.35;
/** Below this share of matched words the timeline is not trustworthy and blocks the render. */
export const MIN_MATCHED_RATIO = 0.9;

/** Stable text key without node:crypto (this module also runs in the renderer): two FNV-1a passes plus the length. */
export function textKey(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code ^ (index & 0xff), 0x811c9dc5) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}-${text.length}`;
}

export interface NarrationBlock { index: number; sceneIds: string[]; text: string; key: string }

/** Groups consecutive scenes into TTS blocks without ever splitting a scene. */
export function narrationBlocks(scenes: readonly Pick<StoryboardScene, 'id' | 'narration'>[], maxChars = NARRATION_BLOCK_CHARS): NarrationBlock[] {
  const blocks: NarrationBlock[] = [];
  let ids: string[] = [];
  let parts: string[] = [];
  const flush = () => {
    if (!parts.length) return;
    const text = parts.join(' ');
    blocks.push({ index: blocks.length, sceneIds: ids, text, key: textKey(text) });
    ids = []; parts = [];
  };
  for (const scene of scenes) {
    if (scene.narration.length > maxChars) throw new Error(`invalid: a cena ${scene.id} tem mais de ${maxChars} caracteres de narração; divida a cena antes de narrar.`);
    if (parts.length && [...parts, scene.narration].join(' ').length > maxChars) flush();
    ids.push(scene.id); parts.push(scene.narration);
  }
  flush();
  return blocks;
}

/** The narration as the storyboard says it, in order: what the voice must say, and what a sync is checked against. */
export const storyboardNarration = (scenes: readonly Pick<StoryboardScene, 'narration'>[]) => scenes.map((scene) => scene.narration).join(' ');

export const narrationManifestSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.literal('voicestudio'),
  modelId: z.string().min(1),
  voiceId: z.string().min(1),
  /** The Aethera channel voice spoken with, and the persistent authorization that allowed it (absent for library voices). */
  channelVoice: z.object({ presetId: z.string().min(1), authorizationId: z.string().min(1), scope: z.enum(['noncommercial', 'commercial']), instruct: z.string(), seed: z.number().int() }).optional(),
  /** Silences inserted after scenes by the per-scene direction. */
  pauses: z.array(z.object({ afterSceneId: z.string().min(1), durationMs: z.number().int().positive() })).optional(),
  /** The pacing style that added the pauses between scenes (AP-04 E2); absent in older narrations. */
  pacingStyle: z.string().optional(),
  /** Sentence ends found in the blocks and widened to the pacing style's pause (AP-04 E2); absent in older narrations. */
  sentencePauses: z.object({ boundaries: z.number().int().nonnegative(), matched: z.number().int().nonnegative(), widened: z.number().int().nonnegative(), durationMs: z.number().int().positive() }).optional(),
  /** Blocks the pacing style found too fast and spoke again slower (AP-04 E1 review); absent when none. */
  paceAdjustments: z.array(z.object({ sceneIds: z.array(z.string().min(1)), fromSpeed: z.number(), toSpeed: z.number(), wpmBefore: z.number().int(), wpmAfter: z.number().int(), kept: z.literal('original').optional() })).optional(),
  language: z.string().nullable(),
  speed: z.number().nullable(),
  format: z.literal('wav'),
  storyboardVersion: z.number().int().positive(),
  narrationKey: z.string().min(1),
  blocks: z.array(z.object({ index: z.number().int(), sceneIds: z.array(z.string()), key: z.string(), relativePath: z.string(), durationMs: z.number().int().positive() })).min(1),
  relativePath: z.string(),
  durationMs: z.number().int().positive(),
});
export type NarrationManifest = z.infer<typeof narrationManifestSchema>;

export interface SpokenWord { w: string; s: number; e: number }
const token = (word: string) => normalizeSentence(word).replace(/\s+/gu, '');

const UNITS = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function belowThousand(value: number): string {
  if (value < 20) return UNITS[value] ?? '';
  if (value < 100) { const unit = value % 10; return `${TENS[Math.floor(value / 10)]}${unit ? ` e ${UNITS[unit]}` : ''}`; }
  if (value === 100) return 'cem';
  const rest = value % 100;
  return `${HUNDREDS[Math.floor(value / 100)]}${rest ? ` e ${belowThousand(rest)}` : ''}`;
}

/**
 * An integer (0–999 999) as said in Portuguese: the narration spells numbers out for the voice ("dois mil e setenta e
 * sete") while the transcriber writes digits ("2077"). "e" joins the thousands to a remainder below 100 or a round hundred.
 */
export function portugueseNumber(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 999_999) throw new RangeError('number out of range');
  if (value < 1_000) return belowThousand(value);
  const thousands = Math.floor(value / 1_000);
  const rest = value % 1_000;
  const head = thousands === 1 ? 'mil' : `${belowThousand(thousands)} mil`;
  if (!rest) return head;
  return `${head}${rest < 100 || rest % 100 === 0 ? ' e' : ''} ${belowThousand(rest)}`;
}

const LETTERS: Record<string, string> = { a: 'a', b: 'bê', c: 'cê', d: 'dê', e: 'é', f: 'efe', g: 'gê', h: 'agá', i: 'i', j: 'jota', k: 'cá', l: 'ele', m: 'eme', n: 'ene', o: 'ó', p: 'pê', q: 'quê', r: 'erre', s: 'esse', t: 'tê', u: 'u', v: 'vê', w: 'dáblio', x: 'xis', y: 'ípsilon', z: 'zê' };

/**
 * One transcribed word as the tokens the narration may contain: digits become the Portuguese number and an acronym
 * (2–5 capitals) becomes its letter names; the word's time is split evenly between the parts.
 */
function spokenParts(word: SpokenWord): Array<{ token: string; startMs: number; endMs: number }> {
  const startMs = Math.round(word.s * 1_000);
  const endMs = Math.round(word.e * 1_000);
  const bare = word.w.replace(/[^\p{L}\p{N}]/gu, '');
  let parts: string[] | null = null;
  if (/^\d{1,6}$/u.test(bare)) parts = portugueseNumber(Number(bare)).split(' ');
  else if (/^[A-Z]{2,5}$/u.test(bare)) parts = [...bare.toLowerCase()].map((letter) => LETTERS[letter] ?? letter);
  if (!parts) return [{ token: token(word.w), startMs, endMs }];
  // A one-word number ("3" → "três") is that word, not the digit: the narration never spells digits.
  if (parts.length < 2) return [{ token: token(parts[0] ?? word.w), startMs, endMs }];
  const step = (endMs - startMs) / parts.length;
  return parts.map((part, index) => ({ token: token(part), startMs: Math.round(startMs + step * index), endMs: index === parts.length - 1 ? endMs : Math.round(startMs + step * (index + 1)) }));
}

export interface AlignedWord { sceneId: string; word: string; startMs: number | null; endMs: number | null }

/**
 * Matches the expected words, in order, to the transcribed ones. A forward window tolerates words the recognizer added or
 * dropped; an expected word not found inside it is a missing word, and the cursor does not jump past the rest.
 */
export function alignWords(scenes: readonly Pick<StoryboardScene, 'id' | 'narration'>[], spoken: readonly SpokenWord[], window = 8): AlignedWord[] {
  const heard = spoken.flatMap((word) => spokenParts(word));
  const aligned: AlignedWord[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    for (const word of scene.narration.split(/\s+/u).filter(Boolean)) {
      const wanted = token(word);
      if (!wanted) continue;
      let found = -1;
      for (let index = cursor; index < Math.min(heard.length, cursor + window); index++) {
        if (heard[index]?.token === wanted) { found = index; break; }
      }
      const match = found >= 0 ? heard[found] : undefined;
      if (match) { cursor = found + 1; aligned.push({ sceneId: scene.id, word, startMs: match.startMs, endMs: match.endMs }); }
      else aligned.push({ sceneId: scene.id, word, startMs: null, endMs: null });
    }
  }
  return aligned;
}

/**
 * Runs of consecutive expected words the recognizer did not hear, per scene (E1 review). A single missed word is the
 * recognizer's limit; a run of `minRun` or more is a stretch the voice most likely did not say — the TTS was measured
 * dropping a whole sentence — and the overall matched ratio can still look fine.
 */
export function missingWordRuns(aligned: readonly AlignedWord[], minRun = 4): Array<{ sceneId: string; words: string[] }> {
  const runs: Array<{ sceneId: string; words: string[] }> = [];
  let current: { sceneId: string; words: string[] } | null = null;
  for (const word of aligned) {
    if (word.startMs === null && current?.sceneId === word.sceneId) { current.words.push(word.word); continue; }
    if (current && current.words.length >= minRun) runs.push(current);
    current = word.startMs === null ? { sceneId: word.sceneId, words: [word.word] } : null;
  }
  if (current && current.words.length >= minRun) runs.push(current);
  return runs;
}

export interface TimedPhrase { sceneId: string; text: string; startMs: number | null; endMs: number | null }
export interface SyncIssue { code: 'missing_words' | 'unmatched_scene' | 'long_pause' | 'scene_deviation' | 'low_coverage'; sceneId: string | null; message: string; atMs?: number }
export interface SyncReport { matched: number; expected: number; ratio: number; missing: Array<{ sceneId: string; words: string[] }>; pauses: Array<{ atMs: number; durationMs: number }>; deviations: Array<{ sceneId: string; estimatedMs: number; realMs: number }>; issues: SyncIssue[]; blocking: boolean }

/**
 * Puts every scene on the real clock. A scene starts at its first matched word and ends where the next one starts, so the
 * timeline is contiguous from 0 to the audio length; a scene with no matched word is placed between its neighbours by
 * word count and reported.
 */
export function syncScenes<S extends StoryboardScene>(scenes: readonly S[], aligned: readonly AlignedWord[], spoken: readonly SpokenWord[], audioDurationMs: number): { scenes: S[]; phrases: TimedPhrase[]; report: SyncReport } {
  const firstMatch = new Map<string, number>();
  for (const word of aligned) if (word.startMs !== null && !firstMatch.has(word.sceneId)) firstMatch.set(word.sceneId, word.startMs);
  const starts: Array<number | null> = scenes.map((scene, index) => (index === 0 ? 0 : firstMatch.get(scene.id) ?? null));
  // Fill unmatched starts by interpolation on word counts between known neighbours.
  for (let index = 1; index < scenes.length; index++) {
    if (starts[index] !== null) continue;
    let next = index;
    while (next < scenes.length && starts[next] === null) next++;
    const from = starts[index - 1] ?? 0;
    const to = next < scenes.length ? (starts[next] ?? audioDurationMs) : audioDurationMs;
    const counts = scenes.slice(index - 1, next).map((scene) => countWords(scene.narration));
    const total = counts.reduce((sum, value) => sum + value, 0) || 1;
    let acc = counts[0] ?? 0;
    for (let fill = index; fill < next; fill++) { starts[fill] = Math.round(from + ((to - from) * acc) / total); acc += counts[fill - index + 1] ?? 0; }
  }
  // Monotonic: a recognizer error never makes a scene start before the previous one.
  for (let index = 1; index < starts.length; index++) starts[index] = Math.max(starts[index] ?? 0, (starts[index - 1] ?? 0) + 1);
  const timed = scenes.map((scene, index) => ({ ...scene, startMs: starts[index] ?? 0, endMs: index + 1 < scenes.length ? (starts[index + 1] ?? audioDurationMs) : Math.max(audioDurationMs, (starts[index] ?? 0) + 1) }));

  const issues: SyncIssue[] = [];
  const missing = scenes.map((scene) => ({ sceneId: scene.id, words: aligned.filter((word) => word.sceneId === scene.id && word.startMs === null).map((word) => word.word) })).filter((item) => item.words.length);
  for (const item of missing) {
    const index = scenes.findIndex((scene) => scene.id === item.sceneId) + 1;
    if (!firstMatch.has(item.sceneId)) issues.push({ code: 'unmatched_scene', sceneId: item.sceneId, message: `Cena ${index}: nenhuma palavra foi reconhecida na narração; o tempo foi estimado.` });
    else issues.push({ code: 'missing_words', sceneId: item.sceneId, message: `Cena ${index}: ${item.words.length} palavra(s) não reconhecida(s): ${item.words.slice(0, 6).join(', ')}${item.words.length > 6 ? '…' : ''}.` });
  }
  const pauses: SyncReport['pauses'] = [];
  for (let index = 1; index < spoken.length; index++) {
    const gap = Math.round(((spoken[index]?.s ?? 0) - (spoken[index - 1]?.e ?? 0)) * 1_000);
    if (gap > LONG_PAUSE_MS) { const atMs = Math.round((spoken[index - 1]?.e ?? 0) * 1_000); pauses.push({ atMs, durationMs: gap }); issues.push({ code: 'long_pause', sceneId: timed.find((scene) => scene.startMs <= atMs && atMs < scene.endMs)?.id ?? null, message: `Pausa de ${(gap / 1_000).toFixed(1)} s em ${(atMs / 1_000).toFixed(1)} s.`, atMs }); }
  }
  const deviations: SyncReport['deviations'] = [];
  scenes.forEach((scene, index) => {
    const estimatedMs = scene.endMs - scene.startMs;
    const real = timed[index];
    const realMs = real ? real.endMs - real.startMs : 0;
    if (estimatedMs > 0 && Math.abs(realMs - estimatedMs) / estimatedMs > SCENE_DEVIATION_RATIO) { deviations.push({ sceneId: scene.id, estimatedMs, realMs }); issues.push({ code: 'scene_deviation', sceneId: scene.id, message: `Cena ${index + 1}: ${(realMs / 1_000).toFixed(1)} s reais para ${(estimatedMs / 1_000).toFixed(1)} s estimados.` }); }
  });
  const matched = aligned.filter((word) => word.startMs !== null).length;
  const ratio = aligned.length ? matched / aligned.length : 0;
  const blocking = ratio < MIN_MATCHED_RATIO || issues.some((issue) => issue.code === 'unmatched_scene');
  if (ratio < MIN_MATCHED_RATIO) issues.unshift({ code: 'low_coverage', sceneId: null, message: `Só ${Math.round(ratio * 100)}% das palavras foram reconhecidas na narração (mínimo ${Math.round(MIN_MATCHED_RATIO * 100)}%).` });

  const phrases: TimedPhrase[] = [];
  for (const scene of scenes) {
    const words = aligned.filter((word) => word.sceneId === scene.id);
    let offset = 0;
    for (const sentence of splitSentences(scene.narration)) {
      const count = sentence.split(/\s+/u).filter((word) => token(word)).length;
      const slice = words.slice(offset, offset + count).filter((word) => word.startMs !== null);
      phrases.push({ sceneId: scene.id, text: sentence, startMs: slice[0]?.startMs ?? null, endMs: slice.at(-1)?.endMs ?? null });
      offset += count;
    }
  }
  return { scenes: timed, phrases, report: { matched, expected: aligned.length, ratio: Math.round(ratio * 1_000) / 1_000, missing, pauses, deviations, issues, blocking } };
}

export const syncReportSchema = z.strictObject({
  matched: z.number().int(), expected: z.number().int(), ratio: z.number(),
  missing: z.array(z.strictObject({ sceneId: z.string(), words: z.array(z.string()) })),
  pauses: z.array(z.strictObject({ atMs: z.number().int(), durationMs: z.number().int() })),
  deviations: z.array(z.strictObject({ sceneId: z.string(), estimatedMs: z.number().int(), realMs: z.number().int() })),
  issues: z.array(z.strictObject({ code: z.enum(['missing_words', 'unmatched_scene', 'long_pause', 'scene_deviation', 'low_coverage']), sceneId: z.string().nullable(), message: z.string(), atMs: z.number().int().optional() })),
  blocking: z.boolean(),
});

/** What the renderer sees of the narration and sync of a run. */
export const productionNarrationViewSchema = z.strictObject({
  manifest: narrationManifestSchema.nullable(),
  stale: z.boolean(),
  sync: z.strictObject({ storyboardVersion: z.number().int(), durationMs: z.number().int(), report: syncReportSchema }).nullable(),
});
export type ProductionNarrationView = z.infer<typeof productionNarrationViewSchema>;

import { z } from 'zod';
import { sceneNatures, textRegions, type RelevanceDecision } from './aethera-visual-analysis.js';

// AP-04 etapa 2 — shots, phrase captions and the editorial gate. Category-neutral: nothing here knows about games.

export interface TimedWord { w: string; startMs: number; endMs: number }
/** A scene's measured words; word times are relative to the scene start. `endMs` (absolute) defaults to the last word's end. */
export interface SceneWords { id: string; startMs: number; endMs?: number; words: readonly TimedWord[] }

// ---------------------------------------------------------------- captions (E3)

export interface CaptionCue { startMs: number; endMs: number; lines: string[] }
export interface CaptionOptions {
  maxLineChars: number; maxLines: number; minMs: number; maxMs: number; pauseBreakMs: number;
  /** Reading speed ceiling: a cue stays on screen into the following pause until it can be read at this rate. */
  maxCps: number;
  /** Frames of nothing between two cues, so the eye sees the change. */
  minGapMs: number;
}
export const DEFAULT_CAPTION_OPTIONS: CaptionOptions = { maxLineChars: 42, maxLines: 2, minMs: 1_200, maxMs: 6_000, pauseBreakMs: 300, maxCps: 17, minGapMs: 80 };

/**
 * Caption size (E3 review): 5.4% of the frame height — about 58 px in 1080p, still readable when a 16:9 video plays on a
 * phone — and no wider than 6% of the width, so a vertical frame does not get oversized text.
 */
export const captionFontPx = (format: { width: number; height: number }) => Math.round(Math.min(format.height * 0.054, format.width * 0.06));
/** Average glyph width of the caption face (semibold sans) in em, used to fit a line in the safe width. */
const CAPTION_GLYPH_EM = 0.52;
/** Characters per caption line that fit the frame's safe width at the caption size; 18–42. */
export const captionLineCharsFor = (format: { width: number; height: number; safeArea: { left: number; right: number } }) =>
  Math.max(18, Math.min(42, Math.floor((format.width - format.safeArea.left - format.safeArea.right) / (captionFontPx(format) * CAPTION_GLYPH_EM))));

/** Below this a cue is a flash nobody reads; only then may it join the next sentence. */
const FLASH_MS = 800;
const sentenceEnd = (word: string) => /[.!?…]["”»)]*$/u.test(word);
const clauseEnd = (word: string) => /[,;:]["”»)]*$/u.test(word);
/** Short function words (pt/en) that read badly at the end of a line or a cue: the reader waits for what they attach to. */
const FUNCTION_WORDS = new Set(['a', 'o', 'as', 'os', 'e', 'é', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'com', 'por', 'para', 'pra', 'que', 'se', 'ou', 'ao', 'à', 'the', 'a', 'an', 'of', 'to', 'and', 'in', 'on', 'or']);
const weakEnd = (text: string) => FUNCTION_WORDS.has((text.split(' ').at(-1) ?? '').toLowerCase());

/**
 * The best two-line break: balanced, preferring a break after a comma and never leaving a function word hanging at the
 * end of the first line. Null when the text cannot fit in `maxLines` lines without cutting a word.
 */
function lineBreaks(text: string, maxLineChars: number, maxLines: number): string[] | null {
  if (text.length <= maxLineChars) return [text];
  if (maxLines < 2) return null;
  const tokens = text.split(' ');
  let best: string[] | null = null;
  let bestScore = Infinity;
  for (let cut = 1; cut < tokens.length; cut += 1) {
    const first = tokens.slice(0, cut).join(' ');
    const second = tokens.slice(cut).join(' ');
    if (first.length > maxLineChars || second.length > maxLineChars) continue;
    const score = Math.abs(first.length - second.length) + (weakEnd(first) ? 20 : 0) - (clauseEnd(first) ? 10 : 0) - (sentenceEnd(first) ? 15 : 0);
    if (score < bestScore) { bestScore = score; best = [first, second]; }
  }
  return best;
}

/**
 * Phrases for reading, built from measured word times (E3): at most `maxLines` lines of `maxLineChars` without cutting a
 * word, broken at sentence ends and audible pauses, a long sentence broken after a comma when it has one, and never ending
 * on a function word. A cue stays on screen for at least `minMs` and long enough to be read at `maxCps`, borrowing the
 * following pause but never the next cue's time (`minGapMs` apart). Between cues nothing is shown — a pause never falls
 * back to the whole paragraph.
 */
export function captionCues(words: readonly TimedWord[], options: Partial<CaptionOptions> = {}): CaptionCue[] {
  const settings = { ...DEFAULT_CAPTION_OPTIONS, ...options };
  const join = (group: readonly TimedWord[]) => group.map((item) => item.w).join(' ');
  const fits = (group: readonly TimedWord[]) => lineBreaks(join(group), settings.maxLineChars, settings.maxLines) !== null;
  const groups: TimedWord[][] = [];
  let current: TimedWord[] = [];
  for (const [index, word] of words.entries()) {
    const first = current[0];
    if (first && (!fits([...current, word]) || word.endMs - first.startMs > settings.maxMs)) {
      // Break after the last comma when there is one (keeping two words on each side), else before a trailing function word.
      const comma = current.findLastIndex((item, at) => at >= 1 && at < current.length - 1 && clauseEnd(item.w));
      const cut = comma >= 0 ? comma + 1 : current.length > 2 && weakEnd(current.at(-1)?.w ?? '') ? current.length - 1 : current.length;
      groups.push(current.slice(0, cut));
      current = current.slice(cut);
      if (current.length && !fits([...current, word])) { groups.push(current); current = []; }
    }
    current.push(word);
    const next = words[index + 1];
    // A word the recognizer did not time arrives with no length (it takes the previous word's end); the silence after it
    // is really the word being said, so it never counts as a pause.
    const pause = next && word.endMs > word.startMs ? next.startMs - word.endMs : 0;
    if (sentenceEnd(word.w) || pause >= settings.pauseBreakMs) { groups.push(current); current = []; }
  }
  if (current.length) groups.push(current);
  // A cue that cannot stay `minMs` because the next one comes too soon joins it when both fit in one cue ("Primeiro eixo:"
  // + "o mundo."): a flash on screen cannot be read. Not when the joined cue would read faster than `maxCps`: a dense
  // cue is no easier than a short one, and the sentence boundary is kept.
  for (let index = 0; index < groups.length - 1; index += 1) {
    const group = groups[index] ?? [];
    const next = groups[index + 1] ?? [];
    const start = group[0]?.startMs ?? 0;
    const room = (next[0]?.startMs ?? Infinity) - settings.minGapMs - start;
    const merged = [...group, ...next];
    const mergedRoom = Math.min(settings.maxMs, (groups[index + 2]?.[0]?.startMs ?? Infinity) - settings.minGapMs - start);
    const readable = join(merged).length / (mergedRoom / 1_000) <= settings.maxCps;
    // Across a sentence end only for a real flash, and only when each sentence can keep its own line.
    const crossesSentence = sentenceEnd(group.at(-1)?.w ?? '');
    const sentencePerLine = join(group).length <= settings.maxLineChars && join(next).length <= settings.maxLineChars && settings.maxLines >= 2;
    const allowed = !crossesSentence || (room < FLASH_MS && sentencePerLine);
    if (room < settings.minMs && allowed && readable && fits(merged) && (merged.at(-1)?.endMs ?? 0) - start <= settings.maxMs) {
      groups.splice(index, 2, merged);
      index -= 1;
    }
  }
  const cues = groups.map((group) => {
    const text = join(group);
    // Two sentences joined in one cue keep one sentence per line.
    const inner = group.findIndex((word, at) => at < group.length - 1 && sentenceEnd(word.w));
    const split = inner >= 0 ? [join(group.slice(0, inner + 1)), join(group.slice(inner + 1))] : null;
    const lines = split && split.every((line) => line.length <= settings.maxLineChars) ? split : lineBreaks(text, settings.maxLineChars, settings.maxLines) ?? [text];
    return { startMs: group[0]?.startMs ?? 0, endMs: group.at(-1)?.endMs ?? 0, lines };
  });
  return cues.map((cue, index) => {
    const limit = (cues[index + 1]?.startMs ?? Infinity) - settings.minGapMs;
    const readMs = Math.ceil((cue.lines.join(' ').length / settings.maxCps) * 1_000);
    const wanted = Math.max(cue.startMs + settings.minMs, cue.startMs + readMs);
    return { ...cue, endMs: Math.max(cue.endMs, Math.min(wanted, limit, cue.startMs + settings.maxMs)) };
  });
}

/** Cues of a run on the absolute clock: each scene's measured words (relative to the scene) cued apart and shifted. */
export function sceneCaptionCues(scenes: readonly { startMs: number; words: readonly TimedWord[] }[], options: Partial<CaptionOptions> = {}): CaptionCue[] {
  const all = scenes.flatMap((scene) => captionCues(scene.words, options).map((cue) => ({ ...cue, startMs: cue.startMs + scene.startMs, endMs: cue.endMs + scene.startMs })));
  // A cue held into its scene's last pause must still leave the next scene's first cue its own time.
  const gap = options.minGapMs ?? DEFAULT_CAPTION_OPTIONS.minGapMs;
  return all.map((cue, index) => {
    const next = all[index + 1];
    return next && cue.endMs > next.startMs - gap ? { ...cue, endMs: Math.max(cue.startMs + 1, next.startMs - gap) } : cue;
  });
}

const srtTime = (ms: number) => {
  const value = Math.max(0, Math.round(ms));
  const pad = (number: number, size = 2) => String(number).padStart(size, '0');
  return `${pad(Math.floor(value / 3_600_000))}:${pad(Math.floor(value / 60_000) % 60)}:${pad(Math.floor(value / 1_000) % 60)},${pad(value % 1_000, 3)}`;
};

/** SubRip text of the cues, exactly as they are drawn on screen. */
export function captionCuesSrt(cues: readonly CaptionCue[]): string {
  return cues.map((cue, index) => `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.lines.join('\n')}\n`).join('\n');
}

// ---------------------------------------------------------------- shots (E4)

export const shotKinds = ['subject_footage', 'text_over_footage', 'comparison', 'concept', 'source_card', 'opening', 'closing', 'title'] as const;
export type ShotKind = (typeof shotKinds)[number];

/** What one shot must show. `wants` is the visual requirement the relevance judge checks against, not the narration. */
export const shotIntentSchema = z.strictObject({
  kind: z.enum(shotKinds),
  subjectIds: z.array(z.string().min(1)).max(6),
  natures: z.array(z.enum(sceneNatures)).max(4),
  wants: z.string().trim().min(1).max(200),
  /** Short copy for a card or a text-over-footage shot; null when the shot carries no text of its own. */
  onScreenText: z.string().trim().min(1).max(90).nullable(),
  source: z.strictObject({ title: z.string().min(1).max(160), publisher: z.string().min(1).max(120), date: z.string().max(40).nullable() }).optional(),
});
export type ShotIntent = z.infer<typeof shotIntentSchema>;

export interface ShotSpan { id: string; sceneId: string; wordStart: number; wordEnd: number; startMs: number; endMs: number; text: string }

const MIN_SHOT_MS = 1_200;
/** A sentence this short carries no visual need of its own ("Sim.", "Pois é.") and joins its neighbour. */
const MAX_FRAGMENT_WORDS = 2;

/**
 * Sentence-level shots with absolute screen time: a shot lasts from its first word (the scene start for the first shot)
 * until the next shot starts, and the last one until the scene ends. Only content-free fragments (at most two words) are
 * merged automatically. A short sentence with its own content stays a shot of its own (e.g. one item of an enumeration):
 * whether it can share a shot with a neighbour depends on its intent (E4), and the editorial gate flags its rhythm.
 */
export function splitSceneIntoShots(scene: SceneWords): ShotSpan[] {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  scene.words.forEach((word, index) => { if (sentenceEnd(word.w) || index === scene.words.length - 1) { ranges.push([start, index]); start = index + 1; } });
  const fragment = ([from, to]: [number, number]) => to - from + 1 <= MAX_FRAGMENT_WORDS;
  const merged: Array<[number, number]> = [];
  let pending: [number, number] | null = null;
  for (const range of ranges) {
    const current: [number, number] = pending ? [pending[0], range[1]] : [...range];
    pending = null;
    const isLast = range === ranges.at(-1);
    const previous = merged.at(-1);
    if (fragment(range) && current[0] === range[0] && isLast && previous) { previous[1] = range[1]; continue; }
    if (fragment(range) && current[0] === range[0] && !isLast) { pending = current; continue; }
    merged.push(current);
  }
  const lastMerged = merged.at(-1);
  if (pending) { if (lastMerged) lastMerged[1] = pending[1]; else merged.push(pending); }
  const sceneEnd = scene.endMs ?? scene.startMs + (scene.words.at(-1)?.endMs ?? 0);
  const starts = merged.map(([from], index) => scene.startMs + (index === 0 ? 0 : scene.words[from]?.startMs ?? 0));
  return merged.map(([from, to], index) => ({
    id: `${scene.id}:${index}`, sceneId: scene.id, wordStart: from, wordEnd: to,
    startMs: starts[index] ?? scene.startMs, endMs: starts[index + 1] ?? sceneEnd,
    text: scene.words.slice(from, to + 1).map((word) => word.w).join(' '),
  }));
}

/** Shots shorter than this on screen get the rhythm warning of the editorial gate. */
export const MIN_SHOT_SCREEN_MS = MIN_SHOT_MS;

// ---------------------------------------------------------------- editorial gate (E1)

const overlaysSchema = z.strictObject({ burnedText: z.boolean(), burnedTextRegion: z.enum(textRegions).optional(), watermark: z.boolean(), webcam: z.boolean() });
export const editorialVisualSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('footage'), assetId: z.string().min(1), inMs: z.number().int().nonnegative(), outMs: z.number().int().positive(), nature: z.enum(sceneNatures), overlays: overlaysSchema, sourceMismatch: z.boolean() }),
  z.strictObject({ type: z.literal('composition'), component: z.string().min(1), themeId: z.string().min(1) }),
  z.strictObject({ type: z.literal('none') }),
]);
export type EditorialVisual = z.infer<typeof editorialVisualSchema>;
export type FootageVisual = Extract<EditorialVisual, { type: 'footage' }>;

export interface EditorialShot {
  shotId: string; sceneId: string; startMs: number; endMs: number; narration: string;
  intent: ShotIntent; visual: EditorialVisual; relevance: RelevanceDecision | null; evidence: string[];
  captionPlacement: 'bottom' | 'top'; themeId: string;
  humanDecision: { decision: 'approved' | 'rejected'; note: string; at: string } | null;
}
export interface EditorialCheck { id: string; label: string; severity: 'blocking' | 'warning'; passed: boolean; evidence: string }
/** Speaking pace of this production; set by the preset/Director, never a universal rule. */
export interface EditorialPacing { minWpm: number; maxWpm: number; blockWpm: number }
export interface EditorialInput {
  shots: readonly EditorialShot[]; scenes: readonly { sceneId: string; words: number; speechMs: number }[]; captions: readonly CaptionCue[];
  pacing: EditorialPacing; productionThemeId: string; humanApproval?: { approvedBy: string; at: string };
}
export type EditorialStatus = 'blocked' | 'awaiting_review' | 'ready_for_human' | 'approved';
export interface EditorialGateResult { status: EditorialStatus; shots: Array<EditorialShot & { checks: EditorialCheck[]; decision: 'accept' | 'review' | 'reject' }>; checks: EditorialCheck[] }

const MAX_CAPTION_CPS = 17;
const MIN_CAPTION_MS = 1_000;
const MIN_FOOTAGE_MS = MIN_SHOT_SCREEN_MS;
const MAX_FOOTAGE_MS = 8_000;
const MAX_CARD_CPS = 15;

const check = (id: string, label: string, severity: EditorialCheck['severity'], passed: boolean, evidence: string): EditorialCheck => ({ id, label, severity, passed, evidence });

function shotChecks(shot: EditorialShot, all: readonly EditorialShot[], themeId: string): EditorialCheck[] {
  const checks: EditorialCheck[] = [];
  const durationMs = shot.endMs - shot.startMs;
  const visual = shot.visual;
  checks.push(check('visual-present', 'A tomada tem um visual com intenção', 'blocking', visual.type !== 'none', visual.type === 'none' ? 'Nenhuma mídia aceita nem composição: fundo vazio não é aceito.' : visual.type));
  if (visual.type === 'footage') {
    const human = shot.humanDecision?.decision;
    const decision = human === 'approved' ? 'accept' : human === 'rejected' ? 'reject' : shot.relevance?.decision ?? 'review';
    checks.push(check('relevance', 'A imagem representa o que a fala pede', decision === 'reject' ? 'blocking' : 'warning', decision === 'accept', human ? `Decisão humana: ${shot.humanDecision?.note ?? ''}` : shot.relevance?.reason ?? 'Sem julgamento de relevância.'));
    checks.push(check('webcam', 'Sem webcam de terceiros', 'blocking', !visual.overlays.webcam, visual.overlays.webcam ? 'O trecho tem webcam de streamer.' : 'ok'));
    checks.push(check('source-mismatch', 'Fonte corresponde ao que diz ser', 'blocking', !visual.sourceMismatch, visual.sourceMismatch ? 'A análise contradiz a origem declarada da mídia.' : 'ok'));
    const reused = all.find((other) => other.shotId !== shot.shotId && other.visual.type === 'footage' && other.visual.assetId === visual.assetId && other.visual.inMs < visual.outMs && other.visual.outMs > visual.inMs && all.indexOf(other) < all.indexOf(shot));
    checks.push(check('repetition', 'O trecho não se repete', 'blocking', !reused, reused ? `Mesmo trecho da tomada ${reused.shotId}.` : 'ok'));
    const collides = visual.overlays.burnedText && visual.overlays.burnedTextRegion === shot.captionPlacement;
    checks.push(check('caption-collision', 'A legenda não cobre texto da imagem', 'blocking', !collides, collides ? `Texto gravado na região ${visual.overlays.burnedTextRegion}, onde está a legenda.` : 'ok'));
    checks.push(check('rhythm', 'Duração da tomada adequada ao ritmo', 'warning', durationMs >= MIN_FOOTAGE_MS && durationMs <= MAX_FOOTAGE_MS, `${(durationMs / 1_000).toFixed(1)} s`));
  }
  if (visual.type === 'composition') checks.push(check('theme', 'Composição segue o tema da produção', 'warning', visual.themeId === themeId, `${visual.themeId} × ${themeId}`));
  const copy = shot.intent.onScreenText;
  if (copy) {
    const cps = copy.length / Math.max(0.5, durationMs / 1_000);
    checks.push(check('text-legibility', 'Texto na tela legível no tempo da tomada', 'warning', copy.length <= 60 && cps <= MAX_CARD_CPS, `${copy.length} caracteres em ${(durationMs / 1_000).toFixed(1)} s (${cps.toFixed(1)}/s)`));
  }
  return checks;
}

/**
 * Editorial pre-check, separate from technical QA. It never approves on its own: with every check green the production is
 * `ready_for_human`, and only a recorded human approval makes it `approved`.
 */
export function editorialGate(input: EditorialInput): EditorialGateResult {
  const shots = input.shots.map((shot) => {
    const checks = shotChecks(shot, input.shots, input.productionThemeId);
    const decision: 'accept' | 'review' | 'reject' = checks.some((item) => !item.passed && item.severity === 'blocking') ? 'reject' : checks.some((item) => !item.passed) ? 'review' : 'accept';
    return { ...shot, checks, decision };
  });
  const checks: EditorialCheck[] = [];
  for (const scene of input.scenes) {
    const wpm = scene.speechMs > 0 ? (scene.words * 60_000) / scene.speechMs : 0;
    const severity = wpm > input.pacing.blockWpm ? 'blocking' : 'warning';
    checks.push(check(`pace:${scene.sceneId}`, 'Ritmo da narração', severity, wpm >= input.pacing.minWpm && wpm <= input.pacing.maxWpm, `${Math.round(wpm)} palavras/min (alvo ${input.pacing.minWpm}–${input.pacing.maxWpm}, bloqueio acima de ${input.pacing.blockWpm})`));
  }
  input.captions.forEach((cue, index) => {
    const chars = cue.lines.join(' ').length;
    const seconds = (cue.endMs - cue.startMs) / 1_000;
    const cps = chars / Math.max(0.1, seconds);
    if (cps > MAX_CAPTION_CPS || cue.endMs - cue.startMs < MIN_CAPTION_MS || cue.lines.length > 2) checks.push(check(`caption:${index}`, 'Legenda confortável de ler', 'blocking', false, `${chars} caracteres em ${seconds.toFixed(1)} s (${cps.toFixed(1)}/s), ${cue.lines.length} linha(s): "${cue.lines.join(' ')}"`));
  });
  const all = [...checks, ...shots.flatMap((shot) => shot.checks)];
  const blocked = all.some((item) => !item.passed && item.severity === 'blocking');
  const review = shots.some((shot) => shot.decision === 'review') || all.some((item) => !item.passed);
  const status: EditorialStatus = blocked ? 'blocked' : review ? 'awaiting_review' : input.humanApproval ? 'approved' : 'ready_for_human';
  return { status, shots, checks };
}

const STATUS_LABEL: Record<EditorialStatus, string> = { blocked: 'Bloqueado', awaiting_review: 'Aguardando revisão de tomadas', ready_for_human: 'Pré-check verde — aguardando aprovação humana', approved: 'Aprovado por pessoa' };

/** Per-shot report: narration, intent, chosen visual, evidence, decision and every failed check. */
export function editorialReportMarkdown(result: EditorialGateResult): string {
  const lines = [`# Relatório editorial`, '', `**Status:** ${STATUS_LABEL[result.status]}`, ''];
  const global = result.checks.filter((item) => !item.passed);
  if (global.length) lines.push('## Ritmo e legendas', '', ...global.map((item) => `- ${item.severity === 'blocking' ? 'BLOQUEIO' : 'Aviso'} · ${item.label}: ${item.evidence}`), '');
  lines.push('## Tomadas', '');
  for (const shot of result.shots) {
    const visual = shot.visual.type === 'footage' ? `${shot.visual.assetId} ${(shot.visual.inMs / 1_000).toFixed(1)}–${(shot.visual.outMs / 1_000).toFixed(1)} s (${shot.visual.nature})` : shot.visual.type === 'composition' ? `composição ${shot.visual.component}` : 'nenhum';
    lines.push(`### ${shot.shotId} · ${(shot.startMs / 1_000).toFixed(1)}–${(shot.endMs / 1_000).toFixed(1)} s · ${shot.decision}`, '',
      `- **Fala:** ${shot.narration}`, `- **Intenção:** ${shot.intent.kind} — ${shot.intent.wants}`, `- **Visual:** ${visual}`,
      `- **Evidência:** ${shot.evidence.length ? shot.evidence.join('; ') : '—'}`, `- **Julgamento:** ${shot.relevance?.reason ?? '—'}`,
      ...shot.checks.filter((item) => !item.passed).map((item) => `- ${item.severity === 'blocking' ? 'BLOQUEIO' : 'Aviso'} · ${item.label}: ${item.evidence}`), '');
  }
  return lines.join('\n');
}

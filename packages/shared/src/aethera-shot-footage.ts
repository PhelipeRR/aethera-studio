import type { ShotSpan } from './aethera-editorial.js';
import type { SceneNature, SegmentAnalysis } from './aethera-visual-analysis.js';
import { timelineDocumentSchema, type TimelineClip, type TimelineDocument } from './aethera-timeline.js';
import { portugueseNumber } from './velix-sync.js';

/*
 * AP-04 E4/E5 (correction after the E3 sample review): which footage each shot shows. Category-neutral: a "subject" is a
 * game, a film, a team or a person — whatever the run researched. The rules are general, not tuned to one sample:
 *   1. A shot shows its own subject. A subject named in the shot's narration wins over the scene's subject; footage of
 *      another subject is never used to illustrate it.
 *   2. Footage with a webcam inset, from a third-party commentary or a divergent source is never selected.
 *   3. Burned-in text that would sit under the captions moves the captions to the top when the top is free; text in the
 *      middle or over the whole frame rejects the footage.
 *   4. No segment is used twice; a shot longer than one segment is filled with plain cuts of several segments.
 *   5. With no acceptable footage, the shot gets an identity card of its subject — never another subject's footage.
 */

export interface FootageSubject { id: string; title: string; aliases?: readonly string[] }

export type FootageSource = 'official' | 'third_party' | 'divergent' | 'unknown';

export interface FootageCandidate {
  assetId: string; segmentId: string; subjectId: string; startMs: number; endMs: number;
  /** Where the media comes from, after source assessment (E7); only `official` and `unknown` are eligible. */
  source: FootageSource;
  /** Duration of the whole asset: openings and endings (logos, ratings, title cards) rank lower. */
  assetDurationMs: number;
  /** Darkest sampled frame of the segment, 0–1 (mean luma); a fade or a black frame cannot carry a shot. */
  minBrightness?: number;
  /** Busyness of the top, middle and bottom thirds (SD-2), for placing added text where the image is calm. */
  zones?: { top: number; middle: number; bottom: number; cells?: number[][]; staticCells?: number[][] };
  analysis: Pick<SegmentAnalysis, 'nature' | 'overlays' | 'frames'> | null;
}

export interface FootageCut { assetId: string; segmentId: string; inMs: number; outMs: number; startMs: number; endMs: number }

export interface ShotFootagePlan {
  shotId: string; sceneId: string; startMs: number; endMs: number; text: string;
  /** Subjects the shot is about, in order of mention; empty when the narration names none and the scene has none. */
  subjectIds: string[];
  kind: 'footage' | 'identity_card' | 'comparison_card';
  cuts: FootageCut[];
  captionPlacement: 'bottom' | 'top';
  /** Subject title to show on screen when the subject changes from the previous shot; null otherwise. */
  label: string | null;
  /** True when a cut has no visual analysis yet: it must go to human review. */
  unanalyzed: boolean;
  /** Smart Director: the graphic this shot shows instead of a derived card (panels, a card with the director's lines). */
  graphic?: { component: 'title' | 'panels' | 'kinetic' | 'diagram'; props: Record<string, unknown> };
  reason: string;
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The ways a narration names a subject: its title, the title with numbers spelled out as the voice says them
 * ("Cyberpunk dois mil e setenta e sete"), the title without a trailing number, the distinctive last word of a title with
 * three or more words ("Hollow Knight Silksong" → "Silksong") and any alias the run recorded.
 */
export function subjectAliases(subject: FootageSubject): string[] {
  const title = subject.title.trim();
  const spelled = title.replace(/\b\d{1,6}\b/gu, (digits) => portugueseNumber(Number(digits)));
  const words = title.split(/\s+/u);
  const withoutNumber = words.length > 1 && /^\d+$/u.test(words.at(-1) ?? '') ? words.slice(0, -1).join(' ') : null;
  const last = words.length >= 3 && (words.at(-1)?.length ?? 0) >= 5 ? words.at(-1) ?? null : null;
  return [...new Set([title, spelled, withoutNumber, last, ...(subject.aliases ?? [])].filter((item): item is string => !!item && item.trim().length >= 3).map(fold))];
}

/** Subjects named in a text, in order of first mention. */
export function mentionedSubjects(text: string, subjects: readonly FootageSubject[]): string[] {
  const folded = ` ${fold(text)} `;
  return subjects
    .map((subject) => ({ id: subject.id, at: Math.min(...subjectAliases(subject).map((alias) => { const index = folded.indexOf(` ${alias} `); return index < 0 ? Infinity : index; })) }))
    .filter((item) => Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at)
    .map((item) => item.id);
}

/** Natures that show a subject in action or in its world rank first; menus and title cards last. */
const NATURE_RANK: Partial<Record<SceneNature, number>> = { action: 1, exploration: 1, landscape: 0.9, cinematic: 0.85, crowd: 0.7, portrait: 0.6, dialogue: 0.5, speech: 0.4, other: 0.4, unknown: 0.3, interface: 0.15, document: 0.1, text_card: 0 };
/** Darkest frame a cut may contain (mean luma 0–1): below it the shot is a fade, a black slate or unreadable night. */
export const MIN_BRIGHTNESS = 0.07;

/**
 * Natures the words of a sentence ask for. A weak, language-level hint (pt/en) that only adds weight to the ranking: the
 * shot's own intent (E4) is the authority when it exists, and a sentence with no hint leaves the ranking as it was.
 */
export function natureHints(text: string): SceneNature[] {
  const words = ` ${fold(text)} `;
  const has = (...terms: string[]) => terms.some((term) => words.includes(` ${term}`));
  const natures = new Set<SceneNature>();
  if (has('paisage', 'cenario', 'mundo', 'lugar', 'mapa', 'cidade', 'horizonte', 'landscape', 'world', 'city')) { natures.add('landscape'); natures.add('exploration'); }
  if (has('corredor', 'explor', 'caminh', 'curiosidade', 'percurso', 'explore', 'path')) natures.add('exploration');
  if (has('combate', 'luta', 'batalha', 'derrota', 'ataque', 'chefe', 'erro do jogador', 'fight', 'battle', 'combat')) natures.add('action');
  if (has('interface', 'menu', 'marcador', 'hud', 'tela de')) natures.add('interface');
  if (has('personagem', 'rosto', 'pessoa', 'character', 'face')) natures.add('portrait');
  return [...natures];
}

/** Shortest piece of a segment worth cutting to. */
export const MIN_CUT_MS = 1_500;

export type CaptionFit = { fits: true; placement: 'bottom' | 'top' } | { fits: false; reason: string };

/** Where captions can go over a segment, given the text burned into it (rule 3). */
export function captionFit(analysis: FootageCandidate['analysis']): CaptionFit {
  if (!analysis) return { fits: true, placement: 'bottom' };
  const regions = new Set([...(analysis.overlays.burnedText && analysis.overlays.burnedTextRegion ? [analysis.overlays.burnedTextRegion] : []), ...analysis.frames.flatMap((frame) => frame.visibleText.map((item) => item.region))]);
  if (analysis.overlays.burnedText && regions.size === 0) return { fits: false, reason: 'texto gravado em região desconhecida' };
  if (regions.has('center') || regions.has('full') || regions.has('overlay')) return { fits: false, reason: 'texto gravado no meio da imagem' };
  if (regions.has('bottom') && regions.has('top')) return { fits: false, reason: 'texto gravado em cima e embaixo' };
  if (regions.has('bottom')) return { fits: true, placement: 'top' };
  return { fits: true, placement: 'bottom' };
}

/** Why a candidate can never be used, or null when it is eligible (rules 2 and 3). */
export function footageRejection(candidate: FootageCandidate): string | null {
  if (candidate.minBrightness !== undefined && candidate.minBrightness < MIN_BRIGHTNESS) return 'quadro escuro ou fade';
  if (candidate.source === 'third_party') return 'comentário de terceiro';
  if (candidate.source === 'divergent') return 'fonte divergente';
  if (candidate.analysis?.overlays.webcam) return 'webcam na imagem';
  if (candidate.analysis?.overlays.watermark) return 'marca d’água';
  const fit = captionFit(candidate.analysis);
  return fit.fits ? null : fit.reason;
}

function score(candidate: FootageCandidate, wantedMs: number, previousAsset: string | null, wanted: readonly SceneNature[]): number {
  const nature = candidate.analysis ? NATURE_RANK[candidate.analysis.nature] ?? 0.3 : 0.45;
  // What the sentence talks about (a landscape, a fight) weighs more than the generic ranking of natures.
  const fitsText = candidate.analysis && wanted.includes(candidate.analysis.nature) ? 0.6 : 0;
  const length = Math.min(1, (candidate.endMs - candidate.startMs) / Math.max(1, wantedMs));
  const middle = (candidate.startMs + candidate.endMs) / 2 / Math.max(1, candidate.assetDurationMs);
  const edges = middle < 0.08 || middle > 0.9 ? 0.3 : 0;
  const analyzed = candidate.analysis ? 0.2 : 0;
  const variety = candidate.assetId === previousAsset ? 0.1 : 0;
  // Footage with its own text (a trailer's subtitles, a title) competes with the captions even when they move away from
  // it: a clean shot always wins, and moving the captions is the fallback.
  const ownText = candidate.analysis && (candidate.analysis.overlays.burnedText || candidate.analysis.frames.some((frame) => frame.visibleText.length > 0)) ? 1 : 0;
  return nature + fitsText + 0.5 * length + analyzed - edges - variety - ownText;
}

/**
 * Footage for every shot, in order (rules 1–5). `sceneSubjects` gives each scene's subject when the narration of a shot
 * names none; with neither, the shot may show any subject's eligible footage (an opening or a general statement), and
 * successive such shots rotate between subjects.
 */
export function planShotFootage(input: { shots: readonly ShotSpan[]; sceneSubjects: ReadonlyMap<string, string | null>; subjects: readonly FootageSubject[]; candidates: readonly FootageCandidate[];
  /** Smart Director: per shot, the subject and what must appear, as the director decided. They replace the keyword hints. */
  directions?: ReadonlyMap<string, { subjectId: string | null; wants: string }>;
  /** Internal: footage already reserved for the shots that name one subject. */
  reserved?: ReadonlyMap<string, ShotFootagePlan> }): ShotFootagePlan[] {
  // A sentence that names one subject has first claim on that subject's footage; general sentences use what is left
  // (regression: the rotation of general sentences used up the only good shots of the subject a later sentence named).
  if (!input.reserved) {
    const subjectOf = (shot: ShotSpan) => { const directed = input.directions?.get(shot.id); if (directed) return directed.subjectId; const named = mentionedSubjects(shot.text, input.subjects); return named.length === 1 ? named[0] ?? null : null; };
    const named = input.shots.filter((shot) => subjectOf(shot) !== null);
    if (named.length && named.length < input.shots.length) {
      const first = planShotFootage({ ...input, shots: named, reserved: new Map() });
      return planShotFootage({ ...input, reserved: new Map(first.map((plan) => [plan.shotId, plan])) });
    }
  }
  const titles = new Map(input.subjects.map((subject) => [subject.id, subject.title]));
  const eligible = input.candidates.filter((candidate) => footageRejection(candidate) === null);
  const used = new Set<string>([...(input.reserved?.values() ?? [])].flatMap((plan) => plan.cuts.map((cut) => cut.segmentId)));
  const plans: ShotFootagePlan[] = [];
  // What the narration is about (inherited by the next sentence of the scene) and what the screen last showed (label).
  let previousSubject = null as string | null;
  let previousShown = null as string | null;
  let previousScene: string | null = null;
  let previousAsset: string | null = null;
  let rotation = 0;
  for (const shot of input.shots) {
    const kept = input.reserved?.get(shot.id);
    if (kept) {
      // Planned in the first pass; only the label depends on what the screen showed just before.
      const shown = kept.kind === 'footage' ? input.candidates.find((candidate) => candidate.segmentId === kept.cuts[0]?.segmentId)?.subjectId ?? kept.subjectIds[0] ?? null : kept.subjectIds[0] ?? null;
      plans.push({ ...kept, label: kept.kind === 'footage' && shown && shown !== previousShown ? titles.get(shown) ?? null : null });
      previousSubject = kept.subjectIds[0] ?? null; previousShown = kept.kind === 'footage' ? shown : null; previousScene = shot.sceneId; previousAsset = kept.cuts.at(-1)?.assetId ?? null;
      continue;
    }
    const directed = input.directions?.get(shot.id);
    const named = directed ? (directed.subjectId ? [directed.subjectId] : []) : mentionedSubjects(shot.text, input.subjects);
    // The director's description of what must appear (or, without a plan, the narration) hints the kind of shot.
    const wanted = natureHints(directed?.wants ?? shot.text);
    const inherited: string | null = previousScene === shot.sceneId && previousSubject ? previousSubject : input.sceneSubjects.get(shot.sceneId) ?? null;
    const subjectIds: string[] = named.length ? named : inherited ? [inherited] : [];
    const base = { shotId: shot.id, sceneId: shot.sceneId, startMs: shot.startMs, endMs: shot.endMs, text: shot.text, subjectIds };
    if (subjectIds.length > 1) {
      plans.push({ ...base, kind: 'comparison_card', cuts: [], captionPlacement: 'bottom', label: null, unanalyzed: false, reason: `a frase compara ${subjectIds.length} assuntos` });
      previousSubject = null; previousShown = null; previousScene = shot.sceneId; previousAsset = null;
      continue;
    }
    const subject: string | null = subjectIds[0] ?? null;
    // A shot about nobody in particular shows the subjects in turn, scene by scene, so a general statement never favours
    // one of them; inside a scene it stays with the subject already on screen (no label flipping on every sentence).
    const ids = input.subjects.map((item) => item.id);
    const turn = rotation % Math.max(1, ids.length);
    const rotated = [...ids.slice(turn), ...ids.slice(0, turn)];
    const order = subject ? [subject] : previousScene === shot.sceneId && previousShown ? [previousShown, ...rotated.filter((id) => id !== previousShown)] : rotated;
    const cuts: FootageCut[] = [];
    let placement: 'bottom' | 'top' = 'bottom';
    let unanalyzed = false;
    let at = shot.startMs;
    for (const id of order) {
      while (at < shot.endMs - 200) {
        const remaining = shot.endMs - at;
        const pool = eligible.filter((candidate) => candidate.subjectId === id && !used.has(candidate.segmentId) && candidate.endMs - candidate.startMs >= Math.min(MIN_CUT_MS, remaining))
          // All cuts of one shot share one caption position, so the captions never jump inside a shot.
          .filter((candidate) => cuts.length === 0 || (captionFit(candidate.analysis) as { placement: 'bottom' | 'top' }).placement === placement);
        const best = pool.sort((a, b) => score(b, remaining, previousAsset, wanted) - score(a, remaining, previousAsset, wanted))[0];
        if (!best) break;
        const take = Math.min(remaining, best.endMs - best.startMs);
        // The middle of a segment, away from its scene-change edges.
        const inMs = best.startMs + Math.floor((best.endMs - best.startMs - take) / 2);
        cuts.push({ assetId: best.assetId, segmentId: best.segmentId, inMs, outMs: inMs + take, startMs: at, endMs: at + take });
        if (cuts.length === 1) placement = (captionFit(best.analysis) as { placement: 'bottom' | 'top' }).placement;
        unanalyzed ||= best.analysis === null;
        used.add(best.segmentId);
        previousAsset = best.assetId;
        at += take;
        // A short tail joins the last cut instead of a flash of another segment.
        if (shot.endMs - at < MIN_CUT_MS && cuts.length) { const last = cuts.at(-1); if (last && last.outMs + (shot.endMs - at) <= (eligible.find((item) => item.segmentId === last.segmentId)?.endMs ?? last.outMs)) { last.outMs += shot.endMs - at; last.endMs = shot.endMs; at = shot.endMs; } }
      }
      if (cuts.length && at >= shot.endMs - 200) break;
    }
    const covered = cuts.length > 0 && at >= shot.endMs - 200;
    const cutSubject = cuts.length ? input.candidates.find((candidate) => candidate.segmentId === cuts[0]?.segmentId)?.subjectId ?? null : null;
    if (!covered) {
      // Rule 5: an identity card of the subject (or of the run's subjects for a general statement); no foreign footage.
      for (const cut of cuts) used.delete(cut.segmentId);
      plans.push({ ...base, kind: 'identity_card', cuts: [], captionPlacement: 'bottom', label: null, unanalyzed: false, reason: subject ? `sem filmagem aceita de ${titles.get(subject) ?? subject}` : 'sem filmagem aceita' });
      previousSubject = subject; previousShown = subject; previousScene = shot.sceneId; previousAsset = null;
      continue;
    }
    // The next general statement starts from the subject after the one just shown.
    if (!subject) rotation = input.subjects.findIndex((item) => item.id === cutSubject) + 1;
    const shown = subject ?? cutSubject;
    const label = shown && shown !== previousShown ? titles.get(shown) ?? null : null;
    plans.push({ ...base, kind: 'footage', cuts, captionPlacement: placement, label, unanalyzed, reason: subject ? (named.length ? 'assunto citado na frase' : 'assunto da cena') : 'frase geral: assuntos em rodízio' });
    previousSubject = subject; previousShown = shown; previousScene = shot.sceneId;
  }
  return plans;
}

/** On-screen subject label style: a small tag at the start of a shot whose subject changed. */
export const SUBJECT_LABEL_STYLE = 'aethera-subject-label';
/** How long the subject label stays at the start of a shot. */
export const SUBJECT_LABEL_MS = 2_200;

const clip = (input: { id: string; startMs: number; endMs: number; sceneId: string; source: TimelineClip['source']; label: string; subjectId?: string | null; reason: string }): TimelineClip => ({
  id: input.id, startMs: input.startMs, durationMs: Math.max(1, input.endMs - input.startMs), sceneIds: [input.sceneId], ...(input.subjectId ? { subjectId: input.subjectId } : {}), label: input.label.slice(0, 80),
  // Plain cuts with no camera moves or effects: the footage carries the shot (rule: no exaggerated effects).
  source: input.source, transform: { x: 0, y: 0, scale: 1, rotation: 0, fit: 'cover' }, keyframes: [], effects: [], intent: { reason: input.reason.slice(0, 200) },
});

/**
 * The timeline with the shot plan applied: the video track holds the planned cuts, the graphics track the identity and
 * comparison cards, the text track gains the subject labels, and the captions are cut per shot so each shot keeps its own
 * caption position. Narration, music, sound effects and markers are untouched.
 */
export function applyShotFootage(document: TimelineDocument, plans: readonly ShotFootagePlan[], options: { subjects: readonly FootageSubject[]; proxyPaths: ReadonlyMap<string, string> }): TimelineDocument {
  const titles = new Map(options.subjects.map((subject) => [subject.id, subject.title]));
  const words = document.tracks.filter((track) => track.kind === 'captions').flatMap((track) => track.items).flatMap((item) => item.source.kind === 'text' ? (item.source.words ?? []).map((word) => ({ ...word, startMs: word.startMs + item.startMs, endMs: word.endMs + item.startMs })) : []);
  const video = plans.flatMap((plan) => plan.cuts.map((cut, index) => {
    const proxyPath = options.proxyPaths.get(cut.assetId);
    return clip({ id: `video:${plan.shotId}:${index}`, startMs: cut.startMs, endMs: cut.endMs, sceneId: plan.sceneId, subjectId: plan.subjectIds[0] ?? null, label: plan.text, reason: plan.reason,
      source: { kind: 'media', assetId: cut.assetId, ...(proxyPath ? { proxyPath } : {}), inMs: cut.inMs, outMs: cut.outMs, speed: 1, volume: 0 } });
  }));
  // A director's card over footage is drawn on top of the cuts; derived cards stand alone.
  const cards = plans.filter((plan) => plan.kind !== 'footage' || plan.graphic).map((plan) => {
    const names = (plan.subjectIds.length ? plan.subjectIds : options.subjects.map((subject) => subject.id)).map((id) => titles.get(id) ?? id);
    // One subject: its title. Several: a list, one name per line (a joined title wraps in the middle of a name).
    const props = plan.graphic ? { sceneId: plan.sceneId, ...plan.graphic.props } : names.length === 1 ? { sceneId: plan.sceneId, title: names[0] ?? '' } : { sceneId: plan.sceneId, items: names };
    return clip({ id: `graphics:${plan.shotId}`, startMs: plan.startMs, endMs: plan.endMs, sceneId: plan.sceneId, subjectId: plan.subjectIds.length === 1 ? plan.subjectIds[0] ?? null : null, label: plan.text, reason: plan.reason,
      source: { kind: 'graphic', component: plan.graphic?.component ?? 'title', version: 1, props } });
  });
  const labels = plans.flatMap((plan) => plan.label ? [clip({ id: `text:label:${plan.shotId}`, startMs: plan.startMs, endMs: Math.min(plan.endMs, plan.startMs + SUBJECT_LABEL_MS), sceneId: plan.sceneId, label: plan.label, reason: 'identificação do assunto',
    source: { kind: 'text', text: plan.label, styleId: SUBJECT_LABEL_STYLE, ...(plan.captionPlacement === 'top' ? { captionPlacement: 'top' as const } : {}) } })] : []);
  const captions = plans.map((plan) => clip({ id: `captions:${plan.shotId}`, startMs: plan.startMs, endMs: plan.endMs, sceneId: plan.sceneId, label: plan.text, reason: 'legenda da tomada',
    source: { kind: 'text', text: plan.text, styleId: 'aethera-caption', captionPlacement: plan.captionPlacement,
      words: words.filter((word) => word.startMs >= plan.startMs && word.startMs < plan.endMs).map((word) => ({ text: word.text, startMs: Math.max(0, word.startMs - plan.startMs), endMs: Math.max(0, word.endMs - plan.startMs) })) } }));
  const tracks = document.tracks.map((track) => {
    if (track.kind === 'video') return { ...track, items: video };
    if (track.kind === 'graphics') return { ...track, items: cards };
    if (track.kind === 'text') return { ...track, items: [...track.items.filter((item) => !(item.source.kind === 'text' && item.source.styleId === SUBJECT_LABEL_STYLE)), ...labels] };
    if (track.kind === 'captions') return { ...track, items: captions };
    return track;
  });
  return timelineDocumentSchema.parse({ ...document, tracks });
}

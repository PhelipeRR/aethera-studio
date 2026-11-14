import { z } from 'zod';
import { normalizeSentence, splitSentences } from './velix-long-script.js';
import type { StoryboardScene } from './velix-storyboard.js';

/**
 * Shorts and other derivatives of a production: candidates are narrative units of the main storyboard (hook, enough
 * context, payoff and close), not a cut from the middle. Each keeps its origin, the claims it carries and why it was
 * picked; a person approves each one before it becomes a production of its own.
 */

export const SHORT_MIN_MS = 15_000;
export const SHORT_MAX_MS = 59_000;
const IDEAL_MIN_MS = 25_000;
const IDEAL_MAX_MS = 45_000;

/** Openings that lean on what came before: a Short starting with them is not understandable on its own. */
const DEPENDENT_OPENERS = ['mas', 'e', 'entao', 'isso', 'isto', 'tambem', 'alem disso', 'por isso', 'ele', 'ela', 'eles', 'elas', 'esse', 'essa', 'esses', 'essas', 'aquele', 'aquela', 'depois', 'ainda assim', 'portanto', 'assim', 'nesse caso', 'dai'];
const HOOK_OPENERS = ['por que', 'como', 'voce sabia', 'o que', 'quanto', 'quem', 'imagine', 'existe', 'pouca gente'];
const CLOSERS = ['por isso', 'no fim', 'resultado', 'ou seja', 'no final', 'conclusao', 'em resumo', 'e por isso'];

export interface ClaimRef { id: string; kind: string; supported: boolean }
export interface ShortCandidate {
  sceneIds: string[];
  startMs: number;
  endMs: number;
  title: string;
  score: number;
  reason: string;
  claimIds: string[];
  breakdown: { hook: number; standalone: number; payoff: number; close: number; duration: number; chapter: number };
}

const opener = (text: string) => normalizeSentence(text);
const startsWithAny = (text: string, words: readonly string[]) => { const value = opener(text); return words.some((word) => value === word || value.startsWith(`${word} `)); };

/** Why a scene cannot open a standalone Short (null when it can). */
export function dependentOpening(scene: Pick<StoryboardScene, 'narration'>): string | null {
  const first = splitSentences(scene.narration)[0] ?? '';
  return startsWithAny(first, DEPENDENT_OPENERS) ? `Começa com "${first.split(/\s+/u)[0] ?? ''}", que depende do que veio antes.` : null;
}

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

/**
 * Scores every window of consecutive scenes that fits a Short and returns the best non-overlapping ones. A window that
 * opens on a dependent phrase, ends mid-thought or carries a fact without approved evidence is never offered.
 */
export function shortCandidates(scenes: readonly StoryboardScene[], claims: readonly ClaimRef[], options: { minMs?: number; maxMs?: number; max?: number } = {}): ShortCandidate[] {
  const minMs = options.minMs ?? SHORT_MIN_MS;
  const maxMs = options.maxMs ?? SHORT_MAX_MS;
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const windows: ShortCandidate[] = [];
  for (let start = 0; start < scenes.length; start++) {
    const first = scenes[start];
    if (!first || dependentOpening(first)) continue;
    for (let end = start; end < scenes.length; end++) {
      const last = scenes[end];
      if (!last) break;
      const duration = last.endMs - first.startMs;
      if (duration > maxMs) break;
      if (duration < minMs) continue;
      const window = scenes.slice(start, end + 1);
      const claimIds = [...new Set(window.flatMap((scene) => scene.claimIds))];
      if (claimIds.some((id) => { const claim = byId.get(id); return claim?.kind === 'fact' && !claim.supported; })) continue;
      const lastSentence = splitSentences(last.narration).at(-1) ?? '';
      if (!/[.!…]$/u.test(lastSentence.trim())) continue;
      const firstSentence = splitSentences(first.narration)[0] ?? '';
      const text = window.map((scene) => scene.narration).join(' ');
      const hook = Math.min(1, (firstSentence.includes('?') ? 0.5 : 0) + (/\d/u.test(firstSentence) ? 0.3 : 0) + (startsWithAny(firstSentence, HOOK_OPENERS) ? 0.4 : 0) + (first.sceneType === 'title' ? 0.1 : 0));
      const standalone = window.slice(1).some((scene) => scene.chapter !== first.chapter) ? 0.7 : 1;
      const payoff = Math.min(1, (/\d/u.test(text) ? 0.4 : 0) + (claimIds.some((id) => byId.get(id)?.supported) ? 0.4 : 0) + (window.length >= 2 ? 0.2 : 0));
      const close = Math.min(1, (startsWithAny(lastSentence, CLOSERS) || CLOSERS.some((word) => opener(lastSentence).includes(word)) ? 0.6 : 0.3) + (lastSentence.trim().endsWith('?') ? -0.3 : 0.4));
      const durationScore = duration >= IDEAL_MIN_MS && duration <= IDEAL_MAX_MS ? 1 : duration < IDEAL_MIN_MS ? duration / IDEAL_MIN_MS : Math.max(0.3, 1 - (duration - IDEAL_MAX_MS) / (maxMs - IDEAL_MAX_MS + 1));
      const chapter = window.every((scene) => scene.chapter === first.chapter) ? 1 : 0.6;
      const breakdown = { hook, standalone, payoff, close, duration: Math.round(durationScore * 100) / 100, chapter };
      const score = Math.round((0.3 * hook + 0.2 * standalone + 0.2 * payoff + 0.15 * close + 0.1 * durationScore + 0.05 * chapter) * 1_000) / 1_000;
      const reasons = [hook >= 0.5 ? 'gancho forte na abertura' : 'abertura direta', payoff >= 0.6 ? 'entrega um dado ou conclusão' : 'explica sem dado novo', `${Math.round(duration / 1_000)} s`, chapter === 1 ? 'um único capítulo' : 'atravessa capítulos'];
      windows.push({ sceneIds: window.map((scene) => scene.id), startMs: first.startMs, endMs: last.endMs, title: clip(firstSentence.replace(/[.!…]+$/u, ''), 60), score, reason: reasons.join(' · '), claimIds, breakdown });
    }
  }
  const picked: ShortCandidate[] = [];
  for (const candidate of windows.sort((a, b) => b.score - a.score || a.startMs - b.startMs)) {
    if (picked.length >= (options.max ?? 5)) break;
    if (picked.some((item) => candidate.startMs < item.endMs && item.startMs < candidate.endMs)) continue;
    picked.push(candidate);
  }
  return picked.sort((a, b) => a.startMs - b.startMs);
}

/**
 * The derivative's own storyboard: the chosen scenes with their measured clips, re-timed from zero, the title on the
 * first scene and the channel name closing it. Scene ids are kept, so every scene links back to its origin.
 */
export function derivativeScenes(scenes: readonly StoryboardScene[], candidate: Pick<ShortCandidate, 'sceneIds' | 'title'>, closing?: string | null): StoryboardScene[] {
  const chosen = candidate.sceneIds.map((id) => scenes.find((scene) => scene.id === id)).filter((scene): scene is StoryboardScene => !!scene);
  if (chosen.length !== candidate.sceneIds.length) throw new Error('invalid: o trecho de origem mudou; gere os candidatos de novo.');
  let cursor = 0;
  return chosen.map((scene, index) => {
    const duration = scene.endMs - scene.startMs;
    const next = { ...scene, startMs: cursor, endMs: cursor + duration, locked: false, reviewStatus: 'pending' as const, onScreenText: index === 0 && !scene.onScreenText ? candidate.title : index === chosen.length - 1 && closing && !scene.onScreenText ? clip(closing, 60) : scene.onScreenText };
    cursor += duration;
    return next;
  });
}

export const derivativeStatuses = ['candidate', 'approved', 'rejected', 'created'] as const;
export const productionDerivativeSchema = z.strictObject({
  id: z.string(), parentRunId: z.string(), childRunId: z.string().nullable(), storyboardVersion: z.number().int(), formatId: z.string(),
  sceneIds: z.array(z.string()), startMs: z.number().int(), endMs: z.number().int(), title: z.string(), score: z.number(), reason: z.string(), claimIds: z.array(z.string()),
  status: z.enum(derivativeStatuses), childStatus: z.string().nullable(), exportable: z.boolean(), exported: z.string().nullable(),
});
export type ProductionDerivative = z.infer<typeof productionDerivativeSchema>;

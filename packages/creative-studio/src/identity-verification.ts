import { existsSync } from 'node:fs';
import type { IdentityVerdict } from './approval-states.js';

/**
 * CS-9 — Character identity is confirmed ONLY by comparing the candidate image with visual references of that
 * character, never by text prompts or aesthetic similarity ("cyberpunk", "chrome arm", "red hair").
 *
 * Rules fixed a priori (not tuned on the CS-9 images):
 * - at least MIN_TARGET_REFERENCES target references with authentic provenance (official/licensed media or
 *   real frames) and at least MIN_DISTRACTOR_REFERENCES distractors: OTHER characters/subjects that share the
 *   aesthetic (same franchise, same genre). Without them the verdict is `insufficient_references`.
 * - identity score = mean of the 2 highest cosine similarities to target references.
 * - confirmed only when score >= MIN_TARGET_SIMILARITY AND score exceeds the best distractor by MIN_MARGIN.
 *   Beating distractors that share the aesthetic is what separates identity from "looks similar".
 */

export const IDENTITY_RULES = Object.freeze({
  minTargetReferences: 3,
  minDistractorReferences: 3,
  minTargetSimilarity: 0.8,
  minMargin: 0.05,
  authenticProvenances: ['official_media', 'licensed_reference', 'real_video_frame', 'user_supplied_reference'] as const,
});

export type ReferenceProvenance = (typeof IDENTITY_RULES.authenticProvenances)[number] | 'ai_generated' | 'unknown';

export interface IdentityReference {
  path: string;
  provenance: ReferenceProvenance;
  sourceUrl?: string;
  label?: string;
}

export interface IdentityReferenceSet {
  subject: string;
  targets: IdentityReference[];
  distractors: IdentityReference[];
}

export type ImageEmbedder = (imagePaths: string[]) => Promise<number[][]>;

export interface IdentityVerificationResult extends IdentityVerdict {
  targetScore: number | null;
  bestDistractorScore: number | null;
  bestDistractorLabel: string | null;
  margin: number | null;
  usableTargets: number;
  usableDistractors: number;
  reasons: string[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) ** 2;
    nb += (b[i] ?? 0) ** 2;
  }
  return dot / Math.max(1e-9, Math.sqrt(na) * Math.sqrt(nb));
}

function isAuthentic(ref: IdentityReference): boolean {
  return (IDENTITY_RULES.authenticProvenances as readonly string[]).includes(ref.provenance) && existsSync(ref.path);
}

export async function verifyCharacterIdentity(input: {
  candidatePath: string;
  references: IdentityReferenceSet;
  embed: ImageEmbedder;
}): Promise<IdentityVerificationResult> {
  const { references } = input;
  const targets = references.targets.filter(isAuthentic);
  const distractors = references.distractors.filter((d) => existsSync(d.path));
  const reasons: string[] = [];
  const base = {
    subject: references.subject,
    usableTargets: targets.length,
    usableDistractors: distractors.length,
    targetScore: null,
    bestDistractorScore: null,
    bestDistractorLabel: null,
    margin: null,
  };

  const rejectedTargets = references.targets.length - targets.length;
  if (rejectedTargets > 0) {
    reasons.push(`${rejectedTargets} referência(s) alvo descartada(s): proveniência não autêntica ou arquivo ausente.`);
  }
  if (targets.length < IDENTITY_RULES.minTargetReferences || distractors.length < IDENTITY_RULES.minDistractorReferences) {
    reasons.push(
      `Referências insuficientes: ${targets.length}/${IDENTITY_RULES.minTargetReferences} alvo autênticas e ` +
        `${distractors.length}/${IDENTITY_RULES.minDistractorReferences} distratores de estética semelhante.`,
    );
    return {
      ...base,
      status: 'insufficient_references',
      evidence: reasons.join(' '),
      reasons,
    };
  }

  const paths = [input.candidatePath, ...targets.map((t) => t.path), ...distractors.map((d) => d.path)];
  const embeddings = await input.embed(paths);
  if (embeddings.length !== paths.length) throw new Error('Embedder returned an unexpected number of vectors.');
  const vec = (i: number): number[] => embeddings[i] ?? [];
  const candidate = vec(0);
  const targetSims = targets.map((_, i) => cosine(candidate, vec(1 + i))).sort((a, b) => b - a);
  const distractorSims = distractors.map((d, i) => ({
    label: d.label ?? d.path,
    sim: cosine(candidate, vec(1 + targets.length + i)),
  }));
  const targetScore = ((targetSims[0] ?? 0) + (targetSims[1] ?? targetSims[0] ?? 0)) / 2;
  const best = distractorSims.reduce((m, d) => (d.sim > m.sim ? d : m), { label: '', sim: -1 });
  const margin = targetScore - best.sim;

  const confirmed = targetScore >= IDENTITY_RULES.minTargetSimilarity && margin >= IDENTITY_RULES.minMargin;
  reasons.push(
    `Similaridade com ${references.subject}: ${targetScore.toFixed(3)} (mín. ${IDENTITY_RULES.minTargetSimilarity}); ` +
      `melhor distrator "${best.label}": ${best.sim.toFixed(3)}; margem ${margin.toFixed(3)} (mín. ${IDENTITY_RULES.minMargin}).`,
  );
  return {
    ...base,
    status: confirmed ? 'confirmed' : 'not_confirmed',
    targetScore: Number(targetScore.toFixed(4)),
    bestDistractorScore: Number(best.sim.toFixed(4)),
    bestDistractorLabel: best.label,
    margin: Number(margin.toFixed(4)),
    evidence: reasons.join(' '),
    reasons,
  };
}

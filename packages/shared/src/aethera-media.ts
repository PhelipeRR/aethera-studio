import { z } from 'zod';
import { identityStatuses, subjectIdentityStatus, type IdentitySignal, type IdentityStatus, type MediaProvenance } from './aethera-studio.js';
import { normalizeGameTitle } from './aethera-game-research.js';

/**
 * Media discovery of the Aethera Studio (AS-04): trailers and gameplay found for a verified game, scored, checked for
 * identity before any download, and mapped to the D-AS-2 editorial states. Pure: no network, no files.
 */

export const candidateSources = ['igdb_video', 'youtube_search', 'manual'] as const;
export const candidateKinds = ['trailer', 'gameplay', 'other'] as const;
export const candidateStatuses = ['proposed', 'selected', 'rejected', 'acquired', 'failed', 'skipped'] as const;
export type CandidateKind = (typeof candidateKinds)[number];
export type CandidateStatus = (typeof candidateStatuses)[number];

export const sourceCandidateSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), runId: z.string().min(1), subjectId: z.string().min(1), referenceId: z.string().min(1).nullable(),
  url: z.string().url().refine((value) => /^https?:\/\//i.test(value), { message: 'A origem precisa ser http(s).' }),
  source: z.enum(candidateSources), kind: z.enum(candidateKinds), title: z.string().min(1), channel: z.string(), channelVerified: z.boolean(), official: z.boolean(),
  durationSeconds: z.number().nonnegative().nullable(), maxHeight: z.number().int().positive().nullable(), publishedAt: z.string().nullable(), license: z.string().nullable(),
  thumbnailUrl: z.string().nullable(), score: z.number().min(0).max(1), reasons: z.array(z.string()), identity: z.enum(identityStatuses).nullable(),
  status: z.enum(candidateStatuses), discoveredAt: z.string().min(1),
});
export type SourceCandidate = z.infer<typeof sourceCandidateSchema>;

export function classifyVideoKind(title: string): CandidateKind {
  const text = title.toLowerCase();
  // Long play first: "20 minutes of gameplay" is footage; "Gameplay Reveal" or "Gameplay Trailer" is a trailer.
  if (/\b(walkthrough|playthrough|longplay|let'?s play|no commentary|first \d+ minutes|minutes of)\b/.test(text)) return 'gameplay';
  if (/\b(trailer|teaser|reveal|announcement|launch)\b/.test(text)) return 'trailer';
  if (/\bgameplay\b/.test(text)) return 'gameplay';
  return 'other';
}

/** Words that say nothing about who owns a channel ("Bandai Namco Europe" and "Bandai Namco Entertainment" are one owner). */
const GENERIC = new Set(['the', 'official', 'channel', 'games', 'game', 'gaming', 'entertainment', 'studio', 'studios', 'interactive', 'publishing', 'digital', 'software', 'media', 'inc', 'ltd', 'llc', 'co', 'corp', 'corporation', 'company', 'group', 'europe', 'america', 'us', 'usa', 'uk', 'japan', 'jp', 'asia', 'global', 'international', 'tv']);
const ownerTokens = (name: string) => normalizeGameTitle(name).split(' ').filter((token) => token.length >= 2 && !GENERIC.has(token));

/** Official when the channel and one of the IGDB companies share their distinctive name words (regional suffixes ignored). */
export function isOfficialChannel(channel: string, companies: readonly string[]): boolean {
  const owner = ownerTokens(channel);
  if (!owner.length) return false;
  return companies.some((company) => {
    const tokens = ownerTokens(company);
    if (!tokens.length) return false;
    const [shorter, longer] = tokens.length <= owner.length ? [tokens, owner] : [owner, tokens];
    return shorter.every((token) => longer.includes(token));
  });
}

type SubjectRef = { id: string; title: string; aliases: readonly string[]; companies: readonly string[] };
const mentions = (text: string, subject: SubjectRef) => [subject.title, ...subject.aliases].map(normalizeGameTitle).filter((name) => name.length >= 3).some((name) => ` ${text} `.includes(` ${name} `));

/**
 * Identity before download (§4.5): IGDB linking the video to the game and an official channel are provenance; the
 * video title is metadata text. A title naming another game of the ranking is a mismatch — strong when it names only
 * the other game, moderate when it names both (comparisons, compilations).
 */
export function candidateIdentitySignals(input: { candidate: Pick<SourceCandidate, 'source' | 'title' | 'official' | 'channel'>; subject: SubjectRef; otherSubjects: readonly SubjectRef[] }): IdentitySignal[] {
  const signals: IdentitySignal[] = [];
  if (input.candidate.source === 'igdb_video') signals.push({ source: 'provenance', verdict: 'match', score: 0.9, evidence: 'O IGDB associa este vídeo ao jogo.' });
  else if (input.candidate.official) signals.push({ source: 'provenance', verdict: 'match', score: 0.8, evidence: `Canal oficial: ${input.candidate.channel}.` });
  const title = normalizeGameTitle(input.candidate.title);
  const ours = mentions(title, input.subject);
  const others = input.otherSubjects.filter((other) => other.id !== input.subject.id && mentions(title, other));
  if (others.length) signals.push({ source: 'metadata_text', verdict: 'mismatch', score: ours ? 0.6 : 0.9, evidence: `O título cita ${others.map((other) => other.title).join(', ')}.` });
  else if (ours) signals.push({ source: 'metadata_text', verdict: 'match', score: 0.85, evidence: 'O título cita o jogo.' });
  else signals.push({ source: 'metadata_text', verdict: 'inconclusive', score: 0.3, evidence: 'O título não cita o jogo.' });
  return signals;
}

export function candidateIdentity(input: Parameters<typeof candidateIdentitySignals>[0]): { status: IdentityStatus; signals: IdentitySignal[] } {
  const signals = candidateIdentitySignals(input);
  return { status: subjectIdentityStatus(signals), signals };
}

/** D-AS-2: editorial use only for verified media from an official channel; uncertainty goes to review. Never legal clearance. */
export function usageForCandidate(input: { official: boolean; identity: IdentityStatus | null }): MediaProvenance['usage'] {
  if (input.identity === 'rejected') return 'blocked';
  return input.official && input.identity === 'verified' ? 'editorial_use' : 'review_required';
}

/** The existing library's rights states: editorial use is "conditional", review is "pending_review". */
export function rightsStatusForUsage(usage: MediaProvenance['usage']): 'conditional' | 'pending_review' | 'blocked' {
  return usage === 'editorial_use' ? 'conditional' : usage === 'review_required' ? 'pending_review' : 'blocked';
}

const FIT: Record<CandidateKind, [number, number]> = { trailer: [30, 300], gameplay: [180, 3_600], other: [30, 3_600] };

/**
 * Editorial ceiling per kind: a source is B-roll for a video of minutes, and indexing cost grows with its length (scene
 * detection decodes all of it, vision runs per segment). Measured 2026-11-11: a 12 h walkthrough is 20 GB, ~16 min of
 * scene detection and thousands of vision segments. Longer sources are never recommended nor downloaded; the probe's
 * 4 h technical limit (VELIX_LIMITS.maxSourceSeconds) stays as the last line.
 */
export const MAX_ACQUIRABLE_SECONDS: Readonly<Record<CandidateKind, number>> = Object.freeze({ trailer: 10 * 60, gameplay: 60 * 60, other: 60 * 60 });
export function exceedsAcquirableDuration(kind: CandidateKind, durationSeconds: number | null): boolean {
  return durationSeconds !== null && durationSeconds > MAX_ACQUIRABLE_SECONDS[kind];
}
export function tooLongReason(kind: CandidateKind): string {
  return `acima do limite de ${MAX_ACQUIRABLE_SECONDS[kind] / 60} min para ${kind === 'trailer' ? 'trailer' : kind === 'gameplay' ? 'gameplay' : 'fonte'}`;
}

/** Explainable score: official channel, identity, resolution (1080p+ preferred), kind and duration fit. */
export function scoreCandidate(candidate: Pick<SourceCandidate, 'official' | 'channelVerified' | 'identity' | 'maxHeight' | 'kind' | 'durationSeconds'>): { score: number; reasons: string[] } {
  if (candidate.identity === 'rejected') return { score: 0, reasons: ['identidade rejeitada'] };
  if (exceedsAcquirableDuration(candidate.kind, candidate.durationSeconds)) return { score: 0, reasons: [tooLongReason(candidate.kind)] };
  const reasons: string[] = [];
  let score = 0;
  if (candidate.official) { score += 0.3; reasons.push('canal oficial'); } else if (candidate.channelVerified) { score += 0.1; reasons.push('canal verificado'); }
  if (candidate.identity === 'verified') { score += 0.25; reasons.push('identidade verificada'); } else if (candidate.identity === 'review_required') { score += 0.1; reasons.push('identidade a revisar'); }
  const height = candidate.maxHeight ?? 0;
  if (height >= 2160) { score += 0.2; reasons.push('2160p'); } else if (height >= 1440) { score += 0.19; reasons.push('1440p'); } else if (height >= 1080) { score += 0.18; reasons.push('1080p'); } else if (height >= 720) { score += 0.08; reasons.push('720p'); } else reasons.push(height ? `${height}p (baixa)` : 'resolução desconhecida');
  if (candidate.kind !== 'other') { score += 0.15; reasons.push(candidate.kind === 'trailer' ? 'trailer' : 'gameplay'); }
  const [min, max] = FIT[candidate.kind];
  if (candidate.durationSeconds !== null && candidate.durationSeconds >= min && candidate.durationSeconds <= max) { score += 0.1; reasons.push('duração adequada'); }
  return { score: Math.round(Math.min(1, score) * 1_000) / 1_000, reasons };
}

/** Per game, the best trailer and the best gameplay that are not rejected, preferring 720p or more. */
export function recommendSelection(candidates: readonly SourceCandidate[]): string[] {
  const picked: string[] = [];
  const subjects = [...new Set(candidates.map((candidate) => candidate.subjectId))];
  for (const subjectId of subjects) {
    for (const kind of ['trailer', 'gameplay'] as const) {
      const pool = candidates.filter((candidate) => candidate.subjectId === subjectId && candidate.kind === kind && candidate.identity !== 'rejected' && candidate.status !== 'rejected' && !exceedsAcquirableDuration(candidate.kind, candidate.durationSeconds));
      const sharp = pool.filter((candidate) => (candidate.maxHeight ?? 0) >= 720);
      const best = [...(sharp.length ? sharp : pool)].sort((a, b) => b.score - a.score)[0];
      if (best) picked.push(best.id);
    }
  }
  return picked;
}

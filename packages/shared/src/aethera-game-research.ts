import { z } from 'zod';

/**
 * Game research of the Aethera Autonomous Studio (AS-03, D-AS-1): what each source said about a game, and the pure
 * rule that turns those observations into `confirmed`, `unconfirmed` or `conflicting`. Nothing here calls a source.
 */

export const gameSources = ['igdb', 'rawg', 'web'] as const;
export type GameSource = (typeof gameSources)[number];

/** YYYY, YYYY-MM or YYYY-MM-DD, with a real month and day. */
const partialDate = z.string().refine((value) => {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
  if (!match) return false;
  const month = match[2] ? Number(match[2]) : 1;
  const day = match[3] ? Number(match[3]) : 1;
  if (month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(Number(match[1]), month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}, { message: 'Data precisa ser AAAA, AAAA-MM ou AAAA-MM-DD válida.' });

export const gameSourceObservationSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: z.enum(gameSources),
  /** IGDB id, RAWG id or the URL of the page. */
  ref: z.string().min(1),
  title: z.string().trim().min(1),
  releaseDate: partialDate.nullable(),
  platforms: z.array(z.string().trim().min(1)),
  /** When the source was consulted (D-AS-1: query dates are kept). */
  retrievedAt: z.string().min(1),
  /** `unverified`: reported but not checked (e.g. a web page that did not load or did not mention the game). */
  status: z.enum(['ok', 'unverified']),
  note: z.string().optional(),
}).refine((value) => value.source !== 'web' || /^https?:\/\//i.test(value.ref), { message: 'Fonte web precisa de URL http(s).', path: ['ref'] });
export type GameSourceObservation = z.infer<typeof gameSourceObservationSchema>;

export function normalizeGameTitle(title: string): string {
  return title.replace(/[™®©]/g, '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export type DatePrecision = 'day' | 'month' | 'year';
const precisionOf = (date: string): DatePrecision => (date.length === 10 ? 'day' : date.length === 7 ? 'month' : 'year');
const truncate = (date: string, precision: DatePrecision) => date.slice(0, precision === 'day' ? 10 : precision === 'month' ? 7 : 4);
const coarser = (a: DatePrecision, b: DatePrecision): DatePrecision => (a === 'year' || b === 'year' ? 'year' : a === 'month' || b === 'month' ? 'month' : 'day');
const sameDate = (a: string, b: string) => { const precision = coarser(precisionOf(a), precisionOf(b)); return truncate(a, precision) === truncate(b, precision); };

export interface GameVerification {
  verification: 'confirmed' | 'unconfirmed' | 'conflicting';
  releaseDate: string | null;
  datePrecision: DatePrecision;
  platforms: string[];
  agreeingSources: GameSource[];
  conflicts: string[];
}

/**
 * Confirmed needs two different kinds of source (IGDB, RAWG, web) agreeing on the date at their common precision;
 * any disagreement is a conflict to show, never resolved silently; otherwise the game stays unconfirmed. IGDB is the
 * primary source for the date shown and the platforms.
 */
export function resolveGameVerification(observations: readonly GameSourceObservation[]): GameVerification {
  const usable = observations.filter((item): item is GameSourceObservation & { releaseDate: string } => item.status === 'ok' && item.releaseDate !== null);
  const conflicts: string[] = [];
  usable.forEach((a, index) => usable.slice(index + 1).forEach((b) => { if (!sameDate(a.releaseDate, b.releaseDate)) conflicts.push(`${a.source} ${a.releaseDate} ≠ ${b.source} ${b.releaseDate}`); }));
  const primary = usable.find((item) => item.source === 'igdb') ?? usable[0];
  const sources = [...new Set(usable.map((item) => item.source))];
  const mostPrecise = [...usable].sort((a, b) => b.releaseDate.length - a.releaseDate.length)[0];
  const releaseDate = conflicts.length ? primary?.releaseDate ?? null : mostPrecise?.releaseDate ?? null;
  const ok = observations.filter((item) => item.status === 'ok');
  const platforms = ok.find((item) => item.source === 'igdb' && item.platforms.length)?.platforms ?? ok.find((item) => item.platforms.length)?.platforms ?? [];
  return {
    verification: conflicts.length ? 'conflicting' : sources.length >= 2 ? 'confirmed' : 'unconfirmed',
    releaseDate,
    datePrecision: releaseDate ? precisionOf(releaseDate) : 'year',
    platforms: [...platforms],
    agreeingSources: conflicts.length ? [] : sources,
    conflicts,
  };
}

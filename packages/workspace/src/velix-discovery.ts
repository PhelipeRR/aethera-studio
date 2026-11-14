import { createHash } from 'node:crypto';

export type VelixRightsStatus = 'verified_allowed' | 'conditional' | 'unverified' | 'blocked';
export type VelixAssetRights = {
  owner: string;
  sourceUrl: string;
  license: string;
  evidence: string | null;
  verifiedAt: string | null;
  credit: string | null;
  restrictions: string[];
  status: VelixRightsStatus;
};
export type VelixMediaReference = {
  url: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  language: string | null;
  query: string;
  retrievedAt: string;
  kind: 'video' | 'article';
};
export type VelixClipAnalysis = { duration: number; sceneCuts: number[]; silences: Array<{ start: number; end: number }> };
export type VelixClipSuggestion = { id: string; start: number; end: number; confidence: number; criteria: string[]; accepted: boolean };

export function authorizeAsset(rights: VelixAssetRights): { allowed: boolean; reason: string | null } {
  if (rights.status === 'verified_allowed') {
    if (!rights.evidence || !rights.verifiedAt) return { allowed: false, reason: 'verified_allowed exige evidência e data de verificação' };
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: `asset ${rights.status} não pode entrar automaticamente na produção` };
}

function canonicalUrl(input: string): string {
  const url = new URL(input);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  return url.toString();
}

export function deduplicateReferences(references: readonly VelixMediaReference[]): VelixMediaReference[] {
  const found = new Map<string, VelixMediaReference>();
  for (const reference of references) {
    let key: string;
    try { key = canonicalUrl(reference.url); } catch { continue; }
    const current = found.get(key);
    if (!current || reference.retrievedAt > current.retrievedAt) found.set(key, reference);
  }
  return [...found.values()];
}

export function suggestClipIntervals(analysis: VelixClipAnalysis): VelixClipSuggestion[] {
  const cuts = [...new Set([0, ...analysis.sceneCuts, analysis.duration])].filter((n) => Number.isFinite(n) && n >= 0 && n <= analysis.duration).sort((a, b) => a - b);
  const out: VelixClipSuggestion[] = [];
  for (let index = 0; index < cuts.length - 1; index++) {
    const start = cuts[index] ?? 0;
    const end = cuts[index + 1] ?? analysis.duration;
    if (end - start < 1) continue;
    const silence = analysis.silences.find((item) => item.start > start && item.start < end);
    const adjustedStart = silence && silence.end < end ? silence.end : start;
    if (end - adjustedStart < 1) continue;
    const criteria = ['scene-cut'];
    if (silence) criteria.push('silence-boundary');
    out.push({ id: createHash('sha256').update(`${adjustedStart}:${end}`).digest('hex').slice(0, 16), start: adjustedStart, end, confidence: silence ? 0.85 : 0.65, criteria, accepted: false });
  }
  return out;
}

export function buildAttribution(rights: VelixAssetRights): string {
  return [`Fonte: ${rights.sourceUrl}`, `Titular: ${rights.owner}`, `Licença: ${rights.license}`, `Evidência: ${rights.evidence ?? 'não informada'}`, `Verificado em: ${rights.verifiedAt ?? 'não verificado'}`, `Crédito: ${rights.credit ?? 'não informado'}`, 'A revisão humana continua necessária; este registro não declara fair use ou outra exceção legal.'].join('\n');
}

/** Formal limits of the Velix media work: every job runs inside them, whatever the file or the machine. */
export const VELIX_LIMITS = { maxSourceBytes: 500 * 1024 * 1024, maxSourceSeconds: 4 * 60 * 60, ffmpegThreads: 2, analysisTimeoutMs: 30 * 60 * 1000, renderTimeoutMs: 60 * 60 * 1000, maxRunningJobs: 2, discoveryCacheMs: 15 * 60 * 1000 } as const;

export type VelixRadarReference = { publisher: string; publishedAt: string | null };
export type VelixRadar = { days: number; measuredAt: string; total: number; undated: number; inWindow: number; previousWindow: number; publishers: Array<{ publisher: string; count: number }>; daily: Array<{ day: string; count: number }> };

/** Counts what the project's own sources published. It measures this sample, never a platform trend. */
export function buildVelixRadar(references: readonly VelixRadarReference[], input: { days: number; now: Date }): VelixRadar {
  const end = input.now.getTime(); const span = input.days * 24 * 60 * 60 * 1000;
  const dated = references.flatMap((item) => { const time = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN; return Number.isNaN(time) || time > end ? [] : [{ publisher: item.publisher, time }]; });
  const window = dated.filter((item) => item.time >= end - span);
  const tally = (keys: string[]) => { const counts = new Map<string, number>(); for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1); return [...counts]; };
  return {
    days: input.days, measuredAt: input.now.toISOString(), total: references.length, undated: references.length - dated.length, inWindow: window.length,
    previousWindow: dated.filter((item) => item.time < end - span && item.time >= end - 2 * span).length,
    publishers: tally(window.map((item) => item.publisher)).map(([publisher, count]) => ({ publisher, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    daily: tally(window.map((item) => new Date(item.time).toISOString().slice(0, 10))).map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

export type VelixRightsRow = { referenceId: string; status: string; credit: string | null; owner: string; license: string };

/** Rights are an append-only history, so the last row of a reference is what holds now. */
export function currentRights<T extends { referenceId: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.referenceId, row]));
}

export function velixCredits(rows: readonly VelixRightsRow[]): string[] {
  return rows.flatMap((row) => (row.credit?.trim() ? [`${row.credit.trim()} (${row.license}, ${row.owner})`] : []));
}

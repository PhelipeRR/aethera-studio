/**
 * CS-9 — Search-only probe of the authentic media sources Aethera already ships.
 * Runs the same chain the desktop uses (local library, Wikimedia Commons, Internet Archive, yt-dlp search)
 * for the three identities under validation. It DOES NOT download any media; it records provider statuses,
 * candidates and whether each candidate's metadata names the subject (the same relevance rule used in production).
 *
 * Usage: npx tsx scripts/cs9-authentic-source-probe.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchResilientMediaSources } from '../packages/cinema/src/analysis/resilient-media-sources.js';
import { defaultYtDlp, ytDlpSearch } from '../packages/workspace/src/aethera-acquisition.js';
import { isRelevantCandidate } from '../apps/aethera-desktop/src/main/creative-authentic-media.js';

const SUBJECTS = [
  { subject: 'Johnny Silverhand', query: 'Cyberpunk 2077 Johnny Silverhand' },
  { subject: 'Malenia', query: 'Elden Ring Malenia' },
  { subject: 'Hornet', query: 'Hollow Knight Silksong Hornet' },
];

const appData = process.env['APPDATA'] ?? '';
const ytDlp = defaultYtDlp();

async function main(): Promise<void> {
  const report = [];
  for (const s of SUBJECTS) {
    const res = await searchResilientMediaSources(
      s.query,
      {
        localMediaDirs: [join(appData, 'AetheraStudio', 'cinema-media')],
        ytDlpSearchFn: (q, count, sig) => ytDlpSearch(ytDlp, q, count, sig),
      },
      AbortSignal.timeout(90_000),
      { genre: 'games', prompt: s.query },
    );
    const candidates = res.candidates.map((c) => ({
      origin: c.origin,
      title: c.title ?? null,
      url: c.url,
      license: c.license,
      directDownloadable: Boolean(c.directDownloadable),
      relevant: isRelevantCandidate(s.query, `${c.title ?? ''} ${c.description ?? ''} ${c.url}`, s.subject),
    }));
    report.push({ ...s, providerStatuses: res.providerStatuses, candidates });
    console.log(`\n## ${s.subject} — "${s.query}"`);
    for (const p of res.providerStatuses) console.log(`  ${p.provider}: ${p.status} (${p.count})${p.detail ? ` — ${p.detail.slice(0, 120)}` : ''}`);
    for (const c of candidates) console.log(`  [${c.relevant ? 'RELEVANT' : 'ignored '}] ${c.origin} | ${c.title} | ${c.url}`);
  }
  const out = join(import.meta.dirname, '..', 'artifacts', 'cs9-reference-set', 'authentic-source-probe.json');
  writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), downloads: 0, report }, null, 2));
  console.log(`\nReport: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

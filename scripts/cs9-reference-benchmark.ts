/**
 * CS-9 — Reference-set benchmark. Measures false positives / false negatives of:
 *   1. the historical CS-9 combined gate (verdicts recorded in the CS-9 summaries),
 *   2. the CS-9 script "Quality" metric (step2/step3), recomputed on every image exactly as the scripts did,
 *   3. the new decision rules (independent states + identity against references).
 * Labels come from artifacts/cs9-reference-set/labels.json. A human label (humanLabel) overrides the provisional
 * one; metrics are reported separately for human-documented and provisional labels.
 *
 * Usage: npx tsx scripts/cs9-reference-benchmark.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { verifyCharacterIdentity, type IdentityReferenceSet } from '../packages/creative-studio/src/identity-verification.js';
import { PersistentPythonAiAdapter } from '../packages/creative-studio/src/persistent-ai-adapter.js';

const ROOT = join(import.meta.dirname, '..');
const SET_DIR = join(ROOT, 'artifacts', 'cs9-reference-set');

interface Label {
  technical: 'good' | 'acceptable' | 'bad';
  semantic: 'faithful' | 'unfaithful';
  identity: 'confirmed' | 'not_confirmed' | 'not_applicable';
  aesthetic: string;
  source: string;
  defects: string[];
}
interface Item {
  id: string;
  path: string;
  identitySubject: string | null;
  historicalGate: { verdict: 'approved' | 'rejected'; source: string; detail: string } | null;
  humanDocumented?: Record<string, string>;
  humanLabel: (Partial<Label> & { reviewer?: string }) | null;
  label: Label;
}

/** Exact replica of the "Quality" computed by scripts/cs9-step3-generalization.ts (including its 4-byte stride over 3-channel data). */
async function cs9ScriptQuality(path: string): Promise<{ overall: number; passed: boolean; legibility: number }> {
  const meta = await sharp(path).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const stats = await sharp(path).stats();
  const meanStdev = ((stats.channels[0]?.stdev ?? 0) + (stats.channels[1]?.stdev ?? 0) + (stats.channels[2]?.stdev ?? 0)) / 3;
  const edgeBuf = await sharp(path).greyscale().sharpen({ sigma: 1 }).raw().toBuffer();
  let edgeSum = 0;
  for (let i = 0; i < edgeBuf.length; i += 1) edgeSum += edgeBuf[i] ?? 0;
  const avgEdge = edgeBuf.length > 0 ? edgeSum / edgeBuf.length : 0;
  const textRegionH = Math.round(h * 0.4);
  const textRegionBuf = await sharp(path)
    .extract({ left: 0, top: h - textRegionH, width: w, height: textRegionH })
    .resize(224, Math.round((224 * textRegionH) / w), { fit: 'fill' })
    .raw()
    .toBuffer();
  let bright = 0;
  let dark = 0;
  let total = 0;
  for (let i = 0; i < textRegionBuf.length; i += 4) {
    const lum = (textRegionBuf[i] ?? 0) * 0.299 + (textRegionBuf[i + 1] ?? 0) * 0.587 + (textRegionBuf[i + 2] ?? 0) * 0.114;
    total += 1;
    if (lum > 100) bright += 1;
    else if (lum < 40) dark += 1;
  }
  const legibility = Math.min(100, Math.round(Math.min(1, (bright / total) * 20) * Math.min(1, (dark / total) * 1.6) * 100));
  const complexity = Math.min(100, Math.round(meanStdev * 2.5));
  const composition = Math.min(100, Math.round(avgEdge * 1.2 + meanStdev * 0.8));
  const overall = Math.round(complexity * 0.3 + legibility * 0.4 + composition * 0.3);
  return { overall, passed: overall >= 55 && meanStdev >= 18, legibility };
}

function loadReferences(subject: string): IdentityReferenceSet {
  const manifest = join(SET_DIR, 'identity-references', subject.toLowerCase().replace(/\s+/g, '-'), 'manifest.json');
  if (!existsSync(manifest)) return { subject, targets: [], distractors: [] };
  const raw = JSON.parse(readFileSync(manifest, 'utf8')) as IdentityReferenceSet;
  const base = join(manifest, '..');
  // Held-out controls in the manifest are deliberately NOT references.
  return {
    subject,
    targets: raw.targets.map((t) => ({ ...t, path: join(base, t.path) })),
    distractors: raw.distractors.map((d) => ({ ...d, path: join(base, d.path) })),
  };
}

interface Confusion { tp: number; fp: number; tn: number; fn: number; n: number; fpIds: string[]; fnIds: string[] }
function confusion(rows: Array<{ id: string; predictedPositive: boolean | null; actualPositive: boolean }>): Confusion & { notEvaluable: number } {
  const c = { tp: 0, fp: 0, tn: 0, fn: 0, n: 0, fpIds: [] as string[], fnIds: [] as string[], notEvaluable: 0 };
  for (const r of rows) {
    if (r.predictedPositive === null) {
      c.notEvaluable += 1;
      continue;
    }
    c.n += 1;
    if (r.predictedPositive && r.actualPositive) c.tp += 1;
    else if (r.predictedPositive && !r.actualPositive) { c.fp += 1; c.fpIds.push(r.id); }
    else if (!r.predictedPositive && r.actualPositive) { c.fn += 1; c.fnIds.push(r.id); }
    else c.tn += 1;
  }
  return c;
}
const rate = (num: number, den: number) => (den === 0 ? null : Number((num / den).toFixed(3)));

async function main(): Promise<void> {
  const labels = JSON.parse(readFileSync(join(SET_DIR, 'labels.json'), 'utf8')) as { items: Item[] };
  let adapter: PersistentPythonAiAdapter | undefined;
  const rows = [];
  for (const item of labels.items) {
    const label: Label = { ...item.label, ...(item.humanLabel ?? {}) } as Label;
    const labelOrigin = item.humanLabel ? 'human' : item.humanDocumented ? 'human_documented_set_level' : 'claude_provisional';
    const abs = join(ROOT, item.path);
    const quality = await cs9ScriptQuality(abs);

    let identity: Awaited<ReturnType<typeof verifyCharacterIdentity>> | null = null;
    if (item.identitySubject) {
      identity = await verifyCharacterIdentity({
        candidatePath: abs,
        references: loadReferences(item.identitySubject),
        // CLIP image embeddings are only requested when the subject has enough authentic references.
        embed: (paths) => (adapter ??= new PersistentPythonAiAdapter()).embedImages(paths),
      });
    }
    // New rules: semantic fidelity is only confirmed with identity confirmed (when claimed); technical needs the layered
    // document (flattened PNGs carry no layer geometry); aesthetic needs a named human reviewer.
    const newSemanticConfirmed = item.identitySubject ? identity?.status === 'confirmed' : null;
    const newTechnical = null; // not evaluable: no .aethera-creative.json was persisted for these renders
    const newReleaseReady = false; // humanAesthetic is pending for every item in this set

    const actualTechnicalOk = label.technical !== 'bad';
    const actualOverallOk = actualTechnicalOk && label.semantic === 'faithful' && label.identity !== 'not_confirmed';
    rows.push({
      id: item.id,
      path: item.path,
      labelOrigin,
      label,
      historicalGate: item.historicalGate?.verdict ?? null,
      cs9ScriptQuality: quality,
      identity: identity ? { status: identity.status, evidence: identity.evidence } : null,
      newSemanticConfirmed,
      newTechnical,
      newReleaseReady,
      actualTechnicalOk,
      actualOverallOk,
    });
  }

  const byOrigin = (origin: string | null) => rows.filter((r) => origin === null || r.labelOrigin === origin);
  const metrics = (subset: typeof rows) => ({
    n: subset.length,
    historicalGateVsOverall: confusion(
      subset.filter((r) => r.historicalGate !== null).map((r) => ({ id: r.id, predictedPositive: r.historicalGate === 'approved', actualPositive: r.actualOverallOk })),
    ),
    cs9ScriptQualityVsTechnical: confusion(subset.map((r) => ({ id: r.id, predictedPositive: r.cs9ScriptQuality.passed, actualPositive: r.actualTechnicalOk }))),
    newIdentityVsLabel: confusion(
      subset.filter((r) => r.newSemanticConfirmed !== null).map((r) => ({ id: r.id, predictedPositive: r.newSemanticConfirmed, actualPositive: r.label.identity === 'confirmed' })),
    ),
    newReleaseVsOverall: confusion(subset.map((r) => ({ id: r.id, predictedPositive: r.newReleaseReady, actualPositive: r.actualOverallOk }))),
    newTechnicalEvaluable: subset.filter((r) => r.newTechnical !== null).length,
  });
  const summary = {
    generatedAt: new Date().toISOString(),
    labelOrigins: Object.fromEntries(['human', 'human_documented_set_level', 'claude_provisional'].map((o) => [o, byOrigin(o).length])),
    all: metrics(rows),
    humanDocumentedOnly: metrics(byOrigin('human_documented_set_level')),
    provisionalOnly: metrics(byOrigin('claude_provisional')),
  };
  for (const k of ['all', 'humanDocumentedOnly', 'provisionalOnly'] as const) {
    const q = summary[k].cs9ScriptQualityVsTechnical;
    Object.assign(q, { fpr: rate(q.fp, q.fp + q.tn), fnr: rate(q.fn, q.fn + q.tp) });
  }
  await adapter?.shutdown();
  writeFileSync(join(SET_DIR, 'benchmark-results.json'), JSON.stringify({ summary, rows }, null, 2) + '\n');

  const fmt = (c: Confusion & { notEvaluable: number; fpr?: number | null; fnr?: number | null }) =>
    `n=${c.n} TP=${c.tp} FP=${c.fp} TN=${c.tn} FN=${c.fn}${c.notEvaluable ? ` (não avaliável: ${c.notEvaluable})` : ''}${c.fpr !== undefined ? ` FPR=${c.fpr} FNR=${c.fnr}` : ''}`;
  for (const k of ['all', 'humanDocumentedOnly', 'provisionalOnly'] as const) {
    const m = summary[k];
    console.log(`\n== ${k} (n=${m.n})`);
    console.log(`  Gate histórico CS-9 vs rótulo global : ${fmt(m.historicalGateVsOverall)}  FP=${m.historicalGateVsOverall.fpIds.join(', ') || '-'}`);
    console.log(`  "Quality" dos scripts CS-9 vs técnico : ${fmt(m.cs9ScriptQualityVsTechnical)}`);
    console.log(`    FP: ${m.cs9ScriptQualityVsTechnical.fpIds.join(', ') || '-'}`);
    console.log(`    FN: ${m.cs9ScriptQualityVsTechnical.fnIds.join(', ') || '-'}`);
    console.log(`  Identidade (novo) vs rótulo          : ${fmt(m.newIdentityVsLabel)}`);
    console.log(`  Liberação (novo) vs rótulo global     : ${fmt(m.newReleaseVsOverall)}  FN=${m.newReleaseVsOverall.fnIds.join(', ') || '-'}`);
    console.log(`  Técnico (novo) avaliável em PNG achatado: ${m.newTechnicalEvaluable}`);
  }
  for (const r of rows) if (r.identity) console.log(`  [identidade] ${r.id}: ${r.identity.status} — ${r.identity.evidence}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

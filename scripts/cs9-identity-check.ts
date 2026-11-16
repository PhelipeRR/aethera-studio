/**
 * CS-9 — Real identity check (CLIP ViT-B/32 image↔image) against curated Malenia references.
 * References: artifacts/cs9-reference-set/identity-references/malenia/manifest.json (frames from archived
 * gameplay VODs, cropped to the character; full frames with the streamer's webcam were not kept).
 *
 * Candidates:
 *  - held-out Malenia frames that are NOT used as references (positive controls → expected "confirmed"),
 *  - the CS-9 "Malenia" thumbnail and other CS-9 renders (expected "not_confirmed").
 *
 * Usage: npx tsx scripts/cs9-identity-check.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PersistentPythonAiAdapter } from '../packages/creative-studio/src/persistent-ai-adapter.js';
import { IDENTITY_RULES, verifyCharacterIdentity, type IdentityReferenceSet } from '../packages/creative-studio/src/identity-verification.js';

const ROOT = join(import.meta.dirname, '..');
const REF_DIR = join(ROOT, 'artifacts', 'cs9-reference-set', 'identity-references', 'malenia');

interface ManifestEntry { path: string; provenance: string; sourceUrl: string; label: string; note: string }
interface Manifest { subject: string; targets: ManifestEntry[]; distractors: ManifestEntry[]; controls: ManifestEntry[] }

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(join(REF_DIR, 'manifest.json'), 'utf8')) as Manifest;
  const references: IdentityReferenceSet = {
    subject: manifest.subject,
    targets: manifest.targets.map((t) => ({ path: join(REF_DIR, t.path), provenance: 'real_video_frame', sourceUrl: t.sourceUrl, label: t.label })),
    distractors: manifest.distractors.map((d) => ({ path: join(REF_DIR, d.path), provenance: 'real_video_frame', sourceUrl: d.sourceUrl, label: d.label })),
  };
  const candidates = [
    ...manifest.controls.map((c) => ({ id: `control:${c.path}`, path: join(REF_DIR, c.path), expected: 'confirmed' as const })),
    { id: 'cs9-malenia-step3', path: join(ROOT, 'artifacts/cs9-real-generation/elden-ring-malenia-step3.png'), expected: 'not_confirmed' as const },
    { id: 'cs9-johnny-step2', path: join(ROOT, 'artifacts/cs9-real-generation/cyberpunk-2077-johnny-silverhand-step2.png'), expected: 'not_confirmed' as const },
    { id: 'cs9-hornet-step3', path: join(ROOT, 'artifacts/cs9-real-generation/silksong-hornet-step3.png'), expected: 'not_confirmed' as const },
    { id: 'cs9-cyberpunk-B', path: join(ROOT, 'artifacts/cs9-real-generation/cyberpunk-2077-concept-B-environmental_story.png'), expected: 'not_confirmed' as const },
    { id: 'cs8-implante', path: join(ROOT, 'artifacts/creative-studio-cs8/cyberpunk-2077-concept-A-implante-secreto.png'), expected: 'not_confirmed' as const },
  ];

  const adapter = new PersistentPythonAiAdapter();
  const results = [];
  try {
    for (const c of candidates) {
      const r = await verifyCharacterIdentity({ candidatePath: c.path, references, embed: (paths) => adapter.embedImages(paths) });
      results.push({ ...c, status: r.status, targetScore: r.targetScore, bestDistractorScore: r.bestDistractorScore, bestDistractorLabel: r.bestDistractorLabel, margin: r.margin, correct: r.status === c.expected });
      console.log(`${r.status === c.expected ? 'OK  ' : 'MISS'} ${c.id}: ${r.status} (esperado ${c.expected}) — ${r.evidence}`);
    }
  } finally {
    await adapter.shutdown();
  }
  const positives = results.filter((r) => r.expected === 'confirmed');
  const negatives = results.filter((r) => r.expected === 'not_confirmed');
  const summary = {
    generatedAt: new Date().toISOString(),
    model: 'openai/clip-vit-base-patch32 (image embeddings)',
    rules: IDENTITY_RULES,
    references: { targets: references.targets.length, distractors: references.distractors.length },
    truePositives: positives.filter((r) => r.correct).length,
    falseNegatives: positives.filter((r) => !r.correct).length,
    trueNegatives: negatives.filter((r) => r.correct).length,
    falsePositives: negatives.filter((r) => !r.correct).length,
    caveats: [
      'Only 3 target references and 2 held-out controls from 2 VODs: statistically weak; thresholds were fixed before this run and not tuned.',
      'The game lock-on marker sits on Malenia in targets and controls and on none of the distractors: a possible confound.',
      'References were curated by Claude visual review; human confirmation pending.',
    ],
  };
  writeFileSync(join(ROOT, 'artifacts', 'cs9-reference-set', 'identity-check-malenia.json'), JSON.stringify({ summary, results }, null, 2) + '\n');
  console.log(`\nTP=${summary.truePositives} FN=${summary.falseNegatives} TN=${summary.trueNegatives} FP=${summary.falsePositives}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

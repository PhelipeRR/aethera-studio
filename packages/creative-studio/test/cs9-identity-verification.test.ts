import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyCharacterIdentity, type IdentityReferenceSet, type ImageEmbedder } from '../src/index.js';

/**
 * Decision-logic tests with a deterministic embedder (vectors keyed by file name). They prove the rules:
 * no references → never confirmed; aesthetic look-alikes must be beaten by a margin; AI images are not references.
 * Real CLIP embeddings are exercised by scripts/cs9-reference-benchmark.ts against acquired references.
 */

const dir = mkdtempSync(join(tmpdir(), 'cs9-identity-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const vectors: Record<string, number[]> = {};
function file(name: string, vec: number[]): string {
  const p = join(dir, name);
  writeFileSync(p, 'x');
  vectors[p] = vec;
  return p;
}
const embed: ImageEmbedder = async (paths) => paths.map((p) => vectors[p] ?? [0, 0, 1]);

const target = (n: number, v: number[]) => ({ path: file(`target-${n}.png`, v), provenance: 'official_media' as const });
const distractor = (n: number, v: number[], label: string) => ({ path: file(`distractor-${n}.png`, v), provenance: 'official_media' as const, label });

function refs(over: Partial<IdentityReferenceSet> = {}): IdentityReferenceSet {
  return {
    subject: 'Malenia',
    targets: [target(1, [1, 0, 0]), target(2, [0.98, 0.2, 0]), target(3, [0.95, 0.1, 0.1])],
    distractors: [
      distractor(1, [0, 1, 0], 'Ranni'),
      distractor(2, [0.2, 0.98, 0], 'Radahn'),
      distractor(3, [0, 0.9, 0.3], 'Generic fantasy knight'),
    ],
    ...over,
  };
}

describe('CS-9 — verifyCharacterIdentity', () => {
  it('returns insufficient_references when there are no authentic references (never confirms from prompts)', async () => {
    const r = await verifyCharacterIdentity({ candidatePath: file('cand-0.png', [1, 0, 0]), references: refs({ targets: [] }), embed });
    expect(r.status).toBe('insufficient_references');
    expect(r.targetScore).toBeNull();
  });

  it('does not accept AI-generated images as identity references', async () => {
    const aiTargets = refs().targets.map((t) => ({ ...t, provenance: 'ai_generated' as const }));
    const r = await verifyCharacterIdentity({ candidatePath: file('cand-1.png', [1, 0, 0]), references: refs({ targets: aiTargets }), embed });
    expect(r.status).toBe('insufficient_references');
    expect(r.reasons.join(' ')).toContain('proveniência não autêntica');
  });

  it('confirms when the candidate matches the character and beats same-aesthetic distractors by the margin', async () => {
    const r = await verifyCharacterIdentity({ candidatePath: file('cand-2.png', [0.99, 0.05, 0.05]), references: refs(), embed });
    expect(r.status).toBe('confirmed');
    expect(r.margin ?? -1).toBeGreaterThanOrEqual(0.05);
  });

  it('does not confirm an image that only shares the aesthetic (closer to a distractor)', async () => {
    const r = await verifyCharacterIdentity({ candidatePath: file('cand-3.png', [0.6, 0.8, 0]), references: refs(), embed });
    expect(r.status).toBe('not_confirmed');
  });

  it('does not confirm an off-subject image (coins on a circuit board) even if no distractor is close', async () => {
    const r = await verifyCharacterIdentity({ candidatePath: file('cand-4.png', [0, 0, 1]), references: refs(), embed });
    expect(r.status).toBe('not_confirmed');
    expect(r.targetScore ?? 1).toBeLessThan(0.8);
  });
});

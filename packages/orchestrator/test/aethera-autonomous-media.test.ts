import type { EditorialPlan } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { resolveMediaGapsAutonomously, type MediaGap } from '../src/aethera/autonomous-media.js';
import { selectAutonomousMediaCandidates } from '../src/aethera/media-hunter.js';

const minimalPlan = {
  schemaVersion: 1,
  productionId: 'prod-1',
  version: 1,
  status: 'draft',
  hash: 'a'.repeat(64),
  basedOn: { scriptKey: 'k1' },
  director: { provider: 'claude', model: 'sonnet', promptVersion: '1' },
  segments: [
    {
      segmentId: 'seg-1',
      intent: { reason: 'mostrar gravidade' },
      composition: { kind: 'single_shot', subjectId: 'Buraco negro', wants: 'Simulação gravitacional', camera: 'static', label: null },
    },
    {
      segmentId: 'seg-2',
      intent: { reason: 'mostrar farol cósmico' },
      composition: { kind: 'single_shot', subjectId: 'Farol cósmico', wants: 'Pulso de luz no espaço', camera: 'slow_in', label: null },
    },
  ],
} as unknown as EditorialPlan;

const gaps: MediaGap[] = [
  { segmentId: 'seg-1', kind: 'footage', reason: 'sem filmagem limpa disponível' },
  { segmentId: 'seg-2', kind: 'footage', reason: 'sem filmagem aceita' },
];

describe('autonomous media decisions (D-AP-18)', () => {
  it('selects top non-rejected candidates per subject autonomously', () => {
    const picked = selectAutonomousMediaCandidates([
      { id: 'c1', subjectId: 's1', score: 0.4, identity: 'verified', status: 'proposed' },
      { id: 'c2', subjectId: 's1', score: 0.9, identity: 'verified', status: 'proposed' },
      { id: 'c3', subjectId: 's1', score: 0.95, identity: 'rejected', status: 'proposed' },
      { id: 'c4', subjectId: 's2', score: 0.7, identity: 'verified', status: 'proposed' },
    ] as never, 1);

    expect(picked.map((c) => c.id)).toEqual(['c2', 'c4']);
  });

  it('resolves gaps autonomously via acquisition or fallback generation with provenance', async () => {
    const result = await resolveMediaGapsAutonomously(minimalPlan, gaps, {
      searchAndAcquire: async ({ segmentId }) =>
        segmentId === 'seg-1'
          ? { id: 'acq-1', assetPath: 'media/blackhole.mp4', sourceUrl: 'https://example.org/bh.mp4', origin: 'acquired', license: 'CC0', subject: 'Buraco negro', durationMs: 5000 }
          : null,
      generateVisual: async ({ segmentId }) => ({
        id: `gen-${segmentId}`,
        assetPath: `media/${segmentId}.mp4`,
        origin: 'generated',
        license: 'local-generated-autonomous',
        subject: 'Farol cósmico',
        durationMs: 4000,
      }),
      now: () => new Date('2026-11-13T18:50:00Z'),
    });

    expect(result.resolvedCount).toBe(2);
    expect(result.unresolvedCount).toBe(0);
    expect(result.resolutions[0]?.provenanceRecord).toMatchObject({
      segmentId: 'seg-1',
      origin: 'acquired',
      autonomous: true,
      license: 'CC0',
    });
    expect(result.resolutions[1]?.provenanceRecord).toMatchObject({
      segmentId: 'seg-2',
      origin: 'generated',
      autonomous: true,
    });
  });
});

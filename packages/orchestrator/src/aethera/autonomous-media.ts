import { createHash } from 'node:crypto';
import type { EditorialPlan } from '@neuralbridge/shared';

export interface MediaGap {
  segmentId: string;
  kind?: string;
  reason: string;
}

export interface AutonomousMediaCandidate {
  id: string;
  assetPath: string;
  sourceUrl?: string;
  origin: 'acquired' | 'generated' | 'stock';
  license: string;
  subject: string;
  durationMs: number;
  sha256?: string;
}

export interface AutonomousMediaDeps {
  /** Search and download/acquire footage autonomously for a given subject/description. */
  searchAndAcquire?: (input: { segmentId: string; subject: string; description: string; minDurationMs: number }) => Promise<AutonomousMediaCandidate | null>;
  /** Generate visual media (image/video) autonomously when no footage can be acquired. */
  generateVisual?: (input: { segmentId: string; subject: string; prompt: string; durationMs: number }) => Promise<AutonomousMediaCandidate | null>;
  now?: () => Date;
}

export interface AutonomousMediaResolution {
  segmentId: string;
  status: 'resolved' | 'unresolved';
  candidate?: AutonomousMediaCandidate;
  provenanceRecord?: {
    segmentId: string;
    origin: 'acquired' | 'generated' | 'stock';
    license: string;
    sourceUrl?: string;
    sha256: string;
    autonomous: true;
    resolvedAt: string;
  };
  reason?: string;
}

function extractSubjectAndWants(segment: EditorialPlan['segments'][number] | undefined, fallbackId: string, fallbackReason: string): { subject: string; wants: string } {
  if (!segment) return { subject: fallbackId, wants: fallbackReason };
  const comp = segment.composition;
  if (comp.kind === 'single_shot') {
    return { subject: comp.subjectId ?? fallbackId, wants: comp.wants };
  }
  if (comp.kind === 'picture_in_picture') {
    return { subject: comp.main.subjectId ?? fallbackId, wants: comp.main.wants };
  }
  if (comp.kind === 'multi_panel' && comp.panels[0]) {
    return { subject: comp.panels[0].subjectId ?? fallbackId, wants: comp.panels[0].wants };
  }
  return { subject: fallbackId, wants: segment.communicates || fallbackReason };
}

/**
 * Autonomously resolves media gaps in an EditorialPlan without blocking for human consent (D-AP-18).
 * Tries search/acquisition first, then local visual generation, and always records provenance.
 */
export async function resolveMediaGapsAutonomously(
  plan: EditorialPlan,
  gaps: readonly MediaGap[],
  deps: AutonomousMediaDeps,
): Promise<{ resolutions: AutonomousMediaResolution[]; resolvedCount: number; unresolvedCount: number }> {
  const now = deps.now ?? (() => new Date());
  const resolutions: AutonomousMediaResolution[] = [];
  const segmentMap = new Map(plan.segments.map((s) => [s.segmentId, s]));

  for (const gap of gaps) {
    const { subject, wants } = extractSubjectAndWants(segmentMap.get(gap.segmentId), gap.segmentId, gap.reason);

    let candidate: AutonomousMediaCandidate | null = null;
    if (deps.searchAndAcquire) {
      candidate = await deps.searchAndAcquire({
        segmentId: gap.segmentId,
        subject,
        description: wants,
        minDurationMs: 3_000,
      });
    }
    if (!candidate && deps.generateVisual) {
      candidate = await deps.generateVisual({
        segmentId: gap.segmentId,
        subject,
        prompt: `${subject}: ${wants}`,
        durationMs: 4_000,
      });
    }

    if (candidate) {
      const sha256 = candidate.sha256 ?? createHash('sha256').update(`${candidate.id}:${candidate.assetPath}`).digest('hex');
      resolutions.push({
        segmentId: gap.segmentId,
        status: 'resolved',
        candidate,
        provenanceRecord: {
          segmentId: gap.segmentId,
          origin: candidate.origin,
          license: candidate.license,
          ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
          sha256,
          autonomous: true,
          resolvedAt: now().toISOString(),
        },
      });
    } else {
      resolutions.push({
        segmentId: gap.segmentId,
        status: 'unresolved',
        reason: 'nenhum provedor autônomo retornou mídia compatível',
      });
    }
  }

  return {
    resolutions,
    resolvedCount: resolutions.filter((r) => r.status === 'resolved').length,
    unresolvedCount: resolutions.filter((r) => r.status === 'unresolved').length,
  };
}

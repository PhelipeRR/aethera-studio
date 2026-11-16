import { z } from 'zod';

/**
 * CS-9 — Three INDEPENDENT approval states for a creative piece.
 *
 * - technical: produced only by automated gates (QualityGate, typography geometry, VisualContentGate).
 * - semanticFidelity: whether the piece shows what it claims (topic and, when applicable, a character identity).
 *   Identity is only "confirmed" against visual references; aesthetic resemblance is never identity.
 * - humanAesthetic: only a named human reviewer can set it. No automated path writes this state.
 *
 * Each recorder touches exactly one state. A piece is release-ready only when all three agree.
 */

export const technicalApprovalSchema = z.object({
  status: z.enum(['not_evaluated', 'passed', 'failed']),
  checkedAt: z.string().optional(),
  criticalCodes: z.array(z.string()).default([]),
  source: z.string().optional(),
});
export type TechnicalApproval = z.infer<typeof technicalApprovalSchema>;

export const identityVerdictSchema = z.object({
  subject: z.string().min(1),
  status: z.enum(['confirmed', 'not_confirmed', 'insufficient_references', 'not_applicable']),
  evidence: z.string().optional(),
});
export type IdentityVerdict = z.infer<typeof identityVerdictSchema>;

export const semanticFidelitySchema = z.object({
  status: z.enum(['not_evaluated', 'confirmed', 'rejected', 'unverified']),
  checkedAt: z.string().optional(),
  identity: identityVerdictSchema.optional(),
  notes: z.array(z.string()).default([]),
});
export type SemanticFidelity = z.infer<typeof semanticFidelitySchema>;

export const humanAestheticApprovalSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewer: z.string().optional(),
  decidedAt: z.string().optional(),
  notes: z.string().optional(),
});
export type HumanAestheticApproval = z.infer<typeof humanAestheticApprovalSchema>;

export const approvalStatesSchema = z.object({
  technical: technicalApprovalSchema,
  semanticFidelity: semanticFidelitySchema,
  humanAesthetic: humanAestheticApprovalSchema,
});
export type ApprovalStates = z.infer<typeof approvalStatesSchema>;

export function defaultApprovalStates(): ApprovalStates {
  return {
    technical: { status: 'not_evaluated', criticalCodes: [] },
    semanticFidelity: { status: 'not_evaluated', notes: [] },
    humanAesthetic: { status: 'pending' },
  };
}

/** Records an automated technical audit. Never touches semantic or human states. */
export function recordTechnicalAudit(
  states: ApprovalStates,
  audit: { passed: boolean; findings: Array<{ code: string; severity: string }>; checkedAt?: string },
  source = 'QualityGateService',
): ApprovalStates {
  return {
    ...states,
    technical: {
      status: audit.passed ? 'passed' : 'failed',
      checkedAt: audit.checkedAt ?? new Date().toISOString(),
      criticalCodes: [...new Set(audit.findings.filter((f) => f.severity === 'critical').map((f) => f.code))],
      source,
    },
  };
}

/**
 * Records semantic fidelity. When the piece claims a character identity, "confirmed" requires the identity
 * verdict itself to be "confirmed"; any other identity outcome downgrades the state to "unverified" or "rejected".
 */
export function recordSemanticFidelity(
  states: ApprovalStates,
  input: { topicMatches: boolean; identity?: IdentityVerdict; notes?: string[]; checkedAt?: string },
): ApprovalStates {
  let status: SemanticFidelity['status'];
  if (!input.topicMatches) status = 'rejected';
  else if (!input.identity || input.identity.status === 'not_applicable' || input.identity.status === 'confirmed') status = 'confirmed';
  else if (input.identity.status === 'not_confirmed') status = 'rejected';
  else status = 'unverified';
  return {
    ...states,
    semanticFidelity: {
      status,
      checkedAt: input.checkedAt ?? new Date().toISOString(),
      ...(input.identity ? { identity: input.identity } : {}),
      notes: input.notes ?? [],
    },
  };
}

/** Records a human aesthetic decision. Requires a named reviewer; independent of the technical verdict. */
export function recordHumanAestheticDecision(
  states: ApprovalStates,
  input: { decision: 'approved' | 'rejected'; reviewer: string; notes?: string; decidedAt?: string },
): ApprovalStates {
  const reviewer = input.reviewer.trim();
  if (!reviewer) throw new Error('A decisão estética exige um revisor humano identificado.');
  return {
    ...states,
    humanAesthetic: {
      status: input.decision,
      reviewer,
      decidedAt: input.decidedAt ?? new Date().toISOString(),
      ...(input.notes ? { notes: input.notes } : {}),
    },
  };
}

export interface ReleaseReadiness {
  ready: boolean;
  blockers: string[];
}

export function releaseReadiness(states: ApprovalStates): ReleaseReadiness {
  const blockers: string[] = [];
  if (states.technical.status !== 'passed') {
    blockers.push(
      states.technical.status === 'failed'
        ? `Aprovação técnica reprovada (${states.technical.criticalCodes.join(', ') || 'sem código'}).`
        : 'Aprovação técnica não avaliada.',
    );
  }
  if (states.semanticFidelity.status !== 'confirmed') {
    const identity = states.semanticFidelity.identity;
    blockers.push(
      identity && identity.status !== 'confirmed' && identity.status !== 'not_applicable'
        ? `Fidelidade semântica ${states.semanticFidelity.status}: identidade de "${identity.subject}" ${identity.status}.`
        : `Fidelidade semântica ${states.semanticFidelity.status}.`,
    );
  }
  if (states.humanAesthetic.status !== 'approved') {
    blockers.push(
      states.humanAesthetic.status === 'rejected'
        ? `Aprovação estética humana rejeitada por ${states.humanAesthetic.reviewer ?? 'revisor'}.`
        : 'Aprovação estética humana pendente.',
    );
  }
  return { ready: blockers.length === 0, blockers };
}

import { z } from 'zod';
import type { ProductionQualityCheck } from './velix-production.js';

/**
 * Claims and evidence of an autonomous Velix production. A fact needs evidence a person approved; opinion, estimate and
 * forecast are allowed as long as they are labelled. What research finds is never authorization: a source outside the
 * approved references is a discovery, and media is a candidate until the Rights Manager says otherwise.
 */

export const claimKinds = ['fact', 'opinion', 'estimate', 'forecast'] as const;
export type ClaimKind = (typeof claimKinds)[number];
export const evidenceStatuses = ['candidate', 'approved', 'rejected'] as const;
export type EvidenceStatus = (typeof evidenceStatuses)[number];
/** How research classifies what it found. */
export const researchClassifications = ['evidence', 'discovery', 'media_candidate', 'unusable'] as const;
export type ResearchClassification = (typeof researchClassifications)[number];

export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = { fact: 'Fato', opinion: 'Opinião', estimate: 'Estimativa', forecast: 'Previsão' };

/** How many claims a segment may yield, by research depth. */
export const CLAIMS_PER_SEGMENT = { light: 5, standard: 10, deep: 20 } as const;
/** Segments of a Dossiê (single block) script are cut to about this size. */
export const RESEARCH_SEGMENT_WORDS = 400;

const text = (max: number) => z.string().trim().min(1).max(max);
export const researchAnswerSchema = z.object({
  claims: z.array(z.object({
    text: text(500),
    kind: z.enum(claimKinds),
    confidence: z.number().min(0).max(1),
    evidence: z.array(z.object({
      url: z.string().trim().url().max(2_000),
      title: z.string().trim().max(300).default(''),
      publisher: z.string().trim().max(200).default(''),
      publishedAt: z.string().trim().max(40).nullable().default(null),
      excerpt: z.string().trim().max(1_000).default(''),
      confidence: z.number().min(0).max(1).default(0.5),
      classification: z.enum(researchClassifications),
    })).max(8).default([]),
  })).max(40).default([]),
  media: z.array(z.object({ url: z.string().trim().url().max(2_000), title: text(300), kind: z.enum(['video', 'image', 'audio']), reason: z.string().trim().max(500).default('') })).max(20).default([]),
});
export type ResearchAnswer = z.infer<typeof researchAnswerSchema>;

export const RESEARCH_ANSWER_JSON_SCHEMA = {
  type: 'object',
  required: ['claims'],
  properties: {
    claims: { type: 'array', items: { type: 'object', required: ['text', 'kind', 'confidence'], properties: {
      text: { type: 'string' }, kind: { type: 'string', enum: [...claimKinds] }, confidence: { type: 'number' },
      evidence: { type: 'array', items: { type: 'object', required: ['url', 'classification'], properties: { url: { type: 'string' }, title: { type: 'string' }, publisher: { type: 'string' }, publishedAt: { type: ['string', 'null'] }, excerpt: { type: 'string' }, confidence: { type: 'number' }, classification: { type: 'string', enum: [...researchClassifications] } } } },
    } } },
    media: { type: 'array', items: { type: 'object', required: ['url', 'title', 'kind'], properties: { url: { type: 'string' }, title: { type: 'string' }, kind: { type: 'string', enum: ['video', 'image', 'audio'] }, reason: { type: 'string' } } } },
  },
} as const;

/** Only http(s) URLs, compared without fragment, trailing slash or case in the host. */
export function normalizeUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    const path = url.pathname.replace(/\/+$/u, '');
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return null;
  }
}

/**
 * Evidence the agent attached to a claim keeps its classification only when it cites an approved reference: any other
 * source is a discovery (found, not authorized), and a non-http URL is unusable.
 */
export function classifyEvidence(url: string, classification: ResearchClassification, approvedUrls: ReadonlySet<string>): ResearchClassification {
  const normalized = normalizeUrl(url);
  if (!normalized || classification === 'unusable') return 'unusable';
  if (classification === 'media_candidate') return 'media_candidate';
  return approvedUrls.has(normalized) ? 'evidence' : 'discovery';
}

export interface ClaimForGate { id: string; text: string; kind: ClaimKind; evidence: ReadonlyArray<{ status: EvidenceStatus; classification: ResearchClassification }> }
export interface ClaimGate { total: number; facts: number; supported: number; unsupported: Array<{ id: string; text: string }>; labelled: number; passed: boolean }

/** A fact passes only with at least one approved piece of evidence from an approved reference. */
export function claimGate(claims: readonly ClaimForGate[]): ClaimGate {
  const facts = claims.filter((claim) => claim.kind === 'fact');
  const unsupported = facts.filter((claim) => !claim.evidence.some((item) => item.status === 'approved' && item.classification === 'evidence'));
  return { total: claims.length, facts: facts.length, supported: facts.length - unsupported.length, unsupported: unsupported.map(({ id, text: claimText }) => ({ id, text: claimText })), labelled: claims.length - facts.length, passed: unsupported.length === 0 };
}

export function claimGateCheck(gate: ClaimGate): ProductionQualityCheck {
  return {
    id: 'claims-supported', label: 'Afirmações factuais com evidência aprovada', severity: 'blocking', passed: gate.passed,
    evidence: gate.passed ? `${gate.facts} fato(s) com evidência aprovada; ${gate.labelled} marcado(s) como opinião, estimativa ou previsão.` : `${gate.unsupported.length} de ${gate.facts} fato(s) sem evidência aprovada.`,
  };
}

/** What the renderer sees of a claim. */
export const productionClaimSchema = z.strictObject({
  id: z.string(), chapter: z.number().int().nullable(), text: z.string(), kind: z.enum(claimKinds), kindSource: z.enum(['agent', 'user']), confidence: z.number(),
  evidence: z.array(z.strictObject({ id: z.string(), url: z.string(), title: z.string(), publisher: z.string(), publishedAt: z.string().nullable(), excerpt: z.string(), confidence: z.number(), classification: z.enum(researchClassifications), status: z.enum(evidenceStatuses), referenceId: z.string().nullable() })),
});
export type ProductionClaim = z.infer<typeof productionClaimSchema>;
export const productionClaimsSchema = z.strictObject({
  claims: z.array(productionClaimSchema),
  gate: z.strictObject({ total: z.number().int(), facts: z.number().int(), supported: z.number().int(), unsupported: z.array(z.strictObject({ id: z.string(), text: z.string() })), labelled: z.number().int(), passed: z.boolean() }),
  candidates: z.number().int().nonnegative(),
});
export type ProductionClaims = z.infer<typeof productionClaimsSchema>;

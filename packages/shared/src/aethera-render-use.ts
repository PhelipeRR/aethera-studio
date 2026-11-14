import { z } from 'zod';
import type { MediaProvenance } from './aethera-studio.js';
import type { RightsStatus } from './velix-storyboard.js';

/**
 * AP-02 (docs/plans/aethera-production-house.md §14.3): on what basis a piece of media may enter a render. Two records
 * stay separate and are only read here: the Rights Manager (`velix_media_rights`, licence verified by a person) and the
 * Aethera provenance of acquired media (`usage`, `legalClearance`). Acquired media is never "licensed": at most it is
 * used editorially, under the project's explicit policy, and its legal clearance is shown untouched.
 */

export const renderUseBases = ['licensed', 'editorial_use', 'preview_only', 'not_allowed'] as const;
export type RenderUseBasis = (typeof renderUseBases)[number];
export type RenderMode = 'draft' | 'final';

const isoDate = z.string().min(1);
const note = z.string().trim().min(1).max(500);

/** The person's decision to use third-party media editorially in one video project. Off unless recorded. */
export const editorialUsePolicySchema = z.strictObject({
  schemaVersion: z.literal(1), projectId: z.string().min(1), thirdPartyEditorialUse: z.boolean(), note, decidedBy: z.string().min(1), decidedAt: isoDate,
});
export type EditorialUsePolicy = z.infer<typeof editorialUsePolicySchema>;

/** A person's decision on one acquired asset that needed review. */
export const mediaEditorialDecisionSchema = z.strictObject({
  schemaVersion: z.literal(1), assetId: z.string().min(1), projectId: z.string().min(1), decision: z.enum(['approved', 'rejected']), note, decidedBy: z.string().min(1), decidedAt: isoDate,
});
export type MediaEditorialDecision = z.infer<typeof mediaEditorialDecisionSchema>;

export interface RenderUseInput {
  /** Current Rights Manager status of the media reference; null when the Rights Manager has no record. */
  rightsStatus: RightsStatus | null;
  provenance: Pick<MediaProvenance, 'url' | 'publisher' | 'adapter' | 'adapterVersion' | 'acquiredAt' | 'usage' | 'legalClearance'> | null;
  policyEnabled: boolean;
  decision: MediaEditorialDecision['decision'] | null;
}

export interface RenderUse { basis: RenderUseBasis; reason: string; legalClearance: MediaProvenance['legalClearance'] | null }

const complete = (provenance: NonNullable<RenderUseInput['provenance']>) =>
  [provenance.url, provenance.publisher, provenance.adapter, provenance.adapterVersion, provenance.acquiredAt].every((value) => value.trim().length > 0);

export function renderUseBasis(input: RenderUseInput): RenderUse {
  const legalClearance = input.provenance?.legalClearance ?? null;
  const result = (basis: RenderUseBasis, reason: string): RenderUse => ({ basis, reason, legalClearance });
  if (input.rightsStatus === 'verified_allowed') return result('licensed', 'Direito verificado no Rights Manager.');
  if (input.rightsStatus === 'blocked') return result('not_allowed', 'Bloqueada no Rights Manager.');
  const provenance = input.provenance;
  if (!provenance) return result('not_allowed', 'Sem direito verificado nem proveniência de aquisição.');
  if (provenance.usage === 'blocked') return result('not_allowed', 'Uso bloqueado pela proveniência.');
  if (input.decision === 'rejected') return result('not_allowed', 'Uso editorial rejeitado por você.');
  if (!input.policyEnabled) return result('not_allowed', 'A política de uso editorial de mídia de terceiros está desligada neste projeto.');
  if (!complete(provenance)) return result('not_allowed', 'Proveniência incompleta (origem, publicador ou adaptador).');
  if (provenance.usage === 'editorial_use') return result('editorial_use', 'Uso editorial sob a política do projeto; não é licença.');
  return input.decision === 'approved'
    ? result('editorial_use', 'Uso editorial aprovado por você para este ativo; não é licença.')
    : result('preview_only', 'Fonte a revisar: entra só na prévia até a sua decisão.');
}

export function renderUseAllows(basis: RenderUseBasis, mode: RenderMode): boolean {
  if (basis === 'licensed' || basis === 'editorial_use') return true;
  return basis === 'preview_only' && mode === 'draft';
}

/** What the production screen shows for one acquired medium: provenance, the person's decision and the resulting basis. */
export const acquiredMediaUseViewSchema = z.strictObject({
  assetId: z.string().min(1), referenceId: z.string().min(1), title: z.string(), publisher: z.string(), url: z.string(), path: z.string(),
  usage: z.enum(['editorial_use', 'review_required', 'blocked']), legalClearance: z.string(),
  decision: z.enum(['approved', 'rejected']).nullable(), basis: z.enum(renderUseBases), reason: z.string(),
});
export type AcquiredMediaUseView = z.infer<typeof acquiredMediaUseViewSchema>;

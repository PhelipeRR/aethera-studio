import { contentBriefSchema, publicationDraftInputSchema, validatePublishInput, type AutonomyMode, type ContentBrief, type PublicationDraftInput } from '@neuralbridge/shared';
import { isPublicPublicationApprovalRequired } from '@neuralbridge/shared';

export type PublicationPolicyInput = {
  mode: AutonomyMode;
  visibility: 'private' | 'unlisted' | 'public';
  estimatedCostUsd?: number;
  budgetUsd?: number;
};

export type PublicationPolicyResult = {
  allowed: boolean;
  approvalRequired: boolean;
  reason: string | null;
};

export type YouTubePublicationRequest = {
  projectId: string;
  outputRelativePath: string;
  thumbnailRelativePath?: string;
  title: string;
  description: string;
  tags: string[];
  privacy: 'private' | 'unlisted' | 'public';
  publishAt: string | null;
  confirmed: true;
};

/** Maps an approved Aethera package to the existing YouTube publication contract. */
export function toYouTubePublicationRequest(input: { projectId: string; outputRelativePath: string; thumbnailRelativePath?: string; package: PublicationDraftInput; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null }): YouTubePublicationRequest {
  if (!input.outputRelativePath.trim()) throw new Error('invalid: o vídeo renderizado é obrigatório antes da publicação.');
  const normalized = createPublicationPackage(input.package);
  validatePublishInput({ title: normalized.title, description: normalized.description, tags: normalized.tags, privacy: input.privacy, publishAt: input.publishAt });
  return { projectId: input.projectId, outputRelativePath: input.outputRelativePath, ...(input.thumbnailRelativePath ? { thumbnailRelativePath: input.thumbnailRelativePath } : {}), title: normalized.title, description: normalized.description, tags: normalized.tags, privacy: input.privacy, publishAt: input.publishAt, confirmed: true };
}

/** Product policy for publication packages. It deliberately has no provider or OAuth dependency. */
export function evaluatePublicationPolicy(input: PublicationPolicyInput): PublicationPolicyResult {
  const estimatedCostUsd = input.estimatedCostUsd ?? 0;
  const budgetUsd = input.budgetUsd ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) return { allowed: false, approvalRequired: false, reason: 'Custo estimado inválido.' };
  if (estimatedCostUsd > budgetUsd) return { allowed: false, approvalRequired: false, reason: 'O custo estimado excede o orçamento configurado.' };
  const approvalRequired = isPublicPublicationApprovalRequired(input.mode, input.visibility);
  return { allowed: true, approvalRequired, reason: approvalRequired ? 'Publicações públicas exigem aprovação explícita.' : null };
}

export function createPublicationPackage(input: PublicationDraftInput): PublicationDraftInput {
  const brief = contentBriefSchema.parse(input.brief);
  const tags = [...new Set(input.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  const chapters = [...input.chapters].sort((a, b) => a.time - b.time);
  const packageInput = publicationDraftInputSchema.parse({ ...input, brief, tags, chapters });
  validateChapters(packageInput.brief, packageInput.chapters);
  return packageInput;
}

export function validateChapters(brief: ContentBrief, chapters: readonly { time: number; title: string }[]): void {
  let previous = -1;
  for (const chapter of chapters) {
    if (chapter.time < previous || chapter.time >= brief.durationSeconds) throw new Error('invalid: capítulos devem estar em ordem e dentro da duração do vídeo.');
    previous = chapter.time;
  }
}

export function publicationApprovalStatus(policy: PublicationPolicyResult, approved: boolean): 'draft' | 'awaiting_approval' | 'approved' {
  if (!policy.allowed) throw new Error(`policy: ${policy.reason ?? 'publicação bloqueada.'}`);
  if (policy.approvalRequired && !approved) return 'awaiting_approval';
  return approved || !policy.approvalRequired ? 'approved' : 'draft';
}

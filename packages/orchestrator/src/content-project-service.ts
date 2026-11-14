import { contentBriefSchema, isPublicPublicationApprovalRequired, productionBriefSchema, publicationDraftInputSchema, VIDEO_FORMATS, type AutonomyMode, type ContentBrief, type ProductionBrief, type PublicationDraftInput } from '@neuralbridge/shared';

export function validateContentBrief(input: ContentBrief): ContentBrief { return contentBriefSchema.parse(input); }

export function createPublicationDraft(input: PublicationDraftInput): PublicationDraftInput {
  return publicationDraftInputSchema.parse({ ...input, brief: contentBriefSchema.parse(input.brief), tags: [...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))] });
}

export function publicationPolicy(mode: AutonomyMode, visibility: 'private' | 'unlisted' | 'public'): { approvalRequired: boolean; reason: string | null } {
  const approvalRequired = isPublicPublicationApprovalRequired(mode, visibility);
  return { approvalRequired, reason: approvalRequired ? visibility === 'public' ? 'Publicações públicas exigem aprovação explícita.' : 'O modo Manual exige aprovação explícita.' : null };
}

/**
 * The production brief for a content project: the saved briefing (format, duration, audience, tone) when there is one,
 * the channel profile otherwise, and the channel's per-execution budget so the production run enforces it.
 */
export function productionBriefFromContentProject(project: { title: string; brief: ContentBrief | null }, videoProjectId: string, channel: { budgetUsd: number; audience: string; tone: string } | null): ProductionBrief {
  const saved = project.brief;
  return productionBriefSchema.parse({
    schemaVersion: 1, projectId: videoProjectId, format: VIDEO_FORMATS[saved?.format ?? 'youtube-long'], productionType: 'content-project',
    topic: saved?.topic ?? project.title, targetDurationSeconds: saved?.durationSeconds ?? 600, language: 'pt-BR',
    audience: saved?.audience ?? (channel?.audience.trim() || 'público do canal'), tone: saved?.tone ?? (channel?.tone.trim() || 'claro e envolvente'),
    narrativeStyle: 'documental', researchDepth: 'standard', sourceCount: 0, pace: 'standard', budgetUsd: channel?.budgetUsd ?? 0,
  });
}

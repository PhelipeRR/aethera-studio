import { z } from 'zod';
import { contentBriefSchema } from './content-brief.js';
import { contentScriptSchema } from './content-script.js';

export const autonomyModes = ['manual', 'assisted', 'autonomous'] as const;
export type AutonomyMode = (typeof autonomyModes)[number];
export const contentProjectStatuses = ['draft', 'active', 'paused', 'completed', 'archived'] as const;
export const publicationVisibilities = ['private', 'unlisted', 'public'] as const;
export const contentNextActionKinds = ['briefing', 'script', 'production', 'package', 'thumbnail', 'publication', 'analytics'] as const;

const isoDate = z.string().datetime({ offset: true });

export const contentChannelSchema = z.strictObject({
  id: z.string().min(1), workspaceId: z.string().min(1), name: z.string().min(1), niche: z.string().default(''), audience: z.string().default(''), tone: z.string().default(''), budgetUsd: z.number().nonnegative().default(0), concurrencyLimit: z.number().int().positive().default(1),
  autonomy: z.enum(autonomyModes), identity: z.record(z.string(), z.unknown()).default({}), editorialStrategy: z.record(z.string(), z.unknown()).default({}), createdAt: isoDate, updatedAt: isoDate,
});
export type ContentChannel = z.infer<typeof contentChannelSchema>;

export const contentIdeaSchema = z.strictObject({
  id: z.string().min(1), workspaceId: z.string().min(1), channelId: z.string().min(1).nullable(), title: z.string().min(1), angle: z.string().default(''), source: z.string().default('manual'), status: z.enum(['new', 'selected', 'converted', 'discarded']), createdAt: isoDate, updatedAt: isoDate,
});
export type ContentIdea = z.infer<typeof contentIdeaSchema>;
export const contentAssetSchema = z.strictObject({ id: z.string().min(1), projectId: z.string().min(1), path: z.string().min(1), bytes: z.number().int().nonnegative(), sha256: z.string().min(1), rightsStatus: z.enum(['verified_allowed', 'conditional', 'unverified', 'blocked', 'pending_review']) });
export type ContentAsset = z.infer<typeof contentAssetSchema>;

export const contentProjectSchema = z.strictObject({
  id: z.string().min(1), workspaceId: z.string().min(1), channelId: z.string().min(1).nullable(), videoProjectId: z.string().min(1).nullable(), title: z.string().min(1), brief: contentBriefSchema.nullable(), script: contentScriptSchema.nullable().default(null), status: z.enum(contentProjectStatuses), autonomy: z.enum(autonomyModes), createdAt: isoDate, updatedAt: isoDate,
});
export type ContentProject = z.infer<typeof contentProjectSchema>;

export const productionExecutionSchema = z.strictObject({ id: z.string().min(1), projectId: z.string().min(1), status: z.enum(['draft', 'running', 'paused', 'awaiting_approval', 'completed', 'failed', 'cancelled']), createdAt: isoDate, updatedAt: isoDate });
export type ProductionExecution = z.infer<typeof productionExecutionSchema>;
/** Executions that still hold a production slot: everything that has not reached a final state. */
export const activeExecutionStatuses = ['draft', 'running', 'paused', 'awaiting_approval'] as const satisfies readonly ProductionExecution['status'][];

export const publicationPackageSchema = z.strictObject({
  id: z.string().min(1), projectId: z.string().min(1), version: z.number().int().positive(), title: z.string().default(''), description: z.string().default(''), tags: z.array(z.string()), chapters: z.array(z.object({ time: z.number().nonnegative(), title: z.string().min(1) })), thumbnailAssetId: z.string().min(1).nullable(), status: z.enum(['draft', 'awaiting_approval', 'approved', 'published']), createdAt: isoDate, updatedAt: isoDate,
});
export type PublicationPackage = z.infer<typeof publicationPackageSchema>;
export const publicationApprovalSchema = z.strictObject({ id: z.string().min(1), packageId: z.string().min(1), projectId: z.string().min(1), packageVersion: z.number().int().positive(), decision: z.enum(['approved', 'rejected']), approvedBy: z.string().min(1), note: z.string(), createdAt: isoDate });
export type PublicationApproval = z.infer<typeof publicationApprovalSchema>;

export const contentPublicationSchema = z.strictObject({ id: z.string().min(1), projectId: z.string().min(1), packageId: z.string().min(1), platform: z.string().min(1), visibility: z.enum(publicationVisibilities), status: z.enum(['draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled']), approvalRequired: z.boolean(), scheduledAt: isoDate.nullable(), publishedAt: isoDate.nullable() });
export type ContentPublication = z.infer<typeof contentPublicationSchema>;
export const contentAnalyticsSnapshotSchema = z.strictObject({ id: z.string().min(1), projectId: z.string().min(1), publicationId: z.string().min(1).nullable(), platform: z.string().min(1), capturedAt: isoDate, metrics: z.record(z.string(), z.number().finite()), notes: z.string().max(2_000).default('') });
export type ContentAnalyticsSnapshot = z.infer<typeof contentAnalyticsSnapshotSchema>;
export const publicationScheduleInputSchema = z.strictObject({ id: z.string().min(1), projectId: z.string().min(1), packageId: z.string().min(1), platform: z.string().min(1), visibility: z.enum(publicationVisibilities), scheduledAt: isoDate.nullable(), approved: z.literal(true) });
export type PublicationScheduleInput = z.infer<typeof publicationScheduleInputSchema>;

export const projectNextActionSchema = z.strictObject({ id: z.string().min(1), label: z.string().min(1), kind: z.enum(contentNextActionKinds) });
export type ProjectNextAction = z.infer<typeof projectNextActionSchema>;
export const contentQueueItemSchema = z.strictObject({ project: contentProjectSchema, nextAction: projectNextActionSchema, latestExecutionStatus: z.string().nullable(), latestPackageStatus: z.string().nullable(), latestPublicationStatus: z.string().nullable(), latestPublicationScheduledAt: isoDate.nullable() });
export type ContentQueueItem = z.infer<typeof contentQueueItemSchema>;

type ExecutionStatus = ProductionExecution['status'] | string;
type PackageStatus = PublicationPackage['status'] | string;
type PublicationStatus = ContentPublication['status'] | string;

export function deriveProjectNextAction(
  _project: ContentProject,
  executions: ReadonlyArray<Pick<ProductionExecution, 'status'> & { status: ExecutionStatus }>,
  packages: ReadonlyArray<Pick<PublicationPackage, 'status' | 'thumbnailAssetId'> & { status: PackageStatus }>,
  publications: ReadonlyArray<Pick<ContentPublication, 'status'> & { status: PublicationStatus }>,
): ProjectNextAction {
  const latest = executions.at(-1);
  if (latest?.status === 'failed' || latest?.status === 'cancelled') return { id: 'production-retry', label: 'Retomar produção', kind: 'production' };
  if (!_project.brief) return { id: 'briefing', label: 'Completar briefing', kind: 'briefing' };
  if (!_project.script || _project.script.status !== 'approved') return { id: 'script', label: _project.script ? 'Aprovar roteiro' : 'Criar roteiro', kind: 'script' };
  if (!latest) return { id: 'production-start', label: 'Iniciar produção', kind: 'production' };
  if (latest.status !== 'completed') return { id: 'production-continue', label: 'Continuar produção', kind: 'production' };
  const latestPackage = packages.at(-1);
  if (!latestPackage) return { id: 'publication-package', label: 'Criar pacote de publicação', kind: 'package' };
  if (!latestPackage.thumbnailAssetId) return { id: 'publication-thumbnail', label: 'Escolher thumbnail', kind: 'thumbnail' };
  if (latestPackage.status !== 'approved' && latestPackage.status !== 'published') return { id: 'publication-review', label: 'Revisar pacote de publicação', kind: 'package' };
  const latestPublication = publications.at(-1);
  if (!latestPublication || latestPublication.status === 'failed') return { id: 'publication-schedule', label: 'Agendar vídeo', kind: 'publication' };
  if (latestPublication.status === 'published') return { id: 'analytics', label: 'Ver desempenho', kind: 'analytics' };
  return { id: 'publication-continue', label: 'Continuar publicação', kind: 'publication' };
}

export function isPublicPublicationApprovalRequired(mode: AutonomyMode, visibility: ContentPublication['visibility']): boolean {
  return visibility === 'public' || mode === 'manual';
}

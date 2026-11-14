import { z } from 'zod';

/** Stages of the Aethera Autonomous Studio. Additive: a run only has the stages that were scheduled for it. */
export const studioStageKinds = ['game_research', 'media_acquisition', 'visual_index', 'scene_matching', 'media_discovery'] as const;
export const productionStageKinds = ['briefing', 'research', 'script', 'storyboard', 'narration', 'sync', 'composition', 'render', 'quality', 'export', ...studioStageKinds, 'preview'] as const;
export const productionStageStatuses = ['pending', 'running', 'paused', 'awaiting_approval', 'completed', 'failed', 'cancelled'] as const;

export const videoFormatSchema = z.object({
  id: z.enum(['youtube-long', 'youtube-short', 'instagram-reels', 'tiktok', 'square', 'custom']),
  width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), aspectRatio: z.string().min(3),
  safeArea: z.object({ top: z.number().nonnegative(), right: z.number().nonnegative(), bottom: z.number().nonnegative(), left: z.number().nonnegative() }),
});
export const productionBriefSchema = z.object({
  schemaVersion: z.literal(1), projectId: z.string().min(1), format: videoFormatSchema, productionType: z.string().min(1), topic: z.string().min(1),
  targetDurationSeconds: z.number().positive(), targetWords: z.number().int().positive().optional(), language: z.string().min(2), audience: z.string().min(1), tone: z.string().min(1), narrativeStyle: z.string().min(1),
  researchDepth: z.enum(['light', 'standard', 'deep']), sourceCount: z.number().int().nonnegative(), pace: z.enum(['slow', 'standard', 'fast']), budgetUsd: z.number().nonnegative(),
});
export type VideoFormat = z.infer<typeof videoFormatSchema>;
export type ProductionBrief = z.infer<typeof productionBriefSchema>;
export type ProductionStageKind = (typeof productionStageKinds)[number];
export function wordsForDuration(seconds: number, pace: ProductionBrief['pace']): { min: number; max: number; estimate: number } {
  const wpm = pace === 'slow' ? 115 : pace === 'fast' ? 175 : 145; const estimate = Math.round(seconds / 60 * wpm);
  return { min: Math.round(estimate * 0.9), max: Math.round(estimate * 1.1), estimate };
}

export const productionRunStatuses = ['draft', 'running', 'paused', 'awaiting_approval', 'completed', 'failed', 'cancelled'] as const;
export type ProductionRunStatus = (typeof productionRunStatuses)[number];
export type ProductionStageStatus = (typeof productionStageStatuses)[number];
export const productionStageErrorSchema = z.object({ code: z.string().min(1), message: z.string(), retryable: z.boolean() });
export type ProductionStageError = z.infer<typeof productionStageErrorSchema>;
/** What a stage needs to be started again after a restart: never a provider payload or a secret. */
export const productionStageCheckpointSchema = z.object({
  taskProjectId: z.string().min(1),
  /** Stage kinds that must be completed before this checkpoint may launch. */
  dependsOn: z.array(z.string().min(1)).max(20).optional(),
  /** A plain TaskEngine task (Phase A stages). */
  prompt: z.string().min(1).optional(),
  /** A stage adapter run in batches; `input` is what it was scheduled with, `state` what it already produced. */
  adapter: z.enum(productionStageKinds).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  state: z.record(z.string(), z.unknown()).optional(),
}).catchall(z.unknown()).refine((value) => (value.prompt === undefined) !== (value.adapter === undefined), { message: 'checkpoint precisa de prompt ou de adapter' });
export type ProductionStageCheckpoint = z.infer<typeof productionStageCheckpointSchema>;
export const productionQualityCheckSchema = z.object({ id: z.string().min(1), label: z.string().min(1), severity: z.enum(['blocking', 'warning', 'info']), passed: z.boolean(), evidence: z.string().optional(), approved: z.boolean().optional() });
export type ProductionQualityCheck = z.infer<typeof productionQualityCheckSchema>;

/** A file of a production must stay under the video project root: relative, no traversal, no drive or scheme. */
export function isSafeProductionPath(path: string): boolean {
  if (!path || path.length > 512 || path.includes('\0')) return false;
  if (/^[a-zA-Z]:|^[/\\]|^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  return !path.split(/[/\\]/).some((part) => part === '..');
}

/** Exportable only when every blocking check passed or was explicitly approved. */
export function qualityExportable(checks: readonly ProductionQualityCheck[]): boolean {
  return checks.every((check) => check.severity !== 'blocking' || check.passed || check.approved === true);
}

/** Paid work runs only inside the budget; otherwise it waits for a human approval without calling the provider. */
export function budgetAllows(budget: { limitUsd: number; reserveUsd: number; consumedUsd: number }, estimateUsd: number): boolean {
  return estimateUsd <= 0 || budget.consumedUsd + budget.reserveUsd + estimateUsd <= budget.limitUsd + 1e-9;
}

/** What the renderer sees of a production: parsed, without prompts or provider payloads. */
export const productionStageViewSchema = z.strictObject({
  id: z.string(), kind: z.enum(productionStageKinds), status: z.enum(productionStageStatuses), progress: z.number().min(0).max(1), retryCount: z.number().int().nonnegative(),
  costEstimateUsd: z.number().nonnegative(), actualCostUsd: z.number().nonnegative(), taskId: z.string().nullable(), error: productionStageErrorSchema.nullable(), outputArtifactIds: z.array(z.string()), updatedAt: z.string(),
});
export const productionRunViewSchema = z.strictObject({
  id: z.string(), projectId: z.string(), status: z.enum(productionRunStatuses), topic: z.string(), formatId: videoFormatSchema.shape.id, agent: z.enum(['claude', 'codex']), estimatedCostUsd: z.number(), actualCostUsd: z.number(), createdAt: z.string(), updatedAt: z.string(),
});
export const productionStateSchema = z.strictObject({
  run: productionRunViewSchema,
  brief: productionBriefSchema,
  stages: z.array(productionStageViewSchema),
  artifacts: z.array(z.strictObject({ id: z.string(), stageId: z.string(), kind: z.string(), relativePath: z.string().nullable(), mime: z.string().nullable(), contentHash: z.string() })),
  budget: z.strictObject({ currency: z.string(), limitUsd: z.number(), reserveUsd: z.number(), consumedUsd: z.number(), policy: z.string() }),
  approvals: z.array(z.strictObject({ id: z.string(), stageId: z.string().nullable(), decision: z.enum(['approved', 'rejected']), note: z.string().nullable(), createdAt: z.string() })),
  qualityReports: z.array(z.strictObject({ id: z.string(), stageId: z.string().nullable(), blocking: z.boolean(), exportable: z.boolean(), checks: z.array(productionQualityCheckSchema) })),
});
export type ProductionStageView = z.infer<typeof productionStageViewSchema>;
export type ProductionRunView = z.infer<typeof productionRunViewSchema>;
export type ProductionState = z.infer<typeof productionStateSchema>;

/** Ready formats; `custom` needs its own width, height, FPS and safe area. Safe areas are in pixels. */
export const VIDEO_FORMATS: Record<Exclude<VideoFormat['id'], 'custom'>, VideoFormat & { label: string }> = {
  'youtube-long': { id: 'youtube-long', label: 'YouTube (16:9)', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  'youtube-short': { id: 'youtube-short', label: 'YouTube Shorts (9:16)', width: 1080, height: 1920, fps: 30, aspectRatio: '9:16', safeArea: { top: 192, right: 64, bottom: 384, left: 64 } },
  'instagram-reels': { id: 'instagram-reels', label: 'Instagram Reels (9:16)', width: 1080, height: 1920, fps: 30, aspectRatio: '9:16', safeArea: { top: 220, right: 64, bottom: 420, left: 64 } },
  tiktok: { id: 'tiktok', label: 'TikTok (9:16)', width: 1080, height: 1920, fps: 30, aspectRatio: '9:16', safeArea: { top: 160, right: 120, bottom: 480, left: 64 } },
  square: { id: 'square', label: 'Quadrado (1:1)', width: 1080, height: 1080, fps: 30, aspectRatio: '1:1', safeArea: { top: 54, right: 54, bottom: 54, left: 54 } },
};

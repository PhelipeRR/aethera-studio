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

export const channelPlatforms = ['youtube', 'twitch', 'multi'] as const;
export type ChannelPlatform = (typeof channelPlatforms)[number];
export const channelFormats = ['top10', 'news', 'analysis', 'nostalgia', 'documentary', 'shorts'] as const;
export type ChannelFormat = (typeof channelFormats)[number];
export const channelLowerThirdStyles = ['minimal', 'cinematic', 'neon', 'editorial'] as const;
export const channelHumorStyles = ['none', 'subtle', 'sarcastic', 'energetic'] as const;
export const channelDepthLevels = ['quick', 'balanced', 'deep_dive'] as const;
export const channelPacingLevels = ['fast', 'medium', 'cinematic'] as const;
export const channelFactCheckPolicies = ['strict_verified', 'balanced', 'creative'] as const;
export const channelRenderProfiles = ['1080p_60', '1080p_30', '4k_60', 'shorts_vertical'] as const;
export const channelSfxProfiles = ['subtle', 'cinematic', 'energetic', 'none'] as const;
export const channelVfxProfiles = ['clean', 'editorial', 'dynamic'] as const;
export const channelQualityPresets = ['draft', 'standard', 'master'] as const;
export const channelAgentProviders = ['claude', 'codex', 'antigravity'] as const;

export const channelBrandKitSchema = z.object({
  logoUrl: z.string().default(''),
  primaryColor: z.string().default('#8b5cf6'),
  secondaryColor: z.string().default('#06b6d4'),
  accentColor: z.string().default('#f59e0b'),
  backgroundColor: z.string().default('#0b0d14'),
  headingFont: z.string().default('Inter'),
  bodyFont: z.string().default('Inter'),
  introPreset: z.string().default('Vinheta curta 3s'),
  outroPreset: z.string().default('Endscreen padrão 10s'),
  lowerThirdStyle: z.enum(channelLowerThirdStyles).default('cinematic'),
  watermarkPosition: z.enum(['topLeft', 'topRight', 'bottomLeft', 'bottomRight']).default('bottomRight'),
});
export type ChannelBrandKit = z.infer<typeof channelBrandKitSchema>;

export const channelIdentityConfigSchema = z.object({
  platform: z.enum(channelPlatforms).default('youtube'),
  connectionMode: z.enum(['oauth_youtube', 'manual']).default('manual'),
  youtubeChannelId: z.string().default(''),
  handle: z.string().default(''),
  avatarUrl: z.string().default(''),
  bannerUrl: z.string().default(''),
  description: z.string().default(''),
  language: z.string().default('pt-BR'),
  region: z.string().default('BR'),
  lastSyncedAt: z.string().nullable().default(null),
  brandKit: channelBrandKitSchema.prefault({}),
});
export type ChannelIdentityConfig = z.infer<typeof channelIdentityConfigSchema>;

export const channelRecurringSeriesSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  format: z.enum(channelFormats).default('news'),
  weekday: z.string().default('friday'),
  time: z.string().default('18:00'),
  leadDays: z.number().int().min(0).max(30).default(2),
  active: z.boolean().default(true),
});
export type ChannelRecurringSeries = z.infer<typeof channelRecurringSeriesSchema>;

export const channelPublishingConfigSchema = z.object({
  defaultVisibility: z.enum(publicationVisibilities).default('private'),
  defaultCategory: z.string().default('Gaming'),
  defaultPlaylist: z.string().default(''),
  titleTemplate: z.string().default('{title} | {channel}'),
  descriptionTemplate: z.string().default('{summary}\n\nInscreva-se em {channel}!\n{hashtags}'),
  defaultTags: z.array(z.string()).default([]),
  defaultHashtags: z.array(z.string()).default([]),
  creditsTemplate: z.string().default('Roteiro, edição e direção: {channel} via Aethera Studio.'),
  assistedMetadata: z.boolean().default(true),
  assistedThumbnail: z.boolean().default(true),
  timezone: z.string().default('America/Sao_Paulo'),
  recurringSeries: z.array(channelRecurringSeriesSchema).default([]),
  validateBeforePublish: z.boolean().default(true),
});
export type ChannelPublishingConfig = z.infer<typeof channelPublishingConfigSchema>;

export const channelProductionConfigSchema = z.object({
  stageAutonomy: z.object({
    research: z.enum(autonomyModes).default('assisted'),
    script: z.enum(autonomyModes).default('assisted'),
    media: z.enum(autonomyModes).default('assisted'),
    editing: z.enum(autonomyModes).default('assisted'),
    qc: z.enum(autonomyModes).default('manual'),
    publish: z.enum(autonomyModes).default('manual'),
  }).prefault({}),
  requireHumanApprovalForExternalPublish: z.boolean().default(true),
  explicitExternalAutoPublishAuthorized: z.boolean().default(false),
  renderProfile: z.enum(channelRenderProfiles).default('1080p_60'),
  voiceProfile: z.string().default('pt-BR-AntonioNeural'),
  sfxProfile: z.enum(channelSfxProfiles).default('subtle'),
  vfxProfile: z.enum(channelVfxProfiles).default('editorial'),
  qualityPreset: z.enum(channelQualityPresets).default('standard'),
  agentFallbackOrder: z.array(z.enum(channelAgentProviders)).min(1).default(['claude', 'codex']),
  costAlertThresholdUsd: z.number().nonnegative().default(5),
  alertOnFailure: z.boolean().default(true),
  alertOnPendingReview: z.boolean().default(true),
});
export type ChannelProductionConfig = z.infer<typeof channelProductionConfigSchema>;

export const channelEditorialStrategyConfigSchema = z.object({
  brief: z.string().default(''),
  narrativeTone: z.string().default(''),
  humorStyle: z.enum(channelHumorStyles).default('subtle'),
  depthLevel: z.enum(channelDepthLevels).default('balanced'),
  pacing: z.enum(channelPacingLevels).default('medium'),
  enabledFormats: z.array(z.enum(channelFormats)).default(['analysis', 'top10', 'news']),
  formatRules: z.record(z.string(), z.string()).default({}),
  factCheckPolicy: z.enum(channelFactCheckPolicies).default('strict_verified'),
  sourcePolicy: z.string().default('Priorizar fontes oficiais, notas de estúdio e veículos verificados.'),
  useAcademyRules: z.boolean().default(true),
  useProductionLearning: z.boolean().default(true),
  styleExamples: z.array(z.string()).default([]),
  restrictedTopics: z.array(z.string()).default([]),
  topicsRequiringReview: z.array(z.string()).default([]),
  publishing: channelPublishingConfigSchema.prefault({}),
  production: channelProductionConfigSchema.prefault({}),
});
export type ChannelEditorialStrategyConfig = z.infer<typeof channelEditorialStrategyConfigSchema>;

/** Normalizes legacy or partial channel JSON blobs into full Channel Manager 2.0 configs without data loss. */
export function normalizeChannelConfig(channel: Pick<ContentChannel, 'tone' | 'autonomy' | 'identity' | 'editorialStrategy'>): {
  identity: ChannelIdentityConfig;
  editorialStrategy: ChannelEditorialStrategyConfig;
} {
  const rawIdentity = (channel.identity && typeof channel.identity === 'object') ? channel.identity : {};
  const rawStrategy = (channel.editorialStrategy && typeof channel.editorialStrategy === 'object') ? channel.editorialStrategy : {};
  const identity = channelIdentityConfigSchema.parse(rawIdentity);
  const strategyParsed = channelEditorialStrategyConfigSchema.parse({
    ...rawStrategy,
    narrativeTone: typeof (rawStrategy as Record<string, unknown>).narrativeTone === 'string' && (rawStrategy as Record<string, unknown>).narrativeTone
      ? (rawStrategy as Record<string, unknown>).narrativeTone
      : channel.tone,
    production: {
      ...((rawStrategy as Record<string, unknown>).production as Record<string, unknown> | undefined),
      stageAutonomy: {
        research: channel.autonomy,
        script: channel.autonomy,
        media: channel.autonomy,
        editing: channel.autonomy,
        qc: channel.autonomy === 'autonomous' ? 'assisted' : 'manual',
        publish: 'manual',
        ...(((rawStrategy as Record<string, unknown>).production as Record<string, unknown> | undefined)?.stageAutonomy as Record<string, unknown> | undefined),
      },
    },
  });
  return { identity, editorialStrategy: strategyParsed };
}

export interface ChannelCompletenessReport {
  scorePct: number;
  missingRequired: string[];
  missingRecommended: string[];
  readyForProduction: boolean;
  readyForPublish: boolean;
}

export function evaluateChannelCompleteness(channel: ContentChannel): ChannelCompletenessReport {
  const { identity, editorialStrategy } = normalizeChannelConfig(channel);
  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];

  if (!channel.name.trim()) missingRequired.push('Nome do canal');
  if (!channel.niche.trim()) missingRequired.push('Nicho');
  if (!channel.audience.trim()) missingRequired.push('Público-alvo');
  if (!channel.tone.trim() && !editorialStrategy.narrativeTone.trim()) missingRequired.push('Tom narrativo');
  if (editorialStrategy.enabledFormats.length === 0) missingRequired.push('Pelo menos 1 formato de conteúdo');

  if (!identity.handle.trim()) missingRecommended.push('Handle (@canal)');
  if (!identity.description.trim()) missingRecommended.push('Descrição do canal');
  if (!identity.brandKit.primaryColor.trim()) missingRecommended.push('Cor primária do Brand Kit');
  if (!editorialStrategy.publishing.timezone.trim()) missingRecommended.push('Fuso horário de publicação');
  if (identity.connectionMode === 'oauth_youtube' && !identity.youtubeChannelId.trim()) {
    missingRecommended.push('Importar ID real do YouTube via OAuth');
  }

  const totalChecks = 10;
  const passed = totalChecks - missingRequired.length - missingRecommended.length;
  const scorePct = Math.max(0, Math.min(100, Math.round((passed / totalChecks) * 100)));

  return {
    scorePct,
    missingRequired,
    missingRecommended,
    readyForProduction: missingRequired.length === 0,
    readyForPublish: missingRequired.length === 0 && (identity.connectionMode === 'manual' || Boolean(identity.youtubeChannelId.trim())),
  };
}

export function canChannelAutoPublish(channel: ContentChannel, isPackageApproved: boolean): boolean {
  if (!isPackageApproved) return false;
  const { editorialStrategy } = normalizeChannelConfig(channel);
  if (editorialStrategy.production.requireHumanApprovalForExternalPublish) return false;
  return editorialStrategy.production.explicitExternalAutoPublishAuthorized === true;
}

export function renderChannelTitlePreview(template: string, sampleTitle: string, channelName: string): string {
  const base = template.trim() || '{title}';
  return base.replace(/\{title\}/gi, sampleTitle).replace(/\{channel\}/gi, channelName || 'Canal');
}

export function renderChannelDescriptionPreview(
  template: string,
  sampleSummary: string,
  channelName: string,
  hashtags: readonly string[],
  creditsTemplate?: string,
): string {
  const base = template.trim() || '{summary}';
  const tagsLine = hashtags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
  const rendered = base
    .replace(/\{summary\}/gi, sampleSummary)
    .replace(/\{channel\}/gi, channelName || 'Canal')
    .replace(/\{hashtags\}/gi, tagsLine);
  if (!creditsTemplate?.trim()) return rendered.trim();
  const credits = creditsTemplate.replace(/\{channel\}/gi, channelName || 'Canal');
  return `${rendered.trim()}\n\n${credits}`.trim();
}

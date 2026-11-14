import { z } from 'zod';
import { brainSearchInputSchema, LIMITS, listFilterSchema, storeInputSchema } from './brain.js';
import { IpcChannel, type IpcChannelName } from './channels.js';
import { brainSettingsSchema } from './brain-settings.js';
import { monitoringIntervalSchema, monitorSnapshotSchema } from './monitoring.js';
import { coreDeviceSchema, corePairingOfferSchema, corePendingPairingSchema, coreRemoteStatusSchema, coreRuntimeSchema } from './core-desktop.js';
import { grantSchema, revokeRequestSchema } from './core-api/auth.js';
import { AGENT_IDS, CONFIDENCE_STATES, EMBEDDING_STATES, LEARNING_STATUSES, MEMORY_TYPES, RUN_MODES, SOURCE_KINDS, TASK_STATUSES, TRUST_STATES } from './domain.js';
import { motionCaptionSchema, motionProjectSchema, motionV2SceneSchema } from './motion.js';
import { agendaItemSchema, brandIdentitySchema, publishDraftSchema } from './velix-channel.js';
import { productionStyleChoiceSchema, videoStyleSchema } from './video-styles.js';
import { optimizerSuggestionSchema } from './velix-optimizer.js';
import { productionBriefSchema, productionRunViewSchema, productionStateSchema } from './velix-production.js';
import { matchReviewCandidateSchema, mediaAcquisitionJobSchema, rankingIntentSchema, verifiedSubjectSchema } from './aethera-studio.js';
import { acquiredMediaUseViewSchema, editorialUsePolicySchema } from './aethera-render-use.js';
import { channelVoiceViewSchema, narrationDirectionSchema, voicePresetSchema } from './aethera-voice.js';
import { sourceCandidateSchema } from './aethera-media.js';
import { aetheraReferenceValidationReportSchema } from './aethera-reference-validation.js';
import { productionScriptSchema } from './velix-long-script.js';
import { claimKinds, productionClaimsSchema } from './velix-evidence.js';
import { semanticEditResultSchema, storyboardCandidateViewSchema, storyboardEditSchema, storyboardViewSchema } from './velix-storyboard.js';
import { productionNarrationViewSchema } from './velix-sync.js';
import { productionRendersViewSchema } from './velix-composition.js';
import { productionDerivativeSchema } from './velix-derivatives.js';
import { azureDevOpsCapabilitiesSchema, azureDevOpsConnectionInputSchema, azureDevOpsConnectionStatusSchema, azureDevOpsWriteRequestSchema } from './azure-devops.js';
import { ALLOWED_COMMAND, ALLOWED_COMMANDS_MAX, PERMISSION_LEVELS, PREFERRED_AGENTS, STACKS } from './projects.js';
import { CONVERSATION_TITLE_MAX, IMAGE_MAX_BYTES, IMAGE_TYPES, IMAGES_PER_MESSAGE, STEP_KINDS } from './tasks.js';
import { workflowDefinitionInputSchema } from './workflows.js';
import { gitPatchSchema, gitReviewReportSchema, gitReviewStartInputSchema } from './git-review.js';
import { editorialPlanViewSchema } from './aethera-smart-director.js';
import { smartCommitReportSchema, smartCommitStartInputSchema } from './smart-commit.js';
import { spotifyCommandResultSchema, spotifyCommandSchema, spotifyConfigureSchema, spotifyControlSchema, spotifyDeviceSchema, spotifyStatusSchema } from './spotify.js';
import { meetingSessionSchema, meetingStartInputSchema, meetingStopInputSchema, meetingTranscriptInputSchema, suggestionDecisionSchema, suggestionSchema } from './meeting.js';
import { neuraMeetingAudioSchema, neuraVoiceAudioSchema, neuraActionDecisionSchema, neuraInputSchema, neuraPauseResultSchema, neuraResponseSchema, neuraSettingsPatchSchema, neuraSettingsSchema, neuraSpeechInputSchema, neuraSpeechResultSchema, neuraStateSchema } from './neura.js';
import { voiceSessionSchema, voiceStartInputSchema, voiceStopInputSchema } from './voice.js';
import { COMPANION_HUD_MODES, companionEventPageSchema, companionEventsQuerySchema, companionHudDragSchema, companionHudStateSchema, companionOkSchema, companionSessionPageSchema, companionSessionsQuerySchema, companionSubscribeInputSchema, companionSubscriptionResultSchema, companionUnsubscribeInputSchema, companionSessionSchema } from './companion.js';
import { extensionUninstallResultSchema, installedExtensionSchema } from './extensions.js';
import { computerActionDecisionSchema, computerActionResultSchema } from './computer-actions.js';
import { autonomyModes, contentAnalyticsSnapshotSchema, contentAssetSchema, contentChannelSchema, contentIdeaSchema, contentProjectSchema, contentPublicationSchema, contentQueueItemSchema, productionExecutionSchema, projectNextActionSchema, publicationApprovalSchema, publicationPackageSchema, publicationScheduleInputSchema } from './content-operating-system.js';
import { contentBriefSchema } from './content-brief.js';
import { contentScriptSchema } from './content-script.js';
import { aetheraTimelineVersionSchema, timelineDocumentSchema, timelineOpSchema } from './aethera-timeline.js';
import { aetheraProductionPlanSchema } from './aethera-production-planner.js';
import { aceStepMusicGenerationInputSchema, aceStepMusicGenerationResultSchema } from './aethera-audio.js';
import { aetheraReviewReportRecordSchema } from './aethera-review.js';

export const themeSourceSchema = z.enum(['dark', 'light', 'system']);

const noInput = z.undefined();
const historySyncSettingsSchema = z.strictObject({ enabled: z.boolean(), paused: z.boolean(), pollIntervalMs: z.number().int().min(5000).max(24 * 60 * 60 * 1000), projectRoots: z.array(z.string()), excludedProjects: z.array(z.string()), excludedSessions: z.array(z.string()) });
const mcpClientSchema = z.enum(['claude', 'codex']);
const mcpChangeSchema = z.strictObject({ changed: z.boolean(), backup: z.string().nullable() });
const count = z.number().int().nonnegative();
const skillTrustEvidenceSchema = z.strictObject({ kind: z.enum(['fact', 'heuristic', 'declared', 'unavailable']), value: z.string(), path: z.string().optional() });
const skillTrustFindingSchema = z.strictObject({ id: z.string(), category: z.enum(['origin', 'integrity', 'structure', 'permissions', 'behavior', 'compatibility', 'limitations']), severity: z.enum(['info', 'warning', 'high', 'critical']), status: z.enum(['verified', 'attention', 'risk', 'not-verified', 'blocked']), evidence: z.array(skillTrustEvidenceSchema), relatedPath: z.string().optional(), rule: z.string(), result: z.string(), limitation: z.string(), recommendedAction: z.string() });
const skillTrustCheckSchema = z.strictObject({ id: z.string(), label: z.string(), kind: z.enum(['automatic', 'heuristic', 'unverified']), severity: z.enum(['info', 'warning', 'high', 'critical']), status: z.enum(['pass', 'fail', 'warning', 'unknown']), detail: z.string() });
const skillInstallPreviewSchema = z.strictObject({ skillId: z.string(), destination: z.string(), files: z.array(z.strictObject({ path: z.string(), size: z.number().int().nonnegative(), overwrite: z.boolean() })), totalBytes: z.number().int().nonnegative(), findings: z.array(skillTrustFindingSchema), blockedBy: z.array(z.string()), warnings: z.array(z.string()), checks: z.array(skillTrustCheckSchema), readOnly: z.literal(true), assessmentFingerprint: z.string().length(64) });
const skillStudioMetadataSchema = z.strictObject({ name: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(2_000), objective: z.string().max(4_000), triggers: z.array(z.string().max(200)).max(30), agents: z.array(z.enum(['claude', 'codex'])).max(2), dependencies: z.array(z.string().max(200)).max(50), permissions: z.array(z.string().max(200)).max(50), examples: z.array(z.string().max(2_000)).max(30) });
const skillStudioPathSchema = z.string().min(1).max(1_000).refine(value => {
  const normalized = value.replaceAll('\\', '/');
  return !normalized.startsWith('/') && !/^[A-Za-z]:/u.test(normalized) && !normalized.split('/').some(part => part === '..' || part.startsWith('.'));
}, 'Skill Studio file paths must be relative and non-hidden');
const skillStudioFileSchema = z.strictObject({ path: skillStudioPathSchema, content: z.string().max(512_000) });
const skillStudioDraftSchema = z.strictObject({ id: z.string().uuid(), skillId: z.string(), metadata: skillStudioMetadataSchema, instructions: z.string().max(512_000), files: z.array(skillStudioFileSchema).max(200), scope: z.enum(['global', 'project']), projectId: z.string().nullable(), sourcePath: z.string().nullable(), baseFingerprint: z.string().length(64).nullable(), revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string() });
const skillStudioTrustAssessmentSchema = z.strictObject({ skillId: z.string(), evaluatedAt: z.string(), ruleVersion: z.string(), contentFingerprint: z.string().length(64), origin: z.strictObject({ kind: z.enum(['local', 'remote']), value: z.string(), normalized: z.string(), host: z.string().nullable(), allowlisted: z.boolean().nullable() }), scope: z.enum(['global', 'project', 'unknown']), inspectedFiles: z.array(z.strictObject({ path: z.string(), size: z.number().int().nonnegative(), hash: z.string().length(64).nullable() })), findings: z.array(skillTrustFindingSchema), checks: z.array(skillTrustCheckSchema), decision: z.strictObject({ allowed: z.boolean(), requiresExplicitApproval: z.literal(true), blockedBy: z.array(z.string()), warnings: z.array(z.string()) }), valid: z.boolean() });
const skillStudioValidationSchema = z.strictObject({ valid: z.boolean(), errors: z.array(z.string()), warnings: z.array(z.string()), fingerprint: z.string().length(64), manifest: z.strictObject({ name: z.string(), description: z.string() }), trust: skillStudioTrustAssessmentSchema });
const skillStudioEditorStateSchema = z.strictObject({ draft: skillStudioDraftSchema, markdown: z.string(), validation: skillStudioValidationSchema.nullable() });
const skillStudioDraftSummarySchema = z.strictObject({ id: z.string().uuid(), skillId: z.string(), name: z.string(), description: z.string(), scope: z.enum(['global', 'project']), projectId: z.string().nullable(), revision: z.number().int().positive(), updatedAt: z.string() });
const skillStudioVersionSchema = z.strictObject({ id: z.string().uuid(), skillId: z.string(), version: z.number().int().positive(), createdAt: z.string(), origin: z.enum(['created', 'edited', 'imported', 'restored']), fingerprint: z.string().length(64), path: z.string(), current: z.boolean() });
const skillStudioChangeSetSchema = z.strictObject({ skillId: z.string(), fromVersionId: z.string().uuid(), toVersionId: z.string().uuid(), added: z.array(z.string()), removed: z.array(z.string()), changed: z.array(z.string()), summary: z.string() });
const skillStudioImportPreviewSchema = z.strictObject({ sourcePath: z.string(), skillId: z.string(), metadata: skillStudioMetadataSchema, files: z.array(skillStudioFileSchema).max(200), totalBytes: z.number().int().nonnegative(), validation: skillStudioValidationSchema, conflict: z.enum(['none', 'existing-draft', 'existing-published']) });
const skillStudioExportResultSchema = z.strictObject({ skillId: z.string(), versionId: z.string().uuid(), path: z.string(), format: z.literal('directory'), files: z.array(z.string()), totalBytes: z.number().int().nonnegative(), fingerprint: z.string().length(64) });
const skillStudioSimulationSchema = z.strictObject({ recommendations: z.array(z.strictObject({ skillId: z.string(), name: z.string(), relevance: z.number(), reasons: z.array(z.string()), evidence: z.array(z.string()) })), excluded: z.array(z.strictObject({ skillId: z.string(), name: z.string(), reasons: z.array(z.string()) })) });
const semanticStatusSchema = z.strictObject({
  enabled: z.boolean(),
  downloaded: z.boolean(),
  model: z.string(),
  modelsDir: z.string(),
  indexed: count,
  pending: count,
  failed: count,
});

const memoryId = z.string().min(1).max(64);
const memoryType = z.enum(MEMORY_TYPES);
const memoryFields = {
  id: z.string(),
  title: z.string(),
  type: memoryType,
  projectId: z.string().nullable(),
  tags: z.array(z.string()),
  trust: z.enum(TRUST_STATES),
  confidence: z.enum(CONFIDENCE_STATES),
};
const memorySchema = z.strictObject({
  ...memoryFields,
  content: z.string(),
  source: z.strictObject({ kind: z.enum(SOURCE_KINDS), ref: z.string().nullable() }),
  evidence: z.array(z.strictObject({ kind: z.enum(['file', 'url', 'task', 'conversation']), ref: z.string(), createdAt: z.string() })),
  version: z.number().int(),
  embeddingStatus: z.enum(EMBEDDING_STATES),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const linkRefSchema = z.strictObject({ id: z.string().nullable(), title: z.string(), relation: z.string(), origin: z.enum(['wikilink', 'explicit']) });
const memoryDetailSchema = memorySchema.extend({ outgoing: z.array(linkRefSchema), backlinks: z.array(linkRefSchema), pending: z.array(z.string()) });
const summarySchema = z.strictObject({ ...memoryFields, excerpt: z.string(), updatedAt: z.string() });
const searchHitSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  type: memoryType,
  projectId: z.string().nullable(),
  tags: z.array(z.string()),
  snippet: z.string(),
  score: z.number(),
  matchedBy: z.array(z.enum(['text', 'semantic'])),
  confidence: z.enum(CONFIDENCE_STATES),
});

const projectId = z.string().min(1).max(64);
const projectPath = z.string().min(1).max(1024);
const videoReference = z.strictObject({ kind: z.enum(['texto', 'dado', 'imagem', 'fonte']), title: z.string().min(1).max(200), url: z.string().url().max(2_000), license: z.string().min(1).max(200), note: z.string().max(500) });
const videoCapturePlan = z.strictObject({ kind: z.enum(['web', 'electron']), command: z.string().min(1).max(300), url: z.string().min(1).max(200), env: z.record(z.string().max(60), z.string().max(500)), screens: z.array(z.strictObject({ name: z.string().min(1).max(60), path: z.string().max(200) })).min(1).max(12) });
const videoName = z.string().trim().min(1).max(200);
const videoStudioState = z.strictObject({ folder: z.string(), narration: z.string(), data: z.string(), audio: z.string().nullable(), synced: z.boolean(), images: z.array(z.string()) });
const narrationLicenseSchema = z.strictObject({ provider: z.enum(['unknown', 'reviewed']), model: z.enum(['unknown', 'reviewed']), voice: z.enum(['unknown', 'reviewed']), output: z.enum(['unknown', 'reviewed']), userConfirmed: z.boolean() });
const narrationAssetSchema = z.strictObject({ id: z.string().uuid(), provider: z.enum(['elevenlabs-manual', 'voicestudio']), relativePath: z.string().min(1).max(1_000), format: z.enum(['mp3', 'wav']), modelId: z.string().nullable(), voiceId: z.string().nullable(), textHash: z.string().length(64), durationMs: z.number().int().nonnegative(), license: narrationLicenseSchema, status: z.enum(['pending-license', 'ready', 'blocked']), createdAt: z.string().datetime() });
const narrationTimelineSchema = z.strictObject({ assetId: z.string().uuid(), relativePath: z.string().min(1).max(1_000), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(), syncStatus: z.enum(['not-synced', 'synced', 'needs-review']) });
const voiceStudioStatusSchema = z.strictObject({ available: z.boolean(), compatible: z.boolean(), baseUrl: z.string().url(), apiVersion: z.string().nullable(), models: z.array(z.strictObject({ id: z.string(), label: z.string(), installed: z.boolean(), license: narrationLicenseSchema, licenseNote: z.string().nullable() })), voices: z.array(z.strictObject({ id: z.string(), label: z.string(), source: z.enum(['local', 'profile', 'preset', 'unknown']), license: narrationLicenseSchema })), error: z.string().nullable() });
const videoDiscoveryFilters = z.strictObject({ subtopic: z.string().trim().max(200).optional(), keywords: z.string().trim().max(200).optional(), platform: z.enum(['youtube', 'shorts']).optional(), duration: z.enum(['any', 'short', 'medium', 'long']).optional(), style: z.string().trim().max(200).optional(), audience: z.string().trim().max(200).optional(), periodDays: z.number().int().min(1).max(365).optional(), rightsPolicy: z.enum(['reference', 'creative_commons']).optional() });
const videoIdeaView = z.strictObject({
  id: z.string(), status: z.string(), title: z.string(), hook: z.string(), synopsis: z.string(), draftScript: z.string(), audience: z.string(), durationSeconds: z.number().int(), referenceUrls: z.array(z.string()), mediaPlan: z.string(),
  claims: z.array(z.strictObject({ text: z.string(), type: z.enum(['fact', 'hypothesis', 'opinion']), referenceUrl: z.string().nullable() })),
  evidence: z.strictObject({ references: z.number().int().nonnegative(), recent: z.number().int().nonnegative(), researchedAt: z.string().nullable() }),
  pendingReferences: z.array(z.strictObject({ id: z.string(), title: z.string(), url: z.string(), agent: z.string().nullable(), executionId: z.string().nullable() })),
  generation: z.strictObject({ agent: z.string().nullable(), model: z.string().nullable(), executionId: z.string().nullable(), generatedAt: z.string().nullable() }),
});
const videoSettings = z.strictObject({ projectId: projectId.nullable(), rootPath: z.string().nullable(), agent: z.enum(['claude', 'codex']) });
const stackSchema = z.strictObject({
  stacks: z.array(z.enum(STACKS)),
  packageManager: z.enum(['npm', 'pnpm', 'yarn', 'bun']).nullable(),
  evidence: z.partialRecord(z.enum(STACKS), z.string()),
});
const projectSummaryFields = {
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  isPrivate: z.boolean(),
  preferredAgent: z.enum(PREFERRED_AGENTS),
  permissionLevel: z.enum(PERMISSION_LEVELS),
  allowedCommands: z.array(z.string()),
  stack: stackSchema.nullable(),
  memoryCount: z.number().int().nonnegative(),
  exists: z.boolean(),
  kind: z.enum(['project', 'workspace']),
  parentProjectId: z.string().nullable(),
  projectType: z.enum(['standalone', 'workspace', 'child', 'nested-workspace']),
  detectionConfidence: z.number().int().nullable(),
  gitRoot: z.string().nullable(),
};
const discoveryClassification = z.enum(['CONFIRMED_PROJECT', 'PROBABLE_PROJECT', 'WORKSPACE', 'AUXILIARY_DIRECTORY', 'UNKNOWN']);
const discoveryReport = z.strictObject({
  root: z.string(),
  candidates: z.array(z.strictObject({ path: z.string(), relativePath: z.string(), name: z.string(), classification: discoveryClassification, confidence: z.number(), evidence: z.array(z.strictObject({ signal: z.string(), detail: z.string(), points: z.number() })), technologies: z.array(z.string()), git: z.strictObject({ root: z.string(), kind: z.enum(['repository', 'worktree', 'submodule']), branch: z.string().nullable() }).nullable(), parentPath: z.string().nullable(), existingProjectId: z.string().nullable(), overridden: z.boolean(), selected: z.boolean() })),
  skipped: z.array(z.strictObject({ path: z.string(), reason: z.string() })),
  limited: z.boolean(),
});
const profileMemory = z.strictObject({ id: z.string(), title: z.string(), confidence: z.enum(CONFIDENCE_STATES) });
const projectProfileSchema = z.strictObject({
  projectId: z.string(),
  generatedAt: z.string(),
  index: z.strictObject({ files: count, indexed: count, skipped: count, removed: count, tooLarge: count, limited: z.boolean() }),
  stack: stackSchema.nullable(),
  modules: z.array(z.strictObject({ path: z.string(), files: count, symbolCount: count, symbols: z.array(z.string()) })),
  dependencies: z.array(z.strictObject({ name: z.string(), version: z.string().nullable(), kind: z.enum(['runtime', 'dev']), source: z.string() })),
  decisions: z.array(profileMemory),
  problems: z.array(z.strictObject({ tag: z.string(), occurrences: count, memories: z.array(profileMemory) })),
  changes: z.strictObject({ modulesAdded: z.array(z.string()), modulesRemoved: z.array(z.string()), dependenciesAdded: z.array(z.string()), dependenciesRemoved: z.array(z.string()) }).nullable(),
});
const projectDetailSchema = z.strictObject({
  ...projectSummaryFields,
  rules: z.string(),
  detectedAt: z.string().nullable(),
  git: z
    .strictObject({
      isRepo: z.boolean(),
      branch: z.string().nullable(),
      changes: z.array(z.strictObject({ path: z.string(), status: z.enum(['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflict']) })),
      lastCommit: z.strictObject({ hash: z.string(), subject: z.string(), date: z.string() }).nullable(),
    })
    .nullable(),
  files: z.array(z.string()),
});

const taskId = z.string().min(1).max(64);
/** Raw bytes of attached images; the main process still checks the real type from the content. */
const imageUploads = z
  .array(z.strictObject({ name: z.string().max(260), data: z.custom<Uint8Array>((value) => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= IMAGE_MAX_BYTES, 'Imagem vazia ou acima de 5 MB.') }))
  .max(IMAGES_PER_MESSAGE);
const taskImage = z.strictObject({ name: z.string(), mime: z.enum(Object.keys(IMAGE_TYPES) as [keyof typeof IMAGE_TYPES, ...(keyof typeof IMAGE_TYPES)[]]), size: z.number().int().nonnegative() });
const taskPrompt = z.string().trim().min(1).max(20_000);
const agentId = z.enum(AGENT_IDS);
const taskStatus = z.enum(TASK_STATUSES);
const nullableCount = count.nullable();
const tokensSchema = z.strictObject({ input: nullableCount, output: nullableCount, cached: nullableCount, costUsd: z.number().nonnegative().nullable() });
const taskSummaryFields = {
  id: z.string(),
  prompt: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  mode: z.enum(RUN_MODES),
  status: taskStatus,
  parentTaskId: z.string().nullable(),
  threadId: z.string(),
  threadTitle: z.string().nullable(),
  model: z.string().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  agents: z.array(agentId),
  tokens: tokensSchema,
  filesChanged: count,
  images: z.array(taskImage),
};
const taskDetailSchema = z.strictObject({
  ...taskSummaryFields,
  steps: z.array(
    z.strictObject({
      id: z.string(),
      position: count,
      agent: agentId,
      kind: z.enum(STEP_KINDS),
      status: taskStatus,
      tokens: tokensSchema,
      filesChanged: z.array(z.string()),
      error: z.string().nullable(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
    }),
  ),
  events: z.array(z.strictObject({ id: z.number().int(), stepId: z.string().nullable(), at: z.string(), kind: z.string(), data: z.record(z.string(), z.unknown()) })),
  executionSnapshot: z.strictObject({ taskId: z.string(), phase: z.enum(['pending', 'planning', 'awaiting_approval', 'executing', 'validating', 'completed', 'failed', 'cancelled']), attempt: count, checkpoint: z.string().nullable(), approval: z.enum(['not-required', 'pending', 'approved', 'rejected', 'cancelled']), cancellation: z.enum(['none', 'requested', 'acknowledged']), failureCategory: z.enum(['none', 'timeout', 'provider', 'database', 'filesystem', 'permission', 'configuration', 'unknown']), evidenceIds: z.array(z.string()), recoveryAction: z.enum(['none', 'resume', 'retry', 'manual-review', 'restore-backup']), updatedAt: z.string(), correlationId: z.string().nullable() }).nullable(),
});
const okSchema = z.strictObject({ ok: z.literal(true) });
const backupInfoSchema = z.strictObject({
  file: z.string(),
  name: z.string(),
  sizeBytes: count,
  createdAt: z.string(),
  kind: z.enum(['auto', 'manual', 'before-restore']),
});
const learningCandidateSchema = z.strictObject({
  id: z.string(),
  taskId: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  agent: agentId.nullable(),
  title: z.string(),
  content: z.string(),
  type: memoryType,
  tags: z.array(z.string()),
  status: z.enum(LEARNING_STATUSES),
  reason: z.string().nullable(),
  mergeTarget: z.strictObject({ id: z.string(), title: z.string() }).nullable(),
  memoryId: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
const retentionSchema = z.strictObject({ memoriesErased: count, tasksErased: count });
const idResult = z.strictObject({ id: z.string() });

export const ipcContract = {
  [IpcChannel.appInfo]: {
    input: noInput,
    output: z.strictObject({ name: z.string(), version: z.string(), platform: z.string(), electron: z.string() }),
  },
  [IpcChannel.appStatus]: {
    input: noInput,
    output: z.strictObject({
      database: z.discriminatedUnion('ok', [
        z.strictObject({ ok: z.literal(true), file: z.string() }),
        z.strictObject({ ok: z.literal(false), file: z.string(), reason: z.enum(['corrupt', 'locked', 'disk-full', 'migration', 'io', 'unknown']), recovery: z.enum(['retry', 'restore-backup', 'free-disk-space', 'check-permissions', 'export-diagnostics']) }),
      ]),
      configuration: z.discriminatedUnion('ok', [
        z.strictObject({ ok: z.literal(true), file: z.string() }),
        z.strictObject({ ok: z.literal(false), file: z.string(), reason: z.literal('invalid'), preservedAs: z.string().nullable(), recovery: z.literal('review-configuration') }),
      ]),
    }),
  },
  [IpcChannel.appRelaunch]: { input: noInput, output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.appExportDiagnostics]: { input: noInput, output: z.strictObject({ file: z.string() }) },
  [IpcChannel.monitoringSnapshot]: { input: z.strictObject({ since: z.number().int().nonnegative().optional() }), output: monitorSnapshotSchema },
  [IpcChannel.monitoringConfigure]: { input: z.strictObject({ intervalMs: monitoringIntervalSchema }), output: z.strictObject({ intervalMs: monitoringIntervalSchema }) },
  [IpcChannel.coreStatus]: { input: z.strictObject({}), output: coreRemoteStatusSchema },
  [IpcChannel.coreRemoteSet]: { input: z.strictObject({ enabled: z.boolean() }), output: coreRemoteStatusSchema },
  [IpcChannel.corePairingStart]: { input: z.strictObject({ grant: grantSchema }), output: corePairingOfferSchema },
  [IpcChannel.corePairings]: { input: z.strictObject({}), output: z.array(corePendingPairingSchema).max(50) },
  [IpcChannel.corePairingDecide]: { input: z.strictObject({ pairingId: z.string().min(1).max(64), decision: z.enum(['approve', 'reject']) }), output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.coreDevices]: { input: z.strictObject({}), output: z.array(coreDeviceSchema).max(500) },
  [IpcChannel.coreRevoke]: { input: revokeRequestSchema, output: z.strictObject({ revoked: z.array(z.string().max(64)).max(500) }) },
  [IpcChannel.coreRuntime]: { input: z.strictObject({}), output: coreRuntimeSchema },
  [IpcChannel.coreStandaloneSet]: { input: z.strictObject({ enabled: z.boolean() }), output: coreRuntimeSchema },
  [IpcChannel.databaseRecoveryBackups]: {
    input: noInput,
    output: z.array(z.strictObject({ name: z.string(), createdAt: z.string(), sizeBytes: z.number().int().nonnegative(), kind: z.string(), valid: z.boolean(), problem: z.string().nullable() })).max(500),
  },
  [IpcChannel.databaseRestoreBackup]: { input: z.strictObject({ name: z.string().min(1).max(200) }), output: z.strictObject({ preservedAs: z.string() }) },
  [IpcChannel.appMissionControl]: { input: noInput, output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.mcpServers]: {
    input: z.strictObject({ refresh: z.boolean() }),
    output: z.strictObject({
      clients: z.array(
        z.strictObject({
          id: mcpClientSchema,
          installed: z.boolean(),
          servers: z.array(
            z.strictObject({
              name: z.string(),
              transport: z.string().nullable(),
              status: z.enum(['connected', 'failed', 'needs_auth', 'disabled', 'not_checked', 'unknown']),
              detail: z.string().nullable(),
            }),
          ),
          error: z.string().nullable(),
        }),
      ),
      checkedAt: z.string(),
    }),
  },
  [IpcChannel.themeGet]: {
    input: noInput,
    output: themeSourceSchema,
  },
  [IpcChannel.themeSet]: {
    input: z.strictObject({ source: themeSourceSchema }),
    output: themeSourceSchema,
  },
  [IpcChannel.mcpStatus]: {
    input: noInput,
    output: z.strictObject({
      server: z.strictObject({ command: z.string(), args: z.array(z.string()), env: z.record(z.string(), z.string()) }),
      backupDir: z.string(),
      clients: z.array(
        z.strictObject({
          id: mcpClientSchema,
          installed: z.boolean(),
          registered: z.boolean(),
          matches: z.boolean(),
          configFile: z.string(),
          addCommand: z.string(),
          removeCommand: z.string(),
          error: z.string().nullable(),
        }),
      ),
    }),
  },
  [IpcChannel.mcpRegister]: {
    input: z.strictObject({ client: mcpClientSchema }),
    output: mcpChangeSchema,
  },
  [IpcChannel.mcpRegisterAlias]: {
    input: z.strictObject({ client: mcpClientSchema }),
    output: mcpChangeSchema,
  },
  [IpcChannel.mcpUnregister]: {
    input: z.strictObject({ client: mcpClientSchema }),
    output: mcpChangeSchema,
  },
  [IpcChannel.semanticStatus]: { input: noInput, output: semanticStatusSchema },
  [IpcChannel.semanticEnable]: { input: noInput, output: semanticStatusSchema },
  [IpcChannel.semanticDisable]: { input: noInput, output: semanticStatusSchema },
  [IpcChannel.brainOverview]: {
    input: noInput,
    output: z.strictObject({
      total: count,
      byType: z.array(z.strictObject({ type: memoryType, count })),
      byProject: z.array(z.strictObject({ projectId: z.string().nullable(), name: z.string().nullable(), count })),
      links: z.strictObject({ resolved: count, pending: count }),
      embeddings: z.strictObject({ indexed: count, pending: count, failed: count }),
      recent: z.array(summarySchema),
    }),
  },
  [IpcChannel.brainSearch]: {
    input: brainSearchInputSchema,
    output: z.strictObject({
      hits: z.array(searchHitSchema),
      mode: z.enum(['hybrid', 'fts']),
      degraded: z.enum(['disabled', 'model_missing', 'model_error']).nullable(),
    }),
  },
  [IpcChannel.brainList]: {
    input: listFilterSchema,
    output: z.strictObject({ items: z.array(summarySchema), nextCursor: z.string().nullable() }),
  },
  [IpcChannel.brainGet]: { input: z.strictObject({ id: memoryId }), output: memoryDetailSchema.nullable() },
  [IpcChannel.brainVersions]: {
    input: z.strictObject({ id: memoryId }),
    output: z.array(
      z.strictObject({
        version: z.number().int(),
        title: z.string(),
        content: z.string(),
        type: memoryType,
        tags: z.array(z.string()),
        changedBy: z.enum(SOURCE_KINDS),
        createdAt: z.string(),
      }),
    ),
  },
  [IpcChannel.brainStore]: {
    input: storeInputSchema,
    output: z.strictObject({ memory: memorySchema, created: z.boolean(), changed: z.boolean() }),
  },
  [IpcChannel.brainDelete]: { input: z.strictObject({ id: memoryId, hard: z.boolean() }), output: z.strictObject({ deleted: z.literal(true) }) },
  [IpcChannel.brainConfidence]: { input: z.strictObject({ id: memoryId, confidence: z.enum(CONFIDENCE_STATES) }), output: z.strictObject({ confidence: z.enum(CONFIDENCE_STATES) }) },
  [IpcChannel.brainRevalidate]: {
    input: z.strictObject({ id: memoryId }),
    output: z.strictObject({
      confidence: z.enum(CONFIDENCE_STATES),
      findings: z.array(z.strictObject({ kind: z.enum(['file', 'url', 'task', 'conversation']), ref: z.string(), status: z.enum(['ok', 'missing', 'changed', 'unchecked']) })),
    }),
  },
  [IpcChannel.brainProjects]: {
    input: noInput,
    output: z.array(z.strictObject({ id: z.string(), name: z.string(), isPrivate: z.boolean() })),
  },
  [IpcChannel.brainTags]: { input: noInput, output: z.array(z.strictObject({ name: z.string().max(LIMITS.tagLength), count })) },
  [IpcChannel.brainGraph]: {
    input: noInput,
    output: z.strictObject({
      memories: z.array(z.strictObject({ id: z.string(), title: z.string(), type: memoryType, projectId: z.string().nullable(), tags: z.array(z.string()) })),
      links: z.array(z.strictObject({ sourceId: z.string(), targetId: z.string().nullable(), targetTitle: z.string(), relation: z.string() })),
      truncated: z.boolean(),
    }),
  },
  [IpcChannel.brainSettings]: { input: noInput, output: brainSettingsSchema },
  [IpcChannel.brainSaveSettings]: { input: brainSettingsSchema, output: brainSettingsSchema },
  [IpcChannel.brainLearning]: { input: z.strictObject({ status: z.enum(LEARNING_STATUSES).optional() }), output: z.array(learningCandidateSchema) },
  [IpcChannel.brainLearningApprove]: {
    input: z.strictObject({
      id: memoryId,
      edits: z
        .strictObject({ title: z.string().max(LIMITS.titleLength).optional(), content: z.string().max(LIMITS.contentLength).optional(), type: memoryType.optional(), tags: z.array(z.string().max(LIMITS.tagLength)).max(LIMITS.tags).optional() })
        .optional(),
    }),
    output: z.strictObject({ memoryId: z.string() }),
  },
  [IpcChannel.brainLearningReject]: { input: z.strictObject({ id: memoryId }), output: okSchema },
  [IpcChannel.brainBackups]: { input: noInput, output: z.array(backupInfoSchema) },
  [IpcChannel.brainBackupCreate]: { input: noInput, output: backupInfoSchema },
  // A name from the backups folder, never a path.
  [IpcChannel.brainBackupRestore]: { input: z.strictObject({ name: z.string().regex(/^neuralbridge-[0-9TZ-]+-(auto|manual|before-restore)\.db$/) }), output: z.strictObject({ safetyBackup: backupInfoSchema }) },
  [IpcChannel.brainRetention]: { input: noInput, output: retentionSchema },
  [IpcChannel.brainExport]: { input: z.strictObject({ format: z.enum(['json', 'markdown']) }), output: z.strictObject({ count, path: z.string() }).nullable() },
  [IpcChannel.brainImport]: {
    input: noInput,
    output: z.strictObject({ imported: count, skipped: z.array(z.strictObject({ title: z.string(), reason: z.string() })) }).nullable(),
  },
  [IpcChannel.brainGraph3d]: {
    input: noInput,
    output: z.strictObject({
      memories: z.array(
        z.strictObject({
          id: z.string(),
          title: z.string(),
          type: memoryType,
          projectId: z.string().nullable(),
          projectName: z.string().nullable(),
          trust: z.enum(TRUST_STATES),
          sourceKind: z.enum(SOURCE_KINDS),
          tags: z.array(z.string()),
          updatedAt: z.string(),
        }),
      ),
      links: z.array(z.strictObject({ sourceId: z.string(), targetId: z.string(), relation: z.string(), origin: z.enum(['wikilink', 'explicit']) })),
      truncated: z.boolean(),
    }),
  },
  [IpcChannel.brainGalaxy]: {
    input: noInput,
    output: z.strictObject({
      memories: z.array(
        z.strictObject({
          id: z.string(),
          title: z.string(),
          type: memoryType,
          projectId: z.string().nullable(),
          projectName: z.string().nullable(),
          trust: z.enum(TRUST_STATES),
          confidence: z.enum(CONFIDENCE_STATES),
          sourceKind: z.enum(SOURCE_KINDS),
          tags: z.array(z.string()),
          createdAt: z.string(),
          updatedAt: z.string(),
        }),
      ),
      links: z.array(z.strictObject({ sourceId: z.string(), targetId: z.string(), relation: z.string(), origin: z.enum(['wikilink', 'explicit']) })),
      total: count,
      truncated: z.boolean(),
      embeddings: z
        .strictObject({
          model: z.string(),
          dim: z.number().int().min(1).max(4096),
          ids: z.array(z.string()),
          vectors: z.custom<Uint8Array>((value) => value instanceof Uint8Array, 'Vetores devem ser bytes Float32.'),
        })
        .refine((value) => value.vectors.byteLength === value.ids.length * value.dim * 4, 'Tamanho dos vetores não confere com ids x dim.')
        .nullable(),
    }),
  },
  [IpcChannel.brainSimilarity]: {
    input: noInput,
    output: z.strictObject({
      available: z.boolean(),
      reason: z.enum(['disabled', 'no_embeddings']).nullable(),
      threshold: z.number(),
      topK: count,
      considered: count,
      truncated: z.boolean(),
      edges: z.array(z.strictObject({ sourceId: z.string(), targetId: z.string(), score: z.number().min(-1).max(1) })),
    }),
  },
  [IpcChannel.brainActivity]: {
    input: z.strictObject({ since: z.iso.datetime() }),
    output: z.array(z.strictObject({ id: z.number().int(), memoryId: z.string(), title: z.string(), client: z.string(), action: z.enum(['recall', 'search_hit', 'context', 'update']), at: z.string() })),
  },
  [IpcChannel.projectsList]: { input: noInput, output: z.array(z.strictObject(projectSummaryFields)) },
  [IpcChannel.projectsPick]: { input: noInput, output: z.string().nullable() },
  [IpcChannel.projectsDiscover]: { input: z.strictObject({ path: projectPath }), output: discoveryReport },
  [IpcChannel.projectsDiscoverCancel]: { input: noInput, output: okSchema },
  [IpcChannel.projectsDiscoverConfirm]: { input: z.strictObject({ root: projectPath, choices: z.array(z.strictObject({ path: projectPath, selected: z.boolean(), classification: discoveryClassification, parentPath: projectPath.nullable() })).max(2_000) }), output: z.strictObject({ created: z.array(z.string()), linked: z.array(z.string()) }) },
  [IpcChannel.projectsMove]: { input: z.strictObject({ id: projectId, parentId: projectId.nullable() }), output: okSchema },
  [IpcChannel.projectsSetKind]: { input: z.strictObject({ id: projectId, kind: z.enum(['project', 'workspace']) }), output: okSchema },
  [IpcChannel.projectsGitState]: { input: noInput, output: z.record(z.string(), z.strictObject({ branch: z.string().nullable(), own: z.boolean() })) },
  [IpcChannel.projectsCreate]: { input: z.strictObject({ name: z.string().min(1).max(120), parent: projectPath, technology: z.enum(['node', 'dotnet', 'python', 'java', 'rust', 'go', 'other']), parentProjectId: projectId.nullable(), allowNested: z.boolean() }), output: z.strictObject({ id: z.string() }) },
  [IpcChannel.projectsClone]: { input: z.strictObject({ url: z.string().min(1).max(2_000), parent: projectPath, name: z.string().min(1).max(120), parentProjectId: projectId.nullable() }), output: z.strictObject({ id: z.string() }) },
  [IpcChannel.projectsInitGit]: { input: z.strictObject({ id: projectId, allowNested: z.boolean() }), output: okSchema },
  [IpcChannel.projectsAdd]: { input: z.strictObject({ path: projectPath }), output: projectDetailSchema },
  [IpcChannel.projectsGet]: { input: z.strictObject({ id: projectId }), output: projectDetailSchema },
  [IpcChannel.projectsRefresh]: { input: z.strictObject({ id: projectId }), output: projectDetailSchema },
  [IpcChannel.projectsUpdate]: {
    input: z.strictObject({
      id: projectId,
      changes: z.strictObject({
        name: z.string().trim().min(1).max(120).optional(),
        preferredAgent: z.enum(PREFERRED_AGENTS).optional(),
        rules: z.string().max(20_000).optional(),
        isPrivate: z.boolean().optional(),
        permissionLevel: z.enum(PERMISSION_LEVELS).optional(),
        allowedCommands: z.array(z.string().regex(ALLOWED_COMMAND)).max(ALLOWED_COMMANDS_MAX).optional(),
      }),
    }),
    output: projectDetailSchema,
  },
  [IpcChannel.projectsImpact]: { input: z.strictObject({ id: projectId }), output: z.strictObject({ memories: count }) },
  [IpcChannel.projectsRemove]: { input: z.strictObject({ id: projectId }), output: z.strictObject({ removed: z.literal(true), memories: count }) },
  [IpcChannel.projectsDiff]: {
    input: z.strictObject({ id: projectId, path: projectPath.optional(), commit: z.string().regex(/^[A-Za-z0-9_./-]+(?:~[0-9]*|\^[0-9]*)*$/).optional() }),
    output: z.strictObject({ text: z.string(), truncated: z.boolean() }),
  },
  [IpcChannel.projectsLineStats]: {
    input: z.strictObject({ id: projectId, cursor: z.string().max(500).optional() }),
    output: z.array(z.strictObject({ path: z.string(), added: count, removed: count })),
  },
  [IpcChannel.projectsProfile]: { input: z.strictObject({ id: projectId }), output: projectProfileSchema.nullable() },
  [IpcChannel.projectsProfileRefresh]: { input: z.strictObject({ id: projectId }), output: projectProfileSchema },
  [IpcChannel.projectsGitIndex]: {
    input: z.strictObject({ id: projectId }),
    output: z.strictObject({ isRepo: z.boolean(), commits: count, files: count, alreadyKnown: count, limited: z.boolean(), branches: count }),
  },
  [IpcChannel.projectsGitSearch]: {
    input: z.strictObject({ id: projectId, query: z.string().trim().min(1).max(200) }),
    output: z.array(z.strictObject({ hash: z.string(), file: z.string().nullable(), subject: z.string(), author: z.string(), date: z.string(), reference: z.string(), excerpt: z.string() })),
  },
  [IpcChannel.projectsGitRelations]: {
    input: z.strictObject({ id: projectId, hash: z.string().regex(/^[0-9a-f]{7,64}$/) }),
    output: z.strictObject({ files: z.array(z.string()), memories: z.array(profileMemory), tasks: z.array(z.strictObject({ id: z.string(), prompt: z.string() })) }),
  },
  [IpcChannel.projectsGitHistory]: {
    input: z.strictObject({ id: projectId, cursor: z.string().max(500).optional() }),
    output: z.strictObject({
      isRepo: z.boolean(),
      branches: z.array(z.strictObject({ name: z.string(), head: z.string() })),
      refs: z.array(z.strictObject({ name: z.string(), kind: z.enum(['local', 'remote', 'tag']), hash: z.string() })).optional(),
      head: z.string().nullable().optional(),
      commits: z.array(z.strictObject({
        hash: z.string(), author: z.string(), date: z.string(), parents: z.array(z.string()), subject: z.string(), body: z.string(),
        files: z.array(z.strictObject({ path: z.string(), previousPath: z.string().nullable(), status: z.enum(['added', 'modified', 'deleted', 'renamed']), line: z.number().nullable(), binary: z.boolean(), patch: z.string(), truncated: z.boolean() })),
      })),
      limited: z.boolean(),
      nextCursor: z.string().nullable().optional(),
    }),
  },
  [IpcChannel.projectsGitCompare]: {
    input: z.strictObject({
      id: projectId,
      left: z.string()
        .refine(val => {
          if (typeof val !== 'string') return false;
          if (val.length === 0 || val.length > 255) return false;
          if (val.includes('..')) return false;
          if (val.startsWith('/') || val.endsWith('/')) return false;
          if (val === '.' || val === '..') return false;
          if (val.includes(';') || val.includes('&&') || val.includes('||') || val.includes('|') || val.includes('&') || val.includes('`')) return false;
          if (/^\.\.$/.test(val)) return false;
          if (/^[a-zA-Z]:\/.*$/.test(val)) return false;
          if (/^\/.*\/.*\/.*$/.test(val)) return false;
          if (/^[A-Za-z0-9_./~^][A-Za-z0-9_./0-9-]*(?:~[0-9]+|\^[0-9]+)*$/.test(val)) return true;
          return false;
        })
        .refine(val => {
          if (!val.includes('/')) return true;
          const parts = val.split('/');
          return parts.every(part => part.length > 0 && !part.includes('..'));
        }),
      right: z.string()
        .refine(val => {
          if (typeof val !== 'string') return false;
          if (val.length === 0 || val.length > 255) return false;
          if (val.includes('..')) return false;
          if (val.startsWith('/') || val.endsWith('/')) return false;
          if (val === '.' || val === '..') return false;
          if (val.includes(';') || val.includes('&&') || val.includes('||') || val.includes('|') || val.includes('&') || val.includes('`')) return false;
          if (/^\.\.$/.test(val)) return false;
          if (/^[a-zA-Z]:\/.*$/.test(val)) return false;
          if (/^\/.*\/.*\/.*$/.test(val)) return false;
          if (/^[A-Za-z0-9_./~^][A-Za-z0-9_./0-9-]*(?:~[0-9]+|\^[0-9]+)*$/.test(val)) return true;
          return false;
        })
        .refine(val => {
          if (!val.includes('/')) return true;
          const parts = val.split('/');
          return parts.every(part => part.length > 0 && !part.includes('..'));
        }),
      mode: z.enum(['direct', 'merge-base'])
    }),
    output: z.strictObject({ left: z.string(), right: z.string(), mode: z.enum(['direct', 'merge-base']), mergeBase: z.string().nullable(), files: z.array(z.strictObject({ path: z.string(), previousPath: z.string().nullable(), status: z.enum(['added', 'modified', 'deleted', 'renamed', 'binary']), added: z.number().int().nonnegative(), removed: z.number().int().nonnegative() })), added: z.number().int().nonnegative(), removed: z.number().int().nonnegative() }),
  },
  [IpcChannel.projectsGitWorkingTree]: { input: z.strictObject({ id: projectId }), output: z.array(z.strictObject({ path: projectPath, status: z.enum(['staged', 'unstaged', 'untracked', 'conflict']), staged: z.boolean(), unstaged: z.boolean() })) },
  [IpcChannel.projectsGitStage]: { input: z.strictObject({ id: projectId, paths: z.array(projectPath).min(1).max(500), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitUnstage]: { input: z.strictObject({ id: projectId, paths: z.array(projectPath).min(1).max(500), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitAuthorize]: { input: z.strictObject({ id: projectId, operation: z.string().min(1).max(40), parameters: z.record(z.string(), z.union([z.string().max(500), z.array(z.string().max(500)).max(500)])) }), output: z.strictObject({ token: z.string(), expiresAt: z.string() }) },
  [IpcChannel.projectsGitBranches]: { input: z.strictObject({ id: projectId }), output: z.array(z.strictObject({ name: z.string(), current: z.boolean(), remote: z.boolean(), worktree: z.boolean() })) },
  [IpcChannel.projectsGitBranchCreate]: { input: z.strictObject({ id: projectId, name: z.string().min(1).max(250), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitBranchSwitch]: { input: z.strictObject({ id: projectId, name: z.string().min(1).max(250), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitBranchRename]: { input: z.strictObject({ id: projectId, name: z.string().min(1).max(250), oldName: z.string().min(1).max(250), newName: z.string().min(1).max(250), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitBranchDelete]: { input: z.strictObject({ id: projectId, name: z.string().min(1).max(250), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitStashes]: { input: z.strictObject({ id: projectId }), output: z.array(z.strictObject({ ref: z.string(), message: z.string() })) },
  [IpcChannel.projectsGitStashCreate]: { input: z.strictObject({ id: projectId, message: z.string().min(1).max(200), includeUntracked: z.boolean(), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitStashApply]: { input: z.strictObject({ id: projectId, ref: z.string().regex(/^stash@\{[0-9]+\}$/), pop: z.boolean(), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitStashDrop]: { input: z.strictObject({ id: projectId, ref: z.string().regex(/^stash@\{[0-9]+\}$/), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitCommit]: { input: z.strictObject({ id: projectId, message: z.string().min(1).max(500), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitSyncStatus]: { input: z.strictObject({ id: projectId }), output: z.strictObject({ branch: z.string().nullable(), upstream: z.string().nullable(), remote: z.string().nullable(), remotes: z.array(z.string()), ahead: z.number().int().nonnegative(), behind: z.number().int().nonnegative(), pending: z.array(z.strictObject({ hash: z.string(), subject: z.string(), date: z.string() })) }) },
  [IpcChannel.projectsGitPush]: { input: z.strictObject({ id: projectId, remote: z.string().min(1).max(100).optional(), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitOperationState]: { input: z.strictObject({ id: projectId }), output: z.strictObject({ operation: z.enum(['revert', 'cherry-pick']).nullable(), conflicts: z.array(projectPath) }) },
  [IpcChannel.projectsGitRevert]: { input: z.strictObject({ id: projectId, commit: z.string().regex(/^[0-9a-f]{7,64}$/i), mainline: z.number().int().min(1).optional(), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitCherryPick]: { input: z.strictObject({ id: projectId, commit: z.string().regex(/^[0-9a-f]{7,64}$/i), mainline: z.number().int().min(1).optional(), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitOperationResolve]: { input: z.strictObject({ id: projectId, operation: z.enum(['revert', 'cherry-pick']), action: z.enum(['continue', 'abort']), token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsGitAuthorizePatch]: { input: z.strictObject({ id: projectId, patch: gitPatchSchema }), output: z.strictObject({ token: z.string(), expiresAt: z.string() }) },
  [IpcChannel.projectsGitApplyPatch]: { input: z.strictObject({ id: projectId, patch: gitPatchSchema, token: z.string().min(20).max(200) }), output: okSchema },
  [IpcChannel.projectsFile]: {
    input: z.strictObject({ id: projectId, path: projectPath }),
    output: z.union([z.strictObject({ ok: z.literal(true), content: z.string() }), z.strictObject({ ok: z.literal(false), reason: z.string() })]),
  },
  [IpcChannel.tasksStart]: {
    // Model names go to the CLI as one argument (no shell); still, only characters model ids use.
    input: z.strictObject({ prompt: taskPrompt, projectId: projectId.nullable(), mode: z.enum(RUN_MODES), access: z.enum(['read-only', 'edit']).optional(), model: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/).nullable().optional(), images: imageUploads.optional(), skillIds: z.array(z.string().min(1).max(300)).max(8).optional(), participants: z.array(projectId).max(32).optional(), externalRef: z.strictObject({ system: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/), id: z.string().min(1).max(128), revision: z.number().int().nonnegative() }).optional() }),
    output: idResult,
  },
  [IpcChannel.tasksGitReviewStart]: { input: gitReviewStartInputSchema, output: idResult },
  [IpcChannel.tasksSmartCommitStart]: { input: smartCommitStartInputSchema, output: idResult },
  [IpcChannel.tasksResume]: { input: z.strictObject({ id: taskId, prompt: taskPrompt, images: imageUploads.optional() }), output: idResult },
  [IpcChannel.analyticsTokens]: {
    input: z.strictObject({ period: z.enum(['24h', '7d', '30d', 'all']) }),
    output: z.strictObject({
      since: z.string(),
      generatedAt: z.string(),
      totals: z.strictObject({ input: count, output: count, cached: count, estimatedContext: count, tasks: count, tasksWithData: count, tasksWithoutData: count }),
      cacheRate: z.number().min(0).nullable(),
      byAgent: z.array(z.strictObject({ key: z.string(), label: z.string(), input: count, output: count, cached: count, steps: count })),
      byStep: z.array(z.strictObject({ key: z.string(), label: z.string(), input: count, output: count, cached: count, steps: count })),
      byProject: z.array(z.strictObject({ key: z.string(), label: z.string(), input: count, output: count, cached: count, steps: count })),
      alerts: z.array(z.strictObject({ kind: z.enum(['budget', 'context', 'repeated', 'review_loop', 'cache', 'missing']), severity: z.enum(['critical', 'warning', 'info']), message: z.string(), recommendation: z.string(), taskIds: z.array(z.string()) })),
    }),
  },
  [IpcChannel.analyticsBudget]: { input: noInput, output: z.number().int() },
  [IpcChannel.analyticsBudgetSave]: { input: z.strictObject({ tokenBudget: z.number().int().min(10_000).max(50_000_000) }), output: z.number().int() },
  [IpcChannel.tasksHeal]: { input: z.strictObject({ id: taskId }), output: idResult },
  [IpcChannel.tasksImage]: { input: z.strictObject({ id: taskId, index: z.number().int().min(0).max(IMAGES_PER_MESSAGE - 1) }), output: z.string().startsWith('data:image/') },
  [IpcChannel.tasksApprove]: { input: z.strictObject({ id: taskId }), output: okSchema },
  [IpcChannel.tasksCancel]: { input: z.strictObject({ id: taskId }), output: okSchema },
  [IpcChannel.tasksPause]: { input: z.strictObject({ id: taskId }), output: okSchema },
  [IpcChannel.tasksRetryCapacity]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: okSchema },
  [IpcChannel.tasksCapacityAutoResume]: { input: z.strictObject({ id: z.string().min(1).max(100), enabled: z.boolean() }), output: okSchema },
  [IpcChannel.tasksResumePaused]: { input: z.strictObject({ id: taskId }), output: okSchema },
  [IpcChannel.tasksOutputFile]: { input: z.strictObject({ id: taskId, path: projectPath, action: z.enum(['open', 'reveal']) }), output: okSchema },
  [IpcChannel.tasksList]: {
    input: z.strictObject({
      status: taskStatus.optional(),
      projectId: projectId.optional(),
      agent: agentId.optional(),
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    output: z.array(z.strictObject(taskSummaryFields)),
  },
  [IpcChannel.companionSessions]: { input: companionSessionsQuerySchema, output: companionSessionPageSchema },
  [IpcChannel.companionSession]: { input: z.strictObject({ sessionId: z.string().uuid() }), output: companionSessionSchema.nullable() },
  [IpcChannel.companionEvents]: { input: companionEventsQuerySchema, output: companionEventPageSchema },
  [IpcChannel.companionSubscribe]: { input: companionSubscribeInputSchema, output: companionSubscriptionResultSchema },
  [IpcChannel.companionUnsubscribe]: { input: companionUnsubscribeInputSchema, output: companionOkSchema },
  [IpcChannel.companionHudMode]: { input: z.strictObject({ mode: z.enum(COMPANION_HUD_MODES) }), output: companionOkSchema },
  [IpcChannel.companionHudVisibility]: { input: z.strictObject({ visible: z.boolean() }), output: companionOkSchema },
  [IpcChannel.companionHudPin]: { input: z.strictObject({ alwaysOnTop: z.boolean() }), output: companionOkSchema },
  [IpcChannel.companionHudResetPosition]: { input: noInput, output: companionOkSchema },
  [IpcChannel.companionHudState]: { input: noInput, output: companionHudStateSchema },
  [IpcChannel.companionHudDrag]: { input: companionHudDragSchema, output: companionOkSchema },
  [IpcChannel.companionHudInteractive]: { input: z.strictObject({ interactive: z.boolean() }), output: companionOkSchema },
  [IpcChannel.companionHudOpenPanel]: { input: noInput, output: companionOkSchema },
  [IpcChannel.companionHudOpenSettings]: { input: noInput, output: companionOkSchema },
  [IpcChannel.spotifyStatus]: { input: noInput, output: spotifyStatusSchema },
  [IpcChannel.spotifyConfigure]: { input: spotifyConfigureSchema, output: spotifyStatusSchema },
  [IpcChannel.spotifyConnect]: { input: noInput, output: spotifyStatusSchema },
  [IpcChannel.spotifyCancelConnect]: { input: noInput, output: companionOkSchema },
  [IpcChannel.spotifyDisconnect]: { input: noInput, output: spotifyStatusSchema },
  [IpcChannel.spotifyControl]: { input: spotifyControlSchema, output: spotifyStatusSchema },
  [IpcChannel.spotifyDevices]: { input: noInput, output: z.array(spotifyDeviceSchema).max(50) },
  [IpcChannel.spotifyOpenTrack]: { input: noInput, output: companionOkSchema },
  [IpcChannel.neuraVoiceStart]: { input: voiceStartInputSchema, output: voiceSessionSchema },
  [IpcChannel.neuraVoiceStop]: { input: voiceStopInputSchema, output: companionOkSchema },
  [IpcChannel.neuraMeetingStart]: { input: meetingStartInputSchema, output: meetingSessionSchema },
  [IpcChannel.neuraMeetingStop]: { input: meetingStopInputSchema, output: companionOkSchema },
  [IpcChannel.neuraSuggestionDecide]: { input: suggestionDecisionSchema, output: suggestionSchema },
  [IpcChannel.neuraSuggestionCopy]: { input: z.strictObject({ suggestionId: z.string().uuid() }), output: suggestionSchema },
  [IpcChannel.neuraSpotifyCommand]: { input: spotifyCommandSchema, output: spotifyCommandResultSchema },
  [IpcChannel.neuraPauseAll]: { input: noInput, output: neuraPauseResultSchema },
  [IpcChannel.neuraResume]: { input: noInput, output: neuraStateSchema },
  [IpcChannel.neuraSpeechFinished]: { input: noInput, output: companionOkSchema },
  [IpcChannel.neuraVoiceAudio]: { input: neuraVoiceAudioSchema, output: companionOkSchema },
  [IpcChannel.neuraMeetingAudio]: { input: neuraMeetingAudioSchema, output: companionOkSchema },
  [IpcChannel.neuraSpeak]: { input: neuraSpeechInputSchema, output: neuraSpeechResultSchema },
  [IpcChannel.neuraState]: { input: noInput, output: neuraStateSchema },
  [IpcChannel.neuraInput]: { input: neuraInputSchema, output: neuraResponseSchema },
  [IpcChannel.neuraMeetingTranscript]: { input: meetingTranscriptInputSchema, output: companionOkSchema },
  [IpcChannel.neuraActionDecide]: { input: neuraActionDecisionSchema, output: neuraResponseSchema },
  [IpcChannel.neuraSettings]: { input: noInput, output: neuraSettingsSchema },
  [IpcChannel.neuraSettingsUpdate]: { input: neuraSettingsPatchSchema, output: neuraSettingsSchema },
  [IpcChannel.neuraClearHistory]: { input: noInput, output: z.strictObject({ removed: z.number().int().nonnegative() }) },
  [IpcChannel.tasksGet]: { input: z.strictObject({ id: taskId }), output: taskDetailSchema },
  [IpcChannel.tasksGitReviewGet]: { input: z.strictObject({ id: taskId }), output: gitReviewReportSchema.nullable() },
  [IpcChannel.tasksSmartCommitGet]: { input: z.strictObject({ id: taskId }), output: smartCommitReportSchema.nullable() },
  [IpcChannel.tasksThread]: { input: z.strictObject({ id: taskId }), output: z.array(taskDetailSchema) },
  [IpcChannel.tasksRenameThread]: { input: z.strictObject({ id: taskId, title: z.string().max(CONVERSATION_TITLE_MAX) }), output: okSchema },
  [IpcChannel.tasksDeleteThread]: { input: z.strictObject({ id: taskId }), output: z.strictObject({ deleted: count }) },
  [IpcChannel.tasksModels]: { input: noInput, output: z.strictObject({ claude: z.array(z.string()), codex: z.array(z.string()) }) },
  [IpcChannel.tasksSwarmPlan]: { input: z.strictObject({ prompt: taskPrompt, tokenBudget: z.number().int().min(10_000).max(50_000_000).optional() }), output: z.strictObject({ roles: z.array(z.string()), rationale: z.array(z.string()), maxParallel: count, requiresHumanApproval: z.boolean(), handoffs: z.array(z.strictObject({ role: z.string(), dependsOn: z.array(z.string()), readOnly: z.boolean(), output: z.string() })) }) },
  [IpcChannel.tasksSwarmRun]: { input: z.strictObject({ prompt: taskPrompt, projectId: projectId.nullable(), approved: z.boolean(), tokenBudget: z.number().int().min(10_000).max(50_000_000).optional() }), output: z.strictObject({ taskIds: z.array(z.string()), roles: z.array(z.string()), results: z.array(z.strictObject({ role: z.string(), taskId: z.string(), status: z.string(), summary: z.string().nullable(), error: z.string().nullable(), filesChanged: z.array(z.string()) })), conflicts: z.array(z.string()) }) },
  [IpcChannel.workflowsList]: { input: z.strictObject({ projectId: projectId.optional() }), output: z.array(z.strictObject({ id: z.string(), name: z.string(), projectId: projectId.nullable(), version: count, updatedAt: z.string() })) },
  [IpcChannel.workflowsGet]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.strictObject({ id: z.string(), definition: workflowDefinitionInputSchema, version: count, layout: z.string().nullable(), updatedAt: z.string() }) },
  [IpcChannel.workflowsSave]: { input: z.strictObject({ id: z.string().min(1).max(100).optional(), definition: workflowDefinitionInputSchema }), output: z.strictObject({ id: z.string(), version: count }) },
  [IpcChannel.workflowsDelete]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: okSchema },
  [IpcChannel.workflowsRun]: { input: z.strictObject({ id: z.string().min(1).max(100), approved: z.boolean(), inputs: z.record(z.string().max(100), z.string().max(20_000)).optional() }), output: z.strictObject({ runId: z.string() }) },
  [IpcChannel.workflowsAutomations]: { input: z.strictObject({ projectId: z.string().min(1).max(100) }), output: z.array(z.strictObject({ id: z.string(), name: z.string(), workflowId: z.string(), trigger: z.object({ refs: z.array(z.string()).optional(), pathGlobs: z.array(z.string()).optional(), kinds: z.array(z.string()).optional() }), enabled: z.boolean(), hourlyLimit: count })) },
  [IpcChannel.workflowsAutomationSave]: { input: z.strictObject({ id: z.string().min(1).max(100).optional(), projectId: z.string().min(1).max(100), workflowId: z.string().min(1).max(100), name: z.string().trim().min(1).max(120), trigger: z.strictObject({ refs: z.array(z.string().min(1).max(255)).max(32).optional(), pathGlobs: z.array(z.string().min(1).max(255)).max(32).optional() }), hourlyLimit: z.number().int().min(1).max(200).optional() }), output: z.strictObject({ id: z.string() }) },
  [IpcChannel.workflowsAutomationToggle]: { input: z.strictObject({ id: z.string().min(1).max(100), enabled: z.boolean() }), output: okSchema },
  [IpcChannel.workflowsAutomationDelete]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: okSchema },
  [IpcChannel.workflowsAutomationEvents]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.array(z.strictObject({ id: z.string(), kind: z.string(), ref: z.string().nullable(), commitHash: z.string().nullable(), status: z.string(), reason: z.string().nullable(), runId: z.string().nullable(), createdAt: z.string() })) },
  [IpcChannel.workflowsRunFromGit]: { input: z.strictObject({ workflowId: z.string().min(1).max(100), ref: z.string().min(1).max(255).optional(), hash: z.string().min(1).max(255).optional(), base: z.string().min(1).max(255).optional(), head: z.string().min(1).max(255).optional() }), output: z.strictObject({ runId: z.string() }) },
  [IpcChannel.workflowsSteps]: { input: z.strictObject({ runId: z.string().min(1).max(100) }), output: z.array(z.strictObject({ stepId: z.string(), status: z.string(), taskId: z.string().nullable(), error: z.string().nullable() })) },
  [IpcChannel.workflowsApproveStep]: { input: z.strictObject({ runId: z.string().min(1).max(100), stepId: z.string().min(1).max(100) }), output: okSchema },
  [IpcChannel.workflowsRejectStep]: { input: z.strictObject({ runId: z.string().min(1).max(100), stepId: z.string().min(1).max(100) }), output: okSchema },
  [IpcChannel.workflowsDecideStep]: { input: z.strictObject({ runId: z.string().min(1).max(100), stepId: z.string().min(1).max(100), choice: z.enum(['retry', 'skip', 'abort']) }), output: okSchema },
  [IpcChannel.workflowsRuns]: { input: z.strictObject({ workflowId: z.string().min(1).max(100).optional() }), output: z.array(z.strictObject({ id: z.string(), workflowId: z.string(), status: z.enum(['pending', 'running', 'waiting_approval', 'paused', 'retrying', 'interrupted', 'completed', 'failed', 'cancelled']), currentLayer: count, taskIds: z.array(z.string()), error: z.string().nullable(), updatedAt: z.string() })) },
  [IpcChannel.workflowsPause]: { input: z.strictObject({ runId: z.string().min(1).max(100) }), output: okSchema },
  [IpcChannel.workflowsResume]: { input: z.strictObject({ runId: z.string().min(1).max(100) }), output: okSchema },
  [IpcChannel.workflowsCancel]: { input: z.strictObject({ runId: z.string().min(1).max(100) }), output: okSchema },
  [IpcChannel.workflowsTimeline]: { input: z.strictObject({ runId: z.string().min(1).max(100) }), output: z.array(z.strictObject({ sequence: count, completed: z.array(z.string()), pending: z.array(z.string()), recoveryMeta: z.record(z.string(), z.unknown()), createdAt: z.string() })) },
  [IpcChannel.workflowsTemplates]: { input: z.strictObject({}), output: z.array(z.strictObject({ id: z.string(), version: count, name: z.string(), category: z.string(), description: z.string(), requirements: z.array(z.string()), source: z.string() })) },
  [IpcChannel.workflowsInstantiateTemplate]: { input: z.strictObject({ templateId: z.string().min(1).max(100), projectId: projectId.nullable() }), output: z.strictObject({ templateId: z.string(), version: count, definition: workflowDefinitionInputSchema }) },
  [IpcChannel.workflowsTemplateFavorite]: { input: z.strictObject({ templateId: z.string().min(1).max(100), favorite: z.boolean() }), output: okSchema },
  [IpcChannel.workflowsTemplateExport]: { input: z.strictObject({ templateId: z.string().min(1).max(100) }), output: z.string().max(2_000_000) },
  [IpcChannel.workflowsTemplateImport]: { input: z.strictObject({ payload: z.string().min(2).max(2_000_000) }), output: z.strictObject({ id: z.string(), version: count }) },
  [IpcChannel.workflowsLayoutSave]: { input: z.strictObject({ id: z.string().min(1).max(100), layout: z.string().max(500_000) }), output: okSchema },
  [IpcChannel.videoKit]: { input: z.strictObject({}), output: z.strictObject({ installed: z.boolean(), path: z.string(), version: z.string().nullable(), templates: z.array(z.strictObject({ id: z.string(), label: z.string(), defaultData: z.string() })), downloaderVersion: z.string().nullable() }) },
  [IpcChannel.videoSettings]: { input: z.strictObject({}), output: videoSettings },
  [IpcChannel.videoSettingsSave]: { input: z.strictObject({ projectId: projectId.nullable(), agent: z.enum(['claude', 'codex']).optional() }), output: videoSettings },
  [IpcChannel.videoPrepare]: { input: z.strictObject({ name: z.string().trim().min(1).max(200), kind: z.enum(['tema', 'projeto']) }), output: z.strictObject({ folder: z.string() }) },
  [IpcChannel.videoTopics]: { input: z.strictObject({ niche: z.string().trim().min(1).max(120) }), output: z.array(z.string()) },
  [IpcChannel.videoResearch]: { input: z.strictObject({ topic: z.string().trim().min(1).max(2_000) }), output: z.array(videoReference) },
  [IpcChannel.videoResearchSave]: { input: z.strictObject({ name: z.string().trim().min(1).max(200), kind: z.enum(['tema', 'projeto']), items: z.array(videoReference).min(1).max(30) }), output: z.strictObject({ folder: z.string(), saved: z.number().int(), failed: z.number().int() }) },
  [IpcChannel.videoCapturePlan]: { input: z.strictObject({ targetId: projectId }), output: videoCapturePlan },
  [IpcChannel.videoCapture]: { input: z.strictObject({ targetId: projectId, name: videoName, plan: videoCapturePlan, size: z.strictObject({ width: z.number().int().min(320).max(3840), height: z.number().int().min(320).max(3840) }), confirmed: z.literal(true) }), output: z.strictObject({ saved: z.array(z.string()), failed: z.array(z.string()) }) },
  [IpcChannel.videoPrints]: { input: z.strictObject({ name: videoName }), output: z.array(z.strictObject({ file: z.string(), image: z.string().startsWith('data:image/png;base64,') })) },
  [IpcChannel.videoPrintRemove]: { input: z.strictObject({ name: videoName, file: z.string().min(1).max(120) }), output: okSchema },
  [IpcChannel.videoLimits]: { input: z.strictObject({ refresh: z.boolean(), agent: z.enum(['claude', 'codex']).optional() }), output: z.strictObject({ available: z.boolean(), blocked: z.boolean(), reason: z.string().nullable(), windows: z.array(z.strictObject({ id: z.string(), percent: z.number(), resetsAt: z.string().nullable() })) }) },
  [IpcChannel.videoStudioList]: { input: z.strictObject({}), output: z.array(z.string()) },
  [IpcChannel.videoStudioLoad]: { input: z.strictObject({ name: videoName }), output: videoStudioState },
  [IpcChannel.videoStudioSave]: { input: z.strictObject({ name: videoName, narration: z.string().max(20_000).optional(), data: z.string().max(500_000).optional() }), output: okSchema },
  [IpcChannel.videoStudioGenerate]: { input: z.strictObject({ name: videoName, kind: z.enum(['tema', 'projeto']), brief: z.string().trim().min(1).max(6_000), seconds: z.number().int().min(10).max(600) }), output: videoStudioState.extend({ generation: z.strictObject({ agent: z.enum(['claude', 'codex']), model: z.string().nullable(), executionId: z.string().nullable(), generatedAt: z.string().datetime() }) }) },
  [IpcChannel.videoStudioSync]: { input: z.strictObject({ name: videoName }), output: z.strictObject({ missed: z.number().int() }) },
  [IpcChannel.videoStudioPreview]: { input: z.strictObject({ name: videoName, data: z.string().min(2).max(500_000), time: z.number().min(0).max(3_600) }), output: z.string().startsWith('data:image/png;base64,') },
  [IpcChannel.videoStudioRender]: { input: z.strictObject({ name: videoName, data: z.string().min(2).max(500_000), quality: z.enum(['draft', 'final']) }), output: z.strictObject({ id: z.string() }).passthrough() },
  [IpcChannel.videoStudioOutput]: { input: z.strictObject({ name: videoName }), output: z.string().startsWith('data:video/mp4;base64,') },
  [IpcChannel.videoStudioNarrationStatus]: { input: z.strictObject({ name: videoName }), output: voiceStudioStatusSchema.extend({ asset: narrationAssetSchema.nullable(), timeline: narrationTimelineSchema.nullable() }) },
  [IpcChannel.videoStudioNarrationGenerate]: { input: z.strictObject({ name: videoName, text: z.string().trim().min(1).max(4_096), modelId: z.string().trim().min(1).max(200), voiceId: z.string().trim().min(1).max(200), format: z.enum(['mp3', 'wav']), language: z.string().trim().max(20).optional(), speed: z.number().min(0.25).max(4).optional(), license: narrationLicenseSchema }), output: narrationAssetSchema },
  [IpcChannel.videoStudioNarrationPreview]: { input: z.strictObject({ name: videoName, assetId: z.string().uuid().optional() }), output: z.string().regex(/^data:audio\/(mp3|wav);base64,/u) },
  [IpcChannel.videoStudioNarrationTimeline]: { input: z.strictObject({ name: videoName, timeline: narrationTimelineSchema }), output: okSchema },
  [IpcChannel.videoFrames]: { input: z.strictObject({ root: z.string().min(1).max(1_000), template: z.string().min(1).max(100), data: z.string().min(2).max(500_000) }), output: z.array(z.string().startsWith('data:image/png;base64,')) },
  [IpcChannel.videoImport]: { input: z.strictObject({ root: z.string().min(1).max(1_000), url: z.string().min(1).max(2_000), quality: z.union([z.literal(1080), z.literal(720), z.literal(480), z.literal(360), z.literal('mp3')]), confirmed: z.literal(true) }), output: z.strictObject({ id: z.string(), status: z.string(), error: z.string().nullable(), origin: z.enum(['studio', 'chat']), agent: z.enum(['auto', 'claude', 'codex']).nullable(), progress: z.number().min(0).max(1).nullable(), output: z.string().nullable() }) },
  [IpcChannel.videoRender]: { input: z.strictObject({ root: z.string().min(1).max(1_000), outputPath: z.string().min(1).max(1_000), template: z.string().min(1).max(100), data: z.string().min(2).max(500_000), audioPath: z.string().min(1).max(1_000).optional(), quality: z.enum(['draft', 'final']).optional(), origin: z.enum(['studio', 'chat']).optional(), agent: z.enum(['auto', 'claude', 'codex']).optional() }), output: z.strictObject({ id: z.string(), status: z.string(), error: z.string().nullable(), origin: z.enum(['studio', 'chat']), agent: z.enum(['auto', 'claude', 'codex']).nullable(), progress: z.number().min(0).max(1).nullable(), output: z.string().nullable() }) },
  [IpcChannel.videoRenderStatus]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.strictObject({ id: z.string(), status: z.string(), error: z.string().nullable(), origin: z.enum(['studio', 'chat']), agent: z.enum(['auto', 'claude', 'codex']).nullable(), progress: z.number().min(0).max(1).nullable(), output: z.string().nullable() }).nullable() },
  [IpcChannel.videoRenderCancel]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.strictObject({ id: z.string(), status: z.string(), error: z.string().nullable() }) },
  [IpcChannel.videoRenderJobsList]: { input: z.strictObject({}), output: z.array(z.strictObject({ id: z.string(), status: z.string(), error: z.string().nullable(), origin: z.enum(['studio', 'chat']), agent: z.enum(['auto', 'claude', 'codex']).nullable(), createdAt: z.string(), updatedAt: z.string() })) },
  [IpcChannel.videoPreview]: { input: z.strictObject({ root: z.string().min(1).max(1_000), outputPath: z.string().min(1).max(1_000) }), output: z.string().startsWith('data:video/mp4;base64,') },
  [IpcChannel.videoDiscoverySearch]: { input: z.strictObject({ projectId, query: z.string().trim().min(1).max(200), provider: z.enum(['youtube', 'rss']), feedUrl: z.string().url().optional(), pageToken: z.string().max(200).optional(), filters: videoDiscoveryFilters.optional() }), output: z.strictObject({ status: z.enum(['ok', 'unavailable', 'offline', 'error', 'rate_limited', 'cancelled']), reason: z.string().nullable(), nextPageToken: z.string().nullable().optional(), cached: z.boolean().optional(), results: z.array(z.strictObject({ id: z.string().optional(), url: z.string().url(), title: z.string(), publisher: z.string(), publishedAt: z.string().nullable(), kind: z.string() })) }) },
  [IpcChannel.videoMotionRuntime]: { input: noInput, output: z.strictObject({ disabled: z.boolean(), templates: z.boolean(), tools: z.boolean(), browser: z.boolean(), installing: z.boolean(), progress: z.number().min(0).max(100), error: z.string().nullable() }) },
  [IpcChannel.videoMotionRuntimeInstall]: { input: z.strictObject({ confirmed: z.literal(true) }), output: okSchema },
  [IpcChannel.videoMotionRuntimeCancel]: { input: noInput, output: z.strictObject({ cancelled: z.boolean() }) },
  [IpcChannel.videoMotionLoad]: { input: z.strictObject({ projectId }), output: motionProjectSchema.nullable() },
  [IpcChannel.videoMotionSave]: { input: z.strictObject({ projectId, project: motionProjectSchema }), output: okSchema },
  [IpcChannel.videoMotionRender]: { input: z.strictObject({ projectId, scriptVersionId: z.string().min(1).max(100), audioRelativePath: z.string().trim().min(1).max(1_000).optional() }), output: z.strictObject({ id: z.string() }) },
  [IpcChannel.videoMotionStatus]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.strictObject({ id: z.string(), status: z.string(), progress: z.number().min(0).max(1), outputPath: z.string().nullable(), error: z.string().nullable() }).nullable() },
  [IpcChannel.videoMotionCancel]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.strictObject({ cancelled: z.boolean() }) },
  [IpcChannel.videoMotionNarrationAssets]: { input: z.strictObject({ projectId }), output: z.array(narrationAssetSchema) },
  [IpcChannel.videoMotionSuggest]: { input: z.strictObject({ projectId, scriptVersionId: z.string().min(1).max(100), agent: z.enum(['claude', 'codex']) }), output: z.strictObject({ scenes: z.array(motionV2SceneSchema), agent: z.string(), model: z.string().nullable(), executionId: z.string().nullable() }) },
  [IpcChannel.videoMotionAlignCaptions]: { input: z.strictObject({ projectId, audioRelativePath: z.string().trim().min(1).max(1_000), captions: z.array(motionCaptionSchema).max(500) }), output: z.strictObject({ captions: z.array(motionCaptionSchema).max(500), missed: z.number().int().nonnegative() }) },
  [IpcChannel.videoMotionSyncNarration]: { input: z.strictObject({ projectId, scriptVersionId: z.string().min(1).max(100), audioRelativePath: z.string().trim().min(1).max(1_000), project: motionProjectSchema }), output: z.strictObject({ project: motionProjectSchema, missedCaptions: z.array(z.string().max(100)).max(500), missedScenes: z.array(z.string().max(100)).max(500) }) },
  [IpcChannel.videoDiscoveryCancel]: { input: z.strictObject({ projectId }), output: z.strictObject({ cancelled: z.boolean() }) },
  [IpcChannel.videoRadar]: { input: z.strictObject({ projectId, days: z.number().int().min(1).max(365) }), output: z.strictObject({ days: z.number(), measuredAt: z.string(), total: z.number(), undated: z.number(), inWindow: z.number(), previousWindow: z.number(), publishers: z.array(z.strictObject({ publisher: z.string(), count: z.number() })), daily: z.array(z.strictObject({ day: z.string(), count: z.number() })) }) },
  [IpcChannel.videoClipThumbnail]: { input: z.strictObject({ projectId, sourceRelativePath: z.string().min(1).max(1_000), time: z.number().min(0) }), output: z.string().startsWith('data:image/jpeg;base64,') },
  [IpcChannel.videoAudioAuthorize]: { input: z.strictObject({ projectId, relativePath: z.string().trim().min(1).max(1_000), evidence: z.string().trim().min(1).max(2_000), owner: z.string().trim().min(1).max(200), license: z.string().trim().min(1).max(200), credit: z.string().trim().max(500).optional() }), output: z.strictObject({ id: z.string() }) },
  [IpcChannel.videoProductionStatus]: { input: z.strictObject({ projectId }), output: z.strictObject({ running: z.boolean(), phase: z.string().nullable(), startedAt: z.string().nullable(), log: z.array(z.string()) }) },
  [IpcChannel.videoProductionCancel]: { input: z.strictObject({ projectId }), output: z.strictObject({ cancelled: z.boolean() }) },
  [IpcChannel.videoDiscoveryList]: { input: z.strictObject({ projectId }), output: z.strictObject({ searches: z.array(z.unknown()), references: z.array(z.unknown()), rights: z.array(z.unknown()), clips: z.array(z.unknown()), assets: z.array(z.unknown()), analyses: z.array(z.unknown()) }) },
  [IpcChannel.videoDiscoveryRights]: { input: z.strictObject({ projectId, referenceId: z.string().min(1).max(100), status: z.enum(['verified_allowed', 'conditional', 'unverified', 'blocked']), owner: z.string().max(200), license: z.string().max(200), evidence: z.string().max(2_000).nullable().optional(), verifiedAt: z.string().max(100).nullable().optional(), credit: z.string().max(500).nullable().optional(), restrictions: z.array(z.string().max(300)).max(30).optional() }), output: z.strictObject({ id: z.string() }) },
  [IpcChannel.videoDiscoveryClips]: { input: z.strictObject({ projectId }), output: z.array(z.unknown()) },
  [IpcChannel.videoClipAnalyze]: { input: z.strictObject({ projectId, relativePath: z.string().trim().min(1).max(1_000), evidence: z.string().trim().min(1).max(2_000) }), output: z.strictObject({ id: z.string(), status: z.string() }) },
  [IpcChannel.videoClipStatus]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.strictObject({ id: z.string(), status: z.string(), progress: z.number().min(0).max(1), error: z.string().nullable(), analysis: z.unknown() }).nullable() },
  [IpcChannel.videoClipCancel]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.strictObject({ id: z.string(), status: z.string() }) },
  [IpcChannel.videoClipUpdate]: { input: z.strictObject({ projectId, id: z.string().min(1).max(100), start: z.number().min(0).optional(), end: z.number().positive().optional(), accepted: z.boolean().optional(), favorite: z.boolean().optional() }), output: okSchema },
  [IpcChannel.videoClipReorder]: { input: z.strictObject({ projectId, ids: z.array(z.string().min(1).max(100)).max(100) }), output: okSchema },
  [IpcChannel.videoClipPreview]: { input: z.strictObject({ projectId, sourceRelativePath: z.string().min(1).max(1_000), start: z.number().min(0), end: z.number().positive() }), output: z.string().startsWith('data:video/mp4;base64,') },
  [IpcChannel.videoClipSendToStudio]: { input: z.strictObject({ projectId, sourceRelativePath: z.string().min(1).max(1_000) }), output: z.strictObject({ ok: z.literal(true), name: z.string(), added: z.number().int().nonnegative() }) },
  [IpcChannel.videoIdeaList]: { input: z.strictObject({ projectId }), output: z.array(videoIdeaView) },
  [IpcChannel.videoIdeaGenerate]: { input: z.strictObject({ projectId, niche: z.string().trim().max(200), mode: z.enum(['generate', 'more', 'surprise']), agent: z.enum(['claude', 'codex']) }), output: z.array(videoIdeaView) },
  [IpcChannel.videoIdeaSave]: { input: z.strictObject({ projectId, id: z.string().min(1).max(100) }), output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.videoIdeaInvestigate]: { input: z.strictObject({ projectId, id: z.string().min(1).max(100), agent: z.enum(['claude', 'codex']) }), output: z.strictObject({ added: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), agent: z.string(), model: z.string().nullable(), executionId: z.string().nullable() }) },
  [IpcChannel.videoIdeaReference]: { input: z.strictObject({ projectId, id: z.string().min(1).max(100), decision: z.enum(['approved', 'rejected']) }), output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.videoIdeaCancel]: { input: z.strictObject({ projectId }), output: z.strictObject({ cancelled: z.boolean() }) },
  [IpcChannel.videoIdeaConvert]: { input: z.strictObject({ projectId, id: z.string().min(1).max(100), name: videoName }), output: z.strictObject({ folder: z.string(), references: z.number().int().nonnegative(), versionId: z.string() }) },
  [IpcChannel.videoProductionBrief]: { input: z.strictObject({ mode: z.enum(['commentary', 'news']), topic: z.string().trim().min(1).max(500), style: z.string().trim().max(200).optional(), rankingCriteria: z.string().trim().max(300).optional(), clips: z.array(z.strictObject({ source: z.string().min(1), start: z.number().min(0), end: z.number().positive(), rights: z.enum(['verified_allowed', 'conditional', 'unverified', 'blocked']) })).max(100).optional(), items: z.array(z.strictObject({ title: z.string().min(1), url: z.string(), publisher: z.string().min(1), publishedAt: z.string().nullable(), claimType: z.enum(['confirmed', 'allegation', 'unverified']) })).max(100).optional() }), output: z.strictObject({ mode: z.enum(['commentary', 'news']), brief: z.string(), clips: z.array(z.unknown()), references: z.array(z.unknown()) }) },
  [IpcChannel.videoProductionEditorialList]: { input: z.strictObject({ projectId }), output: z.strictObject({ ideas: z.array(z.unknown()), versions: z.array(z.unknown()), decisions: z.array(z.unknown()) }) },
  [IpcChannel.videoProductionEditorialVersion]: { input: z.strictObject({ projectId, ideaId: z.string().optional(), sourceVersionId: z.string().optional(), kind: z.enum(['brief', 'script']), content: z.string().min(1).max(500_000), agent: z.enum(['claude', 'codex']).optional(), model: z.string().min(1).max(200).optional(), executionId: z.string().min(1).max(200).optional(), generatedAt: z.string().datetime().optional() }), output: z.strictObject({ id: z.string(), version: z.number().int() }) },
  [IpcChannel.videoProductionEditorialDecision]: { input: z.strictObject({ projectId, versionId: z.string(), decision: z.enum(['approved', 'rejected']), note: z.string().max(2_000).optional() }), output: okSchema },
  [IpcChannel.videoProductionRender]: { input: z.strictObject({ projectId, name: videoName, scriptVersionId: z.string(), data: z.string().min(2).max(500_000), quality: z.enum(['draft', 'final']), mode: z.enum(['commentary', 'news']), references: z.array(z.string().min(1).max(2_000)).max(100).optional(), sourceRelativePath: z.string().min(1).max(1_000).optional(), clipIds: z.array(z.string()).max(200).optional(), transition: z.enum(['cut', 'fade']).optional(), positionCards: z.boolean().optional(), musicRelativePath: z.string().min(1).max(1_000).optional(), musicVolume: z.number().min(0).max(2).optional() }), output: z.strictObject({ id: z.string() }).passthrough() },
  [IpcChannel.videoClipRender]: { input: z.strictObject({ projectId, sourceRelativePath: z.string().min(1).max(1_000), clips: z.array(z.strictObject({ start: z.number().min(0), end: z.number().positive() })).min(1).max(100), evidence: z.string().trim().min(1).max(2_000), narrationRelativePath: z.string().min(1).max(1_000).optional(), narrationOffset: z.number().min(0).optional(), narrationVolume: z.number().min(0).max(4).optional(), originalVolume: z.number().min(0).max(4).optional(), outputRelativePath: z.string().min(1).max(1_000).optional() }), output: z.strictObject({ id: z.string(), status: z.string() }) },
  [IpcChannel.videoChannelOAuthStatus]: { input: noInput, output: z.strictObject({ configured: z.boolean(), connected: z.boolean(), canWrite: z.boolean(), persistent: z.boolean(), clientId: z.string().nullable() }) },
  [IpcChannel.videoChannelOAuthImportClient]: { input: noInput, output: z.strictObject({ configured: z.literal(true), clientId: z.string().min(1) }) },
  [IpcChannel.videoChannelOAuthClear]: { input: noInput, output: z.strictObject({ cleared: z.literal(true) }) },
  [IpcChannel.videoChannelOAuthConnect]: { input: z.strictObject({ write: z.boolean().optional() }).optional(), output: z.strictObject({ connected: z.literal(true), scopes: z.array(z.string()) }) },
  [IpcChannel.videoChannelOAuthDisconnect]: { input: noInput, output: z.strictObject({ disconnected: z.literal(true), revoked: z.boolean() }) },
  [IpcChannel.videoChannelProfile]: { input: noInput, output: z.strictObject({ id: z.string(), title: z.string(), handle: z.string().nullable(), brandingSettings: z.unknown(), description: z.string().optional(), avatarUrl: z.string().optional(), bannerUrl: z.string().optional(), country: z.string().optional(), defaultLanguage: z.string().optional() }) },
  [IpcChannel.videoChannelBrandingApply]: { input: z.strictObject({ brandingSettings: z.record(z.string(), z.unknown()), confirmed: z.literal(true) }), output: z.strictObject({ applied: z.literal(true) }) },
  [IpcChannel.videoChannelIdentitySave]: { input: z.strictObject({ projectId, identity: brandIdentitySchema }), output: z.strictObject({ saved: z.literal(true) }) },
  [IpcChannel.videoChannelIdentityLoad]: { input: z.strictObject({ projectId }), output: brandIdentitySchema.nullable() },
  [IpcChannel.videoChannelPublish]: { input: z.strictObject({ projectId, outputRelativePath: z.string().trim().min(1).max(1_000), thumbnailRelativePath: z.string().trim().min(1).max(1_000).optional(), title: z.string().trim().min(1).max(100), description: z.string().max(5_000), tags: z.array(z.string().trim().min(1).max(100)).max(500), privacy: z.enum(['private', 'unlisted', 'public']), publishAt: z.string().datetime().nullable(), confirmed: z.literal(true) }), output: z.strictObject({ id: z.string(), youtubeVideoId: z.string() }) },
  [IpcChannel.videoChannelPublishStart]: { input: z.strictObject({ projectId, outputRelativePath: z.string().trim().min(1).max(1_000), thumbnailRelativePath: z.string().trim().min(1).max(1_000).optional(), title: z.string().trim().min(1).max(100), description: z.string().max(5_000), tags: z.array(z.string().trim().min(1).max(100)).max(500), privacy: z.enum(['private', 'unlisted', 'public']), publishAt: z.string().datetime().nullable(), confirmed: z.literal(true) }), output: z.strictObject({ id: z.string() }) },
  [IpcChannel.videoChannelPublications]: { input: z.strictObject({ projectId }), output: z.array(publishDraftSchema) },
  [IpcChannel.videoChannelIdentityApply]: { input: z.strictObject({ projectId, banner: z.strictObject({ imageBase64: z.string().min(1).max(9_000_000) }).optional(), watermark: z.strictObject({ imageBase64: z.string().min(1).max(1_500_000), position: z.enum(['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) }).optional(), description: z.string().max(1_000).optional(), keywords: z.string().max(500).optional() }), output: z.strictObject({ id: z.string() }) },
  [IpcChannel.videoChannelIdentityApplyStatus]: { input: z.strictObject({ id: z.string().min(1).max(100) }), output: z.strictObject({ status: z.enum(['running', 'completed', 'failed']), progress: z.number().min(0).max(100), step: z.string(), done: z.array(z.string()), error: z.string().nullable() }).nullable() },
  [IpcChannel.videoChannelCurrentBanner]: { input: noInput, output: z.string().startsWith('data:image/').nullable() },
  [IpcChannel.videoChannelSaveThumbnail]: { input: z.strictObject({ projectId, title: z.string().max(200), imageBase64: z.string().min(1).max(3_000_000) }), output: z.strictObject({ relativePath: z.string().min(1).max(500) }) },
  [IpcChannel.videoStyles]: { input: noInput, output: z.array(videoStyleSchema) },
  [IpcChannel.videoStyleLoad]: { input: z.strictObject({ projectId, video: z.string().max(200) }), output: z.strictObject({ choice: productionStyleChoiceSchema.nullable(), own: z.boolean() }) },
  [IpcChannel.videoStyleSave]: { input: z.strictObject({ projectId, video: z.string().max(200), choice: productionStyleChoiceSchema.nullable() }), output: z.strictObject({ saved: z.literal(true) }) },
  [IpcChannel.videoOverlayBases]: { input: z.strictObject({ projectId }), output: z.array(z.strictObject({ relativePath: z.string().min(1).max(1_000), title: z.string().max(300) })).max(500) },
  [IpcChannel.videoOverlayTranscribe]: { input: z.strictObject({ projectId, video: videoName }), output: z.strictObject({ words: z.number().int().nonnegative(), duration: z.number().nonnegative() }) },
  [IpcChannel.videoStylePreview]: { input: z.strictObject({ video: videoName, styleId: z.string().min(1).max(63), data: z.string().min(2).max(500_000), times: z.array(z.number().min(0).max(3_600)).min(1).max(3) }), output: z.array(z.string().startsWith('data:image/png;base64,')) },
  [IpcChannel.videoCollageKeySave]: { input: z.strictObject({ apiKey: z.string().trim().min(1).max(500) }), output: okSchema },
  [IpcChannel.videoCollageKeyStatus]: { input: noInput, output: z.strictObject({ configured: z.boolean() }) },
  [IpcChannel.videoCollageCreate]: { input: z.strictObject({ projectId, prompt: z.string().trim().min(3).max(1_000), durationSeconds: z.number().min(2).max(30), aspectRatio: z.enum(['16:9', '9:16']) }), output: z.strictObject({ id: z.string(), estimatedCostUsd: z.number(), approvalText: z.string(), status: z.string() }) },
  [IpcChannel.videoCollageApproveMetaphor]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ id: z.string(), status: z.string(), stillPath: z.string().nullable() }) },
  [IpcChannel.videoCollageApproveStill]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ id: z.string(), status: z.string() }) },
  [IpcChannel.videoCollageGenerate]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ id: z.string(), status: z.string(), clipPath: z.string().nullable(), rightsReferenceId: z.string().nullable() }) },
  [IpcChannel.videoProductionRunCreate]: { input: z.strictObject({ projectId, brief: productionBriefSchema, estimatedCostUsd: z.number().nonnegative().max(100_000).optional() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunList]: { input: z.strictObject({ projectId }), output: z.array(productionRunViewSchema) },
  [IpcChannel.videoProductionRunState]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunPause]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunResume]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunCancel]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunScript]: { input: z.strictObject({ runId: z.string().uuid(), agent: z.enum(['claude', 'codex']).optional(), chapterWords: z.number().int().min(150).max(1_500).optional(), lockedChapters: z.array(z.number().int().positive()).max(60).optional() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunScriptRead]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionScriptSchema.nullable() },
  [IpcChannel.videoProductionRunResearch]: { input: z.strictObject({ runId: z.string().uuid(), agent: z.enum(['claude', 'codex']).optional() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunGameResearch]: { input: z.strictObject({ runId: z.string().uuid(), titles: z.array(z.string().trim().min(1).max(200)).min(1).max(50).optional(), period: z.strictObject({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).optional(), count: z.number().int().min(1).max(50).optional(), web: z.boolean().optional() }).refine((value) => Boolean(value.titles) !== Boolean(value.period), { message: 'Informe títulos ou um período.' }), output: productionStateSchema },
  [IpcChannel.videoProductionRunSubjects]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(verifiedSubjectSchema) },
  [IpcChannel.videoProductionRunMediaDiscover]: { input: z.strictObject({ runId: z.string().uuid(), search: z.boolean().optional() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunCandidates]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(sourceCandidateSchema) },
  [IpcChannel.videoProductionCandidateDecide]: { input: z.strictObject({ candidateId: z.string().uuid(), status: z.enum(['selected', 'proposed', 'rejected']) }), output: sourceCandidateSchema },
  [IpcChannel.videoProductionRunMediaAcquire]: { input: z.strictObject({ runId: z.string().uuid(), candidateIds: z.array(z.string().uuid()).min(1).max(100).optional() }), output: productionStateSchema },
  [IpcChannel.videoProductionRunAcquisitions]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(mediaAcquisitionJobSchema) },
  [IpcChannel.videoProductionEditorialPolicyGet]: { input: z.strictObject({ runId: z.string().uuid() }), output: editorialUsePolicySchema.nullable() },
  [IpcChannel.videoProductionEditorialPolicySet]: { input: z.strictObject({ runId: z.string().uuid(), enabled: z.boolean(), note: z.string().trim().min(1).max(500) }), output: editorialUsePolicySchema },
  [IpcChannel.videoProductionMediaUse]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(acquiredMediaUseViewSchema) },
  [IpcChannel.videoProductionMediaEditorialDecide]: { input: z.strictObject({ runId: z.string().uuid(), assetId: z.string().min(1).max(200), decision: z.enum(['approved', 'rejected']), note: z.string().trim().min(1).max(500) }), output: z.array(acquiredMediaUseViewSchema) },
  [IpcChannel.videoProductionMatchCandidates]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(matchReviewCandidateSchema) },
  [IpcChannel.videoProductionRunSceneMatching]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.videoChannelVoices]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(channelVoiceViewSchema) },
  [IpcChannel.videoChannelVoiceSave]: { input: z.strictObject({ runId: z.string().uuid(), preset: voicePresetSchema.omit({ schemaVersion: true, projectId: true, createdAt: true }) }), output: z.array(channelVoiceViewSchema) },
  [IpcChannel.videoChannelVoiceAuthorize]: { input: z.strictObject({ runId: z.string().uuid(), presetId: z.string().min(1).max(80), scope: z.enum(['noncommercial', 'commercial']), note: z.string().trim().min(1).max(500) }), output: z.array(channelVoiceViewSchema) },
  [IpcChannel.videoChannelVoiceRevoke]: { input: z.strictObject({ runId: z.string().uuid(), presetId: z.string().min(1).max(80) }), output: z.array(channelVoiceViewSchema) },
  [IpcChannel.videoNarrationDirections]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(narrationDirectionSchema) },
  [IpcChannel.videoNarrationDirectionSet]: { input: z.strictObject({ runId: z.string().uuid(), sceneId: z.string().min(1).max(200), speed: z.number().min(0.8).max(1.3).optional(), pauseAfterMs: z.number().int().min(0).max(2_000).optional(), clear: z.boolean().optional() }), output: z.array(narrationDirectionSchema) },
  [IpcChannel.videoProductionRunNarrationVoice]: { input: z.strictObject({ runId: z.string().uuid(), presetId: z.string().min(1).max(80), speed: z.number().min(0.8).max(1.3).optional(), pacingStyle: z.enum(['documentary', 'conversational', 'energetic']).optional() }), output: productionStateSchema },
  [IpcChannel.videoProductionSegmentFrame]: { input: z.strictObject({ runId: z.string().uuid(), assetId: z.string().min(1).max(200), atMs: z.number().int().nonnegative().max(14_400_000) }), output: z.strictObject({ dataUrl: z.string().startsWith('data:image/jpeg;base64,') }).nullable() },
  [IpcChannel.videoProductionRunVisualIndex]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.videoProductionReferenceValidation]: { input: z.strictObject({ root: z.string().trim().min(1).max(2_000) }), output: aetheraReferenceValidationReportSchema },
  [IpcChannel.videoStudioCandidateThumbnail]: { input: z.strictObject({ candidateId: z.string().uuid() }), output: z.strictObject({ dataUrl: z.string().max(2_000_000).nullable() }) },
  [IpcChannel.videoStudioRankingIntent]: { input: z.strictObject({ runId: z.string().uuid(), request: z.string().trim().min(3).max(2_000) }), output: rankingIntentSchema },
  [IpcChannel.videoStudioIgdbSave]: { input: z.strictObject({ clientId: z.string().trim().min(1).max(200), clientSecret: z.string().trim().min(1).max(500) }), output: okSchema },
  [IpcChannel.videoStudioIgdbStatus]: { input: noInput, output: z.strictObject({ configured: z.boolean(), clientIdHint: z.string().nullable() }) },
  [IpcChannel.videoStudioIgdbClear]: { input: noInput, output: okSchema },
  [IpcChannel.videoStudioRawgSave]: { input: z.strictObject({ apiKey: z.string().trim().min(1).max(500) }), output: okSchema },
  [IpcChannel.videoStudioRawgStatus]: { input: noInput, output: z.strictObject({ configured: z.boolean() }) },
  [IpcChannel.videoStudioRawgClear]: { input: noInput, output: okSchema },
  [IpcChannel.videoProductionRunClaims]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionClaimsSchema },
  [IpcChannel.videoProductionEvidenceDecide]: { input: z.strictObject({ evidenceId: z.string().uuid(), decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(1_000).optional() }), output: productionClaimsSchema },
  [IpcChannel.videoProductionClaimKind]: { input: z.strictObject({ claimId: z.string().uuid(), kind: z.enum(claimKinds) }), output: productionClaimsSchema },
  [IpcChannel.videoProductionRunStoryboard]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.videoAetheraProductionPlan]: { input: z.strictObject({ command: z.string().trim().min(1).max(2_000) }), output: aetheraProductionPlanSchema },
  [IpcChannel.videoAetheraProductionPlanApply]: { input: z.strictObject({ runId: z.string().uuid(), plan: aetheraProductionPlanSchema }), output: productionStateSchema },
  [IpcChannel.videoAetheraAutoProduce]: {
    input: z.strictObject({ projectId: z.string().min(1).max(120), prompt: z.string().trim().min(3).max(4_000) }),
    output: productionStateSchema,
  },
  [IpcChannel.videoAetheraAutoProviders]: {
    input: noInput,
    output: z.strictObject({
      providers: z.array(z.strictObject({
        id: z.enum(['claude', 'codex', 'antigravity']),
        available: z.boolean(),
        reason: z.string().optional(),
      })),
    }),
  },
  [IpcChannel.videoAetheraMusicGenerate]: { input: aceStepMusicGenerationInputSchema, output: aceStepMusicGenerationResultSchema },
  [IpcChannel.videoStoryboardGet]: { input: z.strictObject({ runId: z.string().uuid() }), output: storyboardViewSchema.nullable() },
  [IpcChannel.videoAetheraTimelineGet]: { input: z.strictObject({ runId: z.string().uuid() }), output: aetheraTimelineVersionSchema.nullable() },
  [IpcChannel.videoAetheraTimelineCreate]: { input: z.strictObject({ runId: z.string().uuid(), document: timelineDocumentSchema }), output: aetheraTimelineVersionSchema },
  [IpcChannel.videoAetheraTimelineApply]: { input: z.strictObject({ runId: z.string().uuid(), baseVersion: z.number().int().positive(), ops: z.array(timelineOpSchema).min(1).max(100), command: z.string().trim().max(500).optional() }), output: aetheraTimelineVersionSchema },
  [IpcChannel.videoAetheraTimelineRestore]: { input: z.strictObject({ runId: z.string().uuid(), baseVersion: z.number().int().positive(), version: z.number().int().positive() }), output: aetheraTimelineVersionSchema },
  [IpcChannel.videoAetheraTimelineHistory]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(aetheraTimelineVersionSchema) },
  [IpcChannel.videoAetheraEditorialPlanGet]: { input: z.strictObject({ runId: z.string().uuid() }), output: editorialPlanViewSchema.nullable() },
  [IpcChannel.videoAetheraEditorialPlanHistory]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(editorialPlanViewSchema) },
  [IpcChannel.videoAetheraEditorialPlanDirect]: { input: z.strictObject({ runId: z.string().uuid(), context: z.string().trim().max(1_000).optional() }), output: editorialPlanViewSchema },
  [IpcChannel.videoAetheraEditorialPlanApprove]: { input: z.strictObject({ runId: z.string().uuid(), version: z.number().int().positive(), hash: z.string().min(1).max(200), approvedBy: z.string().trim().min(1).max(120) }), output: editorialPlanViewSchema },
  [IpcChannel.videoAetheraEditorialPlanApply]: { input: z.strictObject({ runId: z.string().uuid(), baseVersion: z.number().int().positive() }), output: z.strictObject({ timeline: aetheraTimelineVersionSchema, gaps: z.array(z.strictObject({ segmentId: z.string(), message: z.string() })), fallbacks: z.array(z.strictObject({ segmentId: z.string(), from: z.string(), to: z.string() })) }) },
  [IpcChannel.videoAetheraReviewRun]: { input: z.strictObject({ runId: z.string().uuid(), requestedCycles: z.number().int().min(0).max(2).optional() }), output: aetheraReviewReportRecordSchema },
  [IpcChannel.videoAetheraReviewLatest]: { input: z.strictObject({ runId: z.string().uuid() }), output: aetheraReviewReportRecordSchema.nullable() },
  [IpcChannel.videoAetheraReviewHistory]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(aetheraReviewReportRecordSchema) },
  [IpcChannel.videoStoryboardCandidates]: { input: z.strictObject({ runId: z.string().uuid(), sceneId: z.string().min(1).max(64) }), output: z.array(storyboardCandidateViewSchema).max(500) },
  [IpcChannel.videoStoryboardEdit]: { input: z.strictObject({ runId: z.string().uuid(), baseVersion: z.number().int().positive(), edit: storyboardEditSchema }), output: storyboardViewSchema },
  [IpcChannel.videoStoryboardSemanticEdit]: { input: z.strictObject({ runId: z.string().uuid(), baseVersion: z.number().int().positive(), command: z.string().trim().min(1).max(500) }), output: semanticEditResultSchema },
  [IpcChannel.videoStoryboardReselect]: { input: z.strictObject({ runId: z.string().uuid(), baseVersion: z.number().int().positive() }), output: storyboardViewSchema },
  [IpcChannel.videoProductionVoices]: { input: noInput, output: voiceStudioStatusSchema },
  [IpcChannel.videoProductionRunNarration]: { input: z.strictObject({ runId: z.string().uuid(), modelId: z.string().min(1).max(200), voiceId: z.string().min(1).max(200), language: z.string().min(2).max(20).optional(), speed: z.number().min(0.5).max(2).optional(), license: narrationLicenseSchema }), output: productionStateSchema },
  [IpcChannel.videoProductionRunSync]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.videoProductionNarrationGet]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionNarrationViewSchema },
  [IpcChannel.videoProductionRunRender]: { input: z.strictObject({ runId: z.string().uuid(), formatId: z.enum(['youtube-long', 'youtube-short', 'instagram-reels', 'tiktok', 'square']) }), output: productionStateSchema },
  [IpcChannel.videoProductionRenders]: { input: z.strictObject({ runId: z.string().uuid() }), output: productionRendersViewSchema },
  [IpcChannel.videoProductionRenderRecheck]: { input: z.strictObject({ runId: z.string().uuid(), renderArtifactId: z.string().uuid() }), output: productionRendersViewSchema },
  [IpcChannel.videoProductionQualityApprove]: { input: z.strictObject({ runId: z.string().uuid(), renderArtifactId: z.string().uuid(), checkId: z.string().min(1).max(40), note: z.string().trim().min(1).max(1_000) }), output: productionRendersViewSchema },
  [IpcChannel.videoProductionGateApprove]: { input: z.strictObject({ runId: z.string().uuid(), renderArtifactId: z.string().uuid(), gate: z.enum(['editorial', 'publication']), note: z.string().trim().min(1).max(1_000) }), output: productionRendersViewSchema },
  [IpcChannel.videoProductionRunExport]: { input: z.strictObject({ runId: z.string().uuid(), renderArtifactId: z.string().uuid() }), output: productionStateSchema },
  [IpcChannel.azureDevOpsConnectionSave]: { input: azureDevOpsConnectionInputSchema, output: z.strictObject({ id: z.string().uuid(), status: azureDevOpsConnectionStatusSchema }) },
  [IpcChannel.azureDevOpsConnectionStatus]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ id: z.string().uuid(), baseUrl: z.string(), collection: z.string(), project: z.string(), status: azureDevOpsConnectionStatusSchema, readOnly: z.boolean(), capabilities: azureDevOpsCapabilitiesSchema.nullable(), updatedAt: z.string() }).nullable() },
  [IpcChannel.azureDevOpsProbe]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ status: azureDevOpsConnectionStatusSchema, capabilities: azureDevOpsCapabilitiesSchema }) },
  [IpcChannel.azureDevOpsProjects]: { input: z.strictObject({ id: z.string().uuid() }), output: z.array(z.strictObject({ id: z.string(), name: z.string(), url: z.string().nullable(), state: z.string().nullable() })) },
  [IpcChannel.azureDevOpsRepositories]: { input: z.strictObject({ id: z.string().uuid() }), output: z.array(z.strictObject({ id: z.string(), name: z.string(), url: z.string().nullable(), projectId: z.string().nullable(), projectName: z.string().nullable() })) },
  [IpcChannel.azureDevOpsBoards]: { input: z.strictObject({ id: z.string().uuid() }), output: z.array(z.strictObject({ id: z.string(), name: z.string(), url: z.string().nullable() })) },
  [IpcChannel.azureDevOpsPullRequests]: { input: z.strictObject({ id: z.string().uuid(), repositoryId: z.string().trim().min(1).max(200), status: z.string().trim().max(40).optional() }), output: z.array(z.strictObject({ id: z.number().int(), title: z.string(), status: z.string(), createdBy: z.string().nullable(), sourceRef: z.string(), targetRef: z.string(), url: z.string().nullable(), updatedAt: z.string().nullable() })) },
  [IpcChannel.azureDevOpsWorkItems]: { input: z.strictObject({ id: z.string().uuid(), ids: z.array(z.number().int().positive()).min(1).max(200) }), output: z.array(z.strictObject({ id: z.number().int(), title: z.string(), description: z.string().nullable(), state: z.string(), type: z.string(), assignedTo: z.string().nullable(), parentId: z.number().int().positive().nullable(), url: z.string().nullable(), originalEstimate: z.number().nullable(), remainingWork: z.number().nullable(), completedWork: z.number().nullable(), commits: z.array(z.strictObject({ id: z.string(), message: z.string(), url: z.string().nullable() })), attachments: z.array(z.strictObject({ id: z.string(), name: z.string(), contentType: z.string().nullable(), size: z.number().nullable() })) })) },
  [IpcChannel.azureDevOpsQueryWorkItems]: { input: z.strictObject({ id: z.string().uuid(), type: z.string().trim().min(1).max(80), iterationPath: z.string().trim().max(400).nullable().optional(), parentId: z.number().int().positive().nullable().optional() }), output: z.array(z.strictObject({ id: z.number().int(), title: z.string(), description: z.string().nullable(), state: z.string(), type: z.string(), assignedTo: z.string().nullable(), parentId: z.number().int().positive().nullable(), url: z.string().nullable(), originalEstimate: z.number().nullable(), remainingWork: z.number().nullable(), completedWork: z.number().nullable(), commits: z.array(z.strictObject({ id: z.string(), message: z.string(), url: z.string().nullable() })), attachments: z.array(z.strictObject({ id: z.string(), name: z.string(), contentType: z.string().nullable(), size: z.number().nullable() })) })) },
  [IpcChannel.azureDevOpsWorkItemAttachment]: { input: z.strictObject({ id: z.string().uuid(), workItemId: z.number().int().positive(), attachmentId: z.string().regex(/^[0-9a-f-]{8,}$/i) }), output: z.strictObject({ name: z.string(), contentType: z.string().regex(/^image\//), data: z.string().max(12_000_000) }) },
  [IpcChannel.azureDevOpsIterations]: { input: z.strictObject({ id: z.string().uuid() }), output: z.array(z.strictObject({ id: z.string(), name: z.string(), path: z.string().nullable(), startDate: z.string().nullable(), finishDate: z.string().nullable(), state: z.string().nullable() })) },
  [IpcChannel.azureDevOpsPullRequestDetail]: { input: z.strictObject({ id: z.string().uuid(), repositoryId: z.string().trim().min(1).max(200), pullRequestId: z.number().int().positive() }), output: z.strictObject({ id: z.number().int(), title: z.string(), status: z.string(), createdBy: z.string().nullable(), sourceRef: z.string(), targetRef: z.string(), url: z.string().nullable(), updatedAt: z.string().nullable(), description: z.string().nullable(), mergeStatus: z.string().nullable(), reviewers: z.array(z.string()) }) },
  [IpcChannel.azureDevOpsPullRequestThreads]: { input: z.strictObject({ id: z.string().uuid(), repositoryId: z.string().trim().min(1).max(200), pullRequestId: z.number().int().positive() }), output: z.array(z.strictObject({ id: z.number().int(), status: z.string(), comments: z.array(z.strictObject({ id: z.number().int(), author: z.string().nullable(), content: z.string(), publishedAt: z.string().nullable() })) })) },
  [IpcChannel.azureDevOpsPullRequestChanges]: { input: z.strictObject({ id: z.string().uuid(), repositoryId: z.string().trim().min(1).max(200), pullRequestId: z.number().int().positive() }), output: z.array(z.strictObject({ path: z.string(), changeType: z.string(), objectId: z.string().nullable(), url: z.string().nullable(), content: z.string().nullable(), baseContent: z.string().nullable(), targetContent: z.string().nullable() })) },
  [IpcChannel.azureDevOpsOpenBrowser]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ opened: z.literal(true) }) },
  [IpcChannel.azureDevOpsCredentialSave]: { input: z.strictObject({ id: z.string().uuid(), token: z.string().trim().min(1).max(500) }), output: z.strictObject({ saved: z.literal(true) }) },
  [IpcChannel.azureDevOpsCredentialClear]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ cleared: z.literal(true) }) },
  [IpcChannel.azureDevOpsCredentialStatus]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ configured: z.boolean() }) },
  [IpcChannel.azureDevOpsWritePrepare]: { input: z.strictObject({ id: z.string().uuid(), request: azureDevOpsWriteRequestSchema }), output: z.strictObject({ operationId: z.string().uuid(), action: z.enum(['comment_pr', 'set_pr_status', 'create_work_item', 'update_work_item']), target: z.string(), summary: z.string(), requiresApproval: z.literal(true) }) },
  // Only normalized write results cross to the renderer; the TFS response itself never does.
  [IpcChannel.azureDevOpsWriteExecute]: {
    input: z.strictObject({ id: z.string().uuid(), operationId: z.string().uuid() }),
    output: z.union([
      z.strictObject({ approved: z.literal(false) }),
      z.strictObject({ approved: z.literal(true), result: z.union([z.strictObject({ id: z.number().int() }), z.strictObject({ id: z.number().int(), url: z.string().nullable() }), z.strictObject({ pullRequestId: z.number().int(), status: z.string() })]) }),
    ]),
  },
  [IpcChannel.videoProductionDerivatives]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(productionDerivativeSchema) },
  [IpcChannel.videoProductionDerivativesGenerate]: { input: z.strictObject({ runId: z.string().uuid(), formatId: z.enum(['youtube-short', 'instagram-reels', 'tiktok']).optional() }), output: z.array(productionDerivativeSchema) },
  [IpcChannel.videoProductionDerivativeDecide]: { input: z.strictObject({ id: z.string().uuid(), decision: z.enum(['approved', 'rejected']) }), output: z.array(productionDerivativeSchema) },
  [IpcChannel.videoProductionDerivativeCreate]: { input: z.strictObject({ id: z.string().uuid() }), output: z.strictObject({ childRunId: z.string().uuid(), derivatives: z.array(productionDerivativeSchema) }) },
  [IpcChannel.videoProductionDerivativesRender]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.strictObject({ scheduled: z.number().int().nonnegative(), derivatives: z.array(productionDerivativeSchema) }) },
  [IpcChannel.videoProductionDerivativesExport]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.strictObject({ scheduled: z.number().int().nonnegative(), derivatives: z.array(productionDerivativeSchema) }) },
  [IpcChannel.videoStoryboardRestore]: { input: z.strictObject({ runId: z.string().uuid(), baseVersion: z.number().int().positive(), version: z.number().int().positive() }), output: storyboardViewSchema },
  [IpcChannel.videoStoryboardHistory]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.array(z.strictObject({ version: z.number().int().positive(), source: z.enum(['generated', 'edit', 'sync', 'restore', 'matching']), createdAt: z.string(), op: z.string().nullable() })).max(10_000) },
  [IpcChannel.videoProductionDraft]: { input: z.strictObject({ runId: z.string().uuid(), formatId: z.enum(['youtube-long', 'youtube-short', 'instagram-reels', 'tiktok', 'square']) }), output: productionStateSchema },
  [IpcChannel.videoProductionDraftPreview]: { input: z.strictObject({ runId: z.string().uuid() }), output: z.strictObject({ url: z.string().startsWith('data:video/mp4;base64,'), storyboardVersion: z.number().int(), formatId: z.string() }).nullable() },
  [IpcChannel.videoProductionRunDecide]: { input: z.strictObject({ stageId: z.string().uuid(), decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(1_000).optional() }), output: productionStateSchema },
  [IpcChannel.videoCollageList]: { input: z.strictObject({ projectId }), output: z.array(z.unknown()) },
  [IpcChannel.videoChannelVideos]: { input: z.strictObject({ projectId }), output: z.array(z.strictObject({ relativePath: z.string().min(1).max(1_000), size: z.number().int().nonnegative(), modifiedAt: z.string().datetime() })).max(200) },
  [IpcChannel.videoChannelVideoPreview]: { input: z.strictObject({ projectId, relativePath: z.string().trim().min(1).max(1_000) }), output: z.string().startsWith('data:video/mp4;base64,') },
  [IpcChannel.videoSaveProjectFile]: { input: z.strictObject({ projectId, relativePath: z.string().trim().min(1).max(1_000) }), output: z.strictObject({ saved: z.boolean() }) },
  [IpcChannel.videoSaveGeneratedFile]: { input: z.strictObject({ fileName: z.string().trim().min(1).max(200), dataBase64: z.string().min(1).max(36_000_000) }), output: z.strictObject({ saved: z.boolean() }) },
  [IpcChannel.videoChannelPublishStatus]: { input: z.strictObject({ id: z.string().min(1) }), output: z.strictObject({ id: z.string(), status: z.string(), progress: z.number().int().min(0).max(100), error: z.string().nullable() }).nullable() },
  [IpcChannel.videoChannelPublishCancel]: { input: z.strictObject({ id: z.string().min(1) }), output: z.strictObject({ cancelled: z.boolean() }) },
  [IpcChannel.videoChannelPublishResume]: { input: z.strictObject({ id: z.string().min(1), confirmed: z.literal(true) }), output: z.strictObject({ id: z.string(), youtubeVideoId: z.string() }) },
  [IpcChannel.videoChannelAgenda]: { input: z.strictObject({ projectId }), output: z.array(agendaItemSchema) },
  [IpcChannel.videoChannelReschedule]: { input: z.strictObject({ projectId, videoId: z.string().trim().min(1).max(200), publishAt: z.string().datetime().nullable(), confirmed: z.literal(true) }), output: z.strictObject({ rescheduled: z.literal(true) }) },
  [IpcChannel.videoChannelNicheReference]: { input: z.strictObject({ projectId, query: z.string().trim().min(1).max(200) }), output: z.strictObject({ query: z.string(), quotaCost: z.number().int(), titles: z.array(z.string()), totalResults: z.number().int() }) },
  [IpcChannel.videoChannelOptimize]: { input: z.strictObject({ projectId, query: z.string().trim().min(1).max(200), referenceTitles: z.array(z.string().max(200)).max(50), agent: z.enum(['claude', 'codex']) }), output: optimizerSuggestionSchema },
  [IpcChannel.agentsStatus]: {
    input: z.strictObject({ refresh: z.boolean() }),
    output: z.array(
      z.strictObject({
        id: z.enum(['claude', 'codex']),
        label: z.string(),
        installed: z.boolean(),
        path: z.string().nullable(),
        version: z.string().nullable(),
        testedVersion: z.string(),
        authenticated: z.boolean().nullable(),
        authMethod: z.string().nullable(),
        features: z.array(z.string()),
        warnings: z.array(z.string()),
        problems: z.array(z.string()),
        checkedAt: z.string(),
      }),
    ),
  },
  [IpcChannel.skillsList]: {
    input: noInput,
    output: z.array(z.strictObject({ id: z.string(), name: z.string(), description: z.string(), valid: z.boolean(), root: z.string(), path: z.string(), source: z.enum(['claude', 'codex', 'agents', 'plugin', 'custom']), conflict: z.boolean(), scripts: z.array(z.string()) })),
  },
  [IpcChannel.skillsSettings]: { input: noInput, output: z.strictObject({ allowlistedHosts: z.array(z.string()), preferences: z.array(z.strictObject({ skillId: z.string(), taskTypes: z.array(z.string()), agents: z.array(z.enum(['claude', 'codex'])), enabled: z.boolean() })) }) },
  [IpcChannel.skillsSettingsSave]: { input: z.strictObject({ allowlistedHosts: z.array(z.string()), preferences: z.array(z.strictObject({ skillId: z.string(), taskTypes: z.array(z.string()), agents: z.array(z.enum(['claude', 'codex'])), enabled: z.boolean() })) }), output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.historySyncSettings]: { input: noInput, output: historySyncSettingsSchema },
  [IpcChannel.historySyncSettingsSave]: { input: historySyncSettingsSchema, output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.historySyncStatus]: { input: noInput, output: z.strictObject({ lastRun: z.string().nullable(), sessions: count, proposals: count, errors: count, running: z.boolean() }) },
  [IpcChannel.historySyncRun]: { input: noInput, output: z.strictObject({ lastRun: z.string().nullable(), sessions: count, proposals: count, errors: count, running: z.boolean() }) },
  [IpcChannel.importedConversationsList]: { input: noInput, output: z.array(z.strictObject({ id: z.string(), agent: z.enum(['claude', 'codex']), externalId: z.string(), title: z.string(), projectId: z.string().nullable(), projectPath: z.string().nullable(), association: z.enum(['associated', 'unassociated']), updatedAt: z.string().nullable(), importedAt: z.string() })) },
  [IpcChannel.skillsInstall]: { input: z.strictObject({ source: z.string().url().max(2048), approved: z.literal(true) }), output: z.strictObject({ path: z.string() }) },
  [IpcChannel.skillsRecommend]: { input: z.strictObject({ taskDescription: z.string().trim().min(1).max(2_000), agent: z.enum(['claude', 'codex']).optional(), projectId: z.string().trim().min(1).max(200).optional() }), output: z.array(z.strictObject({ skillId: z.string(), name: z.string(), reasons: z.array(z.string()), relevance: z.number(), conflictWarnings: z.array(z.string()) })) },
  [IpcChannel.skillsUsage]: { input: noInput, output: z.array(z.strictObject({ skillId: z.string(), used: z.number().int(), loaded: z.number().int(), failed: z.number().int(), injected: z.number().int(), lastAt: z.string() })) },
  [IpcChannel.skillsUpdate]: { input: z.strictObject({ source: z.string().url().max(2048), approved: z.literal(true) }), output: z.strictObject({ path: z.string() }) },
  [IpcChannel.skillsInstallPrepare]: { input: z.strictObject({ skillId: z.string().min(1).max(200), source: z.string().url().max(2048), scope: z.enum(['global', 'project']), agent: z.enum(['claude', 'codex']).optional() }), output: z.strictObject({ operationId: z.string().uuid(), skillId: z.string(), state: z.string(), fingerprint: z.string().length(64), preview: skillInstallPreviewSchema }) },
  [IpcChannel.skillsInstallPreview]: { input: z.strictObject({ operationId: z.string().uuid() }), output: skillInstallPreviewSchema },
  [IpcChannel.skillsInstallConfirm]: { input: z.strictObject({ operationId: z.string().uuid(), confirmed: z.literal(true) }), output: z.strictObject({ id: z.string().uuid(), skillId: z.string(), destination: z.string(), operation: z.enum(['install', 'update']), state: z.string(), fingerprint: z.string().length(64), backupAvailable: z.boolean(), error: z.string().nullable(), updatedAt: z.string() }) },
  [IpcChannel.skillsInstallStatus]: { input: z.strictObject({ operationId: z.string().uuid() }), output: z.strictObject({ id: z.string().uuid(), skillId: z.string(), destination: z.string(), operation: z.enum(['install', 'update']), state: z.string(), fingerprint: z.string().length(64), backupAvailable: z.boolean(), error: z.string().nullable(), updatedAt: z.string() }) },
  [IpcChannel.skillsInstallCancel]: { input: z.strictObject({ operationId: z.string().uuid() }), output: z.strictObject({ id: z.string().uuid(), skillId: z.string(), destination: z.string(), operation: z.enum(['install', 'update']), state: z.string(), fingerprint: z.string().length(64), backupAvailable: z.boolean(), error: z.string().nullable(), updatedAt: z.string() }) },
  [IpcChannel.skillsInstallRollback]: { input: z.strictObject({ operationId: z.string().uuid(), confirmed: z.literal(true) }), output: z.strictObject({ id: z.string().uuid(), skillId: z.string(), destination: z.string(), operation: z.enum(['install', 'update']), state: z.string(), fingerprint: z.string().length(64), backupAvailable: z.boolean(), error: z.string().nullable(), updatedAt: z.string() }) },
  [IpcChannel.skillsInstallHistory]: { input: noInput, output: z.array(z.strictObject({ id: z.string().uuid(), skillId: z.string(), destination: z.string(), operation: z.enum(['install', 'update']), state: z.string(), fingerprint: z.string().length(64), backupAvailable: z.boolean(), error: z.string().nullable(), updatedAt: z.string() })) },
  [IpcChannel.skillsInstallRecovery]: { input: noInput, output: z.array(z.strictObject({ id: z.string().uuid(), skillId: z.string(), destination: z.string(), operation: z.enum(['install', 'update']), state: z.string(), fingerprint: z.string().length(64), backupAvailable: z.boolean(), error: z.string().nullable(), updatedAt: z.string() })) },
  [IpcChannel.extensionsList]: { input: noInput, output: z.array(installedExtensionSchema) },
  [IpcChannel.extensionsInstall]: { input: z.strictObject({ sourcePath: z.string().min(1).max(4096) }), output: installedExtensionSchema },
  [IpcChannel.extensionsEnable]: { input: z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/) }), output: installedExtensionSchema },
  [IpcChannel.extensionsDisable]: { input: z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/) }), output: installedExtensionSchema },
  [IpcChannel.extensionsUpdate]: { input: z.strictObject({ sourcePath: z.string().min(1).max(4096) }), output: installedExtensionSchema },
  [IpcChannel.extensionsRollback]: { input: z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/) }), output: installedExtensionSchema },
  [IpcChannel.extensionsUninstall]: { input: z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/) }), output: extensionUninstallResultSchema },
  [IpcChannel.personalAccountsList]: { input: noInput, output: z.array(z.strictObject({ accountId: z.string(), provider: z.enum(['gmail', 'calendar', 'whatsapp']), identifier: z.string(), scopes: z.array(z.string()), state: z.enum(['disconnected', 'connecting', 'connected', 'error', 'revoked']) })) },
  [IpcChannel.personalAccountDisconnect]: { input: z.strictObject({ accountId: z.string().min(1).max(200) }), output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.personalGoogleImportClient]: { input: noInput, output: z.strictObject({ configured: z.literal(true), clientId: z.string().min(1) }) },
  [IpcChannel.personalGoogleConnect]: { input: z.strictObject({ gmailSend: z.boolean().optional(), calendarWrite: z.boolean().optional() }).optional(), output: z.strictObject({ connected: z.literal(true), scopes: z.array(z.string()) }) },
  [IpcChannel.personalActionSendMail]: { input: z.strictObject({ accountId: z.string().min(1).max(200), to: z.array(z.string().email()).min(1).max(50), subject: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(20_000) }), output: computerActionResultSchema },
  [IpcChannel.personalActionCreateEvent]: { input: z.strictObject({ accountId: z.string().min(1).max(200), summary: z.string().trim().min(1).max(500), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }) }), output: computerActionResultSchema },
  [IpcChannel.personalActionDecide]: { input: computerActionDecisionSchema, output: computerActionResultSchema },
  [IpcChannel.personalNotificationsList]: { input: z.strictObject({ unreadOnly: z.boolean().optional() }).optional(), output: z.array(z.strictObject({ id: z.string(), priority: z.enum(['low', 'normal', 'high', 'urgent']), channel: z.string(), groupKey: z.string().optional(), title: z.string(), metadata: z.record(z.string(), z.unknown()), dedupeKey: z.string(), readAt: z.string().optional(), createdAt: z.string() })) },
  [IpcChannel.personalNotificationRead]: { input: z.strictObject({ id: z.string() }), output: z.strictObject({ ok: z.literal(true) }) },
  [IpcChannel.contentChannelsList]: { input: noInput, output: z.array(contentChannelSchema) },
  [IpcChannel.contentIdeasList]: { input: z.strictObject({ workspaceId: z.string().min(1).max(200) }), output: z.array(contentIdeaSchema) },
  [IpcChannel.contentIdeaCreate]: { input: z.strictObject({ id: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200), channelId: z.string().min(1).max(200).nullable(), title: z.string().trim().min(1).max(300), angle: z.string().max(1_000).optional(), source: z.string().max(100).optional() }), output: contentIdeaSchema },
  [IpcChannel.contentIdeaConvert]: { input: z.strictObject({ ideaId: z.string().min(1).max(200), projectId: z.string().min(1).max(200), videoProjectId: z.string().min(1).max(200).nullable(), autonomy: z.enum(autonomyModes) }), output: contentProjectSchema },
  [IpcChannel.contentIdeaFromAnalytics]: { input: z.strictObject({ id: z.string().min(1).max(200), projectId: z.string().min(1).max(200), title: z.string().trim().min(1).max(500), angle: z.string().trim().max(500) }), output: contentIdeaSchema },
  [IpcChannel.contentLibraryList]: { input: z.strictObject({ projectId: z.string().min(1).max(200) }), output: z.array(contentAssetSchema) },
  [IpcChannel.contentChannelCreate]: { input: z.strictObject({ id: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200), name: z.string().trim().min(1).max(200), autonomy: z.enum(autonomyModes), budgetUsd: z.number().nonnegative().max(1_000_000).default(0), concurrencyLimit: z.number().int().positive().max(32).default(1), niche: z.string().max(300).optional(), audience: z.string().max(500).optional(), tone: z.string().max(500).optional(), identity: z.record(z.string(), z.unknown()).optional(), editorialStrategy: z.record(z.string(), z.unknown()).optional() }), output: contentChannelSchema },
  [IpcChannel.contentChannelUpdate]: { input: z.strictObject({ id: z.string().min(1).max(200), name: z.string().trim().min(1).max(200).optional(), niche: z.string().max(300).optional(), audience: z.string().max(500).optional(), tone: z.string().max(500).optional(), autonomy: z.enum(autonomyModes).optional(), budgetUsd: z.number().nonnegative().max(1_000_000).optional(), concurrencyLimit: z.number().int().positive().max(32).optional(), identity: z.record(z.string(), z.unknown()).optional(), editorialStrategy: z.record(z.string(), z.unknown()).optional() }), output: contentChannelSchema },
  [IpcChannel.contentChannelDelete]: { input: z.strictObject({ channelId: z.string().min(1).max(200) }), output: z.strictObject({ deleted: z.boolean() }) },
  [IpcChannel.contentProjectsList]: { input: z.strictObject({ workspaceId: z.string().min(1).max(200) }), output: z.array(contentProjectSchema) },
  [IpcChannel.contentQueueList]: { input: z.strictObject({ workspaceId: z.string().min(1).max(200) }), output: z.array(contentQueueItemSchema) },
  [IpcChannel.contentProjectCreate]: { input: z.strictObject({ id: z.string().min(1).max(200), workspaceId: z.string().min(1).max(200), channelId: z.string().min(1).max(200).nullable(), videoProjectId: z.string().min(1).max(200).nullable(), title: z.string().trim().min(1).max(300), autonomy: z.enum(autonomyModes) }), output: contentProjectSchema },
  [IpcChannel.contentProjectDelete]: { input: z.strictObject({ projectId: z.string().min(1).max(200) }), output: z.strictObject({ deleted: z.boolean() }) },
  [IpcChannel.contentProjectBriefSave]: { input: z.strictObject({ projectId: z.string().min(1).max(200), brief: contentBriefSchema }), output: contentProjectSchema },
  [IpcChannel.contentProjectScriptSave]: { input: z.strictObject({ projectId: z.string().min(1).max(200), script: contentScriptSchema }), output: contentProjectSchema },
  [IpcChannel.contentProjectScriptGenerate]: { input: z.strictObject({ projectId: z.string().min(1).max(200), agent: z.enum(['claude', 'codex']).optional() }), output: contentProjectSchema },
  [IpcChannel.contentAnalyticsList]: { input: z.strictObject({ projectId: z.string().min(1).max(200) }), output: z.array(contentAnalyticsSnapshotSchema) },
  [IpcChannel.contentAnalyticsSnapshotSave]: { input: contentAnalyticsSnapshotSchema, output: contentAnalyticsSnapshotSchema },
  [IpcChannel.contentAnalyticsSync]: { input: z.strictObject({ projectId: z.string().min(1).max(200) }), output: z.array(contentAnalyticsSnapshotSchema) },
  [IpcChannel.contentPublicationPublish]: { input: z.strictObject({ projectId: z.string().min(1).max(200), packageId: z.string().min(1).max(200), outputRelativePath: z.string().trim().min(1).max(1_000), thumbnailRelativePath: z.string().trim().min(1).max(1_000).optional(), privacy: z.enum(['private', 'unlisted', 'public']), publishAt: z.string().datetime().nullable() }), output: z.strictObject({ id: z.string(), youtubeVideoId: z.string() }) },
  [IpcChannel.contentProjectDashboard]: { input: z.strictObject({ projectId: z.string().min(1).max(200) }), output: z.strictObject({ project: contentProjectSchema, executions: z.array(productionExecutionSchema), packages: z.array(publicationPackageSchema), publications: z.array(contentPublicationSchema), approvals: z.array(publicationApprovalSchema), nextAction: projectNextActionSchema }) },
  [IpcChannel.contentPublicationPackageSave]: { input: z.strictObject({ id: z.string().min(1).max(200), projectId: z.string().min(1).max(200), version: z.number().int().positive(), title: z.string().max(100), description: z.string().max(5_000).optional(), tags: z.array(z.string().trim().min(1).max(100)).max(500), thumbnailAssetId: z.string().min(1).nullable().optional() }), output: publicationPackageSchema },
  [IpcChannel.contentPublicationPackageApprove]: { input: z.strictObject({ id: z.string().min(1).max(200), approvedBy: z.string().trim().min(1).max(100).default('user'), note: z.string().max(2_000).default('') }), output: z.strictObject({ approved: z.literal(true) }) },
  [IpcChannel.contentPublicationSchedule]: { input: publicationScheduleInputSchema, output: contentPublicationSchema },
  [IpcChannel.contentProductionStart]: { input: z.strictObject({ id: z.string().min(1).max(200), projectId: z.string().min(1).max(200) }), output: productionExecutionSchema },
  [IpcChannel.skillsStudioDrafts]: { input: noInput, output: z.array(skillStudioDraftSummarySchema) },
  [IpcChannel.skillsStudioCreate]: { input: z.strictObject({ skillId: z.string().trim().min(1).max(120), metadata: skillStudioMetadataSchema, instructions: z.string().max(512_000), files: z.array(skillStudioFileSchema).max(200).optional(), scope: z.enum(['global', 'project']), projectId: z.string().max(200).nullable().optional() }), output: skillStudioEditorStateSchema },
  [IpcChannel.skillsStudioOpen]: { input: z.strictObject({ skillId: z.string().trim().min(1).max(120), scope: z.enum(['global', 'project']), projectId: z.string().max(200).nullable().optional() }), output: skillStudioEditorStateSchema },
  [IpcChannel.skillsStudioGet]: { input: z.strictObject({ draftId: z.string().uuid() }), output: skillStudioEditorStateSchema },
  [IpcChannel.skillsStudioSave]: { input: z.strictObject({ draftId: z.string().uuid(), expectedRevision: z.number().int().positive(), metadata: skillStudioMetadataSchema, instructions: z.string().max(512_000), files: z.array(skillStudioFileSchema).max(200) }), output: skillStudioEditorStateSchema },
  [IpcChannel.skillsStudioValidate]: { input: z.strictObject({ draftId: z.string().uuid() }), output: skillStudioValidationSchema },
  [IpcChannel.skillsStudioPublish]: { input: z.strictObject({ draftId: z.string().uuid(), confirmed: z.literal(true) }), output: skillStudioVersionSchema },
  [IpcChannel.skillsStudioVersions]: { input: z.strictObject({ skillId: z.string().trim().min(1).max(120) }), output: z.array(skillStudioVersionSchema) },
  [IpcChannel.skillsStudioCompare]: { input: z.strictObject({ skillId: z.string().trim().min(1).max(120), fromVersionId: z.string().uuid(), toVersionId: z.string().uuid() }), output: skillStudioChangeSetSchema },
  [IpcChannel.skillsStudioRestore]: { input: z.strictObject({ skillId: z.string().trim().min(1).max(120), versionId: z.string().uuid(), confirmed: z.literal(true), expectedFingerprint: z.string().length(64).nullable().optional() }), output: skillStudioVersionSchema },
  [IpcChannel.skillsStudioImportPreview]: { input: z.strictObject({ sourcePath: z.string().trim().min(1).max(4_096) }), output: skillStudioImportPreviewSchema },
  [IpcChannel.skillsStudioImport]: { input: z.strictObject({ sourcePath: z.string().trim().min(1).max(4_096), confirmed: z.literal(true) }), output: skillStudioEditorStateSchema },
  [IpcChannel.skillsStudioExport]: { input: z.strictObject({ skillId: z.string().trim().min(1).max(120), versionId: z.string().uuid() }), output: skillStudioExportResultSchema },
  [IpcChannel.skillsStudioSimulate]: { input: z.strictObject({ draftId: z.string().uuid(), taskDescription: z.string().max(4_000), projectId: z.string().max(200).optional(), stack: z.array(z.string().max(100)).max(30).optional(), agent: z.enum(['claude', 'codex']).optional(), taskType: z.string().max(200).optional(), workflowStep: z.string().max(200).optional(), limit: z.number().int().min(0).max(50).optional() }), output: skillStudioSimulationSchema },
} satisfies Record<IpcChannelName, { input: z.ZodType; output: z.ZodType }>;

export type IpcContract = typeof ipcContract;
export type IpcInput<C extends IpcChannelName> = z.output<IpcContract[C]['input']>;
export type IpcOutput<C extends IpcChannelName> = z.output<IpcContract[C]['output']>;

export function parseIpcInput<C extends IpcChannelName>(channel: C, payload: unknown): IpcInput<C> {
  return ipcContract[channel].input.parse(payload) as IpcInput<C>;
}

export function parseIpcOutput<C extends IpcChannelName>(channel: C, value: unknown): IpcOutput<C> {
  return ipcContract[channel].output.parse(value) as IpcOutput<C>;
}

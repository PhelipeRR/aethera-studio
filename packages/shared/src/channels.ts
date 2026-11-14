import type { MotionProject, MotionSceneV2 } from './motion.js';
import type { EditorialPlanView } from './aethera-smart-director.js';
import type { MonitoringInterval, MonitorSnapshot } from './monitoring.js';
import type { CoreDevice, CorePairingOffer, CorePendingPairing, CoreRemoteStatus, CoreRuntime } from './core-desktop.js';
import type { Grant } from './core-api/auth.js';
import type { NarrationAsset, NarrationLicenseState, NarrationTimeline, VoiceStudioStatus } from './velix-narration.js';
import type { AgendaItem, BrandIdentity, PublishDraft } from './velix-channel.js';
import type { ProductionStyleChoice, VideoStyle } from './video-styles.js';
import type { OptimizerSuggestion } from './velix-optimizer.js';
import type { ProductionBrief, ProductionRunView, ProductionState } from './velix-production.js';
import type { ProductionScript } from './velix-long-script.js';
import type { MatchReviewCandidate, MediaAcquisitionJob, RankingIntent, VerifiedSubject } from './aethera-studio.js';
import type { AcquiredMediaUseView, EditorialUsePolicy } from './aethera-render-use.js';
import type { ChannelVoiceView, NarrationDirection, VoicePreset } from './aethera-voice.js';
import type { SourceCandidate } from './aethera-media.js';
import type { AetheraReferenceValidationReport } from './aethera-reference-validation.js';
import type { ClaimKind, ProductionClaims } from './velix-evidence.js';
import type { SemanticEditResult, StoryboardCandidateView, StoryboardEdit, StoryboardView } from './velix-storyboard.js';
import type { ProductionNarrationView } from './velix-sync.js';
import type { ProductionRendersView } from './velix-composition.js';
import type { ProductionDerivative } from './velix-derivatives.js';
import type { AetheraTimelineVersion, TimelineDocument, TimelineOp } from './aethera-timeline.js';
import type { AetheraReviewReportRecord } from './aethera-review.js';
import type { AetheraProductionPlan } from './aethera-production-planner.js';
import type { AceStepMusicGenerationInput, AceStepMusicGenerationResult } from './aethera-audio.js';
import type { AzureDevOpsCapabilities, AzureDevOpsConnectionInput, AzureDevOpsConnectionStatus, AzureDevOpsProject, AzureDevOpsRepository, AzureDevOpsPullRequest, AzureDevOpsPullRequestChange, AzureDevOpsPullRequestDetail, AzureDevOpsPullRequestThread, AzureDevOpsWriteDraft, AzureDevOpsWriteRequest } from './azure-devops.js';
// Dependency-free IPC surface: safe to import from the sandboxed preload.

import type { AgentStatus } from './agents.js';
import type { CommitRelations, DiscoveryChoice, DiscoveryReport, GitBranchInfo, GitHistory, GitIndexReport, GitRefComparison, GitSearchHit, GitStashInfo, GitSyncStatus, GitWorkingTreeFile, ProjectDetail, ProjectKind, ProjectProfile, ProjectSummary, ProjectUpdate } from './projects.js';
import type { Brain3DGraph, BrainActivityEntry, BrainSimilarity, GalaxySnapshot } from './brain3d.js';
import type { BackupInfo, BrainSettings, ImportResult, LearningCandidate, RetentionResult } from './brain-settings.js';
import type { LearningStatus, MemoryType } from './domain.js';
import type { ImageUpload, KnownModels, TaskChanged, TaskDetail, TaskListFilter, TaskStartInput, TaskSummary, TokenReport } from './tasks.js';
import type { GitReviewReport, GitReviewStartInput } from './git-review.js';
import type { SmartCommitReport, SmartCommitStartInput } from './smart-commit.js';
import type { SpotifyCommand, SpotifyCommandResult, SpotifyConfigure, SpotifyControl, SpotifyDevice, SpotifyStatus } from './spotify.js';
import type { MeetingSession, MeetingStartInput, MeetingStopInput, MeetingTranscriptInput, Suggestion, SuggestionDecision } from './meeting.js';
import type { NeuraMeetingAudio, NeuraVoiceAudio, NeuraActionDecision, NeuraInput, NeuraPauseResult, NeuraResponse, NeuraSettings, NeuraSettingsPatch, NeuraSpeechInput, NeuraSpeechResult, NeuraState } from './neura.js';
import type { VoiceSession, VoiceStartInput, VoiceStopInput } from './voice.js';
import type { CompanionEvent, CompanionEventFilter, CompanionEventPage, CompanionHudDragPhase, CompanionHudMode, CompanionHudState, CompanionSession, CompanionSessionPage } from './companion.js';
import type { InstalledExtension } from './extensions.js';
import type { AutonomyMode, ContentAnalyticsSnapshot, ContentAsset, ContentChannel, ContentIdea, ContentProject, ContentPublication, ContentQueueItem, ProductionExecution, ProjectNextAction, PublicationApproval, PublicationPackage } from './content-operating-system.js';
import type { ContentBrief } from './content-brief.js';
import type { ContentScript } from './content-script.js';
import type { WorkflowDefinition, WorkflowRunSummary, WorkflowSummary } from './workflows.js';
export interface ImportedConversationSummary { id: string; agent: 'claude' | 'codex'; externalId: string; title: string; projectId: string | null; projectPath: string | null; association: 'associated' | 'unassociated'; updatedAt: string | null; importedAt: string; }
import type {
  BrainGraph,
  EvidenceCheck,
  BrainOverview,
  BrainSearchInput,
  ListFilter,
  MemoryDetail,
  MemorySummary,
  MemoryVersion,
  Page,
  ProjectRef,
  SearchResult,
  StoreInput,
  Memory,
  TagCount,
} from './brain.js';

export type VideoReference = { kind: 'texto' | 'dado' | 'imagem' | 'fonte'; title: string; url: string; license: string; note: string };

export type VideoCapturePlan = { kind: 'web' | 'electron'; command: string; url: string; env: Record<string, string>; screens: Array<{ name: string; path: string }> };

export type VideoDiscoveryFilters = { subtopic?: string; keywords?: string; platform?: 'youtube' | 'shorts'; duration?: 'any' | 'short' | 'medium' | 'long'; style?: string; audience?: string; periodDays?: number; rightsPolicy?: 'reference' | 'creative_commons' };
export type VideoRadarView = { days: number; measuredAt: string; total: number; undated: number; inWindow: number; previousWindow: number; publishers: Array<{ publisher: string; count: number }>; daily: Array<{ day: string; count: number }> };
/** What a Motion render needs on this machine. installing and progress describe the download the user started. */
export type VideoMotionRuntime = { disabled: boolean; templates: boolean; tools: boolean; browser: boolean; installing: boolean; progress: number; error: string | null };
export type VideoProductionStatus = { running: boolean; phase: string | null; startedAt: string | null; log: string[] };
export type VideoIdeaView = {
  id: string; status: string; title: string; hook: string; synopsis: string; draftScript: string; audience: string; durationSeconds: number; referenceUrls: string[]; mediaPlan: string;
  claims: Array<{ text: string; type: 'fact' | 'hypothesis' | 'opinion'; referenceUrl: string | null }>;
  evidence: { references: number; recent: number; researchedAt: string | null };
  pendingReferences: Array<{ id: string; title: string; url: string; agent: string | null; executionId: string | null }>;
  generation: { agent: string | null; model: string | null; executionId: string | null; generatedAt: string | null };
};
export type VideoStudioState = { folder: string; narration: string; data: string; audio: string | null; synced: boolean; images: string[] };

export type VideoLimits = { available: boolean; blocked: boolean; reason: string | null; windows: Array<{ id: string; percent: number; resetsAt: string | null }> };

export const IpcChannel = {
  appInfo: 'app:info',
  appStatus: 'app:status',
  appMissionControl: 'app:mission-control',
  appRelaunch: 'app:relaunch',
  appExportDiagnostics: 'app:export-diagnostics',
  monitoringSnapshot: 'monitoring:snapshot',
  monitoringConfigure: 'monitoring:configure',
  coreStatus: 'core:status',
  coreRemoteSet: 'core:remote-set',
  corePairingStart: 'core:pairing-start',
  corePairings: 'core:pairings',
  corePairingDecide: 'core:pairing-decide',
  coreDevices: 'core:devices',
  coreRevoke: 'core:revoke',
  coreRuntime: 'core:runtime',
  coreStandaloneSet: 'core:standalone-set',
  databaseRecoveryBackups: 'database:recovery-backups',
  databaseRestoreBackup: 'database:restore-backup',
  themeGet: 'theme:get',
  themeSet: 'theme:set',
  mcpStatus: 'mcp:status',
  mcpRegister: 'mcp:register',
  mcpRegisterAlias: 'mcp:register-alias',
  mcpUnregister: 'mcp:unregister',
  mcpServers: 'mcp:servers',
  semanticStatus: 'semantic:status',
  semanticEnable: 'semantic:enable',
  semanticDisable: 'semantic:disable',
  agentsStatus: 'agents:status',
  skillsList: 'skills:list',
  skillsUsage: 'skills:usage',
  skillsRecommend: 'skills:recommend',
  skillsSettings: 'skills:settings',
  skillsSettingsSave: 'skills:settings:save',
  skillsInstall: 'skills:install',
  skillsUpdate: 'skills:update',
  skillsInstallPrepare: 'skills:install:prepare',
  skillsInstallPreview: 'skills:install:preview',
  skillsInstallConfirm: 'skills:install:confirm',
  skillsInstallStatus: 'skills:install:status',
  skillsInstallCancel: 'skills:install:cancel',
  skillsInstallRollback: 'skills:install:rollback',
  skillsInstallHistory: 'skills:install:history',
  skillsInstallRecovery: 'skills:install:recovery',
  extensionsList: 'extensions:list',
  extensionsInstall: 'extensions:install',
  extensionsEnable: 'extensions:enable',
  extensionsDisable: 'extensions:disable',
  extensionsUpdate: 'extensions:update',
  extensionsRollback: 'extensions:rollback',
  extensionsUninstall: 'extensions:uninstall',
  personalAccountsList: 'personal:accounts:list',
  personalAccountDisconnect: 'personal:account:disconnect',
  personalGoogleImportClient: 'personal:google:oauth:import-client',
  personalGoogleConnect: 'personal:google:oauth:connect',
  personalActionSendMail: 'personal:action:send-mail',
  personalActionCreateEvent: 'personal:action:create-event',
  personalActionDecide: 'personal:action:decide',
  personalNotificationsList: 'personal:notifications:list',
  personalNotificationRead: 'personal:notifications:read',
  contentChannelsList: 'content:channels:list',
  contentIdeasList: 'content:ideas:list',
  contentIdeaCreate: 'content:ideas:create',
  contentIdeaConvert: 'content:ideas:convert',
  contentIdeaFromAnalytics: 'content:ideas:from-analytics',
  contentLibraryList: 'content:library:list',
  contentChannelCreate: 'content:channels:create',
  contentProjectsList: 'content:projects:list',
  contentQueueList: 'content:queue:list',
  contentProjectCreate: 'content:projects:create',
  contentProjectBriefSave: 'content:projects:brief:save',
  contentProjectScriptSave: 'content:projects:script:save',
  contentProjectScriptGenerate: 'content:projects:script:generate',
  contentAnalyticsList: 'content:analytics:list',
  contentAnalyticsSnapshotSave: 'content:analytics:snapshot:save',
  contentAnalyticsSync: 'content:analytics:sync',
  contentPublicationPublish: 'content:publication:publish',
  contentProjectDashboard: 'content:projects:dashboard',
  contentPublicationPackageSave: 'content:publication-package:save',
  contentPublicationPackageApprove: 'content:publication-package:approve',
  contentPublicationSchedule: 'content:publication:schedule',
  contentProductionStart: 'content:production:start',
  skillsStudioDrafts: 'skills:studio:drafts',
  skillsStudioCreate: 'skills:studio:create',
  skillsStudioOpen: 'skills:studio:open',
  skillsStudioGet: 'skills:studio:get',
  skillsStudioSave: 'skills:studio:save',
  skillsStudioValidate: 'skills:studio:validate',
  skillsStudioPublish: 'skills:studio:publish',
  skillsStudioVersions: 'skills:studio:versions',
  skillsStudioCompare: 'skills:studio:compare',
  skillsStudioRestore: 'skills:studio:restore',
  skillsStudioImportPreview: 'skills:studio:import-preview',
  skillsStudioImport: 'skills:studio:import',
  skillsStudioExport: 'skills:studio:export',
  skillsStudioSimulate: 'skills:studio:simulate',
  historySyncSettings: 'history-sync:settings',
  historySyncSettingsSave: 'history-sync:settings:save',
  historySyncStatus: 'history-sync:status',
  historySyncRun: 'history-sync:run',
  importedConversationsList: 'imported-conversations:list',
  projectsList: 'projects:list',
  projectsPick: 'projects:pick',
  projectsDiscover: 'projects:discover',
  projectsDiscoverCancel: 'projects:discover:cancel',
  projectsDiscoverConfirm: 'projects:discover:confirm',
  projectsMove: 'projects:move',
  projectsSetKind: 'projects:kind',
  projectsGitState: 'projects:git:state',
  projectsCreate: 'projects:create',
  projectsClone: 'projects:clone',
  projectsInitGit: 'projects:git:init',
  projectsAdd: 'projects:add',
  projectsGet: 'projects:get',
  projectsRefresh: 'projects:refresh',
  projectsUpdate: 'projects:update',
  projectsImpact: 'projects:impact',
  projectsRemove: 'projects:remove',
  projectsDiff: 'projects:diff',
  projectsLineStats: 'projects:line-stats',
  projectsProfile: 'projects:profile',
  projectsProfileRefresh: 'projects:profile:refresh',
  projectsGitIndex: 'projects:git:index',
  projectsGitSearch: 'projects:git:search',
  projectsGitRelations: 'projects:git:relations',
  projectsGitHistory: 'projects:git:history',
  projectsGitCompare: 'projects:git:compare',
  projectsGitWorkingTree: 'projects:git:working-tree',
  projectsGitStage: 'projects:git:stage',
  projectsGitUnstage: 'projects:git:unstage',
  projectsGitBranches: 'projects:git:branches',
  projectsGitBranchCreate: 'projects:git:branch:create',
  projectsGitBranchSwitch: 'projects:git:branch:switch',
  projectsGitBranchRename: 'projects:git:branch:rename',
  projectsGitBranchDelete: 'projects:git:branch:delete',
  projectsGitStashes: 'projects:git:stashes',
  projectsGitStashCreate: 'projects:git:stash:create',
  projectsGitStashApply: 'projects:git:stash:apply',
  projectsGitStashDrop: 'projects:git:stash:drop',
  projectsGitCommit: 'projects:git:commit',
  projectsGitSyncStatus: 'projects:git:sync-status',
  projectsGitPush: 'projects:git:push',
  projectsGitOperationState: 'projects:git:operation-state',
  projectsGitRevert: 'projects:git:revert',
  projectsGitCherryPick: 'projects:git:cherry-pick',
  projectsGitOperationResolve: 'projects:git:operation-resolve',
  projectsGitAuthorizePatch: 'projects:git:authorize-patch',
  projectsGitApplyPatch: 'projects:git:apply-patch',
  projectsGitAuthorize: 'projects:git:authorize',
  projectsFile: 'projects:file',
  brainOverview: 'brain:overview',
  brainSearch: 'brain:search',
  brainList: 'brain:list',
  brainGet: 'brain:get',
  brainVersions: 'brain:versions',
  brainStore: 'brain:store',
  brainDelete: 'brain:delete',
  brainConfidence: 'brain:confidence',
  brainRevalidate: 'brain:revalidate',
  brainProjects: 'brain:projects',
  brainTags: 'brain:tags',
  brainGraph: 'brain:graph',
  brainGraph3d: 'brain:graph3d',
  brainSimilarity: 'brain:similarity',
  brainGalaxy: 'brain:galaxy',
  brainActivity: 'brain:activity',
  brainSettings: 'brain:settings',
  brainSaveSettings: 'brain:settings:save',
  brainLearning: 'brain:learning',
  brainLearningApprove: 'brain:learning:approve',
  brainLearningReject: 'brain:learning:reject',
  brainBackups: 'brain:backups',
  brainBackupCreate: 'brain:backups:create',
  brainBackupRestore: 'brain:backups:restore',
  brainRetention: 'brain:retention',
  brainExport: 'brain:export',
  brainImport: 'brain:import',
  tasksStart: 'tasks:start',
  tasksGitReviewStart: 'tasks:git-review:start',
  tasksSmartCommitStart: 'tasks:smart-commit:start',
  tasksResume: 'tasks:resume',
  tasksApprove: 'tasks:approve',
  tasksCancel: 'tasks:cancel',
  tasksPause: 'tasks:pause',
  tasksRetryCapacity: 'tasks:capacity:retry',
  tasksCapacityAutoResume: 'tasks:capacity:auto-resume',
  tasksResumePaused: 'tasks:resume-paused',
  tasksOutputFile: 'tasks:output-file',
  tasksImage: 'tasks:image',
  tasksHeal: 'tasks:heal',
  analyticsTokens: 'analytics:tokens',
  analyticsBudget: 'analytics:budget',
  analyticsBudgetSave: 'analytics:budget:save',
  tasksList: 'tasks:list',
  companionSessions: 'companion:sessions',
  companionSession: 'companion:session',
  companionEvents: 'companion:events',
  companionSubscribe: 'companion:subscribe',
  companionUnsubscribe: 'companion:unsubscribe',
  companionHudMode: 'companion:hud:mode',
  companionHudVisibility: 'companion:hud:visibility',
  companionHudPin: 'companion:hud:pin',
  companionHudResetPosition: 'companion:hud:reset-position',
  companionHudState: 'companion:hud:state',
  companionHudDrag: 'companion:hud:drag',
  companionHudInteractive: 'companion:hud:interactive',
  companionHudOpenPanel: 'companion:hud:open-panel',
  companionHudOpenSettings: 'companion:hud:open-settings',
  spotifyStatus: 'spotify:status',
  spotifyConfigure: 'spotify:configure',
  spotifyConnect: 'spotify:connect',
  spotifyCancelConnect: 'spotify:cancel-connect',
  spotifyDisconnect: 'spotify:disconnect',
  spotifyControl: 'spotify:control',
  spotifyDevices: 'spotify:devices',
  spotifyOpenTrack: 'spotify:open-track',
  neuraVoiceStart: 'neura:voice:start',
  neuraVoiceStop: 'neura:voice:stop',
  neuraMeetingStart: 'neura:meeting:start',
  neuraMeetingStop: 'neura:meeting:stop',
  neuraSuggestionDecide: 'neura:suggestion:decide',
  neuraSuggestionCopy: 'neura:suggestion:copy',
  neuraSpotifyCommand: 'neura:spotify:command',
  neuraPauseAll: 'neura:pause-all',
  neuraResume: 'neura:resume',
  neuraSpeechFinished: 'neura:speech-finished',
  neuraVoiceAudio: 'neura:voice:audio',
  neuraMeetingAudio: 'neura:meeting:audio',
  neuraSpeak: 'neura:speak',
  neuraState: 'neura:state',
  neuraInput: 'neura:input',
  neuraMeetingTranscript: 'neura:meeting:transcript',
  neuraActionDecide: 'neura:action:decide',
  neuraSettings: 'neura:settings',
  neuraSettingsUpdate: 'neura:settings:update',
  neuraClearHistory: 'neura:clear-history',
  tasksGet: 'tasks:get',
  tasksGitReviewGet: 'tasks:git-review:get',
  tasksSmartCommitGet: 'tasks:smart-commit:get',
  tasksThread: 'tasks:thread',
  tasksRenameThread: 'tasks:thread:rename',
  tasksDeleteThread: 'tasks:thread:delete',
  tasksModels: 'tasks:models',
  tasksSwarmPlan: 'tasks:swarm-plan',
  tasksSwarmRun: 'tasks:swarm-run',
  workflowsList: 'workflows:list',
  workflowsGet: 'workflows:get',
  workflowsSave: 'workflows:save',
  workflowsDelete: 'workflows:delete',
  workflowsRun: 'workflows:run',
  workflowsRuns: 'workflows:runs',
  workflowsPause: 'workflows:pause',
  workflowsResume: 'workflows:resume',
  workflowsCancel: 'workflows:cancel',
  workflowsTimeline: 'workflows:timeline',
  workflowsSteps: 'workflows:steps',
  workflowsAutomations: 'workflows:automations:list',
  workflowsAutomationSave: 'workflows:automations:save',
  workflowsAutomationToggle: 'workflows:automations:toggle',
  workflowsAutomationDelete: 'workflows:automations:delete',
  workflowsAutomationEvents: 'workflows:automations:events',
  workflowsRunFromGit: 'workflows:run-from-git',
  workflowsApproveStep: 'workflows:steps:approve',
  workflowsRejectStep: 'workflows:steps:reject',
  workflowsDecideStep: 'workflows:steps:decide',
  workflowsTemplates: 'workflows:templates:list',
  workflowsInstantiateTemplate: 'workflows:templates:instantiate',
  workflowsTemplateFavorite: 'workflows:templates:favorite',
  workflowsTemplateExport: 'workflows:templates:export',
  workflowsTemplateImport: 'workflows:templates:import',
  workflowsLayoutSave: 'workflows:layout:save',
  videoKit: 'video:kit',
  videoSettings: 'video:settings',
  videoSettingsSave: 'video:settings:save',
  videoPrepare: 'video:prepare',
  videoTopics: 'video:topics',
  videoResearch: 'video:research',
  videoResearchSave: 'video:research:save',
  videoCapturePlan: 'video:capture:plan',
  videoCapture: 'video:capture',
  videoPrints: 'video:prints',
  videoPrintRemove: 'video:prints:remove',
  videoLimits: 'video:limits',
  videoStudioList: 'video:studio:list',
  videoStudioLoad: 'video:studio:load',
  videoStudioSave: 'video:studio:save',
  videoStudioGenerate: 'video:studio:generate',
  videoStudioSync: 'video:studio:sync',
  videoStudioPreview: 'video:studio:preview',
  videoStudioRender: 'video:studio:render',
  videoStudioOutput: 'video:studio:output',
  videoStudioNarrationStatus: 'video:studio:narration:status',
  videoStudioNarrationGenerate: 'video:studio:narration:generate',
  videoStudioNarrationPreview: 'video:studio:narration:preview',
  videoStudioNarrationTimeline: 'video:studio:narration:timeline',
  videoFrames: 'video:frames',
  videoImport: 'video:import',
  videoRender: 'video:render',
  videoRenderStatus: 'video:render:status',
  videoRenderCancel: 'video:render:cancel',
  videoRenderJobsList: 'video:render:jobs:list',
  videoPreview: 'video:preview',
  videoDiscoverySearch: 'video:discovery:search',
  videoDiscoveryList: 'video:discovery:list',
  videoDiscoveryRights: 'video:discovery:rights',
  videoDiscoveryClips: 'video:discovery:clips',
  videoClipAnalyze: 'video:clip:analyze',
  videoClipStatus: 'video:clip:status',
  videoClipCancel: 'video:clip:cancel',
  videoClipUpdate: 'video:clip:update',
  videoClipReorder: 'video:clip:reorder',
  videoClipPreview: 'video:clip:preview',
  videoClipSendToStudio: 'video:clip:send-to-studio',
  videoIdeaList: 'video:idea:list',
  videoIdeaGenerate: 'video:idea:generate',
  videoIdeaSave: 'video:idea:save',
  videoIdeaInvestigate: 'video:idea:investigate',
  videoIdeaConvert: 'video:idea:convert',
  videoIdeaReference: 'video:idea:reference',
  videoIdeaCancel: 'video:idea:cancel',
  videoDiscoveryCancel: 'video:discovery:cancel',
  videoRadar: 'video:radar',
  videoClipThumbnail: 'video:clip:thumbnail',
  videoAudioAuthorize: 'video:audio:authorize',
  videoProductionStatus: 'video:production:status',
  videoProductionCancel: 'video:production:cancel',
  videoMotionLoad: 'video:motion:load',
  videoMotionSave: 'video:motion:save',
  videoMotionRender: 'video:motion:render',
  videoMotionStatus: 'video:motion:status',
  videoMotionCancel: 'video:motion:cancel',
  videoMotionNarrationAssets: 'video:motion:narration-assets',
  videoMotionSuggest: 'video:motion:suggest',
  videoMotionAlignCaptions: 'video:motion:align-captions',
  videoMotionSyncNarration: 'video:motion:sync-narration',
  videoMotionRuntime: 'video:motion:runtime',
  videoMotionRuntimeInstall: 'video:motion:runtime:install',
  videoMotionRuntimeCancel: 'video:motion:runtime:cancel',
  videoProductionBrief: 'video:production:brief',
  videoProductionEditorialList: 'video:production:editorial:list',
  videoProductionEditorialVersion: 'video:production:editorial:version',
  videoProductionEditorialDecision: 'video:production:editorial:decision',
  videoProductionRender: 'video:production:render',
  videoClipRender: 'video:clip:render',
  videoChannelOAuthStatus: 'video:channel:oauth-status',
  videoChannelOAuthImportClient: 'video:channel:oauth-import-client',
  videoChannelOAuthClear: 'video:channel:oauth-clear',
  videoChannelOAuthConnect: 'video:channel:oauth-connect',
  videoChannelOAuthDisconnect: 'video:channel:oauth-disconnect',
  videoChannelProfile: 'video:channel:profile',
  videoChannelBrandingApply: 'video:channel:branding-apply',
  videoChannelIdentitySave: 'video:channel:identity-save',
  videoChannelIdentityLoad: 'video:channel:identity-load',
  videoChannelPublish: 'video:channel:publish',
  videoChannelPublishStart: 'video:channel:publish-start',
  videoChannelPublications: 'video:channel:publications',
  videoChannelVideos: 'video:channel:videos',
  videoStyles: 'video:styles',
  videoStyleLoad: 'video:style:load',
  videoStyleSave: 'video:style:save',
  videoStylePreview: 'video:style:preview',
  videoCollageKeySave: 'video:collage:key:save',
  videoCollageKeyStatus: 'video:collage:key:status',
  videoCollageCreate: 'video:collage:create',
  videoCollageApproveMetaphor: 'video:collage:approve:metaphor',
  videoCollageApproveStill: 'video:collage:approve:still',
  videoCollageGenerate: 'video:collage:generate',
  videoProductionRunCreate: 'video:production-run:create',
  videoProductionRunList: 'video:production-run:list',
  videoProductionRunState: 'video:production-run:state',
  videoProductionRunPause: 'video:production-run:pause',
  videoProductionRunResume: 'video:production-run:resume',
  videoProductionRunCancel: 'video:production-run:cancel',
  videoProductionRunDecide: 'video:production-run:decide',
  videoProductionRunScript: 'video:production-run:script',
  videoProductionRunScriptRead: 'video:production-run:script-read',
  videoProductionRunResearch: 'video:production-run:research',
  videoProductionRunGameResearch: 'video:production-run:game-research',
  videoProductionRunSubjects: 'video:production-run:subjects',
  videoProductionRunMediaDiscover: 'video:production-run:media-discover',
  videoProductionRunCandidates: 'video:production-run:candidates',
  videoProductionCandidateDecide: 'video:production-run:candidate-decide',
  videoProductionRunMediaAcquire: 'video:production-run:media-acquire',
  videoProductionRunAcquisitions: 'video:production-run:acquisitions',
  videoProductionRunVisualIndex: 'video:production-run:visual-index',
  videoProductionEditorialPolicyGet: 'video:production-run:editorial-policy:get',
  videoProductionEditorialPolicySet: 'video:production-run:editorial-policy:set',
  videoProductionMediaUse: 'video:production-run:media-use',
  videoProductionMediaEditorialDecide: 'video:production-run:media-editorial-decide',
  videoProductionMatchCandidates: 'video:production-run:match-candidates',
  videoProductionRunSceneMatching: 'video:production-run:scene-matching',
  videoProductionSegmentFrame: 'video:production-run:segment-frame',
  videoChannelVoices: 'video:channel-voice:list',
  videoChannelVoiceSave: 'video:channel-voice:save',
  videoChannelVoiceAuthorize: 'video:channel-voice:authorize',
  videoChannelVoiceRevoke: 'video:channel-voice:revoke',
  videoNarrationDirections: 'video:production-run:narration-directions',
  videoNarrationDirectionSet: 'video:production-run:narration-direction-set',
  videoProductionRunNarrationVoice: 'video:production-run:narration-voice',
  videoProductionReferenceValidation: 'video:production:reference-validation',
  videoStudioCandidateThumbnail: 'video:studio:candidate-thumbnail',
  videoStudioRankingIntent: 'video:studio:ranking-intent',
  videoStudioIgdbSave: 'video:studio:igdb:save',
  videoStudioIgdbStatus: 'video:studio:igdb:status',
  videoStudioIgdbClear: 'video:studio:igdb:clear',
  videoStudioRawgSave: 'video:studio:rawg:save',
  videoStudioRawgStatus: 'video:studio:rawg:status',
  videoStudioRawgClear: 'video:studio:rawg:clear',
  videoProductionRunClaims: 'video:production-run:claims',
  videoProductionEvidenceDecide: 'video:production-run:evidence-decide',
  videoProductionClaimKind: 'video:production-run:claim-kind',
  videoProductionRunStoryboard: 'video:production-run:storyboard',
  videoAetheraProductionPlan: 'video:aethera-production:plan',
  videoAetheraProductionPlanApply: 'video:aethera-production:plan-apply',
  videoAetheraAutoProduce: 'video:aethera-auto:produce',
  videoAetheraAutoProviders: 'video:aethera-auto:providers',
  videoAetheraMusicGenerate: 'video:aethera-music:generate',
  videoStoryboardGet: 'video:storyboard:get',
  videoAetheraTimelineGet: 'video:aethera-timeline:get',
  videoAetheraTimelineCreate: 'video:aethera-timeline:create',
  videoAetheraTimelineApply: 'video:aethera-timeline:apply',
  videoAetheraTimelineRestore: 'video:aethera-timeline:restore',
  videoAetheraTimelineHistory: 'video:aethera-timeline:history',
  videoAetheraEditorialPlanGet: 'video:aethera-editorial-plan:get',
  videoAetheraEditorialPlanHistory: 'video:aethera-editorial-plan:history',
  videoAetheraEditorialPlanDirect: 'video:aethera-editorial-plan:direct',
  videoAetheraEditorialPlanApprove: 'video:aethera-editorial-plan:approve',
  videoAetheraEditorialPlanApply: 'video:aethera-editorial-plan:apply',
  videoAetheraReviewRun: 'video:aethera-review:run',
  videoAetheraReviewLatest: 'video:aethera-review:latest',
  videoAetheraReviewHistory: 'video:aethera-review:history',
  videoStoryboardCandidates: 'video:storyboard:candidates',
  videoStoryboardEdit: 'video:storyboard:edit',
  videoStoryboardSemanticEdit: 'video:storyboard:semantic-edit',
  videoStoryboardReselect: 'video:storyboard:reselect',
  videoProductionVoices: 'video:production-run:voices',
  videoProductionRunNarration: 'video:production-run:narration',
  videoProductionRunSync: 'video:production-run:sync',
  videoProductionNarrationGet: 'video:production-run:narration-get',
  videoProductionRunRender: 'video:production-run:render',
  videoProductionRenders: 'video:production-run:renders',
  videoProductionRenderRecheck: 'video:production-run:render-recheck',
  videoProductionQualityApprove: 'video:production-run:quality-approve',
  videoProductionGateApprove: 'video:production-run:gate-approve',
  videoProductionRunExport: 'video:production-run:export',
  azureDevOpsConnectionSave: 'azure-devops:connection:save',
  azureDevOpsConnectionStatus: 'azure-devops:connection:status',
  azureDevOpsProbe: 'azure-devops:probe',
  azureDevOpsProjects: 'azure-devops:projects',
  azureDevOpsRepositories: 'azure-devops:repositories',
  azureDevOpsBoards: 'azure-devops:boards',
  azureDevOpsPullRequests: 'azure-devops:pull-requests',
  azureDevOpsWorkItems: 'azure-devops:work-items',
  azureDevOpsQueryWorkItems: 'azure-devops:query-work-items',
  azureDevOpsWorkItemAttachment: 'azure-devops:work-item-attachment',
  azureDevOpsIterations: 'azure-devops:iterations',
  azureDevOpsPullRequestDetail: 'azure-devops:pull-request:detail',
  azureDevOpsPullRequestThreads: 'azure-devops:pull-request:threads',
  azureDevOpsPullRequestChanges: 'azure-devops:pull-request:changes',
  azureDevOpsOpenBrowser: 'azure-devops:open-browser',
  azureDevOpsCredentialSave: 'azure-devops:credential:save',
  azureDevOpsCredentialClear: 'azure-devops:credential:clear',
  azureDevOpsCredentialStatus: 'azure-devops:credential:status',
  azureDevOpsWritePrepare: 'azure-devops:write:prepare',
  azureDevOpsWriteExecute: 'azure-devops:write:execute',
  videoProductionDerivatives: 'video:production:derivatives',
  videoProductionDerivativesGenerate: 'video:production:derivatives:generate',
  videoProductionDerivativeDecide: 'video:production:derivative:decide',
  videoProductionDerivativeCreate: 'video:production:derivative:create',
  videoProductionDerivativesRender: 'video:production:derivatives:render',
  videoProductionDerivativesExport: 'video:production:derivatives:export',
  videoStoryboardRestore: 'video:storyboard:restore',
  videoStoryboardHistory: 'video:storyboard:history',
  videoProductionDraft: 'video:production-run:draft',
  videoProductionDraftPreview: 'video:production-run:draft-preview',
  videoCollageList: 'video:collage:list',
  videoOverlayBases: 'video:overlay:bases',
  videoOverlayTranscribe: 'video:overlay:transcribe',
  videoChannelSaveThumbnail: 'video:channel:save-thumbnail',
  videoChannelIdentityApply: 'video:channel:identity-apply',
  videoChannelIdentityApplyStatus: 'video:channel:identity-apply-status',
  videoChannelCurrentBanner: 'video:channel:current-banner',
  videoChannelVideoPreview: 'video:channel:video-preview',
  videoSaveProjectFile: 'video:save-project-file',
  videoSaveGeneratedFile: 'video:save-generated-file',
  videoChannelPublishStatus: 'video:channel:publish-status',
  videoChannelPublishCancel: 'video:channel:publish-cancel',
  videoChannelPublishResume: 'video:channel:publish-resume',
  videoChannelAgenda: 'video:channel:agenda',
  videoChannelReschedule: 'video:channel:reschedule',
  videoChannelNicheReference: 'video:channel:niche-reference',
  videoChannelOptimize: 'video:channel:optimize',
} as const;

export interface HistorySyncSettings {
  enabled: boolean;
  paused: boolean;
  pollIntervalMs: number;
  projectRoots: string[];
  excludedProjects: string[];
  excludedSessions: string[];
}

/** Main -> renderer notifications (not request/response). */
export const IpcEvent = {
  taskChanged: 'tasks:changed',
  videoProductionRunChanged: 'video:production-run:changed',
  projectDiscoveryProgress: 'projects:discover:progress',
  companionChanged: 'companion:changed',
  companionHudChanged: 'companion:hud:changed',
  spotifyChanged: 'spotify:changed',
  neuraChanged: 'neura:changed',
  neuraWake: 'neura:wake',
  companionCursor: 'companion:cursor',
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

export type ThemeSource = 'dark' | 'light' | 'system';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  electron: string;
}

export type DatabaseStatus =
  | { ok: true; file: string }
  | { ok: false; file: string; reason: 'corrupt' | 'locked' | 'disk-full' | 'migration' | 'io' | 'unknown'; recovery: 'retry' | 'restore-backup' | 'free-disk-space' | 'check-permissions' | 'export-diagnostics' };

/** The preferences file. An invalid file is kept aside (never overwritten) and defaults are used for the session. */
export type ConfigurationStatus =
  | { ok: true; file: string }
  | { ok: false; file: string; reason: 'invalid'; preservedAs: string | null; recovery: 'review-configuration' };

export interface AppStatus {
  database: DatabaseStatus;
  configuration: ConfigurationStatus;
}

/** A backup that can replace an unusable database. Only backups that pass an integrity check are restorable. */
export interface DatabaseRecoveryBackup { name: string; createdAt: string; sizeBytes: number; kind: string; valid: boolean; problem: string | null }

export type McpClientId = 'claude' | 'codex';

export interface SkillSummary {
  id: string; name: string; description: string; valid: boolean; root: string; path: string;
  source: 'claude' | 'codex' | 'agents' | 'plugin' | 'custom'; conflict: boolean; scripts: string[];
}

export interface SkillInstallPreview { skillId: string; destination: string; files: Array<{ path: string; size: number; overwrite: boolean }>; totalBytes: number; findings: Array<{ id: string; category: 'origin' | 'integrity' | 'structure' | 'permissions' | 'behavior' | 'compatibility' | 'limitations'; severity: 'info' | 'warning' | 'high' | 'critical'; status: 'verified' | 'attention' | 'risk' | 'not-verified' | 'blocked'; evidence: Array<{ kind: 'fact' | 'heuristic' | 'declared' | 'unavailable'; value: string; path?: string }>; relatedPath?: string; rule: string; result: string; limitation: string; recommendedAction: string }>; blockedBy: string[]; warnings: string[]; checks: Array<{ id: string; label: string; kind: 'automatic' | 'heuristic' | 'unverified'; severity: 'info' | 'warning' | 'high' | 'critical'; status: 'pass' | 'fail' | 'warning' | 'unknown'; detail: string }>; readOnly: true; assessmentFingerprint: string; }
export interface SkillInstallPreparation { operationId: string; skillId: string; state: string; fingerprint: string; preview: SkillInstallPreview; }
export interface SkillTransactionSummary { id: string; skillId: string; destination: string; operation: 'install' | 'update'; state: string; fingerprint: string; backupAvailable: boolean; error: string | null; updatedAt: string; }
export interface SkillStudioMetadata { name: string; description: string; objective: string; triggers: string[]; agents: Array<'claude' | 'codex'>; dependencies: string[]; permissions: string[]; examples: string[]; }
export interface SkillStudioDraftFile { path: string; content: string; }
export interface SkillStudioDraft { id: string; skillId: string; metadata: SkillStudioMetadata; instructions: string; files: SkillStudioDraftFile[]; scope: 'global' | 'project'; projectId: string | null; sourcePath: string | null; baseFingerprint: string | null; revision: number; createdAt: string; updatedAt: string; }
export interface SkillStudioTrustAssessment { skillId: string; evaluatedAt: string; ruleVersion: string; contentFingerprint: string; origin: { kind: 'local' | 'remote'; value: string; normalized: string; host: string | null; allowlisted: boolean | null }; scope: 'global' | 'project' | 'unknown'; inspectedFiles: Array<{ path: string; size: number; hash: string | null }>; findings: SkillInstallPreview['findings']; checks: SkillInstallPreview['checks']; decision: { allowed: boolean; requiresExplicitApproval: true; blockedBy: string[]; warnings: string[] }; valid: boolean; }
export interface SkillStudioValidation { valid: boolean; errors: string[]; warnings: string[]; fingerprint: string; manifest: { name: string; description: string }; trust: SkillStudioTrustAssessment; }
export interface SkillStudioEditorState { draft: SkillStudioDraft; markdown: string; validation: SkillStudioValidation | null; }
export interface SkillStudioDraftSummary { id: string; skillId: string; name: string; description: string; scope: 'global' | 'project'; projectId: string | null; revision: number; updatedAt: string; }
export interface SkillStudioVersion { id: string; skillId: string; version: number; createdAt: string; origin: 'created' | 'edited' | 'imported' | 'restored'; fingerprint: string; path: string; current: boolean; }
export interface SkillStudioChangeSet { skillId: string; fromVersionId: string; toVersionId: string; added: string[]; removed: string[]; changed: string[]; summary: string; }
export interface SkillStudioImportPreview { sourcePath: string; skillId: string; metadata: SkillStudioMetadata; files: SkillStudioDraftFile[]; totalBytes: number; validation: SkillStudioValidation; conflict: 'none' | 'existing-draft' | 'existing-published'; }
export interface SkillStudioExportResult { skillId: string; versionId: string; path: string; format: 'directory'; files: string[]; totalBytes: number; fingerprint: string; }
export interface SkillStudioSimulation { recommendations: Array<{ skillId: string; name: string; relevance: number; reasons: string[]; evidence: string[] }>; excluded: Array<{ skillId: string; name: string; reasons: string[] }>; }

/** An MCP server configured in a CLI: no command, arguments, URL or environment, which can hold keys. */
export interface McpServerInfo {
  name: string;
  transport: string | null;
  /** not_checked: the CLI lists servers without connecting to them (Codex). */
  status: 'connected' | 'failed' | 'needs_auth' | 'disabled' | 'not_checked' | 'unknown';
  detail: string | null;
}

export interface McpServerList {
  clients: { id: McpClientId; installed: boolean; servers: McpServerInfo[]; error: string | null }[];
  checkedAt: string;
}

export interface McpClientStatus {
  id: McpClientId;
  installed: boolean;
  registered: boolean;
  /** Registered with this installation's command (false = outdated path). */
  matches: boolean;
  configFile: string;
  /** Equivalent shell commands, for people who prefer to run them themselves. */
  addCommand: string;
  removeCommand: string;
  /** Set when the status check itself failed. */
  error: string | null;
}

export interface McpStatus {
  server: { command: string; args: string[]; env: Record<string, string> };
  backupDir: string;
  clients: McpClientStatus[];
}

export interface McpChangeResult {
  changed: boolean;
  backup: string | null;
}

export interface SemanticStatus {
  enabled: boolean;
  /** Model files are on disk (downloading needs the user's consent). */
  downloaded: boolean;
  model: string;
  modelsDir: string;
  /** Live memories by embedding state. */
  indexed: number;
  pending: number;
  failed: number;
}

/** API exposed to the renderer as `window.neuralbridge`. */
export interface NeuralBridgeApi {
  content: {
    channels(): Promise<ContentChannel[]>;
    ideas(workspaceId: string): Promise<ContentIdea[]>;
    createIdea(input: { id: string; workspaceId: string; channelId: string | null; title: string; angle?: string; source?: string }): Promise<ContentIdea>;
    convertIdea(input: { ideaId: string; projectId: string; videoProjectId: string | null; autonomy: AutonomyMode }): Promise<ContentProject>;
    createIdeaFromAnalytics(input: { id: string; projectId: string; title: string; angle: string }): Promise<ContentIdea>;
    library(projectId: string): Promise<ContentAsset[]>;
    createChannel(input: { id: string; workspaceId: string; name: string; autonomy: AutonomyMode; budgetUsd?: number; concurrencyLimit?: number; niche?: string; audience?: string; tone?: string; identity?: Record<string, unknown>; editorialStrategy?: Record<string, unknown> }): Promise<ContentChannel>;
    projects(workspaceId: string): Promise<ContentProject[]>;
    queue(workspaceId: string): Promise<ContentQueueItem[]>;
    createProject(input: { id: string; workspaceId: string; channelId: string | null; videoProjectId: string | null; title: string; autonomy: AutonomyMode }): Promise<ContentProject>;
    dashboard(projectId: string): Promise<{ project: ContentProject; executions: ProductionExecution[]; packages: PublicationPackage[]; publications: ContentPublication[]; approvals: PublicationApproval[]; nextAction: ProjectNextAction }>;
    savePublicationPackage(input: { id: string; projectId: string; version: number; title: string; description?: string; tags: string[]; thumbnailAssetId?: string | null }): Promise<PublicationPackage>;
    saveBrief(input: { projectId: string; brief: ContentBrief }): Promise<ContentProject>;
    saveScript(input: { projectId: string; script: ContentScript }): Promise<ContentProject>;
    generateScript(input: { projectId: string; agent?: 'claude' | 'codex' }): Promise<ContentProject>;
    analytics(projectId: string): Promise<ContentAnalyticsSnapshot[]>;
    syncAnalytics(projectId: string): Promise<ContentAnalyticsSnapshot[]>;
    saveAnalyticsSnapshot(input: ContentAnalyticsSnapshot): Promise<ContentAnalyticsSnapshot>;
    publish(input: { projectId: string; packageId: string; outputRelativePath: string; thumbnailRelativePath?: string; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null }): Promise<{ id: string; youtubeVideoId: string }>;
    approvePublicationPackage(id: string): Promise<{ approved: true }>;
    schedulePublication(input: { id: string; projectId: string; packageId: string; platform: string; visibility: 'private' | 'unlisted' | 'public'; scheduledAt: string | null; approved: true }): Promise<ContentPublication>;
    startProduction(input: { id: string; projectId: string }): Promise<ProductionExecution>;
  };
  personal: {
    accounts(): Promise<Array<{ accountId: string; provider: 'gmail' | 'calendar' | 'whatsapp'; identifier: string; scopes: string[]; state: 'disconnected' | 'connecting' | 'connected' | 'error' | 'revoked' }>>;
    disconnect(accountId: string): Promise<{ ok: true }>;
    importGoogleClient(): Promise<{ configured: true; clientId: string }>;
    connectGoogle(options?: { gmailSend?: boolean; calendarWrite?: boolean }): Promise<{ connected: true; scopes: string[] }>;
    sendMail(input: { accountId: string; to: string[]; subject: string; body: string }): Promise<{ actionId: string; status: string; message: string }>;
    createEvent(input: { accountId: string; summary: string; start: string; end: string }): Promise<{ actionId: string; status: string; message: string }>;
    decideAction(input: { actionId: string; decision: 'allow' | 'deny' | 'cancel'; decidedAt: string }): Promise<{ actionId: string; status: string; message: string }>;
    notifications(input?: { unreadOnly?: boolean }): Promise<Array<{ id: string; priority: 'low' | 'normal' | 'high' | 'urgent'; channel: string; groupKey?: string; title: string; metadata: Record<string, unknown>; dedupeKey: string; readAt?: string; createdAt: string }>>;
    readNotification(id: string): Promise<{ ok: true }>;
  };
  extensions: {
    list(): Promise<InstalledExtension[]>;
    install(sourcePath: string): Promise<InstalledExtension>;
    enable(id: string): Promise<InstalledExtension>;
    disable(id: string): Promise<InstalledExtension>;
    update(sourcePath: string): Promise<InstalledExtension>;
    rollback(id: string): Promise<InstalledExtension>;
    uninstall(id: string): Promise<{ removed: true }>;
  };
  companion: {
    listSessions(query?: { activeOnly?: boolean; newestFirst?: boolean; limit?: number; offset?: number }): Promise<CompanionSessionPage>;
    getSession(sessionId: string): Promise<CompanionSession | null>;
    getEvents(query: { sessionId: string; newestFirst?: boolean; limit?: number; offset?: number }): Promise<CompanionEventPage>;
    subscribe(filter: CompanionEventFilter, listener: (event: CompanionEvent) => void): Promise<{ subscriptionId: string; cancel(): Promise<void> }>;
    unsubscribe(subscriptionId: string): Promise<{ ok: true }>;
    setHudMode(mode: CompanionHudMode): Promise<{ ok: true }>;
    setHudVisibility(visible: boolean): Promise<{ ok: true }>;
    setHudPinned(alwaysOnTop: boolean): Promise<{ ok: true }>;
    resetHudPosition(): Promise<{ ok: true }>;
    getHudState(): Promise<CompanionHudState>;
    dragHud(phase: CompanionHudDragPhase): Promise<{ ok: true }>;
    setHudInteractive(interactive: boolean): Promise<{ ok: true }>;
    openHudPanel(): Promise<{ ok: true }>;
    openSettings(): Promise<{ ok: true }>;
    onHudState(listener: (state: CompanionHudState) => void): () => void;
    /** The pointer relative to the HUD window, also outside it: the mascot's eyes follow it. */
    onCursor(listener: (point: { x: number; y: number }) => void): () => void;
  };
  spotify: {
    status(): Promise<SpotifyStatus>;
    configure(changes: SpotifyConfigure): Promise<SpotifyStatus>;
    /** Opens the browser and resolves once the user has answered, or the attempt has failed. */
    connect(): Promise<SpotifyStatus>;
    cancelConnect(): Promise<{ ok: true }>;
    disconnect(): Promise<SpotifyStatus>;
    control(control: SpotifyControl): Promise<SpotifyStatus>;
    devices(): Promise<SpotifyDevice[]>;
    openTrack(): Promise<{ ok: true }>;
    onChange(listener: (status: SpotifyStatus) => void): () => void;
  };
  neura: {
    startVoice(input: VoiceStartInput): Promise<VoiceSession>;
    stopVoice(input: VoiceStopInput): Promise<{ ok: true }>;
    startMeeting(input: MeetingStartInput): Promise<MeetingSession>;
    stopMeeting(input: MeetingStopInput): Promise<{ ok: true }>;
    decideSuggestion(input: SuggestionDecision): Promise<Suggestion>;
    copySuggestion(input: { suggestionId: string }): Promise<Suggestion>;
    meetingAudio(input: NeuraMeetingAudio): Promise<{ ok: true }>;
    spotifyCommand(input: SpotifyCommand): Promise<SpotifyCommandResult>;
    pauseAll(): Promise<NeuraPauseResult>;
    resume(): Promise<NeuraState>;
    speechFinished(): Promise<{ ok: true }>;
    voiceAudio(input: NeuraVoiceAudio): Promise<{ ok: true }>;
    speak(input: NeuraSpeechInput): Promise<NeuraSpeechResult>;
    state(): Promise<NeuraState>;
    input(input: NeuraInput): Promise<NeuraResponse>;
    addMeetingTranscript(input: MeetingTranscriptInput): Promise<{ ok: true }>;
    decideAction(input: NeuraActionDecision): Promise<NeuraResponse>;
    settings(): Promise<NeuraSettings>;
    updateSettings(changes: NeuraSettingsPatch): Promise<NeuraSettings>;
    clearHistory(): Promise<{ removed: number }>;
    onChange(listener: (state: NeuraState) => void): () => void;
    onWake(listener: () => void): () => void;
  };
  app: {
    info(): Promise<AppInfo>;
    status(): Promise<AppStatus>;
    openMissionControl(): Promise<{ ok: true }>;
    /** Safe retry: restarts the app so every service reopens the database from scratch. */
    relaunch(): Promise<{ ok: true }>;
    /** Writes a redacted diagnostics report under the data folder and returns its path. */
    exportDiagnostics(): Promise<{ file: string }>;
  };
  /** Real-time performance monitoring (lote 50.08): samples newer than `since`, static info and per-source status. */
  monitoring: {
    snapshot(since?: number): Promise<MonitorSnapshot>;
    configure(intervalMs: MonitoringInterval): Promise<{ intervalMs: MonitoringInterval }>;
  };
  /** CORE-07: Singularity Core status, remote access (Tailscale serve) and paired devices. */
  core: {
    status(): Promise<CoreRemoteStatus>;
    setRemote(enabled: boolean): Promise<CoreRemoteStatus>;
    startPairing(grant: Grant): Promise<CorePairingOffer>;
    pairings(): Promise<CorePendingPairing[]>;
    decidePairing(pairingId: string, decision: 'approve' | 'reject'): Promise<{ ok: true }>;
    devices(): Promise<CoreDevice[]>;
    revoke(target: { target: 'device'; deviceId: string } | { target: 'all' }): Promise<{ revoked: string[] }>;
    /** CORE-08: process figures and the standalone (logon) mode. */
    runtime(): Promise<CoreRuntime>;
    setStandalone(enabled: boolean): Promise<CoreRuntime>;
  };
  databaseRecovery: {
    backups(): Promise<DatabaseRecoveryBackup[]>;
    /** Only while the database is unavailable: the current files are moved aside, never deleted, then the app restarts. */
    restore(name: string): Promise<{ preservedAs: string }>;
  };
  theme: {
    get(): Promise<ThemeSource>;
    set(source: ThemeSource): Promise<ThemeSource>;
  };
  mcp: {
    status(): Promise<McpStatus>;
    register(client: McpClientId): Promise<McpChangeResult>;
    registerAlias(client: McpClientId): Promise<McpChangeResult>;
    unregister(client: McpClientId): Promise<McpChangeResult>;
    /** MCP servers configured in each CLI, from their own `mcp list`; cached for five minutes unless refresh. */
    servers(refresh?: boolean): Promise<McpServerList>;
  };
  brain: {
    overview(): Promise<BrainOverview>;
    search(input: BrainSearchInput): Promise<SearchResult>;
    list(filter: ListFilter): Promise<Page<MemorySummary>>;
    get(id: string): Promise<MemoryDetail | null>;
    versions(id: string): Promise<MemoryVersion[]>;
    store(input: StoreInput): Promise<{ memory: Memory; created: boolean; changed: boolean }>;
    /** Soft delete unless hard is true (permanent). */
    delete(id: string, hard: boolean): Promise<{ deleted: true }>;
    setConfidence(id: string, confidence: 'unverified' | 'reviewed' | 'stale'): Promise<{ confidence: 'unverified' | 'reviewed' | 'stale' }>;
    /** Checks the memory's file evidence; a missing or changed file makes it stale. */
    revalidate(id: string): Promise<{ confidence: 'unverified' | 'reviewed' | 'stale'; findings: EvidenceCheck[] }>;
    projects(): Promise<ProjectRef[]>;
    tags(): Promise<TagCount[]>;
    graph(): Promise<BrainGraph>;
    /** Snapshot for the 3D brain (memory facts and resolved links). */
    graph3d(): Promise<Brain3DGraph>;
    /** Calculated similarity between memories, or why it is unavailable. */
    similarity(): Promise<BrainSimilarity>;
    /** Memory Galaxy snapshot (lote 50.06): memory facts, links and stored embeddings for the layout worker. */
    galaxy(): Promise<GalaxySnapshot>;
    /** Access-log rows after `since` (ISO time): who recalled or found which memory. */
    activity(since: string): Promise<BrainActivityEntry[]>;
    settings(): Promise<BrainSettings>;
    saveSettings(settings: BrainSettings): Promise<BrainSettings>;
    /** Learning proposals, newest first; all statuses when none is given. */
    learning(status?: LearningStatus): Promise<LearningCandidate[]>;
    approveLearning(id: string, edits?: { title?: string; content?: string; type?: MemoryType; tags?: string[] }): Promise<{ memoryId: string }>;
    rejectLearning(id: string): Promise<{ ok: true }>;
    backups(): Promise<BackupInfo[]>;
    createBackup(): Promise<BackupInfo>;
    /** Replaces the brain with a listed backup; the current state is backed up first. */
    restoreBackup(name: string): Promise<{ safetyBackup: BackupInfo }>;
    applyRetention(): Promise<RetentionResult>;
    /** Opens a save dialog; null when cancelled. */
    exportBrain(format: 'json' | 'markdown'): Promise<{ count: number; path: string } | null>;
    /** Opens a file dialog; null when cancelled. */
    importBrain(): Promise<ImportResult | null>;
  };
  projects: {
    list(): Promise<ProjectSummary[]>;
    /** Opens the system folder picker; null when cancelled. */
    pick(): Promise<string | null>;
    /** Proposes what to register under a folder; reads only and saves nothing. */
    discover(path: string): Promise<DiscoveryReport>;
    cancelDiscovery(): Promise<{ ok: true }>;
    confirmDiscovery(root: string, choices: DiscoveryChoice[]): Promise<{ created: string[]; linked: string[] }>;
    onDiscoveryProgress(listener: (scanned: number) => void): () => void;
    /** Changes only the link between projects; no file moves. */
    move(id: string, parentId: string | null): Promise<{ ok: true }>;
    setKind(id: string, kind: ProjectKind): Promise<{ ok: true }>;
    gitState(): Promise<Record<string, { branch: string | null; own: boolean }>>;
    create(input: { name: string; parent: string; technology: 'node' | 'dotnet' | 'python' | 'java' | 'rust' | 'go' | 'other'; parentProjectId: string | null; allowNested: boolean }): Promise<{ id: string }>;
    clone(input: { url: string; parent: string; name: string; parentProjectId: string | null }): Promise<{ id: string }>;
    initGit(id: string, allowNested: boolean): Promise<{ ok: true }>;
    add(path: string): Promise<ProjectDetail>;
    get(id: string): Promise<ProjectDetail>;
    refresh(id: string): Promise<ProjectDetail>;
    update(id: string, changes: ProjectUpdate): Promise<ProjectDetail>;
    impact(id: string): Promise<{ memories: number }>;
    remove(id: string): Promise<{ removed: true; memories: number }>;
    diff(id: string, path?: string, commit?: string): Promise<{ text: string; truncated: boolean }>;
    /** Added and removed lines per tracked file against HEAD. */
    lineStats(id: string): Promise<{ path: string; added: number; removed: number }[]>;
    /** The last technical profile (Phase 21), or null before the first. */
    profile(id: string): Promise<ProjectProfile | null>;
    /** Updates the file index by delta and rebuilds the profile. */
    refreshProfile(id: string): Promise<ProjectProfile>;
    /** Indexes new commits of the project's local branches (read-only). */
    indexGit(id: string): Promise<GitIndexReport & { isRepo: boolean }>;
    searchGit(id: string, query: string): Promise<GitSearchHit[]>;
    commitRelations(id: string, hash: string): Promise<CommitRelations>;
    history(id: string, cursor?: string): Promise<GitHistory>;
    compare(id: string, left: string, right: string, mode: 'direct' | 'merge-base'): Promise<GitRefComparison>;
    syncStatus(id: string): Promise<GitSyncStatus>;
    workingTree(id: string): Promise<GitWorkingTreeFile[]>;
    authorize(id: string, operation: string, parameters: Record<string, string | string[]>): Promise<{ token: string; expiresAt: string }>;
    authorizePatch(id: string, patch: string): Promise<{ token: string; expiresAt: string }>;
    applyPatch(id: string, patch: string, token: string): Promise<{ ok: true }>;
    stage(id: string, paths: string[], token: string): Promise<{ ok: true }>;
    unstage(id: string, paths: string[], token: string): Promise<{ ok: true }>;
    branches(id: string): Promise<GitBranchInfo[]>;
    createBranch(id: string, name: string, token: string): Promise<{ ok: true }>;
    switchBranch(id: string, name: string, token: string): Promise<{ ok: true }>;
    renameBranch(id: string, oldName: string, newName: string, token: string): Promise<{ ok: true }>;
    deleteBranch(id: string, name: string, token: string): Promise<{ ok: true }>;
    stashes(id: string): Promise<GitStashInfo[]>;
    createStash(id: string, message: string, includeUntracked: boolean, token: string): Promise<{ ok: true }>;
    applyStash(id: string, ref: string, pop: boolean, token: string): Promise<{ ok: true }>;
    dropStash(id: string, ref: string, token: string): Promise<{ ok: true }>;
    commit(id: string, message: string, token: string): Promise<{ ok: true }>;
    push(id: string, remote: string | undefined, token: string): Promise<{ ok: true }>;
    operationState(id: string): Promise<{ operation: 'revert' | 'cherry-pick' | null; conflicts: string[] }>;
    revert(id: string, commit: string, mainline: number | undefined, token: string): Promise<{ ok: true }>;
    cherryPick(id: string, commit: string, mainline: number | undefined, token: string): Promise<{ ok: true }>;
    resolveOperation(id: string, operation: 'revert' | 'cherry-pick', action: 'continue' | 'abort', token: string): Promise<{ ok: true }>;
    file(id: string, path: string): Promise<{ ok: true; content: string } | { ok: false; reason: string }>;
  };
  analytics: {
    /** Token diagnostics (Phase 22) over provider-reported usage in the period. */
    tokens(period: '24h' | '7d' | '30d' | 'all'): Promise<TokenReport>;
    /** Per-task token budget. */
    budget(): Promise<number>;
    /** Saves the budget; applies to tasks started from now on. */
    saveBudget(tokenBudget: number): Promise<number>;
  };
  agents: {
    /** Cached for a minute unless refresh is true. */
    status(refresh?: boolean): Promise<AgentStatus[]>;
  };
  skills: {
    recommend(input: { taskDescription: string; agent?: 'claude' | 'codex'; projectId?: string }): Promise<Array<{ skillId: string; name: string; reasons: string[]; relevance: number; conflictWarnings: string[] }>>;
    usage(): Promise<Array<{ skillId: string; used: number; loaded: number; failed: number; injected: number; lastAt: string }>>; list(): Promise<SkillSummary[]>; settings(): Promise<{ allowlistedHosts: string[]; preferences: Array<{ skillId: string; taskTypes: string[]; agents: Array<'claude' | 'codex'>; enabled: boolean }> }>; saveSettings(settings: { allowlistedHosts: string[]; preferences: Array<{ skillId: string; taskTypes: string[]; agents: Array<'claude' | 'codex'>; enabled: boolean }> }): Promise<unknown>; install(source: string, approved: boolean): Promise<{ path: string }>; update(source: string, approved: boolean): Promise<{ path: string }>; prepareInstall(input: { skillId: string; source: string; scope: 'global' | 'project'; agent?: 'claude' | 'codex' }): Promise<SkillInstallPreparation>; installPreview(operationId: string): Promise<SkillInstallPreview>; confirmInstall(operationId: string): Promise<SkillTransactionSummary>; installStatus(operationId: string): Promise<SkillTransactionSummary>; cancelInstall(operationId: string): Promise<SkillTransactionSummary>; rollbackInstall(operationId: string): Promise<SkillTransactionSummary>; installHistory(): Promise<SkillTransactionSummary[]>; installRecovery(): Promise<SkillTransactionSummary[]>; studio: { drafts(): Promise<SkillStudioDraftSummary[]>; create(input: { skillId: string; metadata: SkillStudioMetadata; instructions: string; files?: SkillStudioDraftFile[]; scope: 'global' | 'project'; projectId?: string | null }): Promise<SkillStudioEditorState>; open(input: { skillId: string; scope: 'global' | 'project'; projectId?: string | null }): Promise<SkillStudioEditorState>; get(draftId: string): Promise<SkillStudioEditorState>; save(input: { draftId: string; expectedRevision: number; metadata: SkillStudioMetadata; instructions: string; files: SkillStudioDraftFile[] }): Promise<SkillStudioEditorState>; validate(draftId: string): Promise<SkillStudioValidation>; publish(draftId: string): Promise<SkillStudioVersion>; versions(skillId: string): Promise<SkillStudioVersion[]>; compare(input: { skillId: string; fromVersionId: string; toVersionId: string }): Promise<SkillStudioChangeSet>; restore(input: { skillId: string; versionId: string; expectedFingerprint?: string | null }): Promise<SkillStudioVersion>; importPreview(sourcePath: string): Promise<SkillStudioImportPreview>; import(input: { sourcePath: string }): Promise<SkillStudioEditorState>; export(input: { skillId: string; versionId: string }): Promise<SkillStudioExportResult>; simulate(input: { draftId: string; taskDescription: string; projectId?: string; stack?: string[]; agent?: 'claude' | 'codex'; taskType?: string; workflowStep?: string; limit?: number }): Promise<SkillStudioSimulation>; } };
  historySync: { settings(): Promise<HistorySyncSettings>; saveSettings(settings: HistorySyncSettings): Promise<{ ok: true }>; status(): Promise<{ lastRun: string | null; sessions: number; proposals: number; errors: number; running: boolean }>; run(): Promise<{ lastRun: string | null; sessions: number; proposals: number; errors: number; running: boolean }> };
  importedConversations: { list(): Promise<ImportedConversationSummary[]> };
  tasks: {
    start(input: TaskStartInput): Promise<{ id: string }>;
    /** Starts a structured, read-only Git review through the existing TaskEngine. */
    startGitReview(input: GitReviewStartInput): Promise<{ id: string }>;
    /** Returns the persisted report once the review task has produced one. */
    gitReview(id: string): Promise<GitReviewReport | null>;
    /** Generates an editable staged-diff commit/PR proposal through the existing TaskEngine. */
    startSmartCommit(input: SmartCommitStartInput): Promise<{ id: string }>;
    smartCommit(id: string): Promise<SmartCommitReport | null>;
    /** Continues a task in the same conversation: same project and mode, agents resume their sessions. */
    resume(id: string, prompt: string, images?: ImageUpload[]): Promise<{ id: string }>;
    /** An attached image of a task as a data URL (index in the task's images). */
    image(id: string, index: number): Promise<string>;
    approve(id: string): Promise<{ ok: true }>;
    /** Phase 26: starts a bounded, approved automatic fix of a failed project task; returns the new task. */
    heal(id: string): Promise<{ id: string }>;
    cancel(id: string): Promise<{ ok: true }>;
    pause(id: string): Promise<{ ok: true }>;
    resumePaused(id: string): Promise<{ ok: true }>;
    /** Tries a task waiting for agent capacity now. */
    retryCapacity(id: string): Promise<{ ok: true }>;
    setCapacityAutoResume(id: string, enabled: boolean): Promise<{ ok: true }>;
    /** Opens a file the task changed with its default app, or shows it in its folder; only inside the task's project. */
    outputFile(id: string, path: string, action: 'open' | 'reveal'): Promise<{ ok: true }>;
    list(filter: TaskListFilter): Promise<TaskSummary[]>;
    get(id: string): Promise<TaskDetail>;
    thread(id: string): Promise<TaskDetail[]>;
    /** Names the conversation a task belongs to; an empty title goes back to the first request. */
    renameThread(id: string, title: string): Promise<{ ok: true }>;
    /** Deletes the whole conversation a task belongs to, with its steps, logs and token records. */
    deleteThread(id: string): Promise<{ deleted: number }>;
    models(): Promise<KnownModels>;
    swarmPlan(prompt: string, tokenBudget?: number): Promise<{ roles: string[]; rationale: string[]; maxParallel: number; requiresHumanApproval: boolean; handoffs: Array<{ role: string; dependsOn: string[]; readOnly: boolean; output: string }> }>;
    swarmRun(prompt: string, projectId: string | null, approved: boolean, tokenBudget?: number): Promise<{ taskIds: string[]; roles: string[]; results: Array<{ role: string; taskId: string; status: string; summary: string | null; error: string | null; filesChanged: string[] }>; conflicts: string[] }>;
    /** Called whenever a task changes; returns a function that stops listening. */
    onChanged(listener: (change: TaskChanged) => void): () => void;
  };
  workflows: {
    list(projectId?: string): Promise<WorkflowSummary[]>;
    get(id: string): Promise<{ id: string; definition: WorkflowDefinition; version: number; layout: string | null; updatedAt: string }>;
    save(id: string | undefined, definition: WorkflowDefinition): Promise<{ id: string; version: number }>;
    delete(id: string): Promise<{ ok: true }>;
    run(id: string, approved: boolean, inputs?: Record<string, string>): Promise<{ runId: string }>;
    steps(runId: string): Promise<Array<{ stepId: string; status: string; taskId: string | null; error: string | null }>>;
    automations(projectId: string): Promise<Array<{ id: string; name: string; workflowId: string; trigger: { refs?: string[] | undefined; pathGlobs?: string[] | undefined; kinds?: string[] | undefined }; enabled: boolean; hourlyLimit: number }>>;
    saveAutomation(input: { id?: string; projectId: string; workflowId: string; name: string; trigger: { refs?: string[]; pathGlobs?: string[] }; hourlyLimit?: number }): Promise<{ id: string }>;
    toggleAutomation(id: string, enabled: boolean): Promise<{ ok: true }>;
    deleteAutomation(id: string): Promise<{ ok: true }>;
    automationEvents(id: string): Promise<Array<{ id: string; kind: string; ref: string | null; commitHash: string | null; status: string; reason: string | null; runId: string | null; createdAt: string }>>;
    /** Runs a workflow over a commit or branch a person chose; editing steps still wait for approval. */
    runFromGit(input: { workflowId: string; ref?: string; hash?: string; base?: string; head?: string }): Promise<{ runId: string }>;
    approveStep(runId: string, stepId: string): Promise<{ ok: true }>;
    rejectStep(runId: string, stepId: string): Promise<{ ok: true }>;
    /** Answers a step the coordinator would not decide alone, such as an edit interrupted half way. */
    decideStep(runId: string, stepId: string, choice: 'retry' | 'skip' | 'abort'): Promise<{ ok: true }>;
    runs(workflowId?: string): Promise<WorkflowRunSummary[]>;
    pause(runId: string): Promise<{ ok: true }>;
    resume(runId: string): Promise<{ ok: true }>;
    cancel(runId: string): Promise<{ ok: true }>;
    templates(): Promise<Array<{ id: string; version: number; name: string; category: string; description: string; requirements: string[]; source: string }>>;
    instantiateTemplate(templateId: string, projectId: string | null): Promise<{ templateId: string; version: number; definition: WorkflowDefinition }>;
    favoriteTemplate(templateId: string, favorite: boolean): Promise<{ ok: true }>;
    exportTemplate(templateId: string): Promise<string>;
    importTemplate(payload: string): Promise<{ id: string; version: number }>;
    saveLayout(id: string, layout: string): Promise<{ ok: true }>;
    timeline(runId: string): Promise<Array<{ sequence: number; completed: string[]; pending: string[]; recoveryMeta: Record<string, unknown>; createdAt: string }>>;
  };
  video: {
    /** The project that holds every video; `rootPath` is null when none is chosen or its folder is gone. */
    settings(): Promise<{ projectId: string | null; rootPath: string | null; agent: 'claude' | 'codex' }>;
    saveSettings(projectId: string | null, agent?: 'claude' | 'codex'): Promise<{ projectId: string | null; rootPath: string | null; agent: 'claude' | 'codex' }>;
    /** Creates the folder of one video inside the Video project. */
    prepare(input: { name: string; kind: 'tema' | 'projeto' }): Promise<{ folder: string }>;
    /** Asks an agent, read-only, for video topics in a niche. */
    topics(niche: string): Promise<string[]>;
    /** Asks Claude to search the web; it reads pages only, and nothing is saved until the user approves. */
    research(topic: string): Promise<VideoReference[]>;
    /** Prepares the folder of the video, downloads the approved images and writes pesquisa/fontes.md. */
    saveResearch(input: { name: string; kind: 'tema' | 'projeto'; items: VideoReference[] }): Promise<{ folder: string; saved: number; failed: number }>;
    /** An agent reads the target project, read-only, and proposes how to open it; nothing runs. */
    capturePlan(targetId: string): Promise<VideoCapturePlan>;
    /** Runs the confirmed command in the target project, captures its screens and stops it. */
    capture(input: { targetId: string; name: string; plan: VideoCapturePlan; size: { width: number; height: number }; confirmed: true }): Promise<{ saved: string[]; failed: string[] }>;
    prints(name: string): Promise<Array<{ file: string; image: string }>>;
    removePrint(name: string, file: string): Promise<{ ok: true }>;
    /** Claude usage, from a minimal run; the answer is kept for a few minutes unless `refresh` is set. */
    /** Usage of an agent's CLI (Claude when omitted): what the Aethera's agent card shows and what gates Claude work. */
    limits(refresh: boolean, agent?: 'claude' | 'codex'): Promise<VideoLimits>;
    studioList(): Promise<string[]>;
    studioLoad(name: string): Promise<VideoStudioState>;
    studioSave(input: { name: string; narration?: string; data?: string }): Promise<{ ok: true }>;
    /** An agent writes narration and scenes, read-only; the app saves them in the folder of the video. */
    studioGenerate(input: { name: string; kind: 'tema' | 'projeto'; brief: string; seconds: number }): Promise<VideoStudioState & { generation: { agent: 'claude' | 'codex'; model: string | null; executionId: string | null; generatedAt: string } }>;
    /** Transcribes the voice and moves the scenes to the spoken words. */
    studioSync(name: string): Promise<{ missed: number }>;
    studioPreview(input: { name: string; data: string; time: number }): Promise<string>;
    studioRender(input: { name: string; data: string; quality: 'draft' | 'final' }): Promise<{ id: string }>;
    studioOutput(name: string): Promise<string>;
    narrationStatus(name: string): Promise<VoiceStudioStatus & { asset: NarrationAsset | null; timeline: NarrationTimeline | null }>;
    narrationGenerate(input: { name: string; text: string; modelId: string; voiceId: string; format: 'mp3' | 'wav'; language?: string; speed?: number; license: NarrationLicenseState }): Promise<NarrationAsset>;
    narrationPreview(input: { name: string; assetId?: string }): Promise<string>;
    narrationTimeline(input: { name: string; timeline: NarrationTimeline }): Promise<{ ok: true }>;
    /** The MotionVelix kit installed on this machine, with the scenes the app can render directly. */
    kit(): Promise<{ installed: boolean; path: string; version: string | null; templates: Array<{ id: string; label: string; defaultData: string }>; downloaderVersion: string | null }>;
    /** Downloads one video into `imports/` under the root; the job shares renderStatus and renderCancel. */
    importVideo(input: { root: string; url: string; quality: 1080 | 720 | 480 | 360 | 'mp3'; confirmed: true }): Promise<{ id: string; status: string; error: string | null; origin: 'studio' | 'chat'; agent: 'auto' | 'claude' | 'codex' | null; progress: number | null; output: string | null }>;
    /** Stills of a scene as PNG data URLs. */
    frames(root: string, template: string, data: string): Promise<string[]>;
    render(input: { root: string; outputPath: string; template: string; data: string; audioPath?: string; quality?: 'draft' | 'final'; origin?: 'studio' | 'chat'; agent?: 'auto' | 'claude' | 'codex' }): Promise<{ id: string; status: string; error: string | null; origin: 'studio' | 'chat'; agent: 'auto' | 'claude' | 'codex' | null; progress: number | null; output: string | null }>;
    renderStatus(id: string): Promise<{ id: string; status: string; error: string | null; origin: 'studio' | 'chat'; agent: 'auto' | 'claude' | 'codex' | null; progress: number | null; output: string | null } | null>;
    renderCancel(id: string): Promise<{ id: string; status: string; error: string | null }>;
    renderJobs(): Promise<Array<{ id: string; status: string; error: string | null; origin: 'studio' | 'chat'; agent: 'auto' | 'claude' | 'codex' | null; createdAt: string; updatedAt: string }>>;
    preview(root: string, outputPath: string): Promise<string>;
    discoverySearch(input: { projectId: string; query: string; provider: 'youtube' | 'rss'; feedUrl?: string; pageToken?: string; filters?: VideoDiscoveryFilters }): Promise<{ status: string; reason: string | null; nextPageToken?: string | null; cached?: boolean; results: Array<{ id?: string; url: string; title: string; publisher: string; publishedAt: string | null; kind: string }> }>;
    discoveryCancel(projectId: string): Promise<{ cancelled: boolean }>;
    radar(input: { projectId: string; days: number }): Promise<VideoRadarView>;
    clipThumbnail(input: { projectId: string; sourceRelativePath: string; time: number }): Promise<string>;
    audioAuthorize(input: { projectId: string; relativePath: string; evidence: string; owner: string; license: string; credit?: string }): Promise<{ id: string }>;
    productionStatus(projectId: string): Promise<VideoProductionStatus>;
    productionCancel(projectId: string): Promise<{ cancelled: boolean }>;
    motionRuntime(): Promise<VideoMotionRuntime>;
    motionRuntimeInstall(): Promise<{ ok: true }>;
    motionRuntimeCancel(): Promise<{ cancelled: boolean }>;
    motionLoad(projectId: string): Promise<MotionProject | null>;
    motionSave(input: { projectId: string; project: MotionProject }): Promise<{ ok: true }>;
    motionRender(input: { projectId: string; scriptVersionId: string; audioRelativePath?: string }): Promise<{ id: string }>;
    motionStatus(id: string): Promise<{ id: string; status: string; progress: number; outputPath: string | null; error: string | null } | null>;
    motionCancel(id: string): Promise<{ cancelled: boolean }>;
    motionSuggest(input: { projectId: string; scriptVersionId: string; agent: 'claude' | 'codex' }): Promise<{ scenes: MotionSceneV2[]; agent: string; model: string | null; executionId: string | null }>;
    motionAlignCaptions(input: { projectId: string; audioRelativePath: string; captions: MotionProject['captions'] }): Promise<{ captions: MotionProject['captions']; missed: number }>;
    motionSyncNarration(input: { projectId: string; scriptVersionId: string; audioRelativePath: string; project: MotionProject }): Promise<{ project: MotionProject; missedCaptions: string[]; missedScenes: string[] }>;
    motionNarrationAssets(projectId: string): Promise<NarrationAsset[]>;
    channelOAuthStatus(): Promise<{ configured: boolean; connected: boolean; canWrite: boolean; persistent: boolean; clientId: string | null }>;
    channelOAuthImportClient(): Promise<{ configured: true; clientId: string }>;
    channelOAuthClear(): Promise<{ cleared: true }>;
    channelOAuthConnect(input?: { write?: boolean }): Promise<{ connected: true; scopes: string[] }>;
    channelOAuthDisconnect(): Promise<{ disconnected: true; revoked: boolean }>;
    channelProfile(): Promise<{ id: string; title: string; handle: string | null; brandingSettings: unknown }>;
    channelBrandingApply(input: { brandingSettings: Record<string, unknown>; confirmed: true }): Promise<{ applied: true }>;
    channelIdentitySave(input: { projectId: string; identity: BrandIdentity }): Promise<{ saved: true }>;
    channelIdentityLoad(projectId: string): Promise<BrandIdentity | null>;
    channelPublish(input: { projectId: string; outputRelativePath: string; thumbnailRelativePath?: string; title: string; description: string; tags: string[]; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null; confirmed: true }): Promise<{ id: string; youtubeVideoId: string }>;
    channelPublishStart(input: { projectId: string; outputRelativePath: string; thumbnailRelativePath?: string; title: string; description: string; tags: string[]; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null; confirmed: true }): Promise<{ id: string }>;
    channelPublications(projectId: string): Promise<PublishDraft[]>;
    channelVideos(projectId: string): Promise<Array<{ relativePath: string; size: number; modifiedAt: string }>>;
    channelIdentityApply(input: { projectId: string; banner?: { imageBase64: string }; watermark?: { imageBase64: string; position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' }; description?: string; keywords?: string }): Promise<{ id: string }>;
    channelIdentityApplyStatus(id: string): Promise<{ status: 'running' | 'completed' | 'failed'; progress: number; step: string; done: string[]; error: string | null } | null>;
    channelCurrentBanner(): Promise<string | null>;
    styles(): Promise<VideoStyle[]>;
    styleLoad(input: { projectId: string; video: string }): Promise<{ choice: ProductionStyleChoice | null; own: boolean }>;
    styleSave(input: { projectId: string; video: string; choice: ProductionStyleChoice | null }): Promise<{ saved: true }>;
    stylePreview(input: { video: string; styleId: string; data: string; times: number[] }): Promise<string[]>;
    collageKeySave(apiKey: string): Promise<{ ok: true }>;
    collageKeyStatus(): Promise<{ configured: boolean }>;
    collageCreate(input: { projectId: string; prompt: string; durationSeconds: number; aspectRatio: '16:9' | '9:16' }): Promise<{ id: string; estimatedCostUsd: number; approvalText: string; status: string }>;
    collageApproveMetaphor(id: string): Promise<{ id: string; status: string; stillPath: string | null }>;
    collageApproveStill(id: string): Promise<{ id: string; status: string }>;
    collageGenerate(id: string): Promise<{ id: string; status: string; clipPath: string | null; rightsReferenceId: string | null }>;
    collageList(projectId: string): Promise<unknown[]>;
    productionRunCreate(input: { projectId: string; brief: ProductionBrief; estimatedCostUsd?: number }): Promise<ProductionState>;
    productionRunList(projectId: string): Promise<ProductionRunView[]>;
    productionRunState(runId: string): Promise<ProductionState>;
    productionRunPause(runId: string): Promise<ProductionState>;
    productionRunResume(runId: string): Promise<ProductionState>;
    productionRunCancel(runId: string): Promise<ProductionState>;
    productionRunDecide(input: { stageId: string; decision: 'approved' | 'rejected'; note?: string }): Promise<ProductionState>;
    onProductionRunChanged(listener: (change: { runId: string }) => void): () => void;
    productionRunScript(input: { runId: string; agent?: 'claude' | 'codex'; chapterWords?: number; lockedChapters?: number[] }): Promise<ProductionState>;
    productionRunScriptRead(runId: string): Promise<ProductionScript | null>;
    productionRunResearch(input: { runId: string; agent?: 'claude' | 'codex' }): Promise<ProductionState>;
    /** AS-03: researches games by title or by release period (IGDB first, RAWG and the web to confirm). */
    productionRunGameResearch(input: { runId: string; titles?: string[]; period?: { from: string; to: string }; count?: number; web?: boolean }): Promise<ProductionState>;
    productionRunSubjects(runId: string): Promise<VerifiedSubject[]>;
    /** AS-04: finds trailers and gameplay for the researched games (IGDB videos and yt-dlp search, no API key). */
    productionRunMediaDiscover(input: { runId: string; search?: boolean }): Promise<ProductionState>;
    productionRunCandidates(runId: string): Promise<SourceCandidate[]>;
    productionCandidateDecide(input: { candidateId: string; status: 'selected' | 'proposed' | 'rejected' }): Promise<SourceCandidate>;
    productionRunMediaAcquire(input: { runId: string; candidateIds?: string[] }): Promise<ProductionState>;
    productionRunAcquisitions(runId: string): Promise<MediaAcquisitionJob[]>;
    /** AS-05: starts the persisted visual-index stage for acquired media. */
    productionRunVisualIndex(runId: string): Promise<ProductionState>;
    /** AP-02: third-party editorial use of the run's video project (off unless decided), never a licence. */
    productionEditorialPolicyGet(runId: string): Promise<EditorialUsePolicy | null>;
    productionEditorialPolicySet(input: { runId: string; enabled: boolean; note: string }): Promise<EditorialUsePolicy>;
    productionMediaUse(runId: string): Promise<AcquiredMediaUseView[]>;
    productionMediaEditorialDecide(input: { runId: string; assetId: string; decision: 'approved' | 'rejected'; note: string }): Promise<AcquiredMediaUseView[]>;
    productionMatchCandidates(runId: string): Promise<MatchReviewCandidate[]>;
    /** AP-02: matches the storyboard's sentences with indexed cuts (a durable stage). */
    productionRunSceneMatching(runId: string): Promise<ProductionState>;
    /** AP-02: one frame of an acquired asset at a time, as a data URL, so a person can judge a proposed cut. */
    productionSegmentFrame(input: { runId: string; assetId: string; atMs: number }): Promise<{ dataUrl: string } | null>;
    /** Aethera channel voice: designed presets of the run's project, each with its authorization status against the provider's licence now. */
    channelVoices(runId: string): Promise<ChannelVoiceView[]>;
    channelVoiceSave(input: { runId: string; preset: Omit<VoicePreset, 'schemaVersion' | 'projectId' | 'createdAt'> }): Promise<ChannelVoiceView[]>;
    channelVoiceAuthorize(input: { runId: string; presetId: string; scope: 'noncommercial' | 'commercial'; note: string }): Promise<ChannelVoiceView[]>;
    channelVoiceRevoke(input: { runId: string; presetId: string }): Promise<ChannelVoiceView[]>;
    narrationDirections(runId: string): Promise<NarrationDirection[]>;
    narrationDirectionSet(input: { runId: string; sceneId: string; speed?: number; pauseAfterMs?: number; clear?: boolean }): Promise<NarrationDirection[]>;
    productionRunNarrationVoice(input: { runId: string; presetId: string; speed?: number }): Promise<ProductionState>;
    /** AS-10: reads the external reference evidence without writing or downloading anything. */
    productionReferenceValidation(root: string): Promise<AetheraReferenceValidationReport>;
    studioCandidateThumbnail(candidateId: string): Promise<{ dataUrl: string | null }>;
    studioRankingIntent(input: { runId: string; request: string }): Promise<RankingIntent>;
    studioIgdbSave(input: { clientId: string; clientSecret: string }): Promise<{ ok: true }>;
    studioIgdbStatus(): Promise<{ configured: boolean; clientIdHint: string | null }>;
    studioIgdbClear(): Promise<{ ok: true }>;
    studioRawgSave(apiKey: string): Promise<{ ok: true }>;
    studioRawgStatus(): Promise<{ configured: boolean }>;
    studioRawgClear(): Promise<{ ok: true }>;
    productionRunClaims(runId: string): Promise<ProductionClaims>;
    productionEvidenceDecide(input: { evidenceId: string; decision: 'approved' | 'rejected'; note?: string }): Promise<ProductionClaims>;
    productionClaimKind(input: { claimId: string; kind: ClaimKind }): Promise<ProductionClaims>;
    productionRunStoryboard(runId: string): Promise<ProductionState>;
    aetheraProductionPlan(command: string): Promise<AetheraProductionPlan>;
    aetheraProductionPlanApply(input: { runId: string; plan: AetheraProductionPlan }): Promise<ProductionState>;
    aetheraAutoProduce(input: { projectId: string; prompt: string }): Promise<ProductionState>;
    aetheraAutoProviders(): Promise<{ providers: { id: 'claude' | 'codex' | 'antigravity'; available: boolean; reason?: string }[] }>;
    aetheraMusicGenerate(input: AceStepMusicGenerationInput): Promise<AceStepMusicGenerationResult>;
    storyboardGet(runId: string): Promise<StoryboardView | null>;
    aetheraTimelineGet(runId: string): Promise<AetheraTimelineVersion | null>;
    aetheraTimelineCreate(input: { runId: string; document: TimelineDocument }): Promise<AetheraTimelineVersion>;
    aetheraTimelineApply(input: { runId: string; baseVersion: number; ops: TimelineOp[]; command?: string }): Promise<AetheraTimelineVersion>;
    aetheraTimelineRestore(input: { runId: string; baseVersion: number; version: number }): Promise<AetheraTimelineVersion>;
    aetheraTimelineHistory(runId: string): Promise<AetheraTimelineVersion[]>;
    /** Smart Director: the editorial plan is written by the AI director, approved only by a person, executed on the timeline as a new version. */
    aetheraEditorialPlanGet(runId: string): Promise<EditorialPlanView | null>;
    aetheraEditorialPlanHistory(runId: string): Promise<EditorialPlanView[]>;
    aetheraEditorialPlanDirect(input: { runId: string; context?: string }): Promise<EditorialPlanView>;
    aetheraEditorialPlanApprove(input: { runId: string; version: number; hash: string; approvedBy: string }): Promise<EditorialPlanView>;
    aetheraEditorialPlanApply(input: { runId: string; baseVersion: number }): Promise<{ timeline: AetheraTimelineVersion; gaps: Array<{ segmentId: string; message: string }>; fallbacks: Array<{ segmentId: string; from: string; to: string }> }>;
    aetheraReviewRun(input: { runId: string; requestedCycles?: number }): Promise<AetheraReviewReportRecord>;
    aetheraReviewLatest(runId: string): Promise<AetheraReviewReportRecord | null>;
    aetheraReviewHistory(runId: string): Promise<AetheraReviewReportRecord[]>;
    storyboardCandidates(input: { runId: string; sceneId: string }): Promise<StoryboardCandidateView[]>;
    storyboardEdit(input: { runId: string; baseVersion: number; edit: StoryboardEdit }): Promise<StoryboardView>;
    storyboardSemanticEdit(input: { runId: string; baseVersion: number; command: string }): Promise<SemanticEditResult>;
    storyboardReselect(input: { runId: string; baseVersion: number }): Promise<StoryboardView>;
    productionVoices(): Promise<VoiceStudioStatus>;
    productionRunNarration(input: { runId: string; modelId: string; voiceId: string; language?: string; speed?: number; license: NarrationLicenseState }): Promise<ProductionState>;
    productionRunSync(runId: string): Promise<ProductionState>;
    productionNarrationGet(runId: string): Promise<ProductionNarrationView>;
    productionRunRender(input: { runId: string; formatId: 'youtube-long' | 'youtube-short' | 'instagram-reels' | 'tiktok' | 'square' }): Promise<ProductionState>;
    productionRenders(runId: string): Promise<ProductionRendersView>;
    productionRenderRecheck(input: { runId: string; renderArtifactId: string }): Promise<ProductionRendersView>;
    productionQualityApprove(input: { runId: string; renderArtifactId: string; checkId: string; note: string }): Promise<ProductionRendersView>;
    productionGateApprove(input: { runId: string; renderArtifactId: string; gate: 'editorial' | 'publication'; note: string }): Promise<ProductionRendersView>;
    productionRunExport(input: { runId: string; renderArtifactId: string }): Promise<ProductionState>;
    productionDerivatives(runId: string): Promise<ProductionDerivative[]>;
    productionDerivativesGenerate(input: { runId: string; formatId?: 'youtube-short' | 'instagram-reels' | 'tiktok' }): Promise<ProductionDerivative[]>;
    productionDerivativeDecide(input: { id: string; decision: 'approved' | 'rejected' }): Promise<ProductionDerivative[]>;
    productionDerivativeCreate(input: { id: string }): Promise<{ childRunId: string; derivatives: ProductionDerivative[] }>;
    productionDerivativesRender(runId: string): Promise<{ scheduled: number; derivatives: ProductionDerivative[] }>;
    productionDerivativesExport(runId: string): Promise<{ scheduled: number; derivatives: ProductionDerivative[] }>;
    storyboardRestore(input: { runId: string; baseVersion: number; version: number }): Promise<StoryboardView>;
    storyboardHistory(runId: string): Promise<Array<{ version: number; source: 'generated' | 'edit' | 'sync' | 'restore' | 'matching'; createdAt: string; op: string | null }>>;
    productionDraft(input: { runId: string; formatId: 'youtube-long' | 'youtube-short' | 'instagram-reels' | 'tiktok' | 'square' }): Promise<ProductionState>;
    productionDraftPreview(runId: string): Promise<{ url: string; storyboardVersion: number; formatId: string } | null>;
    overlayBases(projectId: string): Promise<Array<{ relativePath: string; title: string }>>;
    overlayTranscribe(input: { projectId: string; video: string }): Promise<{ words: number; duration: number }>;
    channelSaveThumbnail(input: { projectId: string; title: string; imageBase64: string }): Promise<{ relativePath: string }>;
    channelVideoPreview(input: { projectId: string; relativePath: string }): Promise<string>;
    saveProjectFile(input: { projectId: string; relativePath: string }): Promise<{ saved: boolean }>;
    saveGeneratedFile(input: { fileName: string; dataBase64: string }): Promise<{ saved: boolean }>;
    channelPublishStatus(id: string): Promise<{ id: string; status: string; progress: number; error: string | null } | null>;
    channelPublishCancel(id: string): Promise<{ cancelled: boolean }>;
    channelPublishResume(id: string): Promise<{ id: string; youtubeVideoId: string }>;
    channelAgenda(projectId: string): Promise<AgendaItem[]>;
    channelReschedule(input: { projectId: string; videoId: string; publishAt: string | null; confirmed: true }): Promise<{ rescheduled: true }>;
    channelNicheReference(input: { projectId: string; query: string }): Promise<{ query: string; quotaCost: number; titles: string[]; totalResults: number }>;
    channelOptimize(input: { projectId: string; query: string; referenceTitles: string[]; agent: 'claude' | 'codex' }): Promise<OptimizerSuggestion>;
    discoveryList(projectId: string): Promise<{ searches: unknown[]; references: unknown[]; rights: unknown[]; clips: unknown[]; analyses: unknown[] }>;
    discoveryRights(input: { projectId: string; referenceId: string; status: 'verified_allowed' | 'conditional' | 'unverified' | 'blocked'; owner: string; license: string; evidence?: string | null; verifiedAt?: string | null; credit?: string | null; restrictions?: string[] }): Promise<{ id: string }>;
    discoveryClips(projectId: string): Promise<unknown[]>;
    clipAnalyze(input: { projectId: string; relativePath: string; evidence: string }): Promise<{ id: string; status: string }>;
    clipStatus(id: string): Promise<{ id: string; status: string; progress: number; error: string | null; analysis: unknown } | null>;
    clipCancel(id: string): Promise<{ id: string; status: string }>;
    clipUpdate(input: { projectId: string; id: string; start?: number; end?: number; accepted?: boolean; favorite?: boolean }): Promise<{ ok: true }>;
    clipReorder(input: { projectId: string; ids: string[] }): Promise<{ ok: true }>;
    clipPreview(input: { projectId: string; sourceRelativePath: string; start: number; end: number }): Promise<string>;
    clipSendToStudio(input: { projectId: string; sourceRelativePath: string }): Promise<{ ok: true; name: string; added: number }>;
    ideaList(projectId: string): Promise<VideoIdeaView[]>;
    ideaGenerate(input: { projectId: string; niche: string; mode: 'generate' | 'more' | 'surprise'; agent: 'claude' | 'codex' }): Promise<VideoIdeaView[]>;
    ideaSave(input: { projectId: string; id: string }): Promise<{ ok: true }>;
    ideaInvestigate(input: { projectId: string; id: string; agent: 'claude' | 'codex' }): Promise<{ added: number; rejected: number; agent: string; model: string | null; executionId: string | null }>;
    ideaReference(input: { projectId: string; id: string; decision: 'approved' | 'rejected' }): Promise<{ ok: true }>;
    ideaCancel(projectId: string): Promise<{ cancelled: boolean }>;
    ideaConvert(input: { projectId: string; id: string; name: string }): Promise<{ folder: string; references: number; versionId: string }>;
    productionBrief(input: { mode: 'commentary' | 'news'; topic: string; style?: string; rankingCriteria?: string; clips?: Array<{ source: string; start: number; end: number; rights: 'verified_allowed' | 'conditional' | 'unverified' | 'blocked' }>; items?: Array<{ title: string; url: string; publisher: string; publishedAt: string | null; claimType: 'confirmed' | 'allegation' | 'unverified' }> }): Promise<{ mode: 'commentary' | 'news'; brief: string; clips: unknown[]; references: unknown[] }>;
    productionEditorialList(projectId: string): Promise<{ ideas: unknown[]; versions: unknown[]; decisions: unknown[] }>;
    productionEditorialVersion(input: { projectId: string; ideaId?: string; sourceVersionId?: string; kind: 'brief' | 'script'; content: string; agent?: 'claude' | 'codex'; model?: string; executionId?: string; generatedAt?: string }): Promise<{ id: string; version: number }>;
    productionEditorialDecision(input: { projectId: string; versionId: string; decision: 'approved' | 'rejected'; note?: string }): Promise<{ ok: true }>;
    productionRender(input: { projectId: string; name: string; scriptVersionId: string; data: string; quality: 'draft' | 'final'; mode: 'commentary' | 'news'; references?: string[]; sourceRelativePath?: string; clipIds?: string[]; transition?: 'cut' | 'fade'; positionCards?: boolean; musicRelativePath?: string; musicVolume?: number }): Promise<{ id: string }>;
    clipRender(input: { projectId: string; sourceRelativePath: string; clips: Array<{ start: number; end: number }>; evidence: string; narrationRelativePath?: string; narrationOffset?: number; narrationVolume?: number; originalVolume?: number; outputRelativePath?: string }): Promise<{ id: string; status: string }>;
  };
  /** Azure DevOps / TFS integration (core). Kept apart from the Velix `video` facade, which is an extension. */
  azureDevOps: {
    azureDevOpsConnectionSave(input: AzureDevOpsConnectionInput): Promise<{ id: string; status: AzureDevOpsConnectionStatus }>;
    azureDevOpsConnectionStatus(id: string): Promise<{ id: string; baseUrl: string; collection: string; project: string; status: AzureDevOpsConnectionStatus; readOnly: boolean; capabilities: AzureDevOpsCapabilities | null; updatedAt: string } | null>;
    azureDevOpsProbe(id: string): Promise<{ status: AzureDevOpsConnectionStatus; capabilities: AzureDevOpsCapabilities }>;
    azureDevOpsProjects(id: string): Promise<AzureDevOpsProject[]>;
    azureDevOpsRepositories(id: string): Promise<AzureDevOpsRepository[]>;
    azureDevOpsBoards(id: string): Promise<Array<{ id: string; name: string; url: string | null }>>;
    azureDevOpsPullRequests(input: { id: string; repositoryId: string; status?: string }): Promise<AzureDevOpsPullRequest[]>;
    azureDevOpsWorkItems(input: { id: string; ids: number[] }): Promise<Array<{ id: number; title: string; description: string | null; state: string; type: string; assignedTo: string | null; parentId: number | null; url: string | null; originalEstimate: number | null; remainingWork: number | null; completedWork: number | null; commits: Array<{ id: string; message: string; url: string | null }>; attachments: Array<{ id: string; name: string; contentType: string | null; size: number | null }> }>>;
    azureDevOpsQueryWorkItems(input: { id: string; type: string; iterationPath?: string | null; parentId?: number | null }): Promise<Array<{ id: number; title: string; description: string | null; state: string; type: string; assignedTo: string | null; parentId: number | null; url: string | null; originalEstimate: number | null; remainingWork: number | null; completedWork: number | null; commits: Array<{ id: string; message: string; url: string | null }>; attachments: Array<{ id: string; name: string; contentType: string | null; size: number | null }> }>>;
    azureDevOpsWorkItemAttachment(input: { id: string; workItemId: number; attachmentId: string }): Promise<{ name: string; contentType: string; data: string }>;
    azureDevOpsIterations(id: string): Promise<Array<{ id: string; name: string; path: string | null; startDate: string | null; finishDate: string | null; state: string | null }>>;
    azureDevOpsPullRequestDetail(input: { id: string; repositoryId: string; pullRequestId: number }): Promise<AzureDevOpsPullRequestDetail>;
    azureDevOpsPullRequestThreads(input: { id: string; repositoryId: string; pullRequestId: number }): Promise<AzureDevOpsPullRequestThread[]>;
    azureDevOpsPullRequestChanges(input: { id: string; repositoryId: string; pullRequestId: number }): Promise<AzureDevOpsPullRequestChange[]>;
    azureDevOpsOpenBrowser(id: string): Promise<{ opened: true }>;
    azureDevOpsCredentialSave(input: { id: string; token: string }): Promise<{ saved: true }>;
    azureDevOpsCredentialClear(id: string): Promise<{ cleared: true }>;
    azureDevOpsCredentialStatus(id: string): Promise<{ configured: boolean }>;
    azureDevOpsWritePrepare(input: { id: string; request: AzureDevOpsWriteRequest }): Promise<AzureDevOpsWriteDraft>;
    azureDevOpsWriteExecute(input: { id: string; operationId: string }): Promise<{ approved: false } | { approved: true; result: { id: number } | { id: number; url: string | null } | { pullRequestId: number; status: string } }>;
  };
  semantic: {
    status(): Promise<SemanticStatus>;
    /** Downloads the model if needed; call only after the user confirmed. */
    enable(): Promise<SemanticStatus>;
    disable(): Promise<SemanticStatus>;
  };
}

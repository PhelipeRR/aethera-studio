import { contextBridge, ipcRenderer } from 'electron';
import '../../../../packages/desktop-shared/src/preload/index.js';

contextBridge.exposeInMainWorld('aetheraBridge', {
  getStatus: () => ipcRenderer.invoke('aethera:status'),
  produceFromPrompt: (prompt: string) => ipcRenderer.invoke('aethera:produce', prompt),
  planCalendar: (prompt: string) => ipcRenderer.invoke('aethera:plan-calendar', prompt),
  planRevisionCommand: (instruction: string) => ipcRenderer.invoke('aethera:revise-command', instruction),
  pairPeer: (targetApp: 'orchestrator' | 'void') => ipcRenderer.invoke('aethera:pair-peer', targetApp),
  cinemaCapabilities: () => ipcRenderer.invoke('cinema:capabilities'),
  // Configurações → Fontes de mídia. Secrets go main-ward only; responses carry masked hints.
  mediaSourcesList: () => ipcRenderer.invoke('media-sources:list'),
  mediaSourcesSaveSettings: (input: {
    providers?: Record<string, { enabled?: boolean; priority?: number }>;
    allowEditorialPromotionalUse?: boolean;
    commercialUse?: boolean;
  }) => ipcRenderer.invoke('media-sources:save-settings', input),
  mediaSourcesSaveCredential: (input: { provider: string; values: Record<string, string> }) =>
    ipcRenderer.invoke('media-sources:save-credential', input),
  mediaSourcesClearCredential: (input: { provider: string }) =>
    ipcRenderer.invoke('media-sources:clear-credential', input),
  mediaSourcesTest: (input: { provider: string }) => ipcRenderer.invoke('media-sources:test', input),
  // Long agent runs: inactivity window / optional ceiling, live runs and manual skip/cancel of one agent.
  agentExecutionGetSettings: () => ipcRenderer.invoke('agent-execution:get-settings'),
  agentExecutionSaveSettings: (input: { inactivityTimeoutMinutes?: number; editorialMaxDurationMinutes?: number | null }) =>
    ipcRenderer.invoke('agent-execution:save-settings', input),
  agentRunsList: (projectId?: string) => ipcRenderer.invoke('agent-execution:list-runs', projectId),
  agentRunStop: (input: { runId: string; mode?: 'skip' | 'cancel' }) => ipcRenderer.invoke('agent-execution:stop-run', input),
  cinemaProduce: (input: Record<string, unknown>) => ipcRenderer.invoke('cinema:produce', input),
  cinemaExportOtio: (projectId: string) => ipcRenderer.invoke('cinema:export-otio', projectId),
  cinemaRepair: (projectId: string) => ipcRenderer.invoke('cinema:repair', projectId),
  cinemaRunBenchmark: () => ipcRenderer.invoke('cinema:benchmark'),
  cinemaRenderRealMp4: (input: {
    projectId: string;
    injectRealBlackFrameDefect?: boolean;
    useNvenc?: boolean;
    deliveryPresetId?: string;
    exportPresetIds?: string[];
    renderTarget?: 'preview' | 'master';
    previewProfile?: 'draft_540p' | 'review_720p' | 'master_1080p' | 'master_4k';
  }) => ipcRenderer.invoke('cinema:render-real-mp4', input),
  cinemaProbeRealMp4: (input: { filePath: string; targetLufs?: number }) =>
    ipcRenderer.invoke('cinema:probe-real-mp4', input),
  cinemaUpdateTimeline: (input: { projectId: string; clips: unknown[] }) =>
    ipcRenderer.invoke('cinema:update-timeline', input),
  cinemaListProjects: () => ipcRenderer.invoke('cinema:list-projects'),
  cinemaInspectDeleteProject: (projectId: string) => ipcRenderer.invoke('cinema:inspect-delete-project', projectId),
  cinemaDeleteProject: (projectId: string) => ipcRenderer.invoke('cinema:delete-project', projectId),
  cinemaListStagedJobs: () => ipcRenderer.invoke('cinema:list-staged-jobs'),
  cinemaExtractWaveform: (input: { filePath: string; buckets?: number }) =>
    ipcRenderer.invoke('cinema:extract-waveform', input),
  cinemaExtractThumbnail: (input: { filePath: string; timeSec?: number }) =>
    ipcRenderer.invoke('cinema:extract-thumbnail', input),
  trendRadarSearch: (input: {
    config: unknown;
    sessionId?: string;
    appendMore?: boolean;
    refresh?: boolean;
  }) => ipcRenderer.invoke('trend-radar:search', input),
  trendRadarListSessions: () => ipcRenderer.invoke('trend-radar:list-sessions'),
  trendRadarGenerateBriefing: (input: {
    sessionId: string;
    ideaId: string;
    alternativeApproach?: boolean;
  }) => ipcRenderer.invoke('trend-radar:generate-briefing', input),
  trendRadarRefineBriefing: (input: {
    sessionId: string;
    ideaId: string;
    instruction: string;
    updatedFields?: Record<string, unknown>;
  }) => ipcRenderer.invoke('trend-radar:refine-briefing', input),
  cinemaLoadProject: (projectId: string) => ipcRenderer.invoke('cinema:load-project', projectId),
  cinemaImportMedia: (input?: { filePath?: string }) =>
    ipcRenderer.invoke('cinema:import-media', input),
  cinemaListLibrary: () => ipcRenderer.invoke('cinema:list-library'),
  cinemaEvolutionSnapshot: (input?: { refresh?: boolean }) =>
    ipcRenderer.invoke('cinema:evolution-snapshot', input),
  cinemaSubmitFeedback: (input: { text: string; projectId?: string; genre?: string }) =>
    ipcRenderer.invoke('cinema:submit-feedback', input),
  cinemaToggleMemory: (input: { memoryId: string; action: 'disable' | 'rollback' | 'delete' }) =>
    ipcRenderer.invoke('cinema:toggle-memory', input),
  cinemaRunDirectorsDag: (input: { projectId?: string; prompt: string; genre?: string }) =>
    ipcRenderer.invoke('cinema:run-directors-dag', input),
  cinemaAcademySnapshot: () => ipcRenderer.invoke('cinema:academy-snapshot'),
  cinemaAcademyIngest: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:academy-ingest', input),
  cinemaAcademyRunExercise: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:academy-run-exercise', input),
  cinemaAcademyAsk: (input: { question: string; directorFilter?: string }) =>
    ipcRenderer.invoke('cinema:academy-ask', input),
  cinemaAcademyReprocess: () => ipcRenderer.invoke('cinema:academy-reprocess'),
  cinemaAcademyDeleteMaterial: (input: { materialId: string }) =>
    ipcRenderer.invoke('cinema:academy-delete-material', input),
  cinemaAcademyExportBackup: () => ipcRenderer.invoke('cinema:academy-export-backup'),
  cinemaAcademyRestoreBackup: () => ipcRenderer.invoke('cinema:academy-restore-backup'),
  systemEstimateBackup: () => ipcRenderer.invoke('aethera:system-backup-estimate'),
  systemInspectBackup: (input?: { filePath?: string }) =>
    ipcRenderer.invoke('aethera:system-backup-inspect', input),
  systemExportBackup: (input?: { allowIncomplete?: boolean }) =>
    ipcRenderer.invoke('aethera:system-backup-export', input),
  systemRestoreBackup: (input?: {
    filePath?: string;
    sections?: Record<string, boolean>;
    conflictMode?: 'rename' | 'skip' | 'overwrite';
  }) => ipcRenderer.invoke('aethera:system-backup-restore', input),
  cinemaCalendarSnapshot: (input?: { timezone?: string }) =>
    ipcRenderer.invoke('cinema:calendar-snapshot', input),
  cinemaCalendarUpsertEvent: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:calendar-upsert-event', input),
  cinemaCalendarMoveEvent: (input: {
    id: string;
    targetDateIso: string;
    targetKind?: 'planned' | 'scheduled';
    reason?: string;
  }) => ipcRenderer.invoke('cinema:calendar-move-event', input),
  cinemaCalendarDeleteEvent: (input: { id: string }) =>
    ipcRenderer.invoke('cinema:calendar-delete-event', input),
  cinemaCalendarSchedulePlatform: (input: { id: string; publishAtIso: string }) =>
    ipcRenderer.invoke('cinema:calendar-schedule-platform', input),
  cinemaCalendarUpsertSeries: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:calendar-upsert-series', input),
  cinemaCalendarGenerateSeries: (input: { seriesId: string; weeksAhead?: number }) =>
    ipcRenderer.invoke('cinema:calendar-generate-series', input),
  cinemaUpdateAudioMix: (input: {
    projectId: string;
    stems: Array<{ stemRole: string; targetGainDb?: number; muted?: boolean; duckingUnderVoiceDb?: number }>;
    targetLufs?: number;
  }) => ipcRenderer.invoke('cinema:update-audio-mix', input),
  cinemaUpdateColorPlan: (input: {
    projectId: string;
    ffmpegColorFilterChain: string;
    targetSpace?: 'rec709' | 'rec2020_hdr' | 'srgb_web';
  }) => ipcRenderer.invoke('cinema:update-color-plan', input),
  cinemaApplyPromptRevision: (input: { projectId: string; instruction: string; selectedClipId?: string }) =>
    ipcRenderer.invoke('cinema:apply-prompt-revision', input),
  cinemaUpdateScript: (input: {
    projectId: string;
    treatment?: string;
    beats?: Array<{ beatId: string; summary?: string }>;
  }) => ipcRenderer.invoke('cinema:update-script', input),
  cinemaStartStagedProduction: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:start-staged-production', input),
  cinemaReviseStagedProduction: (input: { projectId: string; instruction: string }) =>
    ipcRenderer.invoke('cinema:revise-staged-production', input),
  cinemaListVoices: () => ipcRenderer.invoke('cinema:list-voices'),
  cinemaCancelProduction: (projectId: string) => ipcRenderer.invoke('cinema:cancel-production', projectId),
  cinemaResumeProduction: (projectId: string) => ipcRenderer.invoke('cinema:resume-production', projectId),
  cinemaGetProductionState: (projectId: string) => ipcRenderer.invoke('cinema:get-production-state', projectId),
  cinemaResolvePendingMedia: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:resolve-pending-media', input),
  cinemaReviewGroundingEvidence: (input: {
    projectId: string;
    candidateId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }) => ipcRenderer.invoke('cinema:review-grounding-evidence', input),
  cinemaUpdateColorGrade: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:update-color-grade', input),
  cinemaNleOp: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:nle-op', input),
  onCinemaProductionProgress: (listener: (job: unknown) => void) => {
    const wrapped = (_event: unknown, job: unknown) => listener(job);
    ipcRenderer.on('cinema:production-progress', wrapped);
    return () => ipcRenderer.removeListener('cinema:production-progress', wrapped);
  },
  /** Console of ONE production job (jobId). `projectId` is still accepted for logs written before jobs existed. */
  cinemaConsoleList: (input: {
    jobId?: string;
    projectId?: string;
    limit?: number;
    offset?: number;
    tail?: boolean;
    attempt?: number;
    severity?: 'info' | 'warn' | 'error' | 'debug';
    stage?: string;
    origin?: string;
    channel?: string;
    event?: string;
    source?: string;
    search?: string;
    since?: string;
    until?: string;
  }) => ipcRenderer.invoke('cinema:console-list', input),
  /** General console: every job merged in emission order. */
  cinemaConsoleListAll: (input: Record<string, unknown> = {}) => ipcRenderer.invoke('cinema:console-list-all', input),
  cinemaConsoleJobs: () => ipcRenderer.invoke('cinema:console-jobs'),
  cinemaConsoleFacets: (jobId: string) => ipcRenderer.invoke('cinema:console-facets', jobId),
  cinemaConsoleExport: (input: { jobId?: string; projectId?: string; format: 'json' | 'txt' }) =>
    ipcRenderer.invoke('cinema:console-export', input),
  cinemaConsoleExportAll: (input: { format: 'json' | 'txt'; jobIds?: string[] }) =>
    ipcRenderer.invoke('cinema:console-export-all', input),
  cinemaConsoleClear: (jobId: string) => ipcRenderer.invoke('cinema:console-clear', jobId),
  ttsListProviders: () => ipcRenderer.invoke('tts:list-providers'),
  ttsListVoices: (providerId: string) => ipcRenderer.invoke('tts:list-voices', providerId),
  ttsHealthCheck: (providerId: string) => ipcRenderer.invoke('tts:health-check', providerId),
  ttsGetPreviewUrl: (input: { providerId: string; voiceId: string }) =>
    ipcRenderer.invoke('tts:get-preview-url', input),
  ttsGetCapabilities: (providerId: string) => ipcRenderer.invoke('tts:get-capabilities', providerId),
  ttsElevenLabsSaveCredentials: (credentials: { apiKey: string; modelId?: string }) =>
    ipcRenderer.invoke('tts:elevenlabs-save-credentials', credentials),
  ttsElevenLabsClearCredentials: () => ipcRenderer.invoke('tts:elevenlabs-clear-credentials'),
  onCinemaConsoleLog: (listener: (entry: unknown) => void) => {
    const wrapped = (_event: unknown, entry: unknown) => listener(entry);
    ipcRenderer.on('cinema:console-log', wrapped);
    return () => ipcRenderer.removeListener('cinema:console-log', wrapped);
  },
  creativeEngines: () => ipcRenderer.invoke('creative:engines'),
  creativeListBrandKits: () => ipcRenderer.invoke('creative:list-brand-kits'),
  creativeSaveBrandKit: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:save-brand-kit', input),
  creativeListProjects: (artType?: string) => ipcRenderer.invoke('creative:list-projects', artType),
  creativeLoadProject: (projectId: string) => ipcRenderer.invoke('creative:load-project', projectId),
  creativeCreateFromPrompt: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:create-from-prompt', input),
  creativeGenerateBatch: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:generate-batch', input),
  creativeGenerationHistory: (limit?: number) => ipcRenderer.invoke('creative:generation-history', limit),
  creativeRegenerate: (id: string) => ipcRenderer.invoke('creative:regenerate', id),
  creativeThumbnailLab: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:thumbnail-lab', input),
  creativeCombineConcepts: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:combine-concepts', input),
  creativeTypographyLab: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:typography-lab', input),
  creativeEditLayer: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:edit-layer', input),
  creativeExport: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:export', input),
  creativeApprove: (input: { projectId: string; approvedBy: string }) => ipcRenderer.invoke('creative:approve', input),
  creativeAestheticDecision: (input: { projectId: string; decision: 'approved' | 'rejected'; reviewer: string; notes?: string }) =>
    ipcRenderer.invoke('creative:aesthetic-decision', input),
  creativeEvaluateTechnical: (projectId: string) => ipcRenderer.invoke('creative:evaluate-technical', projectId),
  creativeApprovalStatus: (projectId: string) => ipcRenderer.invoke('creative:approval-status', projectId),
  creativeIngestFile: (input: { sourcePath: string; kind: string }) => ipcRenderer.invoke('creative:ingest-file', input),
  creativeAiStatus: () => ipcRenderer.invoke('creative:ai-status'),
  creativeImageEngineStatus: () => ipcRenderer.invoke('creative:image-engine-status'),
  creativeInstallLora: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:install-lora', input),
  creativeCancelGeneration: () => ipcRenderer.invoke('creative:cancel-generation'),
  creativeReleaseImageMemory: () => ipcRenderer.invoke('creative:release-image-memory'),
  creativeUpscaleProjectBackground: (input: { projectId: string; model: string }) => ipcRenderer.invoke('creative:upscale-project-background', input),
  creativeImageEngineSettings: () => ipcRenderer.invoke('creative:image-engine-settings'),
  creativeSaveImageEngineSettings: (input: Record<string, unknown>) => ipcRenderer.invoke('creative:save-image-engine-settings', input),
  recapGetReadiness: (input?: { chapterId?: string }) => ipcRenderer.invoke('recap:get-readiness', input),
  recapGetMotionVelixStatus: () => ipcRenderer.invoke('recap:get-motionvelix-status'),
  recapPlanRevision: (input: { prompt: string; script: unknown; availablePanelIds?: string[] }) => ipcRenderer.invoke('recap:plan-revision', input),
  recapSelectArchives: () => ipcRenderer.invoke('recap:select-archives'),
  recapStartProduction: (input: Record<string, unknown>) => ipcRenderer.invoke('recap:start-production', input),
  recapApprovePreview: (input: { runId: string }) => ipcRenderer.invoke('recap:approve-preview', input),
  recapSaveSceneEdit: (input: { runId: string; sceneId: string; narrationText: string }) => ipcRenderer.invoke('recap:save-scene-edit', input),
  recapRegenerateScene: (input: { runId: string; sceneId: string }) => ipcRenderer.invoke('recap:regenerate-scene', input),
  recapRegenerateScript: (input: { runId: string; invalidateCache?: boolean }) => ipcRenderer.invoke('recap:regenerate-script', input),
  recapMemoryListProjects: () => ipcRenderer.invoke('recap:memory-list-projects'),
  recapMemoryCreateProject: (input: { workTitle: string; projectId?: string; originalLanguage?: string; narrationLanguage?: string; defaultScriptStyle?: string }) => ipcRenderer.invoke('recap:memory-create-project', input),
  recapMemoryLoadProject: (projectId: string) => ipcRenderer.invoke('recap:memory-load-project', projectId),
  recapMemoryCorrectCharacter: (input: { projectId: string; characterId: string; primaryName: string; nameStatus?: string; addAliases?: string[]; reason?: string }) => ipcRenderer.invoke('recap:memory-correct-character', input),
  recapMemoryMergeCharacters: (input: { projectId: string; primaryCharacterId: string; secondaryCharacterId: string }) => ipcRenderer.invoke('recap:memory-merge-characters', input),
  recapMemoryResolveUpdate: (input: { projectId: string; updateId: string; decision: 'approved' | 'rejected' }) => ipcRenderer.invoke('recap:memory-resolve-update', input),
  recapImportAnalyze: (input: { url: string }) => ipcRenderer.invoke('recap:import-analyze', input),
  recapImportCreateJob: (input: { urls: string[]; forceReimport?: boolean }) => ipcRenderer.invoke('recap:import-create-job', input),
  recapImportGetJob: (id: string) => ipcRenderer.invoke('recap:import-get-job', id),
  recapImportCancelJob: (id: string) => ipcRenderer.invoke('recap:import-cancel-job', id),
  recapImportRetryJob: (id: string) => ipcRenderer.invoke('recap:import-retry-job', id),
  recapImportCdnDirect: (input: { imageUrls: string[]; chapterPageUrl: string; workTitle?: string; chapterNumber?: string }) => ipcRenderer.invoke('recap:import-cdn-direct', input),
  recapFirecrawlStatus: () => ipcRenderer.invoke('recap:firecrawl-status'),
  recapFirecrawlConfig: (input: { apiUrl?: string; enabled?: boolean }) => ipcRenderer.invoke('recap:firecrawl-config', input),
  recapOpenInBrowser: (input: { url: string }) => ipcRenderer.invoke('recap:open-in-browser', input),
  recapPickAssistedSources: (input?: { mode?: 'files' | 'folder' }) => ipcRenderer.invoke('recap:pick-assisted-sources', input),
  recapImportAssisted: (input: {
    paths: string[];
    workTitle: string;
    chapterNumber?: string;
    sourceUrl?: string;
    seriesProjectId?: string;
  }) => ipcRenderer.invoke('recap:import-assisted', input),
  recapInteractiveStart: (input: { urls: string[]; workTitle?: string; seriesProjectId?: string }) =>
    ipcRenderer.invoke('recap:interactive-start', input),
  recapInteractiveStatus: (sessionId: string) => ipcRenderer.invoke('recap:interactive-status', sessionId),
  recapInteractiveCancel: (sessionId: string) => ipcRenderer.invoke('recap:interactive-cancel', sessionId),
  recapInteractiveCloseSession: (input: { url: string }) => ipcRenderer.invoke('recap:interactive-close-session', input),
  recapInteractiveClearProfile: (input: { url: string }) => ipcRenderer.invoke('recap:interactive-clear-profile', input),
  recapLibraryList: () => ipcRenderer.invoke('recap:library-list'),
  recapVerifyArchive: (input: { archivePath: string }) => ipcRenderer.invoke('recap:verify-archive', input),
  recapMergeChapterArchives: (input: { archivePaths: string[]; workTitle?: string }) =>
    ipcRenderer.invoke('recap:merge-chapter-archives', input),
  recapListProjects: () => ipcRenderer.invoke('recap:list-projects'),
  recapLoadProject: (runId: string) => ipcRenderer.invoke('recap:load-project', runId),
  recapDeleteProject: (runId: string) => ipcRenderer.invoke('recap:delete-project', runId),
  onRecapProductionProgress: (listener: (event: unknown) => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on('recap:production-progress', wrapped);
    return () => ipcRenderer.removeListener('recap:production-progress', wrapped);
  },
});


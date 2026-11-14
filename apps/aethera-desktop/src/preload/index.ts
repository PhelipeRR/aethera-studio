import { contextBridge, ipcRenderer } from 'electron';
import '../../../../packages/desktop-shared/src/preload/index.js';

contextBridge.exposeInMainWorld('aetheraBridge', {
  getStatus: () => ipcRenderer.invoke('aethera:status'),
  produceFromPrompt: (prompt: string) => ipcRenderer.invoke('aethera:produce', prompt),
  planCalendar: (prompt: string) => ipcRenderer.invoke('aethera:plan-calendar', prompt),
  planRevisionCommand: (instruction: string) => ipcRenderer.invoke('aethera:revise-command', instruction),
  pairPeer: (targetApp: 'orchestrator' | 'void') => ipcRenderer.invoke('aethera:pair-peer', targetApp),
  cinemaCapabilities: () => ipcRenderer.invoke('cinema:capabilities'),
  cinemaProduce: (input: Record<string, unknown>) => ipcRenderer.invoke('cinema:produce', input),
  cinemaExportOtio: (projectId: string) => ipcRenderer.invoke('cinema:export-otio', projectId),
  cinemaRepair: (projectId: string) => ipcRenderer.invoke('cinema:repair', projectId),
  cinemaRunBenchmark: () => ipcRenderer.invoke('cinema:benchmark'),
  cinemaRenderRealMp4: (input: {
    projectId: string;
    injectRealBlackFrameDefect?: boolean;
    useNvenc?: boolean;
  }) => ipcRenderer.invoke('cinema:render-real-mp4', input),
  cinemaProbeRealMp4: (input: { filePath: string; targetLufs?: number }) =>
    ipcRenderer.invoke('cinema:probe-real-mp4', input),
  cinemaUpdateTimeline: (input: { projectId: string; clips: unknown[] }) =>
    ipcRenderer.invoke('cinema:update-timeline', input),
  cinemaListProjects: () => ipcRenderer.invoke('cinema:list-projects'),
  cinemaDeleteProject: (projectId: string) => ipcRenderer.invoke('cinema:delete-project', projectId),
  cinemaListStagedJobs: () => ipcRenderer.invoke('cinema:list-staged-jobs'),
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
  cinemaCancelProduction: (projectId: string) => ipcRenderer.invoke('cinema:cancel-production', projectId),
  cinemaResumeProduction: (projectId: string) => ipcRenderer.invoke('cinema:resume-production', projectId),
  cinemaGetProductionState: (projectId: string) => ipcRenderer.invoke('cinema:get-production-state', projectId),
  cinemaResolvePendingMedia: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:resolve-pending-media', input),
  cinemaUpdateColorGrade: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:update-color-grade', input),
  cinemaNleOp: (input: Record<string, unknown>) =>
    ipcRenderer.invoke('cinema:nle-op', input),
  onCinemaProductionProgress: (listener: (job: unknown) => void) => {
    const wrapped = (_event: unknown, job: unknown) => listener(job);
    ipcRenderer.on('cinema:production-progress', wrapped);
    return () => ipcRenderer.removeListener('cinema:production-progress', wrapped);
  },
});

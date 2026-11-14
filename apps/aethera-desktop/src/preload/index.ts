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
  cinemaLoadProject: (projectId: string) => ipcRenderer.invoke('cinema:load-project', projectId),
  cinemaImportMedia: (input?: { filePath?: string }) =>
    ipcRenderer.invoke('cinema:import-media', input),
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
});

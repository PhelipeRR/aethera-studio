import { contextBridge, ipcRenderer } from 'electron';
import '../../../../packages/desktop-shared/src/preload/index.js';

contextBridge.exposeInMainWorld('orchestratorBridge', {
  getStatus: () => ipcRenderer.invoke('orchestrator:status'),
  createTask: (input: { prompt: string; cwd?: string }) => ipcRenderer.invoke('orchestrator:create-task', input),
  rememberMemory: (input: { title: string; content: string; tags?: string[] }) =>
    ipcRenderer.invoke('orchestrator:remember', input),
  searchMemory: (query: string) => ipcRenderer.invoke('orchestrator:search-memory', query),
  createWorkflow: (goal: string) => ipcRenderer.invoke('orchestrator:create-workflow', goal),
  pairPeer: (targetApp: 'aethera' | 'void') => ipcRenderer.invoke('orchestrator:pair-peer', targetApp),
});

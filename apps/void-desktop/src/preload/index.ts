import { contextBridge, ipcRenderer } from 'electron';
import '../../../../packages/desktop-shared/src/preload/index.js';

contextBridge.exposeInMainWorld('voidBridge', {
  getStatus: () => ipcRenderer.invoke('void:status'),
  pushNotification: (input: { title: string; channel?: string; priority?: 'low' | 'normal' | 'high' | 'urgent' }) =>
    ipcRenderer.invoke('void:push-notification', input),
  markRead: (id: string): Promise<boolean> => ipcRenderer.invoke('void:mark-read', id),
  createAutomation: (input: { title: string; intervalMs?: number }) =>
    ipcRenderer.invoke('void:create-automation', input),
  ask: (input: { prompt: string }): Promise<{ agent: string; reply: string }> =>
    ipcRenderer.invoke('void:ask', input),
});

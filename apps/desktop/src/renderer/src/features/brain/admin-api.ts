import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BrainSettings } from '@neuralbridge/shared/brain-settings';
import type { LearningStatus, MemoryType } from '@neuralbridge/shared/domain';
import type { HistorySyncSettings } from '@neuralbridge/shared/channels';

const brain = () => window.neuralbridge.brain;
// Under the brain key: memory changes (approvals, restores, imports) refresh the whole brain at once.
const ROOT = ['brain'] as const;
const history = () => window.neuralbridge.historySync;

export const useBrainSettings = () => useQuery({ queryKey: [...ROOT, 'settings'], queryFn: () => brain().settings() });
export const useLearning = (status?: LearningStatus) =>
  useQuery({ queryKey: [...ROOT, 'learning', status ?? 'all'], queryFn: () => brain().learning(status) });
export const useBackups = () => useQuery({ queryKey: [...ROOT, 'backups'], queryFn: () => brain().backups() });
export const useHistorySyncSettings = () => useQuery({ queryKey: ['history-sync', 'settings'], queryFn: () => history().settings() });
export const useHistorySyncStatus = () => useQuery({ queryKey: ['history-sync', 'status'], queryFn: () => history().status(), refetchInterval: 5000 });
export function useSaveHistorySyncSettings() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (settings: HistorySyncSettings) => history().saveSettings(settings), onSuccess: () => client.invalidateQueries({ queryKey: ['history-sync'] }) });
}
export function useRunHistorySync() {
  const client = useQueryClient();
  return useMutation({ mutationFn: () => history().run(), onSuccess: () => client.invalidateQueries({ queryKey: ['history-sync'] }) });
}

function useInvalidate() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: ROOT });
}

export function useSaveBrainSettings() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (settings: BrainSettings) => brain().saveSettings(settings), onSuccess: invalidate });
}

export function useApproveLearning() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, edits }: { id: string; edits?: { title?: string; content?: string; type?: MemoryType; tags?: string[] } }) => brain().approveLearning(id, edits),
    onSuccess: invalidate,
  });
}

export function useRejectLearning() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => brain().rejectLearning(id), onSuccess: invalidate });
}

export function useCreateBackup() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => brain().createBackup(), onSuccess: invalidate });
}

export function useRestoreBackup() {
  const client = useQueryClient();
  // Everything the app shows may have changed: tasks and projects too.
  return useMutation({ mutationFn: (name: string) => brain().restoreBackup(name), onSuccess: () => client.invalidateQueries() });
}

export function useApplyRetention() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => brain().applyRetention(), onSuccess: invalidate });
}

export function useExportBrain() {
  return useMutation({ mutationFn: (format: 'json' | 'markdown') => brain().exportBrain(format) });
}

export function useImportBrain() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => brain().importBrain(), onSuccess: invalidate });
}

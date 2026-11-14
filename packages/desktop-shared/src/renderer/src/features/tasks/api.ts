import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FINAL_TASK_STATUSES, type ImageUpload, type TaskListFilter, type TaskStartInput } from '@neuralbridge/shared/tasks';

const tasks = () => window.neuralbridge.tasks;
const ROOT = ['tasks'] as const;

export const useTaskList = (filter: TaskListFilter) => useQuery({ queryKey: [...ROOT, 'list', filter], queryFn: () => tasks().list(filter) });
export const useTask = (id: string) => useQuery({ queryKey: [...ROOT, 'detail', id], queryFn: () => tasks().get(id) });
export const useThread = (id: string | null) =>
  useQuery({ queryKey: [...ROOT, 'thread', id], queryFn: () => tasks().thread(id ?? ''), enabled: id !== null });

/**
 * Keeps every task query fresh while tasks run: the main process says which task changed and the
 * screens fetch it again from the database, which stays the only source of truth. Bursts of agent
 * output are coalesced into one refetch per frame-ish window.
 */
export function useTaskUpdates(): void {
  const client = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    const unsubscribe = tasks().onChanged((change) => {
      if (change.status && FINAL_TASK_STATUSES.includes(change.status)) finished = true;
      timer ??= setTimeout(() => {
        timer = null;
        void client.invalidateQueries({ queryKey: ROOT });
        // A finished task may have changed project files and memories.
        if (finished) {
          finished = false;
          void client.invalidateQueries({ queryKey: ['projects'] });
          void client.invalidateQueries({ queryKey: ['brain'] });
        }
      }, 150);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [client]);
}

function useInvalidate() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: ROOT });
}

export function useStartTask() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: TaskStartInput) => tasks().start(input), onSuccess: invalidate });
}

export function useResumeTask() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: ({ id, prompt, images }: { id: string; prompt: string; images?: ImageUpload[] }) => tasks().resume(id, prompt, images), onSuccess: invalidate });
}

export function useApproveTask() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => tasks().approve(id), onSuccess: invalidate });
}

export function useHealTask() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => tasks().heal(id), onSuccess: invalidate });
}

export function useCancelTask() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => tasks().cancel(id), onSuccess: invalidate });
}

export function usePauseTask() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => tasks().pause(id), onSuccess: invalidate });
}

export function useResumePausedTask() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => tasks().resumePaused(id), onSuccess: invalidate });
}

/** Models the CLIs reported before (never a guessed list); refreshed with the task queries. */
export const useKnownModels = () => useQuery({ queryKey: [...ROOT, 'models'], queryFn: () => tasks().models() });

export function useRenameThread() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: ({ id, title }: { id: string; title: string }) => tasks().renameThread(id, title), onSuccess: invalidate });
}

export function useDeleteThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tasks().deleteThread(id),
    // As with memories: drop the deleted conversation's own query instead of refetching it.
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: [...ROOT, 'thread', id] });
      void client.invalidateQueries({ queryKey: ROOT });
    },
  });
}

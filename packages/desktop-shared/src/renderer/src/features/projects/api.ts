import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectUpdate } from '@neuralbridge/shared/projects';

const projects = () => window.neuralbridge.projects;
const ROOT = ['projects'] as const;

export const useProjectList = () => useQuery({ queryKey: [...ROOT, 'list'], queryFn: () => projects().list() });
export const useProject = (id: string) => useQuery({ queryKey: [...ROOT, 'detail', id], queryFn: () => projects().get(id), enabled: id !== '' });
export const useDiff = (id: string, path: string | null, enabled: boolean) =>
  useQuery({ queryKey: [...ROOT, 'diff', id, path], queryFn: () => projects().diff(id, path ?? undefined), enabled });
export const useProjectFile = (id: string, path: string | null) =>
  useQuery({ queryKey: [...ROOT, 'file', id, path], queryFn: () => projects().file(id, path ?? ''), enabled: path !== null });

/** Project changes also affect the brain (project names, memory counts and filters). */
function useInvalidate() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ROOT });
    void client.invalidateQueries({ queryKey: ['brain'] });
  };
}

export function useAddProject() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (path: string) => projects().add(path), onSuccess: invalidate });
}

export function useUpdateProject(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (changes: ProjectUpdate) => projects().update(id, changes), onSuccess: invalidate });
}

export const useProjectProfile = (id: string) => useQuery({ queryKey: [...ROOT, 'profile', id], queryFn: () => projects().profile(id) });

export function useRefreshProfile(id: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: () => projects().refreshProfile(id), onSuccess: (profile) => client.setQueryData([...ROOT, 'profile', id], profile) });
}

export function useRefreshProject(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => projects().refresh(id), onSuccess: invalidate });
}

export function useRemoveProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projects().remove(id),
    // As with memories: drop the removed project's own query instead of refetching it before navigating away.
    onSuccess: (_result, id) => {
      client.removeQueries({ queryKey: [...ROOT, 'detail', id] });
      void client.invalidateQueries({ queryKey: ROOT });
      void client.invalidateQueries({ queryKey: ['brain'] });
    },
  });
}

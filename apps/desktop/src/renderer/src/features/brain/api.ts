import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BrainSearchInput, ListFilter, StoreInput } from '@neuralbridge/shared/brain';

const brain = () => window.neuralbridge.brain;

/** Every brain query lives under this key, so one invalidation refreshes overview, lists and details. */
const ROOT = ['brain'] as const;

export const useOverview = () => useQuery({ queryKey: [...ROOT, 'overview'], queryFn: () => brain().overview() });
export const useProjects = () => useQuery({ queryKey: [...ROOT, 'projects'], queryFn: () => brain().projects(), staleTime: 60_000 });
export const useTags = () => useQuery({ queryKey: [...ROOT, 'tags'], queryFn: () => brain().tags() });
export const useMemory = (id: string) => useQuery({ queryKey: [...ROOT, 'memory', id], queryFn: () => brain().get(id) });
export const useVersions = (id: string) => useQuery({ queryKey: [...ROOT, 'versions', id], queryFn: () => brain().versions(id) });

export function useMemoryList(filter: Omit<ListFilter, 'cursor'>, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: [...ROOT, 'list', filter],
    queryFn: ({ pageParam }) => brain().list({ ...filter, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '' as string,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}

export function useSearch(input: BrainSearchInput, enabled: boolean) {
  return useQuery({ queryKey: [...ROOT, 'search', input], queryFn: () => brain().search(input), enabled, placeholderData: keepPreviousData });
}

export function useStoreMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StoreInput) => brain().store(input),
    onSuccess: () => client.invalidateQueries({ queryKey: ROOT }),
  });
}

export function useDeleteMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, hard }: { id: string; hard: boolean }) => brain().delete(id, hard),
    // Do not await the refetch: the deleted memory's page would re-render as "not found" and unmount before
    // the caller's onSuccess (which navigates away) gets to run.
    onSuccess: (_result, { id }) => {
      client.removeQueries({ queryKey: [...ROOT, 'memory', id] });
      void client.invalidateQueries({ queryKey: ROOT });
    },
  });
}

export function useRevalidateMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => brain().revalidate(id),
    onSuccess: () => client.invalidateQueries({ queryKey: ROOT }),
  });
}

export function useSetMemoryConfidence() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confidence }: { id: string; confidence: 'unverified' | 'reviewed' | 'stale' }) => brain().setConfidence(id, confidence),
    onSuccess: () => client.invalidateQueries({ queryKey: ROOT }),
  });
}

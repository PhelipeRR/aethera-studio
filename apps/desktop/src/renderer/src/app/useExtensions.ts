import { useQuery } from '@tanstack/react-query';

export function useExtensions() {
  return useQuery({ queryKey: ['extensions'], queryFn: () => window.neuralbridge.extensions.list(), staleTime: 10_000 });
}

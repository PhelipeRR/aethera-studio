import { useMutation } from '@tanstack/react-query';
import { ScanEye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { ProductionState } from '@neuralbridge/shared/velix-production';

/** AS-05: explicit visual-index trigger; the actual work remains a durable ProductionRunService stage. */
export function ProductionVisualIndex({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const isAethera = state.stages.some((item) => item.kind === 'game_research' || item.kind === 'media_acquisition' || item.kind === 'visual_index');
  const stage = state.stages.filter((item) => item.kind === 'visual_index').at(-1);
  const acquisitions = state.stages.filter((item) => item.kind === 'media_acquisition').at(-1);
  const hasAcquisition = Boolean(acquisitions?.status === 'completed');
  const busy = stage?.status === 'pending' || stage?.status === 'running';
  const finished = state.run.status === 'cancelled' || state.run.status === 'completed';
  const start = useMutation({ mutationFn: () => api.productionRunVisualIndex(state.run.id), onSuccess: onState });
  if (!isAethera) return null;
  return (
    <div aria-label="Indexação visual" className="space-y-2 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium"><ScanEye aria-hidden className="mr-1 inline size-4" />Indexação visual</p>
          <p className="text-xs text-muted-foreground">Cortes, frames, classificação, descrição, embeddings e identidade por segmento. Provedores indisponíveis ficam marcados para revisão.</p>
        </div>
        <Button size="sm" className="min-h-11" disabled={finished || busy || !hasAcquisition || start.isPending} onClick={() => start.mutate()}>{busy ? 'Indexando…' : stage?.status === 'completed' ? 'Reindexar mídia' : 'Indexar mídia'}</Button>
      </div>
      {!hasAcquisition && <p className="text-xs text-muted-foreground">Adquira mídia antes de iniciar a indexação.</p>}
      {stage?.status === 'failed' && stage.error && <p role="alert" className="text-sm text-destructive">{stage.error.message}</p>}
      {start.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(start.error)}</p>}
    </div>
  );
}

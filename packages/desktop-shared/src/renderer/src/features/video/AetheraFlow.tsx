import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Clapperboard, Layers, Search, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { activeRun, flowPhases, PHASE_STATUS_LABEL, type FlowPhaseId, type FlowPhaseStatus } from './production-phases';

/*
 * R3 — the four flow cards of the reference screen. Each card opens its area (as before); when the project has a
 * persisted production, each card also shows that production's real phase status and the phase that needs attention
 * now is outlined in gold. Without a production the cards show no status at all: nothing is invented.
 */

export type FlowTarget = 'descobrir' | 'ideias' | 'produzir' | 'estudio';

const CARDS: Array<{ phase: FlowPhaseId; label: string; description: string; target: FlowTarget; Icon: LucideIcon }> = [
  { phase: 'descobrir', label: 'Descobrir', description: 'Fontes, pesquisa e referências', target: 'descobrir', Icon: Search },
  { phase: 'planejar', label: 'Planejar', description: 'Ideias, roteiro e cenas', target: 'ideias', Icon: Layers },
  { phase: 'aprovar', label: 'Aprovar', description: 'Brief, revisão e ajustes', target: 'produzir', Icon: CircleCheck },
  { phase: 'finalizar', label: 'Finalizar', description: 'Composição, render e exportação', target: 'estudio', Icon: Clapperboard },
];

const DOT: Record<FlowPhaseStatus, string> = {
  pending: 'bg-muted-foreground/50',
  running: 'bg-primary',
  paused: 'bg-warning',
  awaiting: 'bg-primary shadow-[0_0_6px_var(--primary)]',
  completed: 'bg-success',
  failed: 'bg-destructive',
  cancelled: 'bg-muted-foreground/50',
};

export function AetheraFlow({ projectId, tab, onOpen }: { projectId: string | null; tab: string; onOpen: (target: FlowTarget) => void }) {
  const client = useQueryClient();
  const api = window.neuralbridge.video;
  // Same query keys as the Produzir area, so both read one cache and stay in step.
  const runs = useQuery({ queryKey: ['velix-production-runs', projectId], queryFn: () => api.productionRunList(projectId ?? ''), enabled: !!projectId });
  const run = activeRun(runs.data);
  const state = useQuery({ queryKey: ['velix-production-run', run?.id ?? null], queryFn: () => api.productionRunState(run?.id ?? ''), enabled: !!run });
  useEffect(() => api.onProductionRunChanged(({ runId }) => {
    void client.invalidateQueries({ queryKey: ['velix-production-runs', projectId] });
    void client.invalidateQueries({ queryKey: ['velix-production-run', runId] });
  }), [api, client, projectId]);
  const flow = state.data && state.data.run.id === run?.id ? flowPhases(state.data) : null;

  return (
    <section aria-label="Fluxo do Aethera" className="@container mt-7">
      {run && <p className="mb-2 truncate text-xs text-muted-foreground">Fluxo da produção <span className="text-foreground">“{run.topic}”</span></p>}
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
        {CARDS.map(({ phase, label, description, target, Icon }) => {
          const status = flow?.phases[phase];
          const current = flow?.current === phase;
          const open = tab === target;
          return (
            <button
              key={phase}
              type="button"
              onClick={() => onOpen(target)}
              aria-pressed={open}
              data-phase={phase}
              data-status={status ?? 'none'}
              className={cn(
                'sg-panel flex min-h-[4.5rem] items-center gap-4 rounded-xl px-5 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                current ? 'border-primary/70 shadow-[var(--glass-highlight),var(--glow-soft)]' : open ? 'border-[var(--glass-border-strong)]' : 'hover:border-[var(--glass-border-strong)]',
              )}
            >
              <Icon className="size-8 shrink-0 text-primary" strokeWidth={1.4} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-base font-medium leading-tight text-foreground">{label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
                {status && (
                  <span className={cn('mt-1.5 flex items-center gap-1.5 text-xs', current ? 'text-primary' : 'text-muted-foreground')}>
                    <span className={cn('size-1.5 shrink-0 rounded-full', DOT[status])} aria-hidden="true" />
                    {PHASE_STATUS_LABEL[status]}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

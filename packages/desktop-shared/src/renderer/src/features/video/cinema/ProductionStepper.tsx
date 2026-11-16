import { CheckCircle2, Circle, CircleX, LoaderCircle, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PIPELINE_PHASES, PIPELINE_STAGES, stageStateOf, type JobStatusInput, type StageState } from './production-status-model';

const STATE_TEXT: Record<StageState, string> = {
  done: 'concluída',
  active: 'em andamento',
  waiting: 'aguardando você',
  failed: 'falhou',
  pending: 'pendente',
};

function StageIcon({ state }: { state: StageState }) {
  const common = 'size-3.5 shrink-0';
  if (state === 'done') return <CheckCircle2 aria-hidden className={cn(common, 'text-success')} />;
  if (state === 'active') return <LoaderCircle aria-hidden className={cn(common, 'text-primary motion-safe:animate-spin')} />;
  if (state === 'waiting') return <PauseCircle aria-hidden className={cn(common, 'text-warning')} />;
  if (state === 'failed') return <CircleX aria-hidden className={cn(common, 'text-destructive')} />;
  return <Circle aria-hidden className={cn(common, 'text-muted-foreground/60')} />;
}

/** The 11 pipeline stages grouped in 4 phases; each stage shows icon + text, never color alone. */
export function ProductionStepper({ job }: { job: JobStatusInput | null }) {
  return (
    <ol aria-label="Etapas da produção" className="grid gap-x-8 gap-y-5 sm:grid-cols-2 2xl:grid-cols-4">
      {PIPELINE_PHASES.map((phase) => {
        const done = phase.stageIds.filter((id) => stageStateOf(job, id) === 'done').length;
        return (
          <li key={phase.id} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-semibold tracking-wide text-foreground uppercase">{phase.label}</span>
              <span className="font-mono text-muted-foreground tabular-nums">
                {done}/{phase.stageIds.length}
              </span>
            </div>
            <ol className="flex flex-col">
              {phase.stageIds.map((id) => {
                const state = stageStateOf(job, id);
                const label = PIPELINE_STAGES.find((stage) => stage.id === id)?.label ?? id;
                return (
                  <li
                    key={id}
                    data-stage-state={state}
                    aria-current={state === 'active' ? 'step' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 py-1 text-sm',
                      state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
                      state === 'active' && 'font-medium',
                    )}
                  >
                    <StageIcon state={state} />
                    <span>{label}</span>
                    <span className="sr-only">({STATE_TEXT[state]})</span>
                    {(state === 'waiting' || state === 'failed') && (
                      <span className={cn('text-xs', state === 'failed' ? 'text-destructive' : 'text-warning')} aria-hidden>
                        {STATE_TEXT[state]}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </li>
        );
      })}
    </ol>
  );
}

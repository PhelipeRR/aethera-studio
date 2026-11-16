import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { JobStatusIcon, STATUS_TONE } from './JobStatusIcon';
import { jobStatusOf, stageProgressOf } from './production-status-model';

export interface RailJob {
  projectId: string;
  jobId?: string;
  attempt?: number;
  prompt: string;
  state: string;
  progressPct: number;
  completedStages: string[];
  pendingMedia: unknown[];
}

export function railJobKey(job: Pick<RailJob, 'jobId' | 'projectId'>): string {
  return job.jobId ?? job.projectId;
}

interface ProductionRailProps<T extends RailJob> {
  jobs: readonly T[];
  selectedKey: string | null;
  onSelect: (job: T) => void;
  onNew: () => void;
}

/**
 * Persistent list of productions. Selecting one changes what the tabs show; it never scrolls the page. Every item
 * states its status with icon + text, the stage as "N/11" and the percentage.
 */
export function ProductionRail<T extends RailJob>({ jobs, selectedKey, onSelect, onNew }: ProductionRailProps<T>) {
  return (
    <nav aria-labelledby="cinema-rail-title" className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 id="cinema-rail-title" className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          Produções
        </h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{jobs.length}</span>
      </div>

      {jobs.length === 0 ? (
        <p className="px-1 text-sm text-muted-foreground">Nenhuma produção ainda. Descreva um vídeo em Criar.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {jobs.map((job) => {
            const key = railJobKey(job);
            const selected = key === selectedKey;
            const status = jobStatusOf(job);
            const stage = stageProgressOf(job);
            const detail =
              status.kind === 'running'
                ? `${stage.label} · ${stage.current}/${stage.total}`
                : status.kind === 'failed'
                  ? `${status.label} em ${stage.label}${job.attempt && job.attempt > 1 ? ` · t${job.attempt}` : ''}`
                  : status.kind === 'done'
                    ? 'Pronto · abrir no editor'
                    : status.label;
            const title = job.prompt || job.projectId;
            return (
              <li key={key}>
                <button
                  type="button"
                  data-production-job={key}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(job)}
                  className={cn(
                    'flex w-full flex-col gap-1.5 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
                    selected && 'border-border bg-card shadow-[inset_3px_0_0_var(--primary)]',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <JobStatusIcon kind={status.kind} />
                    <span className="truncate text-sm font-medium text-foreground" title={title}>
                      {title}
                    </span>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-xs">
                    <span className={cn('truncate', status.kind === 'running' ? 'text-muted-foreground' : STATUS_TONE[status.kind])}>
                      {detail}
                    </span>
                    <span className="shrink-0 font-mono text-foreground/80 tabular-nums">{job.progressPct}%</span>
                  </span>
                  <Progress value={job.progressPct} className="h-1 bg-muted" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="outline" className="border-dashed text-muted-foreground" onClick={onNew}>
        <Plus aria-hidden /> Nova produção
      </Button>
    </nav>
  );
}

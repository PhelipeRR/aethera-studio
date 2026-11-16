import { Ban, CheckCircle2, CircleX, LoaderCircle, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JobStatusKind } from './production-status-model';

const ICONS = {
  running: LoaderCircle,
  waiting: PauseCircle,
  failed: CircleX,
  done: CheckCircle2,
  cancelled: Ban,
} as const;

export const STATUS_TONE: Record<JobStatusKind, string> = {
  running: 'text-primary',
  waiting: 'text-warning',
  failed: 'text-destructive',
  done: 'text-success',
  cancelled: 'text-muted-foreground',
};

/** State icon; always rendered next to a text label, so it is decorative. */
export function JobStatusIcon({ kind, className }: { kind: JobStatusKind; className?: string }) {
  const Icon = ICONS[kind];
  return (
    <Icon
      aria-hidden
      className={cn(
        'size-4 shrink-0',
        STATUS_TONE[kind],
        kind === 'running' && 'motion-safe:animate-spin [animation-duration:2.4s]',
        className,
      )}
    />
  );
}

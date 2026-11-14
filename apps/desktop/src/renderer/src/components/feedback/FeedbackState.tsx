import { CheckCircle2, CircleAlert, CircleX, LoaderCircle, PauseCircle, WifiOff } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { feedbackSemantics, type FeedbackKind } from './feedbackSemantics';

const ICONS = {
  loading: LoaderCircle,
  empty: CircleAlert,
  error: CircleX,
  success: CheckCircle2,
  offline: WifiOff,
  approval: PauseCircle,
  progress: LoaderCircle,
  cancelled: CircleAlert,
} as const;

const TONES: Record<FeedbackKind, string> = {
  loading: 'border-border bg-muted/20',
  empty: 'border-dashed border-border bg-muted/10',
  error: 'border-destructive/40 bg-destructive/5',
  success: 'border-primary/40 bg-primary/5',
  offline: 'border-warning/50 bg-warning/5',
  approval: 'border-warning/50 bg-warning/5',
  progress: 'border-primary/30 bg-primary/5',
  cancelled: 'border-border bg-muted/20',
};

export function FeedbackState({
  kind,
  title,
  description,
  action,
  secondaryAction,
  progress,
  className,
}: {
  kind: FeedbackKind;
  title: string;
  description?: ReactNode;
  action?: { label: string; onClick: () => void; variant?: 'default' | 'outline' | 'ghost' };
  secondaryAction?: { label: string; onClick: () => void; variant?: 'default' | 'outline' | 'ghost' };
  progress?: number;
  className?: string;
}) {
  const Icon = ICONS[kind];
  const { role, live } = feedbackSemantics(kind);
  const boundedProgress = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
  return (
    <section role={role} aria-live={live} className={cn('rounded-lg border p-4', TONES[kind], className)}>
      <div className="flex items-start gap-3">
        <Icon className={cn('mt-0.5 size-5 shrink-0', (kind === 'loading' || kind === 'progress') && 'animate-spin motion-reduce:animate-none', kind === 'error' && 'text-destructive', (kind === 'offline' || kind === 'approval') && 'text-warning', kind === 'success' && 'text-primary')} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          {boundedProgress !== undefined && <div className="mt-3" aria-label={`Progresso: ${boundedProgress}%`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={boundedProgress}><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary motion-reduce:transition-none" style={{ width: `${boundedProgress}%` }} /></div></div>}
          {(action || secondaryAction) && <div className="mt-3 flex flex-wrap gap-2">{action && <Button type="button" size="sm" variant={action.variant} onClick={action.onClick}>{action.label}</Button>}{secondaryAction && <Button type="button" size="sm" variant={secondaryAction.variant ?? 'outline'} onClick={secondaryAction.onClick}>{secondaryAction.label}</Button>}</div>}
        </div>
      </div>
    </section>
  );
}

export const LoadingState = (props: Omit<ComponentProps<typeof FeedbackState>, 'kind'>) => <FeedbackState kind="loading" {...props} />;
export const EmptyState = (props: Omit<ComponentProps<typeof FeedbackState>, 'kind'>) => <FeedbackState kind="empty" {...props} />;
export const ErrorState = (props: Omit<ComponentProps<typeof FeedbackState>, 'kind'>) => <FeedbackState kind="error" {...props} />;
export const SuccessState = (props: Omit<ComponentProps<typeof FeedbackState>, 'kind'>) => <FeedbackState kind="success" {...props} />;
export const OfflineState = (props: Omit<ComponentProps<typeof FeedbackState>, 'kind'>) => <FeedbackState kind="offline" {...props} />;
export const ApprovalPendingState = (props: Omit<ComponentProps<typeof FeedbackState>, 'kind'>) => <FeedbackState kind="approval" {...props} />;
export const ExecutionProgressState = (props: Omit<ComponentProps<typeof FeedbackState>, 'kind'>) => <FeedbackState kind="progress" {...props} />;
export const CancelledState = (props: Omit<ComponentProps<typeof FeedbackState>, 'kind'>) => <FeedbackState kind="cancelled" {...props} />;

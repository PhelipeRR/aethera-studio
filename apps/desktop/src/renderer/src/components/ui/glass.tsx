import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';
import { donutArcs, formatCount, meterState, percentLabel, STATUS_TONE_TEXT, type DonutSegmentInput, type Measured, type StatusTone } from './glass-model';

/*
 * Singularity glass components (lote 50.03). They only read tokens from styles.css and never fabricate data: every
 * numeric prop accepts null, which renders as "indisponível" or "—".
 */

type GlassTone = 'default' | 'strong' | 'active';

export function GlassPanel({
  tone = 'default',
  interactive = false,
  asChild = false,
  className,
  ...props
}: React.ComponentProps<'div'> & { tone?: GlassTone; interactive?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'div';
  return <Comp className={cn('sg-glass', tone === 'strong' && 'sg-glass--strong', tone === 'active' && 'sg-glass--active', interactive && 'sg-glass--interactive', className)} {...props} />;
}

/** Thin upper-case section label, as "STATUS DO SISTEMA" in the reference. */
export function SectionLabel({ as: Tag = 'p', className, ...props }: React.HTMLAttributes<HTMLElement> & { as?: 'p' | 'h2' | 'h3' | 'span' }) {
  return <Tag className={cn('sg-label', className)} {...props} />;
}

const DOT_TONE: Record<StatusTone, string> = {
  ok: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-destructive',
  unknown: 'bg-muted-foreground/60',
};

/** Coloured dot plus a hidden word, so the state never depends on colour alone. */
export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center', className)}>
      <span className={cn('size-2 rounded-full', DOT_TONE[tone], tone === 'ok' && 'shadow-[0_0_6px_var(--success)]')} aria-hidden="true" />
      <span className="sr-only">{STATUS_TONE_TEXT[tone]}</span>
    </span>
  );
}

export function Chip({ className, selected, ...props }: React.ComponentProps<'span'> & { selected?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs',
        selected ? 'border-[var(--glass-border-strong)] bg-accent text-accent-foreground' : 'border-[var(--glass-border)] bg-secondary text-foreground',
        className,
      )}
      {...props}
    />
  );
}

/** A big real number with its caption. `value` null shows a dash and the reason. */
export function StatCard({
  label,
  value,
  caption,
  icon,
  unavailableReason = 'indisponível',
  className,
}: {
  label: string;
  value: Measured;
  caption?: React.ReactNode;
  icon?: React.ReactNode;
  unavailableReason?: string;
  className?: string;
}) {
  const missing = value === null || value === undefined;
  return (
    <GlassPanel className={cn('flex items-center gap-4 p-4', className)}>
      {icon && <span className="shrink-0 text-primary [&_svg]:size-7" aria-hidden="true">{icon}</span>}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-3xl leading-tight font-extralight text-foreground tabular-nums">{formatCount(value)}</p>
        <p className="text-xs text-muted-foreground">{missing ? unavailableReason : caption}</p>
      </div>
    </GlassPanel>
  );
}

/** Compact meter (CPU, memory, disk). With no measurement it says so and draws an empty, dashed track. */
export function MeterBar({ label, value, format, missingLabel, className }: { label: string; value: Measured; format?: (value: number) => string; /** Shown instead of a number when there is no reading (default "indisponível"). */ missingLabel?: string; className?: string }) {
  const state = meterState(value, format, missingLabel);
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex justify-between gap-2 text-xs">
        <span className="text-foreground">{label}</span>
        <span className={cn('tabular-nums', state.available ? 'text-muted-foreground' : 'text-muted-foreground/80 italic')}>{state.label}</span>
      </div>
      {state.available ? (
        <div className="h-1 rounded-full bg-secondary" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.percent)} aria-valuetext={state.label}>
          <div className="h-full rounded-full bg-primary shadow-[var(--glow-soft)] transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-out)]" style={{ width: `${state.percent}%` }} />
        </div>
      ) : (
        <div className="h-1 rounded-full border border-dashed border-[var(--glass-border)]" aria-hidden="true" />
      )}
    </div>
  );
}

/** Ring chart of real counts. The same data is in a visually hidden table for screen readers. */
export function DonutChart({ segments, centerLabel, centerCaption, title, size = 132, stacked = false, className }: { segments: readonly DonutSegmentInput[]; centerLabel: string; centerCaption?: string; title: string; size?: number; /** Ring above the legend, for narrow panels. */ stacked?: boolean; className?: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const arcs = donutArcs(segments, circumference, 2.5);
  return (
    <figure className={cn(stacked ? 'flex flex-col items-center gap-4' : 'flex flex-wrap items-center gap-5', className)}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" className="shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--secondary)" strokeWidth="8" />
        {arcs.map((arc) => (
          <circle key={arc.id} cx="50" cy="50" r={radius} fill="none" stroke={arc.color} strokeWidth="8" strokeDasharray={arc.dash} strokeDashoffset={arc.offset} strokeLinecap="butt" />
        ))}
        <text x="50" y="49" textAnchor="middle" transform="rotate(90 50 50)" className="fill-foreground text-[15px] font-light">{centerLabel}</text>
        {centerCaption && <text x="50" y="62" textAnchor="middle" transform="rotate(90 50 50)" className="fill-muted-foreground text-[7px]">{centerCaption}</text>}
      </svg>
      <figcaption className={cn('min-w-0', stacked ? 'w-full' : 'flex-1')}>
        <span className="sr-only">{title}</span>
        {arcs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados para distribuir.</p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <tbody>
              {arcs.map((arc) => (
                <tr key={arc.id}>
                  <th scope="row" className="py-0.5 pr-3 text-left font-normal text-foreground">
                    <span className="mr-2 inline-block size-2 rounded-full align-middle" style={{ background: arc.color }} aria-hidden="true" />
                    {arc.label}
                  </th>
                  <td className="py-0.5 text-right text-muted-foreground tabular-nums">{percentLabel(arc.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </figcaption>
    </figure>
  );
}

export interface ActivityItem {
  id: string;
  label: React.ReactNode;
  when: string;
  icon?: React.ReactNode;
}

export function ActivityList({ items, empty = 'Nenhuma atividade ainda.', className }: { items: readonly ActivityItem[]; empty?: string; className?: string }) {
  if (items.length === 0) return <p className={cn('text-sm text-muted-foreground', className)}>{empty}</p>;
  return (
    <ul className={cn('space-y-2.5', className)}>
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 text-sm">
          {item.icon && <span className="mt-0.5 shrink-0 text-primary [&_svg]:size-4" aria-hidden="true">{item.icon}</span>}
          <span className="min-w-0 flex-1 text-foreground">{item.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{item.when}</span>
        </li>
      ))}
    </ul>
  );
}

import * as React from 'react';
import { cn } from '@/lib/utils';
import { seriesPaths, summary } from './chart-model';

export interface ChartSeries {
  label: string;
  values: readonly (number | null)[];
  /** CSS colour, normally a token. */
  color: string;
}

/**
 * History chart (lote 50.08): gold area for the first series, lines for the others, gaps where there was no reading.
 * The SVG is decorative for assistive tech; the same information is in the accessible summary next to it.
 */
export function TimeSeriesChart({ series, max, capacity, format, height = 72, title, className }: { series: readonly ChartSeries[]; max: number; capacity: number; format: (value: number | null) => string; height?: number; title: string; className?: string }) {
  const id = React.useId();
  const width = 300;
  const stats = series.map((entry) => ({ entry, stats: summary(entry.values) }));
  const label = stats.map(({ entry, stats: s }) => `${entry.label}: agora ${format(s.last)}, máximo ${format(s.max)}, média ${format(s.average)}`).join('; ');
  return (
    <figure className={cn('space-y-1.5', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="block h-[var(--chart-h)] w-full overflow-visible" style={{ '--chart-h': `${height}px` } as React.CSSProperties} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={series[0]?.color ?? 'var(--primary)'} stopOpacity="0.32" />
            <stop offset="1" stopColor={series[0]?.color ?? 'var(--primary)'} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />
        ))}
        {series.map((entry, index) => {
          const paths = seriesPaths(entry.values, max, width, height, capacity);
          return (
            <g key={entry.label}>
              {index === 0 && <path d={paths.area} fill={`url(#${id}-fill)`} />}
              <path d={paths.line} fill="none" stroke={entry.color} strokeWidth={index === 0 ? 1.75 : 1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
        <span className="sr-only">{title}. {label}.</span>
        {stats.map(({ entry, stats: s }) => (
          <span key={entry.label} className="inline-flex items-center gap-1.5" aria-hidden="true">
            <span className="h-0.5 w-3 rounded-full" style={{ background: entry.color }} />
            {entry.label} <span className="text-foreground tabular-nums">{format(s.last)}</span>
            <span className="tabular-nums">· máx {format(s.max)}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

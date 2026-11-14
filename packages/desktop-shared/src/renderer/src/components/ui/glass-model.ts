// Pure logic behind the Singularity glass components (lote 50.03). No React here, so it is unit-testable in node.

/** A measured value or null when no real measurement exists. Components never invent a number for null. */
export type Measured = number | null | undefined;

export interface MeterState {
  available: boolean;
  /** Clamped to 0..100; 0 when unavailable. */
  percent: number;
  label: string;
}

export function meterState(value: Measured, format: (value: number) => string = (v) => `${Math.round(v)}%`, missing = 'indisponível'): MeterState {
  if (value === null || value === undefined || !Number.isFinite(value)) return { available: false, percent: 0, label: missing };
  const percent = Math.min(100, Math.max(0, value));
  return { available: true, percent, label: format(percent) };
}

export interface DonutSegmentInput {
  id: string;
  label: string;
  value: number;
  /** A CSS colour, normally a token such as var(--type-decision). */
  color: string;
}

export interface DonutArc extends DonutSegmentInput {
  share: number;
  /** stroke-dasharray / stroke-dashoffset for a circle of the given circumference. */
  dash: string;
  offset: number;
}

/** Arcs for an SVG ring drawn with stroke-dasharray. Segments with no value are dropped; an all-zero input yields no arcs. */
export function donutArcs(segments: readonly DonutSegmentInput[], circumference: number, gap = 0): DonutArc[] {
  const usable = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0);
  const total = usable.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) return [];
  let start = 0;
  return usable.map((segment) => {
    const share = segment.value / total;
    const length = Math.max(0, share * circumference - (usable.length > 1 ? gap : 0));
    const arc = { ...segment, share, dash: `${length} ${circumference - length}`, offset: -start };
    start += share * circumference;
    return arc;
  });
}

export function percentLabel(share: number): string {
  const value = share * 100;
  if (value > 0 && value < 1) return '<1%';
  return `${Math.round(value)}%`;
}

const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('pt-BR');

export function formatCount(value: Measured, mode: 'full' | 'compact' = 'full'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return mode === 'compact' ? compact.format(value) : full.format(value);
}

export type StatusTone = 'ok' | 'warning' | 'error' | 'unknown';

export const STATUS_TONE_TEXT: Record<StatusTone, string> = {
  ok: 'operacional',
  warning: 'atenção',
  error: 'com falha',
  unknown: 'desconhecido',
};

/**
 * Progress for anything that loads. With a value it shows the real percentage; without one (the work has no measurable
 * size, like waiting for Google) it animates and says so, instead of inventing a number.
 */
export function ProgressBar({ label, value }: { label: string; value?: number | null }) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = known ? Math.max(0, Math.min(100, Math.round(value))) : null;
  return (
    <div className="space-y-1" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...(percent === null ? { 'aria-busy': true } : { 'aria-valuenow': percent })}>
      <div className="flex justify-between text-xs"><span className="text-muted-foreground">{label}</span>{percent !== null && <span className="font-medium tabular-nums">{percent}%</span>}</div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        {percent !== null
          ? <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          : <div className="h-full w-1/3 animate-[nb-progress_1.2s_ease-in-out_infinite] rounded-full bg-primary motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-50" />}
      </div>
    </div>
  );
}

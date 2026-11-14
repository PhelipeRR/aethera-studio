// SVG paths for time-series charts (lote 50.08). Pure: a null value breaks the line instead of being drawn as zero.

export interface PathSet {
  line: string;
  area: string;
}

export function seriesPaths(values: readonly (number | null)[], max: number, width: number, height: number, capacity = values.length): PathSet {
  const slots = Math.max(2, capacity);
  const offset = slots - values.length;
  const x = (index: number) => ((index + offset) / (slots - 1)) * width;
  const y = (value: number) => height - (Math.min(max, Math.max(0, value)) / (max || 1)) * height;
  let line = '';
  let area = '';
  let run: [number, number][] = [];
  const flush = () => {
    if (run.length === 0) return;
    line += run.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    const first = run[0];
    const last = run[run.length - 1];
    if (first && last) area += `M${first[0].toFixed(1)},${height}` + run.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join('') + `L${last[0].toFixed(1)},${height}Z`;
    run = [];
  };
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) flush();
    else run.push([x(index), y(value)]);
  });
  flush();
  return { line, area };
}

export function summary(values: readonly (number | null)[]): { last: number | null; min: number | null; max: number | null; average: number | null } {
  const real = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (real.length === 0) return { last: null, min: null, max: null, average: null };
  return { last: [...values].reverse().find((value): value is number => value !== null) ?? null, min: Math.min(...real), max: Math.max(...real), average: real.reduce((a, b) => a + b, 0) / real.length };
}

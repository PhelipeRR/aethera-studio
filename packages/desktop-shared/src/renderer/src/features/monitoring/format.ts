// Formatting for monitoring values (lote 50.08). Null always renders as a dash: no reading, no number.

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${integer.format(value)}%`;
}

export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return `${unit >= 3 ? decimal.format(amount) : integer.format(amount)} ${units[unit]}`;
}

export function rate(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${bytes(value)}/s`;
}

export function bits(value: number | null | undefined): string {
  if (value === null || value === undefined || value <= 0) return '—';
  if (value >= 1e9) return `${decimal.format(value / 1e9)} Gbit/s`;
  if (value >= 1e6) return `${integer.format(value / 1e6)} Mbit/s`;
  return `${integer.format(value / 1e3)} kbit/s`;
}

export function megahertz(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${decimal.format(value / 1000)} GHz`;
}

export function celsius(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${integer.format(value)} °C`;
}

export function share(used: number | null | undefined, total: number | null | undefined): number | null {
  return used === null || used === undefined || !total ? null : Math.min(100, Math.max(0, (used / total) * 100));
}

/** Max for an auto-scaled chart: the series peak rounded up to a readable step, never zero. */
export function niceMax(values: readonly (number | null)[], floor = 1): number {
  const peak = Math.max(floor, ...values.filter((value): value is number => value !== null));
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= peak) ?? 10;
  return step * magnitude;
}

// Pure parsing of Windows performance data (lote 50.08). No I/O: everything here is unit-tested with real output.

/** Counters the collector asks typeperf for, by English path. Localized at startup through PDH (see probe.ts). */
export const COUNTERS = {
  cpuUtilization: '\\Processor Information(_Total)\\% Processor Utility',
  cpuPerformance: '\\Processor Information(_Total)\\% Processor Performance',
  cpuFrequency: '\\Processor Information(_Total)\\Processor Frequency',
  thermal: '\\Thermal Zone Information(*)\\High Precision Temperature',
  diskIdle: '\\PhysicalDisk(_Total)\\% Idle Time',
  diskRead: '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec',
  diskWrite: '\\PhysicalDisk(_Total)\\Disk Write Bytes/sec',
  netDown: '\\Network Interface(*)\\Bytes Received/sec',
  netUp: '\\Network Interface(*)\\Bytes Sent/sec',
  netLink: '\\Network Interface(*)\\Current Bandwidth',
  gpuEngine: '\\GPU Engine(*)\\Utilization Percentage',
  gpuDedicated: '\\GPU Adapter Memory(*)\\Dedicated Usage',
  monitorCpu: '\\Process(typeperf)\\% Processor Time',
  monitorMemory: '\\Process(typeperf)\\Working Set - Private',
  nvidiaCpu: '\\Process(nvidia-smi)\\% Processor Time',
  nvidiaMemory: '\\Process(nvidia-smi)\\Working Set - Private',
} as const;
export type CounterId = keyof typeof COUNTERS;

/** One localized counter: the path to pass to typeperf, and its "Object\Counter" key as the OEM bytes typeperf prints. */
export interface LocalizedCounter {
  path: string;
  /** Object name and counter name in the console's OEM code page, read as latin1 (one char per byte). */
  object: string;
  counter: string;
}

/** Splits one CSV line of typeperf output ("a","b",...). Quotes are doubled inside fields. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { out.push(field); field = ''; }
    else field += char ?? '';
  }
  out.push(field);
  return out;
}

/** typeperf prints "." decimals, but a locale may print ","; blank or "-1"-style placeholders become null. */
export function parseNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === ' ') return null;
  const value = Number(trimmed.includes(',') && !trimmed.includes('.') ? trimmed.replace(',', '.') : trimmed);
  return Number.isFinite(value) ? value : null;
}

export interface Column {
  id: CounterId;
  instance: string | null;
}

/**
 * Maps typeperf header columns to counters. Columns look like "\\HOST\Object(instance)\Counter"; wildcard counters
 * expand to one column per instance. Matching uses the OEM spelling from the probe, so localized names never need
 * decoding. Unknown columns map to null and are ignored.
 */
export function mapColumns(header: readonly string[], counters: Partial<Record<CounterId, LocalizedCounter>>): (Column | null)[] {
  const entries = Object.entries(counters) as [CounterId, LocalizedCounter][];
  return header.map((column, index) => {
    if (index === 0) return null;
    const withoutHost = column.replace(/^\\\\[^\\]+/, '');
    const last = withoutHost.lastIndexOf('\\');
    if (last <= 0) return null;
    const objectPart = withoutHost.slice(1, last);
    const counter = withoutHost.slice(last + 1);
    for (const [id, localized] of entries) {
      if (localized.counter !== counter) continue;
      if (objectPart === localized.object) return { id, instance: null };
      if (objectPart.startsWith(`${localized.object}(`) && objectPart.endsWith(')')) {
        const instance = objectPart.slice(localized.object.length + 1, -1);
        // Wildcard counters keep every instance. A named instance ("_Total", "typeperf") must match exactly: two
        // counters can share object and counter name and differ only by instance (typeperf vs nvidia-smi).
        if (localized.path.includes('(*)')) return { id, instance };
        if (instance.toLowerCase() === requestedInstance(localized.path)?.toLowerCase()) return { id, instance: null };
      }
    }
    return null;
  });
}

/** The instance named in a counter path, e.g. "typeperf" in "\Process(typeperf)\% Processor Time". */
function requestedInstance(path: string): string | null {
  const last = path.lastIndexOf('\\');
  const objectPart = path.slice(1, last);
  const open = objectPart.indexOf('(');
  return open >= 0 && objectPart.endsWith(')') ? objectPart.slice(open + 1, -1) : null;
}

export interface CounterRow {
  values: Partial<Record<CounterId, number | null>>;
  /** Wildcard counters, by instance. */
  instances: Partial<Record<CounterId, Map<string, number>>>;
}

export function readRow(cells: readonly string[], columns: readonly (Column | null)[]): CounterRow {
  const row: CounterRow = { values: {}, instances: {} };
  columns.forEach((column, index) => {
    if (!column) return;
    const value = parseNumber(cells[index]);
    if (column.instance === null) {
      row.values[column.id] = value;
      return;
    }
    if (value === null) return;
    const map = row.instances[column.id] ?? new Map<string, number>();
    map.set(column.instance, value);
    row.instances[column.id] = map;
  });
  return row;
}

/**
 * GPU utilization as Task Manager shows it: per adapter, the busiest engine type, where an engine type's load is the
 * sum over the processes using it. Instances look like "pid_1234_luid_0x0_0x0000D1B3_phys_0_eng_0_engtype_3D".
 */
export function gpuUtilization(engines: Map<string, number> | undefined): number | null {
  if (!engines || engines.size === 0) return null;
  const byType = new Map<string, number>();
  for (const [instance, value] of engines) {
    const luid = /luid_(0x[0-9a-f]+_0x[0-9a-f]+)/i.exec(instance)?.[1] ?? '';
    const type = /engtype_(.+)$/i.exec(instance)?.[1] ?? 'other';
    const key = `${luid}|${type}`;
    byType.set(key, (byType.get(key) ?? 0) + value);
  }
  return Math.min(100, Math.max(0, ...byType.values()));
}

/** Network: sum of real interfaces (loopback and tunnel pseudo-interfaces excluded). */
export function networkTotals(down?: Map<string, number>, up?: Map<string, number>, link?: Map<string, number>): { down: number | null; up: number | null; link: number | null } {
  const real = (name: string) => !/loopback|isatap|teredo|6to4|pseudo/i.test(name);
  const sum = (map?: Map<string, number>) => (map && map.size ? [...map].filter(([name]) => real(name)).reduce((total, [, value]) => total + value, 0) : null);
  const busiest = link && down ? [...link].filter(([name]) => real(name)).sort((a, b) => (down.get(b[0]) ?? 0) - (down.get(a[0]) ?? 0))[0] : undefined;
  return { down: sum(down), up: sum(up), link: busiest ? busiest[1] : null };
}

/**
 * ACPI thermal zones report tenths of kelvin. They are board sensors, not the CPU package: a value outside a
 * plausible CPU range (e.g. 16 °C, below room temperature) is rejected rather than shown as the CPU temperature.
 */
export function cpuTemperature(zones: Map<string, number> | undefined): number | null {
  if (!zones || zones.size === 0) return null;
  const celsius = Math.max(...[...zones.values()].map((tenthsKelvin) => tenthsKelvin / 10 - 273.15));
  return celsius >= 25 && celsius <= 110 ? Math.round(celsius * 10) / 10 : null;
}

export interface NvidiaReading {
  name: string;
  temperatureC: number | null;
  utilization: number | null;
  memoryUsedBytes: number | null;
  memoryTotalBytes: number | null;
}

/** One line of `nvidia-smi --query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits`. */
export function parseNvidiaLine(line: string): NvidiaReading | null {
  const cells = line.split(',').map((cell) => cell.trim());
  if (cells.length < 6 || !/^\d+$/.test(cells[0] ?? '')) return null;
  const num = (text: string | undefined) => (text && !/N\/A|Not Supported/i.test(text) ? parseNumber(text) : null);
  const mib = (text: string | undefined) => { const value = num(text); return value === null ? null : value * 1024 * 1024; };
  return { name: cells[1] ?? 'GPU NVIDIA', temperatureC: num(cells[2]), utilization: num(cells[3]), memoryUsedBytes: mib(cells[4]), memoryTotalBytes: mib(cells[5]) };
}

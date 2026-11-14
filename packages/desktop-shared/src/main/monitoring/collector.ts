import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  DEFAULT_MONITORING_INTERVAL_MS,
  MONITORING_HISTORY,
  type MonitorConsumer,
  type MonitoringInterval,
  type MonitorSample,
  type MonitorSnapshot,
  type MonitorSource,
  type MonitorStatic,
  type SourceStatus,
} from '@neuralbridge/shared';
import { cpuTemperature, gpuUtilization, mapColumns, networkTotals, parseCsvLine, parseNvidiaLine, readRow, type Column, type CounterRow, type NvidiaReading } from './parse.js';
import { parseProbe, PROBE_SCRIPT, probeEnv, type ProbeResult } from './probe.js';

/*
 * Real-time monitoring collector (lote 50.08), main process. Design goals: real Windows data only, no native modules,
 * nothing blocking. typeperf.exe (built into Windows) streams performance counters as CSV from a child process; when
 * an NVIDIA driver is installed, nvidia-smi streams exact GPU temperature, load and VRAM. Both run only while someone
 * is looking (a snapshot request in the last IDLE_MS); RAM and disk space come straight from Node.
 *
 * Future consumers (Claude, Codex, Core, MCP, RAG) plug in as ProcessGroups: a label and a function returning their
 * live pids. Until a group is registered the consumer is reported as not monitored, never with an invented number.
 */

const IDLE_MS = 20_000;
/** GPU engine instances are per process: typeperf expands wildcards once, so it restarts to see new processes. */
const REFRESH_INSTANCES_MS = 120_000;
const DRIVES_EVERY_MS = 30_000;
const COUNTERS_PROVIDER = 'Contadores de desempenho do Windows (typeperf)';
const NVIDIA_PROVIDER = 'nvidia-smi (driver NVIDIA)';

export interface ProcessGroup {
  id: MonitorConsumer['id'];
  label: string;
  /** Live pids of the group; usage is read from Electron metrics when they belong to the app. */
  pids: () => number[];
}

export interface AppProcessMetric {
  pid: number;
  /** % of one logical core since the previous call (Electron's percentCPUUsage). */
  cpuPercent: number;
  workingSetBytes: number;
}

export interface CollectorDeps {
  spawn: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  runProbe: () => Promise<string>;
  readCache: () => ProbeResult | null;
  writeCache: (probe: ProbeResult) => void;
  osRelease: string;
  cpuModel: string | null;
  logicalCores: number;
  totalMemory: () => number;
  freeMemory: () => number;
  statfs: (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  appMetrics: () => AppProcessMetric[];
  /** Absolute path to typeperf.exe (never resolved through PATH). */
  typeperf: string;
  nvidiaSmi: string | null;
  now: () => number;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  log?: (message: string) => void;
}

type State = 'stopped' | 'starting' | 'running' | 'unavailable';

export class MonitoringCollector {
  private state: State = 'stopped';
  private intervalMs: MonitoringInterval;
  private probe: ProbeResult | null = null;
  private typeperf: ChildProcess | null = null;
  private nvidia: ChildProcess | null = null;
  private columns: (Column | null)[] | null = null;
  private buffer = '';
  private nvidiaBuffer = '';
  private lastNvidia: NvidiaReading | null = null;
  private samples: MonitorSample[] = [];
  private seq = 0;
  private lastRequest = 0;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private drivesTimer: ReturnType<typeof setInterval> | null = null;
  private drives: MonitorStatic['drives'] = [];
  private failure: string | null = null;
  private reprobed = false;
  private readonly groups = new Map<MonitorConsumer['id'], ProcessGroup>();

  constructor(private readonly deps: CollectorDeps, intervalMs: MonitoringInterval = DEFAULT_MONITORING_INTERVAL_MS) {
    this.intervalMs = intervalMs;
  }

  /** A future consumer (agents, Core, MCP, RAG) registers its process group here. */
  registerProcessGroup(group: ProcessGroup): void {
    this.groups.set(group.id, group);
  }

  get interval(): MonitoringInterval {
    return this.intervalMs;
  }

  setInterval(intervalMs: MonitoringInterval): void {
    if (intervalMs === this.intervalMs) return;
    this.intervalMs = intervalMs;
    if (this.state === 'running' || this.state === 'starting') this.restartChildren();
  }

  /** Called by the IPC handler: starts collection on demand and returns samples newer than `since`. */
  snapshot(since?: number): MonitorSnapshot {
    this.lastRequest = this.deps.now();
    if (this.state === 'stopped') void this.start();
    const samples = since === undefined ? [...this.samples] : this.samples.filter((sample) => sample.seq > since);
    return {
      state: this.state === 'unavailable' ? 'unavailable' : this.state === 'running' && this.samples.length ? 'running' : 'starting',
      intervalMs: this.intervalMs,
      static: this.staticInfo(),
      samples,
      consumers: this.consumers(),
    };
  }

  dispose(): void {
    this.stop();
  }

  private async start(): Promise<void> {
    this.state = 'starting';
    try {
      this.probe ??= this.deps.readCache();
      if (!this.probe || this.probe.osRelease !== this.deps.osRelease) await this.reprobe();
      void this.refreshDrives();
      this.drivesTimer = this.deps.setInterval(() => void this.refreshDrives(), DRIVES_EVERY_MS);
      this.idleTimer = this.deps.setInterval(() => { if (this.deps.now() - this.lastRequest > IDLE_MS) this.stop(); }, 5_000);
      this.refreshTimer = this.deps.setInterval(() => this.restartChildren(), REFRESH_INSTANCES_MS);
      this.spawnChildren();
      this.state = 'running';
    } catch (error) {
      this.failure = error instanceof Error ? error.message : String(error);
      this.deps.log?.(`monitoring unavailable: ${this.failure}`);
      this.state = 'unavailable';
    }
  }

  private async reprobe(): Promise<void> {
    this.probe = parseProbe(await this.deps.runProbe(), this.deps.osRelease);
    this.deps.writeCache(this.probe);
  }

  private stop(): void {
    for (const timer of [this.idleTimer, this.refreshTimer, this.drivesTimer]) if (timer) this.deps.clearInterval(timer);
    this.idleTimer = this.refreshTimer = this.drivesTimer = null;
    this.killChildren();
    if (this.state !== 'unavailable') this.state = 'stopped';
  }

  private restartChildren(): void {
    this.killChildren();
    this.spawnChildren();
  }

  private killChildren(): void {
    for (const child of [this.typeperf, this.nvidia]) child?.kill();
    this.typeperf = this.nvidia = null;
    this.columns = null;
    this.buffer = this.nvidiaBuffer = '';
  }

  private spawnChildren(): void {
    const seconds = Math.max(1, Math.round(this.intervalMs / 1000));
    if (this.deps.nvidiaSmi) {
      const nvidia = this.deps.spawn(this.deps.nvidiaSmi, ['--query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits', `--loop-ms=${this.intervalMs}`], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      this.nvidia = nvidia;
      nvidia.stdout?.on('data', (chunk: Buffer) => this.onNvidia(chunk.toString('utf8')));
      nvidia.on('error', () => { this.nvidia = null; });
    }
    const paths = Object.values(this.probe?.counters ?? {}).map((counter) => counter.path);
    if (paths.length === 0) { this.failure = 'Nenhum contador de desempenho disponível neste Windows.'; return; }
    const typeperf = this.deps.spawn(this.deps.typeperf, [...paths, '-si', String(seconds)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.typeperf = typeperf;
    typeperf.stdout?.on('data', (chunk: Buffer) => this.onTypeperf(chunk.toString('latin1')));
    typeperf.on('error', (error) => { this.failure = error.message; this.typeperf = null; });
    typeperf.on('exit', (code) => {
      if (this.typeperf !== typeperf) return;
      this.typeperf = null;
      // A locale or Windows update can invalidate cached names: probe once more, then give up honestly.
      if (code !== 0 && !this.reprobed && this.state === 'running') {
        this.reprobed = true;
        void this.reprobe().then(() => this.spawnChildren(), (error: unknown) => { this.failure = String(error); this.state = 'unavailable'; });
      }
    });
  }

  private onNvidia(text: string): void {
    this.nvidiaBuffer += text;
    const lines = this.nvidiaBuffer.split(/\r?\n/);
    this.nvidiaBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const reading = parseNvidiaLine(line);
      if (reading) this.lastNvidia = reading;
    }
  }

  private onTypeperf(text: string): void {
    this.buffer += text;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('"')) continue;
      const cells = parseCsvLine(line);
      if (!this.columns) {
        if (cells[0]?.startsWith('(PDH-CSV')) this.columns = mapColumns(cells, this.probe?.counters ?? {});
        continue;
      }
      this.push(readRow(cells, this.columns));
    }
  }

  private push(row: CounterRow): void {
    const v = row.values;
    const cores = Math.max(1, this.deps.logicalCores);
    const total = this.deps.totalMemory();
    const available = this.deps.freeMemory();
    const nvidia = this.lastNvidia;
    const adapterMemory = row.instances.gpuDedicated ? Math.max(...row.instances.gpuDedicated.values()) : null;
    const network = networkTotals(row.instances.netDown, row.instances.netUp, row.instances.netLink);
    const app = this.deps.appMetrics();
    const overheadCpu = [v.monitorCpu, v.nvidiaCpu].filter((value): value is number => typeof value === 'number');
    const overheadMemory = [v.monitorMemory, v.nvidiaMemory].filter((value): value is number => typeof value === 'number');
    const frequency = typeof v.cpuFrequency === 'number' && typeof v.cpuPerformance === 'number' ? v.cpuFrequency * (v.cpuPerformance / 100) : v.cpuFrequency ?? null;
    const sample: MonitorSample = {
      seq: ++this.seq,
      at: this.deps.now(),
      cpu: { utilization: clampPercent(v.cpuUtilization), frequencyMhz: frequency === null ? null : Math.round(frequency), temperatureC: cpuTemperature(row.instances.thermal) },
      memory: { usedBytes: total - available, availableBytes: available, totalBytes: total },
      gpu: {
        utilization: nvidia?.utilization ?? gpuUtilization(row.instances.gpuEngine),
        temperatureC: nvidia?.temperatureC ?? null,
        vramUsedBytes: nvidia?.memoryUsedBytes ?? adapterMemory,
        vramTotalBytes: nvidia?.memoryTotalBytes ?? this.probe?.vramTotalBytes ?? null,
      },
      disk: { busy: typeof v.diskIdle === 'number' ? clampPercent(100 - v.diskIdle) : null, readBytesPerSec: nonNegative(v.diskRead), writeBytesPerSec: nonNegative(v.diskWrite) },
      network: { downBytesPerSec: network.down, upBytesPerSec: network.up, linkBitsPerSec: network.link },
      app: app.length ? { cpuPercent: round2(app.reduce((sum, item) => sum + item.cpuPercent, 0) / cores), memoryBytes: app.reduce((sum, item) => sum + item.workingSetBytes, 0) } : { cpuPercent: null, memoryBytes: null },
      overhead: { cpuPercent: overheadCpu.length ? round2(overheadCpu.reduce((a, b) => a + b, 0) / cores) : null, memoryBytes: overheadMemory.length ? overheadMemory.reduce((a, b) => a + b, 0) : null },
    };
    this.samples.push(sample);
    if (this.samples.length > MONITORING_HISTORY) this.samples.splice(0, this.samples.length - MONITORING_HISTORY);
  }

  private async refreshDrives(): Promise<void> {
    const mounts = this.probe?.drives.length ? this.probe.drives : ['C:\\'];
    const drives: MonitorStatic['drives'] = [];
    for (const mount of mounts) {
      try {
        const stats = await this.deps.statfs(mount);
        drives.push({ mount, totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize });
      } catch {
        // A removable or offline drive is skipped, not reported as empty.
      }
    }
    this.drives = drives;
  }

  private staticInfo(): MonitorStatic {
    const last = this.samples.at(-1);
    const counters = this.probe?.counters ?? {};
    const has = (id: keyof typeof counters) => Boolean(counters[id]);
    const unavailable = (reason: string): SourceStatus => ({ available: false, provider: null, reason });
    const counter = (ok: boolean, reason: string): SourceStatus => (ok ? { available: true, provider: COUNTERS_PROVIDER, reason: null } : unavailable(reason));
    const waiting = !last;
    const sources: Record<MonitorSource, SourceStatus> = {
      cpu: counter(has('cpuUtilization'), 'Contador de processador indisponível.'),
      cpuTemperature: last?.cpu.temperatureC != null
        ? { available: true, provider: 'Zona térmica ACPI do Windows', reason: null }
        : unavailable(waiting ? 'Aguardando a primeira leitura.' : 'O Windows não expõe a temperatura do processador sem o driver ou utilitário do fabricante; as zonas térmicas ACPI desta máquina não medem a CPU.'),
      memory: { available: true, provider: 'Sistema operacional (Node.js)', reason: null },
      gpu: this.lastNvidia ? { available: true, provider: NVIDIA_PROVIDER, reason: null } : counter(has('gpuEngine'), 'Contadores de GPU indisponíveis (driver sem suporte a WDDM 2.x).'),
      gpuTemperature: this.lastNvidia?.temperatureC != null ? { available: true, provider: NVIDIA_PROVIDER, reason: null } : unavailable(this.deps.nvidiaSmi ? 'O nvidia-smi não informou temperatura.' : 'Sem nvidia-smi: o Windows não expõe a temperatura da GPU para outras placas sem utilitário do fabricante.'),
      vram: this.lastNvidia?.memoryTotalBytes ? { available: true, provider: NVIDIA_PROVIDER, reason: null } : counter(has('gpuDedicated'), 'Contadores de memória da GPU indisponíveis.'),
      disk: counter(has('diskIdle'), 'Contadores de disco indisponíveis.'),
      network: counter(has('netDown'), 'Contadores de rede indisponíveis.'),
      app: { available: true, provider: 'Métricas de processo do Electron', reason: null },
      overhead: counter(has('monitorCpu'), 'Contador de processo do coletor indisponível.'),
    };
    if (this.state === 'unavailable') for (const key of Object.keys(sources) as MonitorSource[]) if (key !== 'memory' && key !== 'app') sources[key] = unavailable(this.failure ?? 'Coleta indisponível.');
    return { cpuModel: this.deps.cpuModel, logicalCores: this.deps.logicalCores, gpuName: this.lastNvidia?.name ?? this.probe?.gpuName ?? null, drives: this.drives, sources };
  }

  private consumers(): MonitorConsumer[] {
    const last = this.samples.at(-1);
    const app = this.deps.appMetrics();
    const pending = 'Sem grupo de processos registrado: a medição por consumidor chega com o Singularity Core (CORE-05).';
    const base: MonitorConsumer[] = [
      { id: 'singularity', label: 'Singularity (app)', monitored: true, cpuPercent: last?.app.cpuPercent ?? null, memoryBytes: last?.app.memoryBytes ?? null, processes: app.length, reason: null },
      { id: 'claude', label: 'Claude Code', monitored: false, cpuPercent: null, memoryBytes: null, processes: 0, reason: pending },
      { id: 'codex', label: 'Codex CLI', monitored: false, cpuPercent: null, memoryBytes: null, processes: 0, reason: pending },
      { id: 'core', label: 'Singularity Core', monitored: false, cpuPercent: null, memoryBytes: null, processes: 0, reason: 'O Core ainda roda dentro do app (ADR CORE-01); vira um processo próprio no CORE-03.' },
      { id: 'mcp', label: 'Ferramentas MCP', monitored: false, cpuPercent: null, memoryBytes: null, processes: 0, reason: pending },
      { id: 'rag', label: 'Operações RAG', monitored: false, cpuPercent: null, memoryBytes: null, processes: 0, reason: pending },
    ];
    return base.map((consumer) => {
      const group = this.groups.get(consumer.id);
      if (!group || consumer.id === 'singularity') return consumer;
      const pids = new Set(group.pids());
      const members = app.filter((metric) => pids.has(metric.pid));
      if (members.length === 0) return { ...consumer, label: group.label, reason: 'Grupo registrado, sem processos ativos agora.' };
      return { ...consumer, label: group.label, monitored: true, processes: members.length, cpuPercent: round(members.reduce((sum, item) => sum + item.cpuPercent, 0) / Math.max(1, this.deps.logicalCores)), memoryBytes: members.reduce((sum, item) => sum + item.workingSetBytes, 0), reason: null };
    });
  }
}

function clampPercent(value: number | null | undefined): number | null {
  return typeof value === 'number' ? Math.min(100, Math.max(0, round(value))) : null;
}

function nonNegative(value: number | null | undefined): number | null {
  return typeof value === 'number' ? Math.max(0, value) : null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Small shares of the machine (the collector, the app) keep two decimals so they do not round to zero. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export { PROBE_SCRIPT, probeEnv };

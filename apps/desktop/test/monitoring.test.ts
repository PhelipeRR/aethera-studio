import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { monitorSnapshotSchema } from '@neuralbridge/shared';
import { MonitoringCollector, type CollectorDeps } from '../src/main/monitoring/collector.js';
import { cpuTemperature, gpuUtilization, mapColumns, networkTotals, parseCsvLine, parseNumber, parseNvidiaLine, readRow, type LocalizedCounter } from '../src/main/monitoring/parse.js';
import { parseProbe, sanitizeProbe } from '../src/main/monitoring/probe.js';

const counters: Record<string, LocalizedCounter> = {
  cpuUtilization: { path: '\\Info(_Total)\\% Util', object: 'Info', counter: '% Util' },
  cpuPerformance: { path: '\\Info(_Total)\\% Perf', object: 'Info', counter: '% Perf' },
  cpuFrequency: { path: '\\Info(_Total)\\Freq', object: 'Info', counter: 'Freq' },
  thermal: { path: '\\Zona(*)\\Temp', object: 'Zona', counter: 'Temp' },
  diskIdle: { path: '\\PhysicalDisk(_Total)\\% ocioso', object: 'PhysicalDisk', counter: '% ocioso' },
  diskRead: { path: '\\PhysicalDisk(_Total)\\Leitura', object: 'PhysicalDisk', counter: 'Leitura' },
  diskWrite: { path: '\\PhysicalDisk(_Total)\\Grava', object: 'PhysicalDisk', counter: 'Grava' },
  netDown: { path: '\\Rede(*)\\Recebidos', object: 'Rede', counter: 'Recebidos' },
  netUp: { path: '\\Rede(*)\\Enviados', object: 'Rede', counter: 'Enviados' },
  netLink: { path: '\\Rede(*)\\Banda', object: 'Rede', counter: 'Banda' },
  gpuEngine: { path: '\\GPU Engine(*)\\Utilization Percentage', object: 'GPU Engine', counter: 'Utilization Percentage' },
  monitorCpu: { path: '\\Process(typeperf)\\% CPU', object: 'Process', counter: '% CPU' },
  nvidiaCpu: { path: '\\Process(nvidia-smi)\\% CPU', object: 'Process', counter: '% CPU' },
};

const header = [
  '(PDH-CSV 4.0)', '\\\\HOST\\Info(_Total)\\% Util', '\\\\HOST\\Info(_Total)\\% Perf', '\\\\HOST\\Info(_Total)\\Freq', '\\\\HOST\\Zona(\\_TZ.TZ10)\\Temp',
  '\\\\HOST\\PhysicalDisk(_Total)\\% ocioso', '\\\\HOST\\PhysicalDisk(_Total)\\Leitura', '\\\\HOST\\PhysicalDisk(_Total)\\Grava',
  '\\\\HOST\\Rede(Intel[R] Ethernet (2))\\Recebidos', '\\\\HOST\\Rede(Loopback)\\Recebidos', '\\\\HOST\\Rede(Intel[R] Ethernet (2))\\Enviados', '\\\\HOST\\Rede(Intel[R] Ethernet (2))\\Banda',
  '\\\\HOST\\GPU Engine(pid_1_luid_0x0_0xD1_phys_0_eng_0_engtype_3D)\\Utilization Percentage', '\\\\HOST\\GPU Engine(pid_2_luid_0x0_0xD1_phys_0_eng_0_engtype_3D)\\Utilization Percentage',
  '\\\\HOST\\GPU Engine(pid_2_luid_0x0_0xD1_phys_0_eng_5_engtype_Copy)\\Utilization Percentage', '\\\\HOST\\Process(typeperf)\\% CPU', '\\\\HOST\\Process(nvidia-smi)\\% CPU', '\\\\HOST\\Desconhecido\\Algo',
];
const row = ['11/08/2026 22:00:17.000', '5.0', '115', '3800', '3000', '99.5', '64643.5', '40402.2', '8439.4', '999', '1812.3', '1000000000', '20', '25', '70', '1.6', '0', '7'];
const quote = (cells: string[]) => cells.map((cell) => `"${cell}"`).join(',');

describe('typeperf parsing', () => {
  it('splits quoted CSV and reads numbers in either decimal style', () => {
    expect(parseCsvLine('"a","b,c","d""e"')).toEqual(['a', 'b,c', 'd"e']);
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber(' ')).toBeNull();
  });

  it('maps columns by localized object and counter, keeping instances with parentheses', () => {
    const columns = mapColumns(header, counters);
    expect(columns[0]).toBeNull();
    expect(columns[1]).toEqual({ id: 'cpuUtilization', instance: null });
    expect(columns[8]).toEqual({ id: 'netDown', instance: 'Intel[R] Ethernet (2)' });
    expect(columns[15]).toEqual({ id: 'monitorCpu', instance: null });
    expect(columns[16]).toEqual({ id: 'nvidiaCpu', instance: null });
    expect(columns[17]).toBeNull();
  });

  it('derives GPU load per busiest engine type, network totals without loopback and a plausible CPU temperature only', () => {
    const parsed = readRow(row, mapColumns(header, counters));
    expect(gpuUtilization(parsed.instances.gpuEngine)).toBe(70);
    expect(networkTotals(parsed.instances.netDown, parsed.instances.netUp, parsed.instances.netLink)).toEqual({ down: 8439.4, up: 1812.3, link: 1000000000 });
    expect(cpuTemperature(new Map([['zone', 3232]]))).toBe(50.1);
    expect(cpuTemperature(new Map([['zone', 2900]]))).toBeNull();
  });

  it('reads nvidia-smi lines, including N/A sensors', () => {
    expect(parseNvidiaLine('0, NVIDIA GeForce RTX 4060 Ti, 41.01, 3, 2443, 8188')).toEqual({ name: 'NVIDIA GeForce RTX 4060 Ti', temperatureC: 41.01, utilization: 3, memoryUsedBytes: 2443 * 1048576, memoryTotalBytes: 8188 * 1048576 });
    expect(parseNvidiaLine('0, GPU, [N/A], 3, 10, 20')?.temperatureC).toBeNull();
    expect(parseNvidiaLine('garbage')).toBeNull();
  });

  it('decodes the probe output, OEM names as latin1 and invalid VRAM as unknown', () => {
    const probe = parseProbe(`warning\n${JSON.stringify({ counters: { cpuUtilization: { path: '\\Informações(_Total)\\% Útil', object: Buffer.from([0x49, 0x6e, 0x66, 0x6f, 0xc6]).toString('base64'), counter: Buffer.from('% U').toString('base64') }, unknown: { path: 'x', object: '', counter: '' } }, gpuName: 'GPU', vramTotalBytes: 0, drives: ['C:\\'] })}`, '10.0');
    expect(Object.keys(probe.counters)).toEqual(['cpuUtilization']);
    expect(probe.counters.cpuUtilization?.object).toBe('Info\u00c6');
    expect(probe.vramTotalBytes).toBeNull();
  });

  it('treats the cached probe as untrusted: option-like counter paths and odd drives are dropped', () => {
    const cpu = { path: '\\Processor(_Total)\\% Processor Time', object: 'Processor', counter: '% Processor Time' };
    const cached = sanitizeProbe({ osRelease: '10.0', counters: { cpuUtilization: cpu, diskRead: { path: '-o', object: 'x', counter: 'y' }, gpuEngine: { path: '\\A\\B"; -cf C:\\x', object: 'a', counter: 'b' }, injected: cpu }, gpuName: 7, vramTotalBytes: Infinity, drives: ['C:\\', '\\\\server\\share', 'D:\\..\\x'] });
    expect(cached?.counters).toEqual({ cpuUtilization: cpu });
    expect(cached?.drives).toEqual(['C:\\']);
    expect(cached?.gpuName).toBeNull();
    expect(cached?.vramTotalBytes).toBeNull();
    expect(sanitizeProbe({ osRelease: '10.0', counters: { cpuUtilization: { path: '-o C:\\out', object: '', counter: '' } } })).toBeNull();
    expect(sanitizeProbe('garbage')).toBeNull();
  });
});

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  killed = false;
  kill(): boolean { this.killed = true; return true; }
}

function deps(overrides: Partial<CollectorDeps> = {}): CollectorDeps & { children: { command: string; args: readonly string[]; child: FakeChild }[] } {
  const children: { command: string; args: readonly string[]; child: FakeChild }[] = [];
  let now = 1_000;
  return {
    children,
    spawn: (command, args) => { const child = new FakeChild(); children.push({ command, args, child }); return child as unknown as ChildProcess; },
    runProbe: async () => JSON.stringify({ counters: Object.fromEntries(Object.entries(counters).map(([id, c]) => [id, { path: c.path, object: Buffer.from(c.object, 'latin1').toString('base64'), counter: Buffer.from(c.counter, 'latin1').toString('base64') }])), gpuName: 'Placa X', vramTotalBytes: 8 * 1024 ** 3, drives: ['C:\\'] }),
    readCache: () => null,
    writeCache: () => undefined,
    osRelease: '10.0.26300',
    cpuModel: 'CPU X',
    logicalCores: 16,
    totalMemory: () => 32 * 1024 ** 3,
    freeMemory: () => 12 * 1024 ** 3,
    statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 250 }),
    appMetrics: () => [{ pid: 1, cpuPercent: 16, workingSetBytes: 200 * 1024 ** 2 }, { pid: 2, cpuPercent: 16, workingSetBytes: 100 * 1024 ** 2 }],
    typeperf: 'typeperf',
    nvidiaSmi: null,
    now: () => (now += 1000),
    setInterval: (() => 0) as unknown as typeof setInterval,
    clearInterval: (() => undefined) as unknown as typeof clearInterval,
    ...overrides,
  };
}

describe('monitoring collector', () => {
  it('starts on demand, turns typeperf rows into real samples and reports unavailable sensors honestly', async () => {
    const d = deps();
    const collector = new MonitoringCollector(d, 2000);
    expect(collector.snapshot().state).toBe('starting');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const typeperf = d.children.find((entry) => entry.command === 'typeperf');
    expect(typeperf?.args.slice(-2)).toEqual(['-si', '2']);
    typeperf?.child.stdout.write(`\r\n${quote(header)}\r\n${quote(row)}\r\n`);
    const snapshot = collector.snapshot();
    expect(monitorSnapshotSchema.parse(snapshot)).toBeTruthy();
    expect(snapshot.state).toBe('running');
    const [sample] = snapshot.samples;
    expect(sample?.cpu).toEqual({ utilization: 5, frequencyMhz: 4370, temperatureC: 26.9 });
    expect(sample?.memory).toEqual({ usedBytes: 20 * 1024 ** 3, availableBytes: 12 * 1024 ** 3, totalBytes: 32 * 1024 ** 3 });
    expect(sample?.gpu).toEqual({ utilization: 70, temperatureC: null, vramUsedBytes: null, vramTotalBytes: 8 * 1024 ** 3 });
    expect(sample?.disk.busy).toBe(0.5);
    expect(sample?.app).toEqual({ cpuPercent: 2, memoryBytes: 300 * 1024 ** 2 });
    expect(sample?.overhead.cpuPercent).toBe(0.1);
    expect(sample?.app.cpuPercent).toBe(2);
    expect(snapshot.static.sources.gpuTemperature.available).toBe(false);
    expect(snapshot.static.sources.gpuTemperature.reason).toMatch(/nvidia-smi/);
    expect(snapshot.static.drives).toEqual([{ mount: 'C:\\', totalBytes: 4096000, freeBytes: 1024000 }]);
    expect(snapshot.consumers.find((consumer) => consumer.id === 'claude')).toMatchObject({ monitored: false, cpuPercent: null });
    expect(collector.snapshot(sample?.seq).samples).toEqual([]);
  });

  it('prefers nvidia-smi for GPU load, temperature and VRAM when the driver is present', async () => {
    const d = deps({ nvidiaSmi: 'C:\\Windows\\System32\\nvidia-smi.exe' });
    const collector = new MonitoringCollector(d, 1000);
    collector.snapshot();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const nvidia = d.children.find((entry) => entry.command.endsWith('nvidia-smi.exe'));
    expect(nvidia?.args).toContain('--loop-ms=1000');
    nvidia?.child.stdout.write('0, NVIDIA GeForce RTX 4060 Ti, 41, 12, 2443, 8188\n');
    d.children.find((entry) => entry.command === 'typeperf')?.child.stdout.write(`${quote(header)}\r\n${quote(row)}\r\n`);
    const snapshot = collector.snapshot();
    expect(snapshot.samples[0]?.gpu).toEqual({ utilization: 12, temperatureC: 41, vramUsedBytes: 2443 * 1048576, vramTotalBytes: 8188 * 1048576 });
    expect(snapshot.static.gpuName).toBe('NVIDIA GeForce RTX 4060 Ti');
    expect(snapshot.static.sources.gpuTemperature.provider).toMatch(/nvidia-smi/);
  });

  it('restarts the children with the new interval and stops them on dispose', async () => {
    const d = deps();
    const collector = new MonitoringCollector(d, 2000);
    collector.snapshot();
    await new Promise((resolve) => setTimeout(resolve, 0));
    collector.setInterval(5000);
    const runs = d.children.filter((entry) => entry.command === 'typeperf');
    expect(runs[0]?.child.killed).toBe(true);
    expect(runs.at(-1)?.args.slice(-2)).toEqual(['-si', '5']);
    collector.dispose();
    expect(runs.at(-1)?.child.killed).toBe(true);
  });

  it('becomes unavailable, with the reason, when the probe fails', async () => {
    const collector = new MonitoringCollector(deps({ runProbe: async () => { throw new Error('PowerShell bloqueado'); } }), 2000);
    collector.snapshot();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const snapshot = collector.snapshot();
    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.static.sources.cpu).toEqual({ available: false, provider: null, reason: 'PowerShell bloqueado' });
    expect(snapshot.static.sources.memory.available).toBe(true);
  });

  it('keeps a bounded history', async () => {
    const d = deps();
    const collector = new MonitoringCollector(d, 1000);
    collector.snapshot();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const typeperf = d.children.find((entry) => entry.command === 'typeperf');
    typeperf?.child.stdout.write(`${quote(header)}\r\n${Array.from({ length: 320 }, () => quote(row)).join('\r\n')}\r\n`);
    const samples = collector.snapshot().samples;
    expect(samples.length).toBe(300);
    expect(samples[0]?.seq).toBe(21);
  });
});

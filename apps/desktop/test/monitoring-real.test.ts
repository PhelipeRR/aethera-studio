import { mkdtempSync } from 'node:fs';
import { totalmem, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { monitorSnapshotSchema } from '@neuralbridge/shared';
import { createMonitoring } from '../src/main/handlers/monitoring.js';

// Lote 50.08 integration: the real collector on this Windows machine (PDH probe, typeperf, nvidia-smi when present).
// No fakes: values must be within physical ranges and the RAM total must equal what the OS reports.
describe.runIf(process.platform === 'win32')('monitoring on real Windows', () => {
  it('collects real CPU, memory, disk, network and GPU readings without blocking', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-monitoring-'));
    const collector = createMonitoring({ preferencesFile: join(dir, 'preferences.json'), dataDir: dir, appMetrics: () => [] });
    collector.setInterval(1000);
    const started = performance.now();
    const first = collector.snapshot();
    const callMs = performance.now() - started;
    expect(callMs).toBeLessThan(50);
    expect(first.state).toBe('starting');

    let snapshot = first;
    for (let i = 0; i < 40 && snapshot.samples.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      snapshot = collector.snapshot();
    }
    collector.dispose();
    expect(monitorSnapshotSchema.parse(snapshot)).toBeTruthy();
    expect(snapshot.state).toBe('running');
    const sample = snapshot.samples.at(-1);
    expect(sample).toBeDefined();
    if (!sample) return;
    expect(sample.cpu.utilization).toBeGreaterThanOrEqual(0);
    expect(sample.cpu.utilization).toBeLessThanOrEqual(100);
    expect(sample.cpu.frequencyMhz).toBeGreaterThan(300);
    expect(sample.memory.totalBytes).toBe(totalmem());
    expect(sample.memory.availableBytes).toBeGreaterThan(0);
    expect(sample.disk.busy).toBeGreaterThanOrEqual(0);
    expect(sample.disk.readBytesPerSec).toBeGreaterThanOrEqual(0);
    expect(sample.network.downBytesPerSec).toBeGreaterThanOrEqual(0);
    expect(snapshot.static.cpuModel).toBeTruthy();
    expect(snapshot.static.drives.length).toBeGreaterThan(0);
    expect(snapshot.static.gpuName).toBeTruthy();
    if (sample.gpu.vramTotalBytes !== null) expect(sample.gpu.vramUsedBytes ?? 0).toBeLessThanOrEqual(sample.gpu.vramTotalBytes);
    if (sample.cpu.temperatureC === null) expect(snapshot.static.sources.cpuTemperature.reason).toBeTruthy();
    expect(sample.overhead.cpuPercent).not.toBeNull();
  }, 60_000);
});

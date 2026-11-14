import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { cpus, freemem, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { IpcChannel, type MonitoringInterval } from '@neuralbridge/shared';
import { readPreferences, writePreferences } from '../preferences.js';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';
import { MonitoringCollector, PROBE_SCRIPT, probeEnv, type AppProcessMetric } from '../monitoring/collector.js';
import { sanitizeProbe } from '../monitoring/probe.js';

export interface MonitoringDependencies {
  preferencesFile: string;
  dataDir: string;
  appMetrics: () => AppProcessMetric[];
  log?: (message: string) => void;
}

// Lote 50.12 (security review): system tools are started by absolute path under %SystemRoot%, never through PATH,
// so a planted typeperf.exe or powershell.exe in a PATH folder or the working directory is never run.
const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
const system32 = join(systemRoot, 'System32');

/** Runs the one-time PowerShell probe off the main thread's critical path (async child process). */
function runProbe(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(join(system32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PROBE_SCRIPT], { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...probeEnv() } }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

export function createMonitoring(dependencies: MonitoringDependencies): MonitoringCollector {
  const cacheFile = join(dependencies.dataDir, 'monitoring', 'probe.json');
  const nvidiaSmi = join(system32, 'nvidia-smi.exe');
  const cpuList = cpus();
  return new MonitoringCollector(
    {
      spawn,
      runProbe,
      readCache: () => {
        try { return sanitizeProbe(JSON.parse(readFileSync(cacheFile, 'utf8'))); } catch { return null; }
      },
      writeCache: (probe) => {
        try { mkdirSync(dirname(cacheFile), { recursive: true }); writeFileSync(cacheFile, JSON.stringify(probe)); } catch { /* the probe simply runs again next start */ }
      },
      osRelease: release(),
      cpuModel: cpuList[0]?.model.trim() ?? null,
      logicalCores: cpuList.length,
      totalMemory: totalmem,
      freeMemory: freemem,
      statfs: (path) => statfs(path),
      appMetrics: dependencies.appMetrics,
      typeperf: join(system32, 'typeperf.exe'),
      nvidiaSmi: existsSync(nvidiaSmi) ? nvidiaSmi : null,
      now: Date.now,
      setInterval,
      clearInterval,
      ...(dependencies.log ? { log: dependencies.log } : {}),
    },
    readPreferences(dependencies.preferencesFile).monitoring.intervalMs as MonitoringInterval,
  );
}

export function registerMonitoringIpcHandlers(ipc: IpcMainLike, collector: MonitoringCollector, preferencesFile: string, isTrustedSender: (url: string) => boolean): void {
  registerIpcHandler(ipc, IpcChannel.monitoringSnapshot, async ({ since }) => collector.snapshot(since), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.monitoringConfigure, async ({ intervalMs }) => {
    const current = readPreferences(preferencesFile);
    writePreferences(preferencesFile, { ...current, monitoring: { intervalMs } });
    collector.setInterval(intervalMs);
    return { intervalMs };
  }, isTrustedSender);
}

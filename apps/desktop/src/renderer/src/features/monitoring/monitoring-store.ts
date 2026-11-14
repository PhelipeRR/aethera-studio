import { useSyncExternalStore } from 'react';
import { MONITORING_HISTORY, type MonitorConsumer, type MonitoringInterval, type MonitorSample, type MonitorStatic } from '@neuralbridge/shared/monitoring';

/*
 * One polling loop for the whole renderer (lote 50.08): the sidebar meters and the monitoring page share it, so the
 * main process is asked once per interval no matter how many components show metrics. Polling stops while the
 * window is hidden; the main process then idles its collectors after 20 s.
 */

export interface MonitoringState {
  state: 'idle' | 'starting' | 'running' | 'unavailable' | 'error';
  intervalMs: MonitoringInterval;
  samples: MonitorSample[];
  static: MonitorStatic | null;
  consumers: MonitorConsumer[];
}

let snapshot: MonitoringState = { state: 'idle', intervalMs: 2000, samples: [], static: null, consumers: [] };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

function emit(next: MonitoringState): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

async function poll(): Promise<void> {
  timer = null;
  if (listeners.size === 0) return;
  if (!document.hidden && !inFlight) {
    inFlight = true;
    try {
      const last = snapshot.samples.at(-1)?.seq;
      const result = await window.neuralbridge.monitoring.snapshot(last);
      // A restarted main process starts counting again: drop history that no longer lines up.
      const base = result.samples[0] && last !== undefined && result.samples[0].seq <= last ? [] : snapshot.samples;
      const samples = [...base, ...result.samples].slice(-MONITORING_HISTORY);
      emit({ state: result.state, intervalMs: result.intervalMs as MonitoringInterval, samples, static: result.static, consumers: result.consumers });
    } catch {
      emit({ ...snapshot, state: 'error' });
    } finally {
      inFlight = false;
    }
  }
  if (listeners.size > 0) timer = setTimeout(() => void poll(), snapshot.state === 'running' ? snapshot.intervalMs : 1000);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer && !inFlight) void poll();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) { clearTimeout(timer); timer = null; }
  };
}

export function useMonitoring(): MonitoringState {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export async function setMonitoringInterval(intervalMs: MonitoringInterval): Promise<void> {
  const result = await window.neuralbridge.monitoring.configure(intervalMs);
  emit({ ...snapshot, intervalMs: result.intervalMs });
}

/** Series of one metric over the kept history, null where there was no reading. */
export function series(samples: readonly MonitorSample[], pick: (sample: MonitorSample) => number | null): (number | null)[] {
  return samples.map(pick);
}

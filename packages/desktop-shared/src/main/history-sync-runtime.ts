import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Worker } from 'node:worker_threads';
import { discoverHistorySources, type HistoryCheckpoint, type HistorySource } from '@neuralbridge/brain';

type State = { checkpoints: Record<string, HistoryCheckpoint>; lastRun: string | null; sessions: number; proposals: number; errors: number };
const empty: State = { checkpoints: {}, lastRun: null, sessions: 0, proposals: 0, errors: 0 };

function load(file: string): State {
  try { const value = JSON.parse(readFileSync(file, 'utf8')) as State; return { ...empty, ...value, checkpoints: value.checkpoints ?? {} }; } catch { return { ...empty, checkpoints: {} }; }
}
function save(file: string, state: State): void { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(state, null, 2)); }

export function createHistorySyncRuntime(options: { home: string; stateFile: string; enabled: () => boolean; paused: () => boolean; propose: (proposals: unknown[], context: { taskId: null; projectId: string | null; agent: 'claude' | 'codex' }) => Promise<unknown> }) {
  const state = load(options.stateFile);
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let controller: AbortController | null = null;
  const run = async () => {
    if (running || !options.enabled() || options.paused()) return;
    running = true;
    controller = new AbortController();
    try {
    const sources = discoverHistorySources(options.home);
    const worker = new Worker(new URL('./history-sync-worker.js', import.meta.url));
    const batches = await new Promise<Array<{ source: HistorySource; checkpoint: HistoryCheckpoint; records: Array<{ id: string; agent: 'claude' | 'codex'; projectId: string | null; proposals: unknown[] }> }>>((resolve, reject) => {
      worker.once('message', resolve); worker.once('error', reject); worker.postMessage({ home: options.home, sources, checkpoints: state.checkpoints, maxRecords: 100 });
      controller?.signal.addEventListener('abort', () => { void worker.terminate(); reject(new Error('history_sync_cancelled')); }, { once: true });
    });
    for (const batch of batches) {
      if (controller.signal.aborted) break;
      for (const item of batch.records) { if (controller.signal.aborted) break; if (!item.proposals.length) continue; await options.propose(item.proposals, { taskId: null, projectId: item.projectId, agent: item.agent }); state.proposals += item.proposals.length; await new Promise<void>((resolve) => setImmediate(resolve)); }
      if (!controller.signal.aborted) { state.checkpoints[batch.source.path] = batch.checkpoint; state.sessions += batch.records.length; save(options.stateFile, state); }
    }
    state.lastRun = new Date().toISOString(); save(options.stateFile, state);
    await worker.terminate();
    } catch { state.errors++; save(options.stateFile, state); }
    finally { controller = null; running = false; }
  };
  return {
    start: (intervalMs: number) => { if (!timer) { void run(); timer = setInterval(() => void run(), intervalMs); } },
    stop: () => { if (timer) clearInterval(timer); timer = null; controller?.abort(); },
    run,
    status: () => ({ lastRun: state.lastRun, sessions: state.sessions, proposals: state.proposals, errors: state.errors, running }),
  };
}


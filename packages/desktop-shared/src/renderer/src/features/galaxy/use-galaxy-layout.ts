import * as React from 'react';
import type { GalaxySnapshot } from '@neuralbridge/shared/brain3d';
import { layoutGalaxy, type GalaxyGroup, type GroupMode, type LayoutMemory } from './galaxy-layout';
import type { WorkerRequest, WorkerResponse } from './galaxy-worker-protocol';

export interface GalaxyLayoutState {
  status: 'idle' | 'computing' | 'ready' | 'error';
  mode: GroupMode;
  positions: Float32Array | null;
  group: Uint16Array | null;
  groups: GalaxyGroup[];
  /** Memories placed by their embedding. */
  withVector: number;
  explained: number;
  /** Worker time for projection + clustering, and for the last layout. */
  workerMs: { load: number | null; layout: number | null };
  /** The worker could not start: positions come from a cheap id hash, not from meaning. */
  degraded: boolean;
  error: string | null;
}

const EMPTY: GalaxyLayoutState = { status: 'idle', mode: 'type', positions: null, group: null, groups: [], withVector: 0, explained: 0, workerMs: { load: null, layout: null }, degraded: false, error: null };

function layoutMemories(snapshot: GalaxySnapshot): LayoutMemory[] {
  return snapshot.memories.map((memory) => ({ id: memory.id, type: memory.type, projectId: memory.projectId, projectName: memory.projectName, tags: memory.tags }));
}

function createWorker(): Worker | null {
  try {
    return new Worker(new URL('./galaxy.worker.ts', import.meta.url), { type: 'module', name: 'galaxy-layout' });
  } catch {
    return null;
  }
}

/** Runs the galaxy layout in a Web Worker; the UI thread only receives finished positions. */
export function useGalaxyLayout(snapshot: GalaxySnapshot | undefined, mode: GroupMode) {
  const [state, setState] = React.useState<GalaxyLayoutState>(EMPTY);
  const workerRef = React.useRef<Worker | null>(null);
  const request = React.useRef(0);
  // Separate counter: a neighbour lookup must never make an in-flight layout look stale.
  const nearestRequest = React.useRef(1_000_000);
  const nearestWaiters = React.useRef(new Map<number, (value: { id: string; score: number }[]) => void>());
  const loadedSnapshot = React.useRef<GalaxySnapshot | null>(null);

  React.useEffect(() => {
    const worker = createWorker();
    workerRef.current = worker;
    if (!worker) return;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.kind === 'loaded') setState((current) => ({ ...current, withVector: message.withVector, explained: message.explained, workerMs: { ...current.workerMs, load: message.ms } }));
      else if (message.kind === 'layout') {
        if (message.requestId !== request.current) return;
        setState((current) => ({ ...current, status: 'ready', mode: message.mode, positions: message.positions, group: message.group, groups: message.groups, workerMs: { ...current.workerMs, layout: message.ms }, error: null }));
      } else if (message.kind === 'nearest') {
        nearestWaiters.current.get(message.requestId)?.(message.neighbours);
        nearestWaiters.current.delete(message.requestId);
      } else if (message.kind === 'error') setState((current) => ({ ...current, status: 'error', error: message.message }));
    };
    worker.onerror = (event) => setState((current) => ({ ...current, status: 'error', error: event.message || 'Falha no worker da galáxia.' }));
    return () => {
      worker.terminate();
      workerRef.current = null;
      loadedSnapshot.current = null;
    };
  }, []);

  React.useEffect(() => {
    if (!snapshot) return;
    const worker = workerRef.current;
    const memories = layoutMemories(snapshot);
    if (!worker) {
      // No worker: hash-only placement, which costs a few milliseconds even at 5,000 memories.
      const projection = { coords: new Float32Array(memories.length * 3).fill(Number.NaN), hasVector: new Uint8Array(memories.length), explained: 0 };
      const effective = mode === 'semantic' ? 'type' : mode;
      const result = layoutGalaxy(memories, projection, effective, null);
      setState({ ...EMPTY, status: 'ready', mode: effective, positions: result.positions, group: result.group, groups: result.groups, degraded: true });
      return;
    }
    const requestId = ++request.current;
    setState((current) => ({ ...current, status: 'computing' }));
    if (loadedSnapshot.current !== snapshot) {
      loadedSnapshot.current = snapshot;
      const vectors = snapshot.embeddings ? snapshot.embeddings.vectors.slice().buffer : new ArrayBuffer(0);
      const message: WorkerRequest = { kind: 'load', requestId, snapshotId: String(requestId), mode, memories, vectorIds: snapshot.embeddings?.ids ?? [], dim: snapshot.embeddings?.dim ?? 0, vectors };
      worker.postMessage(message, [vectors]);
    } else {
      worker.postMessage({ kind: 'layout', requestId, mode } satisfies WorkerRequest);
    }
  }, [snapshot, mode]);

  const nearest = React.useCallback((id: string, k = 5) => new Promise<{ id: string; score: number }[]>((resolve) => {
    const worker = workerRef.current;
    if (!worker) { resolve([]); return; }
    const requestId = ++nearestRequest.current;
    nearestWaiters.current.set(requestId, resolve);
    worker.postMessage({ kind: 'nearest', requestId, id, k } satisfies WorkerRequest);
  }), []);

  return { ...state, nearest };
}

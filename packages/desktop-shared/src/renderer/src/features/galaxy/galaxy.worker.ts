/// <reference lib="webworker" />
import { layoutGalaxy, nearestByMeaning, project, semanticClusters, type GroupMode, type LayoutInput, type LayoutMemory, type Projection } from './galaxy-layout';
import type { WorkerRequest, WorkerResponse } from './galaxy-worker-protocol';

// Memory Galaxy worker (lote 50.06): all projection, clustering and nearest-neighbour work happens here, never on
// the UI thread. The snapshot is kept between messages so changing the grouping only re-runs the cheap layout.

let input: LayoutInput | null = null;
let projection: Projection | null = null;
let clusters: Int16Array | null = null;
let snapshotId = '';

const post = (message: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(message, transfer);

function layout(mode: GroupMode, requestId: number): void {
  if (!input || !projection) return;
  const started = performance.now();
  const result = layoutGalaxy(input.memories, projection, mode, mode === 'semantic' ? clusters : null);
  post({ kind: 'layout', requestId, snapshotId, mode, positions: result.positions, group: result.group, groups: result.groups, ms: performance.now() - started }, [result.positions.buffer, result.group.buffer]);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.kind === 'load') {
      const started = performance.now();
      const memories: LayoutMemory[] = message.memories;
      input = { memories, vectorIds: message.vectorIds, dim: message.dim, vectors: new Float32Array(message.vectors) };
      snapshotId = message.snapshotId;
      projection = project(input);
      clusters = input.vectorIds.length > 1 ? semanticClusters(input) : null;
      post({ kind: 'loaded', requestId: message.requestId, snapshotId, explained: projection.explained, withVector: input.vectorIds.length, ms: performance.now() - started });
      layout(message.mode, message.requestId);
    } else if (message.kind === 'layout') {
      layout(message.mode, message.requestId);
    } else if (message.kind === 'nearest') {
      post({ kind: 'nearest', requestId: message.requestId, id: message.id, neighbours: input ? nearestByMeaning(input, message.id, message.k) : [] });
    }
  } catch (error) {
    post({ kind: 'error', requestId: message.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};

import type { GalaxyGroup, GroupMode, LayoutMemory } from './galaxy-layout';

export type WorkerRequest =
  | { kind: 'load'; requestId: number; snapshotId: string; mode: GroupMode; memories: LayoutMemory[]; vectorIds: string[]; dim: number; vectors: ArrayBuffer }
  | { kind: 'layout'; requestId: number; mode: GroupMode }
  | { kind: 'nearest'; requestId: number; id: string; k: number };

export type WorkerResponse =
  | { kind: 'loaded'; requestId: number; snapshotId: string; explained: number; withVector: number; ms: number }
  | { kind: 'layout'; requestId: number; snapshotId: string; mode: GroupMode; positions: Float32Array; group: Uint16Array; groups: GalaxyGroup[]; ms: number }
  | { kind: 'nearest'; requestId: number; id: string; neighbours: { id: string; score: number }[] }
  | { kind: 'error'; requestId: number; message: string };

import type { Brain3DMemory } from '@neuralbridge/shared/brain3d';
import { brainSdf, REGIONS, type BrainCloud, type Region } from './anatomy';
import { hashString } from './rng';

// Where each memory sits: its project picks a region (lobe and hemisphere), its id picks a point in it.
// Nothing depends on the other memories, so a memory keeps its place when others are added or removed.

const PROJECT_REGIONS: { region: Region; hemisphere: -1 | 1 }[] = (['frontal', 'parietal', 'temporal', 'occipital'] as const).flatMap((region) => [
  { region, hemisphere: -1 as const },
  { region, hemisphere: 1 as const },
]);

/** Global memories live in the cerebellum; each project gets one lobe of one hemisphere. */
export function regionForProject(projectId: string | null): { region: Region; hemisphere: -1 | 0 | 1 } {
  if (projectId === null) return { region: 'cerebellum', hemisphere: 0 };
  return PROJECT_REGIONS[hashString(projectId) % PROJECT_REGIONS.length] ?? { region: 'frontal', hemisphere: -1 };
}

const candidatesCache = new WeakMap<BrainCloud, Map<string, number[]>>();

function candidates(cloud: BrainCloud, region: Region, hemisphere: number): number[] {
  let byRegion = candidatesCache.get(cloud);
  if (!byRegion) {
    byRegion = new Map();
    candidatesCache.set(cloud, byRegion);
  }
  const key = `${region}:${hemisphere}`;
  const cached = byRegion.get(key);
  if (cached) return cached;
  const regionIndex = REGIONS.indexOf(region);
  const list: number[] = [];
  for (let i = 0; i < cloud.count; i++) {
    if (!cloud.surface[i] || cloud.regions[i] !== regionIndex) continue;
    if (hemisphere !== 0 && cloud.hemisphere[i] !== hemisphere) continue;
    list.push(i);
  }
  byRegion.set(key, list);
  return list;
}

/** Positions (x, y, z) and region index for each memory, in the given order. */
export function placeMemories(memories: readonly Pick<Brain3DMemory, 'id' | 'projectId'>[], cloud: BrainCloud): { positions: Float32Array; regions: Uint8Array } {
  const positions = new Float32Array(memories.length * 3);
  const regions = new Uint8Array(memories.length);
  memories.forEach((memory, i) => {
    const { region, hemisphere } = regionForProject(memory.projectId);
    let list = candidates(cloud, region, hemisphere);
    if (!list.length) list = candidates(cloud, region, 0);
    const hash = hashString(memory.id);
    const particle = list[hash % list.length] ?? 0;
    let x = (cloud.positions[particle * 3] ?? 0);
    let y = (cloud.positions[particle * 3 + 1] ?? 0);
    let z = (cloud.positions[particle * 3 + 2] ?? 0);
    // Lift slightly off the surface along its normal, plus a per-id nudge so two memories never coincide.
    const e = 0.004;
    const nx = brainSdf(x + e, y, z) - brainSdf(x - e, y, z);
    const ny = brainSdf(x, y + e, z) - brainSdf(x, y - e, z);
    const nz = brainSdf(x, y, z + e) - brainSdf(x, y, z - e);
    const length = Math.hypot(nx, ny, nz) || 1;
    const lift = 0.035;
    const jitter = (shift: number) => (((hash >>> shift) & 0xff) / 255 - 0.5) * 0.02;
    x += (nx / length) * lift + jitter(8);
    y += (ny / length) * lift + jitter(16);
    z += (nz / length) * lift + jitter(24);
    positions.set([x, y, z], i * 3);
    regions[i] = REGIONS.indexOf(region);
  });
  return { positions, regions };
}

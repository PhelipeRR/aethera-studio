import { createRng } from './rng';

// A procedural human brain built from signed distance functions: no third-party mesh, so no licence to
// track. Axes: x left (-) to right (+), y down (-) to up (+), z back (-) to front (+). One unit is about
// 10 cm; the cerebrum is longer than wide and wider than tall, as in an adult brain.

export const REGIONS = ['frontal', 'parietal', 'temporal', 'occipital', 'cerebellum', 'brainstem'] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_LABEL: Record<Region, string> = {
  frontal: 'Lobo frontal',
  parietal: 'Lobo parietal',
  temporal: 'Lobo temporal',
  occipital: 'Lobo occipital',
  cerebellum: 'Cerebelo',
  brainstem: 'Tronco encefálico',
};

export interface BrainCloud {
  count: number;
  /** x, y, z per point. */
  positions: Float32Array;
  /** Index into REGIONS per point. */
  regions: Uint8Array;
  /** -1 left, 1 right, 0 on the midline. */
  hemisphere: Int8Array;
  /** 1 on the surface, 0 inside. */
  surface: Uint8Array;
}

const BOUNDS = { min: [-0.78, -1.12, -0.92], max: [0.78, 0.64, 0.94] } as const;
const SURFACE_SHELL = 0.01;
const INTERIOR_DEPTH = 0.04;

function ellipsoid(px: number, py: number, pz: number, rx: number, ry: number, rz: number): number {
  const k0 = Math.hypot(px / rx, py / ry, pz / rz);
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

function smoothUnion(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function capsule(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / (abx * abx + aby * aby + abz * abz)));
  return Math.hypot(px - ax - abx * t, py - ay - aby * t, pz - az - abz * t) - (ra + (rb - ra) * t);
}

/** Cerebrum: two hemispheres with folded cortex, temporal lobes and the longitudinal fissure. */
function cerebrum(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  let d = ellipsoid(ax - 0.3, y - 0.05, z, 0.37, 0.5, 0.82);
  d = Math.max(d, -(y + 0.3)); // flat underside...
  d = smoothUnion(d, ellipsoid(ax - 0.42, y + 0.26, z - 0.1, 0.24, 0.2, 0.44), 0.08); // ...with temporal lobes hanging below
  // Gyri and sulci: interfering waves give irregular folds rather than a regular pattern.
  d += 0.022 * Math.sin(9.1 * x + 2.1 * Math.sin(7.3 * z)) * Math.sin(8.3 * y + 1.7 * Math.sin(6.1 * x)) * Math.sin(9.7 * z + 1.3 * Math.sin(8.9 * y));
  // Longitudinal fissure along the top, between the hemispheres.
  if (y > -0.08) d = Math.max(d, 0.028 - ax);
  return d;
}

function cerebellum(x: number, y: number, z: number): number {
  return ellipsoid(x, y + 0.42, z + 0.5, 0.46, 0.21, 0.28) + 0.01 * Math.sin(62 * y + 9 * z);
}

function brainstem(x: number, y: number, z: number): number {
  return capsule(x, y, z, 0, -0.28, -0.2, 0, -1.04, -0.3, 0.12, 0.075);
}

export function brainSdf(x: number, y: number, z: number): number {
  return smoothUnion(smoothUnion(cerebrum(x, y, z), cerebellum(x, y, z), 0.05), brainstem(x, y, z), 0.07);
}

export function regionAt(x: number, y: number, z: number): number {
  const c = cerebrum(x, y, z);
  const cb = cerebellum(x, y, z);
  const bs = brainstem(x, y, z);
  if (bs < c && bs < cb) return 5;
  if (cb < c) return 4;
  if (y < -0.1 && Math.abs(x) > 0.24 && z > -0.42) return 2;
  if (z > 0.22) return 0;
  if (z < -0.48) return 3;
  return 1;
}

/** Builds a cloud by sampling; `run(budget)` tries that many candidates and returns true when the cloud is full. Shared by both samplers. */
function sampler({ count, interiorRatio, seed }: { count: number; interiorRatio: number; seed: number }) {
  const random = createRng(seed);
  const cloud: BrainCloud = {
    count,
    positions: new Float32Array(count * 3),
    regions: new Uint8Array(count),
    hemisphere: new Int8Array(count),
    surface: new Uint8Array(count),
  };
  const interiorTarget = Math.round(count * interiorRatio);
  let interior = 0;
  let surface = 0;
  const span = [BOUNDS.max[0] - BOUNDS.min[0], BOUNDS.max[1] - BOUNDS.min[1], BOUNDS.max[2] - BOUNDS.min[2]];
  const run = (budget: number): boolean => {
    for (let tries = 0; tries < budget && interior + surface < count; tries++) {
      const x = BOUNDS.min[0] + random() * (span[0] ?? 0);
      const y = BOUNDS.min[1] + random() * (span[1] ?? 0);
      const z = BOUNDS.min[2] + random() * (span[2] ?? 0);
      const d = brainSdf(x, y, z);
      let onSurface: boolean;
      if (Math.abs(d) < SURFACE_SHELL && surface < count - interiorTarget) onSurface = true;
      else if (d < -INTERIOR_DEPTH && interior < interiorTarget) onSurface = false;
      else continue;
      const i = interior + surface;
      cloud.positions[i * 3] = x;
      cloud.positions[i * 3 + 1] = y;
      cloud.positions[i * 3 + 2] = z;
      cloud.regions[i] = regionAt(x, y, z);
      cloud.hemisphere[i] = x < -0.005 ? -1 : x > 0.005 ? 1 : 0;
      cloud.surface[i] = onSurface ? 1 : 0;
      if (onSurface) surface++;
      else interior++;
    }
    return interior + surface >= count;
  };
  return { cloud, run };
}

/**
 * Points on the brain's surface (and a share inside), by rejection sampling: uniform density over the
 * surface, so folds and lobes read through the point density as in an anatomical point cloud.
 */
export function sampleBrain(options: { count: number; interiorRatio: number; seed: number }): BrainCloud {
  const { cloud, run } = sampler(options);
  while (!run(1_000_000));
  return cloud;
}

/**
 * The same cloud as sampleBrain, built in slices of `chunk` candidate points with a pause between
 * them, so drawing 40,000 points never freezes the window. Stops with an AbortError when `signal` aborts.
 */
export async function sampleBrainAsync(
  options: { count: number; interiorRatio: number; seed: number },
  { chunk = 20_000, yieldTo = () => new Promise<void>((resolve) => setTimeout(resolve, 0)), signal }: { chunk?: number; yieldTo?: () => Promise<void>; signal?: AbortSignal } = {},
): Promise<BrainCloud> {
  const { cloud, run } = sampler(options);
  while (!run(chunk)) {
    await yieldTo();
    if (signal?.aborted) throw new DOMException('Brain sampling aborted', 'AbortError');
  }
  return cloud;
}

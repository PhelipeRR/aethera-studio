import { describe, expect, it } from 'vitest';
import { brainSdf, REGIONS, sampleBrain, type Region } from '../src/renderer/src/features/brain3d/anatomy.js';
import { buildNetwork } from '../src/renderer/src/features/brain3d/network.js';
import { createRng } from '../src/renderer/src/features/brain3d/rng.js';

const cloud = sampleBrain({ count: 12_000, interiorRatio: 0.15, seed: 7 });

function centroid(region: Region | Region[]) {
  const wanted = new Set(Array.isArray(region) ? region : [region]);
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (let i = 0; i < cloud.count; i++) {
    if (!wanted.has(REGIONS[cloud.regions[i] ?? 0] as Region)) continue;
    x += cloud.positions[i * 3] ?? 0;
    y += cloud.positions[i * 3 + 1] ?? 0;
    z += cloud.positions[i * 3 + 2] ?? 0;
    n++;
  }
  return { x: x / n, y: y / n, z: z / n, n };
}

describe('random numbers', () => {
  it('repeat for the same seed and differ between seeds', () => {
    const a = createRng(1);
    const b = createRng(1);
    const c = createRng(2);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});

describe('procedural brain', () => {
  it('samples the requested number of points, on the surface or inside, deterministically', () => {
    expect(cloud.count).toBe(12_000);
    expect(cloud.positions).toHaveLength(36_000);
    let surface = 0;
    for (let i = 0; i < cloud.count; i++) {
      const d = brainSdf((cloud.positions[i * 3] ?? 0), (cloud.positions[i * 3 + 1] ?? 0), (cloud.positions[i * 3 + 2] ?? 0));
      if (cloud.surface[i]) {
        surface++;
        expect(Math.abs(d)).toBeLessThan(0.02);
      } else {
        expect(d).toBeLessThan(0);
      }
    }
    expect(surface / cloud.count).toBeCloseTo(0.85, 1);
    expect(sampleBrain({ count: 500, interiorRatio: 0.15, seed: 7 }).positions).toEqual(sampleBrain({ count: 500, interiorRatio: 0.15, seed: 7 }).positions);
  });

  it('has the recognisable anatomy: two hemispheres, lobes, cerebellum behind and below, brainstem lowest', () => {
    for (const region of REGIONS) expect(centroid(region).n, region).toBeGreaterThan(100);
    const left = Array.from(cloud.hemisphere).filter((side) => side < 0).length;
    const right = Array.from(cloud.hemisphere).filter((side) => side > 0).length;
    expect(Math.abs(left - right) / (left + right)).toBeLessThan(0.08);

    const cerebrum = centroid(['frontal', 'parietal', 'temporal', 'occipital']);
    const cerebellum = centroid('cerebellum');
    const stem = centroid('brainstem');
    expect(cerebellum.y).toBeLessThan(cerebrum.y);
    expect(cerebellum.z).toBeLessThan(cerebrum.z);
    expect(stem.y).toBeLessThan(cerebellum.y);
    expect(centroid('frontal').z).toBeGreaterThan(centroid('occipital').z);
    expect(centroid('temporal').y).toBeLessThan(centroid('parietal').y);
  });

  it('keeps the cerebrum longer than wide and wider than tall, like a human brain', () => {
    const extent = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] };
    for (let i = 0; i < cloud.count; i++) {
      if ((cloud.regions[i] ?? 0) > 3) continue; // lobes only
      (['x', 'y', 'z'] as const).forEach((axis, k) => {
        const v = (cloud.positions[i * 3 + k] ?? 0);
        extent[axis][0] = Math.min((extent[axis][0] ?? 0), v);
        extent[axis][1] = Math.max((extent[axis][1] ?? 0), v);
      });
    }
    const size = (axis: 'x' | 'y' | 'z') => (extent[axis][1] ?? 0) - (extent[axis][0] ?? 0);
    expect(size('z')).toBeGreaterThan(size('x'));
    expect(size('x')).toBeGreaterThan(size('y'));
  });

  it('separates the hemispheres with a fissure along the top', () => {
    // Points on the very top of the brain stay off the midline.
    let topMidline = 0;
    for (let i = 0; i < cloud.count; i++) {
      const x = (cloud.positions[i * 3] ?? 0);
      const y = (cloud.positions[i * 3 + 1] ?? 0);
      if (y > 0.35 && Math.abs(x) < 0.012) topMidline++;
    }
    expect(topMidline).toBe(0);
  });
});

describe('decorative network', () => {
  const network = buildNetwork(cloud.positions, cloud.regions, { nodes: 2_000, neighbours: 3, maxDistance: 0.12, longRange: 40, seed: 3 });

  it('connects every node, without self or duplicate edges', () => {
    const seen = new Set<string>();
    for (let e = 0; e < network.edgeCount; e++) {
      const a = (network.edges[e * 2] ?? 0);
      const b = (network.edges[e * 2 + 1] ?? 0);
      expect(a).not.toBe(b);
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    for (let n = 0; n < network.nodeCount; n++) expect(network.adjacency[n]?.length ?? 0, `node ${n}`).toBeGreaterThan(0);
    const mean = (network.edgeCount * 2) / network.nodeCount;
    expect(mean).toBeGreaterThan(2.5);
    expect(mean).toBeLessThan(8);
  });

  it('adds a few long connections between different regions, and is deterministic', () => {
    let crossRegion = 0;
    for (let e = 0; e < network.edgeCount; e++) {
      const a = network.nodeParticle[network.edges[e * 2] ?? 0] ?? 0;
      const b = network.nodeParticle[network.edges[e * 2 + 1] ?? 0] ?? 0;
      if (cloud.regions[a] !== cloud.regions[b]) crossRegion++;
    }
    expect(crossRegion).toBeGreaterThanOrEqual(20);
    const again = buildNetwork(cloud.positions, cloud.regions, { nodes: 2_000, neighbours: 3, maxDistance: 0.12, longRange: 40, seed: 3 });
    expect(again.edges).toEqual(network.edges);
  });
});

describe('sampling without blocking', () => {
  it('yields while sampling and produces exactly the same brain as the synchronous sampler', async () => {
    const { sampleBrainAsync } = await import('../src/renderer/src/features/brain3d/anatomy.js');
    let yields = 0;
    const cloudAsync = await sampleBrainAsync({ count: 3_000, interiorRatio: 0.15, seed: 4 }, { chunk: 200, yieldTo: async () => void yields++ });
    expect(cloudAsync.positions).toEqual(sampleBrain({ count: 3_000, interiorRatio: 0.15, seed: 4 }).positions);
    expect(yields).toBeGreaterThan(5);
  });

  it('stops when the view goes away', async () => {
    const { sampleBrainAsync } = await import('../src/renderer/src/features/brain3d/anatomy.js');
    const controller = new AbortController();
    const pending = sampleBrainAsync({ count: 50_000, interiorRatio: 0.15, seed: 4 }, { chunk: 100, yieldTo: async () => controller.abort(), signal: controller.signal });
    await expect(pending).rejects.toThrow(/abort/i);
  });
});

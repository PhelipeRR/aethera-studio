import { describe, expect, it } from 'vitest';
import { sampleBrain } from '../src/renderer/src/features/brain3d/anatomy.js';
import { ImpulseField, type ImpulseOptions } from '../src/renderer/src/features/brain3d/impulses.js';
import { buildNetwork } from '../src/renderer/src/features/brain3d/network.js';

const cloud = sampleBrain({ count: 6_000, interiorRatio: 0.1, seed: 11 });
const network = buildNetwork(cloud.positions, cloud.regions, { nodes: 1_200, neighbours: 3, maxDistance: 0.14, longRange: 20, seed: 5 });
const OPTIONS: ImpulseOptions = { maxImpulses: 60, spawnPerSecond: 8, speed: [0.35, 0.9], branchProbability: 0.35, hopFade: 0.82, nodeDecayPerSecond: 2.5, seed: 9 };

function run(field: ImpulseField, seconds: number, onStep?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    field.step(1 / 60);
    onStep?.();
  }
}

function pointToSegment(p: number[], a: number[], b: number[]): number {
  const ab = [(b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0), (b[2] ?? 0) - (a[2] ?? 0)];
  const ap = [(p[0] ?? 0) - (a[0] ?? 0), (p[1] ?? 0) - (a[1] ?? 0), (p[2] ?? 0) - (a[2] ?? 0)];
  const t = Math.min(1, Math.max(0, ((ap[0] ?? 0) * (ab[0] ?? 0) + (ap[1] ?? 0) * (ab[1] ?? 0) + (ap[2] ?? 0) * (ab[2] ?? 0)) / ((ab[0] ?? 0) ** 2 + (ab[1] ?? 0) ** 2 + (ab[2] ?? 0) ** 2)));
  return Math.hypot((ap[0] ?? 0) - (ab[0] ?? 0) * t, (ap[1] ?? 0) - (ab[1] ?? 0) * t, (ap[2] ?? 0) - (ab[2] ?? 0) * t);
}

describe('neural impulses', () => {
  it('only ever travel along existing connections', () => {
    const field = new ImpulseField(network, OPTIONS);
    const point = new Float32Array(3);
    let checked = 0;
    run(field, 8, () => {
      for (const impulse of field.impulses) {
        const a = (network.edges[impulse.edge * 2] ?? 0);
        const b = (network.edges[impulse.edge * 2 + 1] ?? 0);
        field.positionOf(impulse, point);
        const pa = Array.from(network.nodePositions.subarray(a * 3, a * 3 + 3));
        const pb = Array.from(network.nodePositions.subarray(b * 3, b * 3 + 3));
        expect(pointToSegment(Array.from(point), pa, pb)).toBeLessThan(1e-5);
        expect(impulse.progress).toBeGreaterThanOrEqual(0);
        expect(impulse.progress).toBeLessThanOrEqual(1);
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(1_000);
  });

  it('run many at once in different directions, never above the limit', () => {
    const field = new ImpulseField(network, OPTIONS);
    let peak = 0;
    let opposed = false;
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    run(field, 10, () => {
      peak = Math.max(peak, field.impulses.length);
      const list = field.impulses;
      for (let i = 0; i < list.length && !opposed; i++)
        for (let j = i + 1; j < list.length && !opposed; j++) {
          const first = list[i];
          const second = list[j];
          if (!first || !second) continue;
          field.directionOf(first, a);
          field.directionOf(second, b);
          if ((a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0) < -0.5) opposed = true;
        }
    });
    expect(peak).toBeGreaterThan(5);
    expect(peak).toBeLessThanOrEqual(OPTIONS.maxImpulses);
    expect(opposed).toBe(true);
  });

  it('light the nodes they cross, branch into neighbouring connections and fade out', () => {
    const field = new ImpulseField(network, { ...OPTIONS, spawnPerSecond: 0 });
    for (const node of [0, 100, 200, 300, 400]) field.fire(node, 1, 'ambient');
    let maxActivation = 0;
    run(field, 3, () => {
      maxActivation = Math.max(maxActivation, ...field.nodeActivation);
    });
    expect(field.stats.branches).toBeGreaterThan(0);
    expect(field.stats.hops).toBeGreaterThan(2);
    expect(maxActivation).toBeGreaterThan(0.3);
    run(field, 12);
    expect(field.impulses).toHaveLength(0);
    expect(Math.max(...field.nodeActivation)).toBeLessThan(0.01);
  });

  it('keep ambient activity irregular: no fixed rhythm between new impulses', () => {
    const field = new ImpulseField(network, OPTIONS);
    run(field, 30);
    const gaps = field.stats.spawnTimes.slice(1).map((time, i) => time - (field.stats.spawnTimes[i] ?? 0));
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const deviation = Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - mean) ** 2, 0) / gaps.length);
    expect(gaps.length).toBeGreaterThan(100);
    expect(deviation / mean).toBeGreaterThan(0.5); // a fixed period would give 0
  });

  it('keep real activity apart from ambient activity, and real activity only comes from fire()', () => {
    const quiet = new ImpulseField(network, { ...OPTIONS, spawnPerSecond: 0 });
    run(quiet, 2);
    expect(quiet.impulses).toHaveLength(0);
    quiet.fire(10, 1, 'real');
    run(quiet, 0.5);
    expect(quiet.impulses.length).toBeGreaterThan(0);
    expect(quiet.impulses.every((impulse) => impulse.kind === 'real')).toBe(true);
    expect(Math.max(...quiet.realActivation)).toBeGreaterThan(0);

    const ambient = new ImpulseField(network, OPTIONS);
    run(ambient, 3);
    expect(ambient.impulses.every((impulse) => impulse.kind === 'ambient')).toBe(true);
    expect(Math.max(...ambient.realActivation)).toBe(0);
  });

  it('stop new ambient impulses when ambient activity is switched off, and repeat for a seed', () => {
    const field = new ImpulseField(network, OPTIONS);
    run(field, 2);
    field.ambient = false;
    run(field, 15);
    expect(field.impulses).toHaveLength(0);

    const one = new ImpulseField(network, OPTIONS);
    const two = new ImpulseField(network, OPTIONS);
    run(one, 3);
    run(two, 3);
    expect(two.impulses.map((impulse) => [impulse.edge, impulse.progress])).toEqual(one.impulses.map((impulse) => [impulse.edge, impulse.progress]));
  });
});

describe('reduced motion', () => {
  it('can light a node without sending any impulse', () => {
    const field = new ImpulseField(network, { ...OPTIONS, spawnPerSecond: 0 });
    field.highlight(7, 1, 'real');
    expect(field.impulses).toHaveLength(0);
    expect(field.realActivation[7]).toBeGreaterThan(0.9);
  });
});

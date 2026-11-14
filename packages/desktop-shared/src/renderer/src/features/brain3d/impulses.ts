import type { Network } from './network';
import { createRng } from './rng';

export type ImpulseKind = 'ambient' | 'real';

export interface Impulse {
  edge: number;
  from: number;
  to: number;
  /** 0 at `from`, 1 at `to`. */
  progress: number;
  /** Progress per second along this edge. */
  rate: number;
  /** 0–1: brightness of the impulse and of the nodes it lights. */
  strength: number;
  kind: ImpulseKind;
}

export interface ImpulseOptions {
  /** Ambient impulses alive at once (real ones have their own reserve and are never dropped). */
  maxImpulses: number;
  /** Mean new ambient impulses per second; arrivals are random (Poisson), so there is no rhythm. */
  spawnPerSecond: number;
  /** Speed range in scene units per second. */
  speed: [number, number];
  /** Chance, scaled by strength, that an impulse also continues down a second connection. */
  branchProbability: number;
  /** Strength kept at each node crossed; below MIN_STRENGTH the impulse ends. */
  hopFade: number;
  /** How fast lit nodes and connections dim (exponential rate per second). */
  nodeDecayPerSecond: number;
  seed: number;
}

const MIN_STRENGTH = 0.08;
const REAL_RESERVE = 64;
const MAX_ACTIVATION = 1.6;
const SPAWN_LOG = 2_000;

/**
 * Electrical impulses over a network: they start at nodes, run along connections, light the nodes they
 * reach, may branch, fade with every hop and end on their own. Pure state, no rendering: the GPU draws
 * what this holds, and tests check the behaviour without WebGL.
 */
export class ImpulseField {
  readonly impulses: Impulse[] = [];
  /** Brightness of each node from any impulse. */
  readonly nodeActivation: Float32Array;
  /** Brightness of each node from real events only. */
  readonly realActivation: Float32Array;
  /** Brightness of each connection recently crossed. */
  readonly edgeActivation: Float32Array;
  readonly stats = { hops: 0, branches: 0, spawnTimes: [] as number[] };
  /** Ambient activity on or off (it is decorative and can be switched off). */
  ambient = true;
  spawnPerSecond: number;
  private readonly random: () => number;
  private readonly lengths: Float32Array;
  private time = 0;
  private nextSpawn: number;

  constructor(
    private readonly network: Network,
    private readonly options: ImpulseOptions,
  ) {
    this.random = createRng(options.seed);
    this.spawnPerSecond = options.spawnPerSecond;
    this.nodeActivation = new Float32Array(network.nodeCount);
    this.realActivation = new Float32Array(network.nodeCount);
    this.edgeActivation = new Float32Array(network.edgeCount);
    this.lengths = new Float32Array(network.edgeCount);
    const p = network.nodePositions;
    for (let e = 0; e < network.edgeCount; e++) {
      const a = (network.edges[e * 2] ?? 0) * 3;
      const b = (network.edges[e * 2 + 1] ?? 0) * 3;
      this.lengths[e] = Math.max(1e-4, Math.hypot((p[a] ?? 0) - (p[b] ?? 0), (p[a + 1] ?? 0) - (p[b + 1] ?? 0), (p[a + 2] ?? 0) - (p[b + 2] ?? 0)));
    }
    this.nextSpawn = this.waitForNext();
  }

  /** Ambient activity settings, changed while running (intensity, reduced motion). */
  configure({ ambient, spawnPerSecond }: { ambient: boolean; spawnPerSecond: number }): void {
    this.ambient = ambient;
    this.spawnPerSecond = spawnPerSecond;
  }

  /** Starts impulses at a node: what real events and the ambient generator both use. */
  fire(node: number, strength: number, kind: ImpulseKind): void {
    if (node < 0 || node >= this.network.nodeCount) return;
    this.light(node, strength, kind);
    const edges = this.network.adjacency[node] ?? [];
    if (!edges.length) return;
    const firstIndex = Math.floor(this.random() * edges.length);
    this.launch(edges[firstIndex] ?? 0, node, strength, kind);
    // Real events spread in two directions at once, so they read as a burst rather than a single spark.
    if (kind === 'real' && edges.length > 1) {
      const second = edges[(firstIndex + 1 + Math.floor(this.random() * (edges.length - 1))) % edges.length] ?? 0;
      this.launch(second, node, strength, kind);
    }
  }

  /** Lights a node with no impulse at all: real activity when the user prefers reduced motion. */
  highlight(node: number, strength: number, kind: ImpulseKind): void {
    if (node >= 0 && node < this.network.nodeCount) this.light(node, strength, kind);
  }

  step(dt: number): void {
    this.time += dt;
    if (this.ambient && this.spawnPerSecond > 0) {
      if (!Number.isFinite(this.nextSpawn)) this.nextSpawn = this.time + this.waitForNext();
      while (this.nextSpawn <= this.time) {
        if (this.count('ambient') < this.options.maxImpulses) {
          this.fire(Math.floor(this.random() * this.network.nodeCount), 0.55 + this.random() * 0.45, 'ambient');
          if (this.stats.spawnTimes.length < SPAWN_LOG) this.stats.spawnTimes.push(this.nextSpawn);
        }
        this.nextSpawn += this.waitForNext();
      }
    } else {
      this.nextSpawn = Number.POSITIVE_INFINITY;
    }

    for (let i = this.impulses.length - 1; i >= 0; i--) {
      const impulse = this.impulses[i];
      if (!impulse) continue;
      impulse.progress += impulse.rate * dt;
      if (impulse.progress < 1) continue;
      this.impulses.splice(i, 1);
      this.arrive(impulse);
    }

    const fade = Math.exp(-this.options.nodeDecayPerSecond * dt);
    for (let n = 0; n < this.nodeActivation.length; n++) {
      this.nodeActivation[n] = (this.nodeActivation[n] ?? 0) * fade;
      this.realActivation[n] = (this.realActivation[n] ?? 0) * fade;
    }
    for (let e = 0; e < this.edgeActivation.length; e++) this.edgeActivation[e] = (this.edgeActivation[e] ?? 0) * fade;
  }

  positionOf(impulse: Impulse, out: Float32Array, offset = 0): void {
    this.pointOn(impulse, impulse.progress, out, offset);
  }

  /** Point at any progress along the impulse's connection (the trail uses earlier points). */
  pointOn(impulse: Impulse, progress: number, out: Float32Array, offset: number): void {
    const p = this.network.nodePositions;
    const a = impulse.from * 3;
    const b = impulse.to * 3;
    const t = Math.max(0, progress);
    for (let k = 0; k < 3; k++) {
      const start = p[a + k] ?? 0;
      out[offset + k] = start + ((p[b + k] ?? 0) - start) * t;
    }
  }

  edgeLength(edge: number): number {
    return this.lengths[edge] ?? 1;
  }

  directionOf(impulse: Impulse, out: Float32Array): void {
    const p = this.network.nodePositions;
    const a = impulse.from * 3;
    const b = impulse.to * 3;
    const length = this.edgeLength(impulse.edge);
    for (let k = 0; k < 3; k++) out[k] = ((p[b + k] ?? 0) - (p[a + k] ?? 0)) / length;
  }

  private arrive(impulse: Impulse): void {
    this.stats.hops++;
    this.light(impulse.to, impulse.strength, impulse.kind);
    this.edgeActivation[impulse.edge] = Math.min(MAX_ACTIVATION, (this.edgeActivation[impulse.edge] ?? 0) + impulse.strength * 0.8);
    const strength = impulse.strength * this.options.hopFade;
    if (strength < MIN_STRENGTH) return;
    const onward = (this.network.adjacency[impulse.to] ?? []).filter((edge) => edge !== impulse.edge);
    if (!onward.length) return;
    const pick = Math.floor(this.random() * onward.length);
    this.launch(onward[pick] ?? 0, impulse.to, strength, impulse.kind);
    if (onward.length > 1 && this.random() < this.options.branchProbability * strength) {
      const other = onward[(pick + 1 + Math.floor(this.random() * (onward.length - 1))) % onward.length] ?? 0;
      if (this.launch(other, impulse.to, strength * 0.85, impulse.kind)) this.stats.branches++;
    }
  }

  private launch(edge: number, from: number, strength: number, kind: ImpulseKind): boolean {
    const limit = kind === 'real' ? REAL_RESERVE : this.options.maxImpulses;
    if (this.count(kind) >= limit) return false;
    const a = this.network.edges[edge * 2] ?? 0;
    const to = a === from ? (this.network.edges[edge * 2 + 1] ?? 0) : a;
    const [min, max] = this.options.speed;
    const speed = min + (max - min) * this.random();
    this.impulses.push({ edge, from, to, progress: 0, rate: speed / this.edgeLength(edge), strength, kind });
    return true;
  }

  private light(node: number, strength: number, kind: ImpulseKind): void {
    this.nodeActivation[node] = Math.min(MAX_ACTIVATION, (this.nodeActivation[node] ?? 0) + strength);
    if (kind === 'real') this.realActivation[node] = Math.min(MAX_ACTIVATION, (this.realActivation[node] ?? 0) + strength);
  }

  private count(kind: ImpulseKind): number {
    let n = 0;
    for (const impulse of this.impulses) if (impulse.kind === kind) n++;
    return n;
  }

  /** Exponential waiting time: random arrivals with the configured mean rate. */
  private waitForNext(): number {
    return this.spawnPerSecond > 0 ? -Math.log(1 - this.random()) / this.spawnPerSecond : Number.POSITIVE_INFINITY;
  }
}

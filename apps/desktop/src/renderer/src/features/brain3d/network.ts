import { createRng } from './rng';

/** Decorative neural network over a subset of the brain's particles. Never mixed with memory relations. */
export interface Network {
  nodeCount: number;
  /** Particle index of each network node. */
  nodeParticle: Uint32Array;
  /** x, y, z per node. */
  nodePositions: Float32Array;
  edgeCount: number;
  /** Node pairs: a0, b0, a1, b1, ... */
  edges: Uint32Array;
  /** Edge indices touching each node. */
  adjacency: number[][];
}

export interface NetworkOptions {
  nodes: number;
  /** Nearest neighbours each node links to (within maxDistance). */
  neighbours: number;
  maxDistance: number;
  /** Extra long connections between different regions. */
  longRange: number;
  seed: number;
}

export function buildNetwork(positions: Float32Array, regions: Uint8Array, options: NetworkOptions): Network {
  const random = createRng(options.seed);
  const particles = positions.length / 3;
  const nodeCount = Math.min(options.nodes, particles);

  // Evenly spread subset: a seeded shuffle of particle indices.
  const order = Uint32Array.from({ length: particles }, (_, i) => i);
  for (let i = particles - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [(order[j] ?? 0), (order[i] ?? 0)];
  }
  const nodeParticle = order.slice(0, nodeCount);
  const nodePositions = new Float32Array(nodeCount * 3);
  for (let n = 0; n < nodeCount; n++) nodePositions.set(positions.subarray((nodeParticle[n] ?? 0) * 3, (nodeParticle[n] ?? 0) * 3 + 3), n * 3);

  // Spatial hash for neighbour queries.
  const cell = options.maxDistance;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const grid = new Map<string, number[]>();
  for (let n = 0; n < nodeCount; n++) {
    const k = key((nodePositions[n * 3] ?? 0), (nodePositions[n * 3 + 1] ?? 0), (nodePositions[n * 3 + 2] ?? 0));
    const bucket = grid.get(k);
    if (bucket) bucket.push(n);
    else grid.set(k, [n]);
  }
  const distance = (a: number, b: number) =>
    Math.hypot((nodePositions[a * 3] ?? 0) - (nodePositions[b * 3] ?? 0), (nodePositions[a * 3 + 1] ?? 0) - (nodePositions[b * 3 + 1] ?? 0), (nodePositions[a * 3 + 2] ?? 0) - (nodePositions[b * 3 + 2] ?? 0));

  const pairs: number[] = [];
  const seen = new Set<number>();
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  const connect = (a: number, b: number) => {
    if (a === b) return false;
    const id = a < b ? a * nodeCount + b : b * nodeCount + a;
    if (seen.has(id)) return false;
    seen.add(id);
    const edge = pairs.length / 2;
    pairs.push(a, b);
    adjacency[a]?.push(edge);
    adjacency[b]?.push(edge);
    return true;
  };

  const near = (n: number, radiusCells: number) => {
    const cx = Math.floor((nodePositions[n * 3] ?? 0) / cell);
    const cy = Math.floor((nodePositions[n * 3 + 1] ?? 0) / cell);
    const cz = Math.floor((nodePositions[n * 3 + 2] ?? 0) / cell);
    const found: { node: number; d: number }[] = [];
    for (let dx = -radiusCells; dx <= radiusCells; dx++)
      for (let dy = -radiusCells; dy <= radiusCells; dy++)
        for (let dz = -radiusCells; dz <= radiusCells; dz++)
          for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) if (other !== n) found.push({ node: other, d: distance(n, other) });
    return found.sort((a, b) => a.d - b.d);
  };

  for (let n = 0; n < nodeCount; n++) {
    // A varying number of neighbours per node avoids a uniform lattice look.
    const wanted = Math.max(1, options.neighbours - 1 + Math.floor(random() * 3));
    let added = 0;
    for (const candidate of near(n, 1)) {
      if (candidate.d > options.maxDistance || added >= wanted) break;
      if (connect(n, candidate.node)) added++;
    }
  }
  // Nodes left alone (sparse spots) link to their nearest node, wherever it is.
  for (let n = 0; n < nodeCount; n++) {
    if (adjacency[n]?.length) continue;
    for (let radius = 2; radius < 12; radius++) {
      const [nearest] = near(n, radius);
      if (nearest) {
        connect(n, nearest.node);
        break;
      }
    }
  }
  // A few longer fibres between regions, like tracts joining lobes.
  for (let added = 0, tries = 0; added < options.longRange && tries < options.longRange * 200; tries++) {
    const a = Math.floor(random() * nodeCount);
    const b = Math.floor(random() * nodeCount);
    if (regions[(nodeParticle[a] ?? 0)] === regions[(nodeParticle[b] ?? 0)]) continue;
    const d = distance(a, b);
    if (d < 0.25 || d > 0.7) continue;
    if (connect(a, b)) added++;
  }

  return { nodeCount, nodeParticle, nodePositions, edgeCount: pairs.length / 2, edges: Uint32Array.from(pairs), adjacency };
}

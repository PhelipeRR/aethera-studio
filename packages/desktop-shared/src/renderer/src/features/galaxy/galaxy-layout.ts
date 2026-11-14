// Memory Galaxy layout (lote 50.06). Pure functions, no DOM and no three.js: they run inside a Web Worker and in
// node unit tests. Every star is one memory; its group decides its spiral arm and its embedding decides where on
// that arm it sits, so memories with close meaning end up close together.

export type GroupMode = 'type' | 'project' | 'semantic';

export interface LayoutMemory {
  id: string;
  type: string;
  projectId: string | null;
  projectName: string | null;
  tags: readonly string[];
}

export interface LayoutInput {
  memories: readonly LayoutMemory[];
  /** Ids with a stored vector, in the order of `vectors`. */
  vectorIds: readonly string[];
  dim: number;
  vectors: Float32Array;
}

export interface Projection {
  /** Per memory index: 3 coordinates in [-1, 1], or NaN when the memory has no vector. */
  coords: Float32Array;
  hasVector: Uint8Array;
  /** Share of the vector variance the three axes explain (0..1), for the "how it is organised" note. */
  explained: number;
}

export interface GalaxyGroup {
  id: string;
  label: string;
  count: number;
  /** Arm angle in radians. */
  angle: number;
  /** Mean position of its stars, where the label is drawn. */
  center: [number, number, number];
}

export interface GalaxyLayout {
  mode: GroupMode;
  positions: Float32Array;
  /** Group index per memory. */
  group: Uint16Array;
  groups: GalaxyGroup[];
}

/** Geometry of the disk, in scene units. The black hole stays small: its disk ends well inside the first stars. */
export const DISK = { inner: 3.4, outer: 15, twist: 2.3, armSpread: 0.42, thickness: 0.55 } as const;
export const MAX_ARMS = 10;

/** Deterministic 0..1 values from a string, for memories without a vector (never Math.random). */
export function hashUnit(text: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function rowsFor(input: LayoutInput): { rows: Int32Array; n: number } {
  const index = new Map(input.vectorIds.map((id, i) => [id, i]));
  const rows = new Int32Array(input.memories.length).fill(-1);
  input.memories.forEach((memory, i) => { rows[i] = index.get(memory.id) ?? -1; });
  return { rows, n: input.vectorIds.length };
}

/**
 * Top three principal components by power iteration with deflation: O(n·d) per step, no d×d matrix. 5,000 × 384
 * vectors take a few hundred milliseconds in a worker.
 */
export function project(input: LayoutInput, iterations = 28): Projection {
  const { memories, dim, vectors } = input;
  const { rows, n } = rowsFor(input);
  const coords = new Float32Array(memories.length * 3).fill(Number.NaN);
  const hasVector = new Uint8Array(memories.length);
  if (n === 0 || dim === 0) return { coords, hasVector, explained: 0 };

  const mean = new Float64Array(dim);
  for (let r = 0; r < n; r++) for (let j = 0; j < dim; j++) mean[j] = (mean[j] ?? 0) + (vectors[r * dim + j] ?? 0) / n;
  let totalVariance = 0;
  for (let r = 0; r < n; r++) for (let j = 0; j < dim; j++) { const v = (vectors[r * dim + j] ?? 0) - (mean[j] ?? 0); totalVariance += v * v; }

  const components: Float64Array[] = [];
  const scores: Float64Array[] = [];
  let explainedVariance = 0;
  const projectRow = (r: number, axis: Float64Array): number => {
    let s = 0;
    for (let j = 0; j < dim; j++) s += ((vectors[r * dim + j] ?? 0) - (mean[j] ?? 0)) * (axis[j] ?? 0);
    return s;
  };
  for (let c = 0; c < Math.min(3, dim); c++) {
    // Deterministic start that is not orthogonal to the data in practice.
    let axis = new Float64Array(dim).map((_, j) => Math.sin(j * 12.9898 + c * 78.233) + 0.01);
    const projected = new Float64Array(n);
    for (let it = 0; it < iterations; it++) {
      // Deflation: the axis is kept orthogonal to earlier components, so their part is removed once per step.
      const overlap = components.map((component) => dotAxis(component, axis));
      for (let r = 0; r < n; r++) {
        let s = projectRow(r, axis);
        for (let p = 0; p < c; p++) s -= (scores[p]?.[r] ?? 0) * (overlap[p] ?? 0);
        projected[r] = s;
      }
      const next = new Float64Array(dim);
      for (let r = 0; r < n; r++) { const s = (projected[r] ?? 0); if (s === 0) continue; for (let j = 0; j < dim; j++) next[j] = (next[j] ?? 0) + s * ((vectors[r * dim + j] ?? 0) - (mean[j] ?? 0)); }
      for (const component of components) { const d = dotAxis(component, next); for (let j = 0; j < dim; j++) next[j] = (next[j] ?? 0) - d * (component[j] ?? 0); }
      const norm = Math.hypot(...next);
      if (norm === 0) break;
      axis = next.map((value) => value / norm);
    }
    const score = new Float64Array(n);
    for (let r = 0; r < n; r++) score[r] = projectRow(r, axis);
    components.push(axis);
    scores.push(score);
    explainedVariance += score.reduce((sum, value) => sum + value * value, 0);
  }

  // Robust scale per axis (95th percentile of |score|) so one outlier does not squash the rest.
  const scale = scores.map((score) => {
    const sorted = Array.from(score, Math.abs).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 1;
  });
  memories.forEach((_, i) => {
    const r = (rows[i] ?? 0);
    if (r < 0) return;
    hasVector[i] = 1;
    for (let c = 0; c < 3; c++) { const score = scores[c]; coords[i * 3 + c] = score ? Math.max(-1, Math.min(1, (score[r] ?? 0) / (scale[c] ?? 1))) : 0; }
  });
  return { coords, hasVector, explained: totalVariance > 0 ? Math.min(1, explainedVariance / totalVariance) : 0 };
}

function dotAxis(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += (a[j] ?? 0) * (b[j] ?? 0);
  return s;
}

/** Spherical k-means (cosine) on the stored unit vectors, k-means++ seeded deterministically. -1 = no vector. */
export function semanticClusters(input: LayoutInput, k = Math.max(2, Math.min(MAX_ARMS, Math.round(Math.sqrt(input.vectorIds.length / 8)))), iterations = 14): Int16Array {
  const { dim, vectors } = input;
  const { rows, n } = rowsFor(input);
  const assignment = new Int16Array(input.memories.length).fill(-1);
  if (n === 0) return assignment;
  const clusters = Math.min(k, n);
  const centroids = new Float64Array(clusters * dim);
  const sim = (r: number, c: number) => { let s = 0; for (let j = 0; j < dim; j++) s += (vectors[r * dim + j] ?? 0) * (centroids[c * dim + j] ?? 0); return s; };
  // k-means++ with a fixed sequence instead of randomness.
  const first = Math.floor(hashUnit('seed') * n);
  for (let j = 0; j < dim; j++) centroids[j] = (vectors[first * dim + j] ?? 0);
  const best = new Float64Array(n).fill(-Infinity);
  for (let c = 1; c < clusters; c++) {
    let far = 0;
    let farDistance = -1;
    for (let r = 0; r < n; r++) {
      best[r] = Math.max((best[r] ?? 0), sim(r, c - 1));
      const distance = 1 - (best[r] ?? 0);
      if (distance > farDistance) { farDistance = distance; far = r; }
    }
    for (let j = 0; j < dim; j++) centroids[c * dim + j] = (vectors[far * dim + j] ?? 0);
  }
  const label = new Int16Array(n);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let r = 0; r < n; r++) {
      let top = 0;
      let topSim = -Infinity;
      for (let c = 0; c < clusters; c++) { const s = sim(r, c); if (s > topSim) { topSim = s; top = c; } }
      if (label[r] !== top) moved++;
      label[r] = top;
    }
    centroids.fill(0);
    for (let r = 0; r < n; r++) for (let j = 0; j < dim; j++) centroids[(label[r] ?? 0) * dim + j] = (centroids[(label[r] ?? 0) * dim + j] ?? 0) + (vectors[r * dim + j] ?? 0);
    for (let c = 0; c < clusters; c++) {
      let norm = 0;
      for (let j = 0; j < dim; j++) norm += (centroids[c * dim + j] ?? 0) ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let j = 0; j < dim; j++) centroids[c * dim + j] = (centroids[c * dim + j] ?? 0) / norm;
    }
    if (it > 0 && moved === 0) break;
  }
  input.memories.forEach((_, i) => { const row = rows[i] ?? -1; if (row >= 0) assignment[i] = label[row] ?? 0; });
  return assignment;
}

/** The k memories closest in meaning to `id` (cosine), for the details panel. Empty when it has no vector. */
export function nearestByMeaning(input: LayoutInput, id: string, k = 5): { id: string; score: number }[] {
  const { dim, vectors, vectorIds } = input;
  const self = vectorIds.indexOf(id);
  if (self < 0) return [];
  const scored: { id: string; score: number }[] = [];
  for (let r = 0; r < vectorIds.length; r++) {
    if (r === self) continue;
    let s = 0;
    for (let j = 0; j < dim; j++) s += (vectors[r * dim + j] ?? 0) * (vectors[self * dim + j] ?? 0);
    scored.push({ id: vectorIds[r] ?? '', score: s });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

const TYPE_LABEL: Record<string, string> = {
  decision: 'Decisões',
  code_pattern: 'Padrões de código',
  project_context: 'Contexto de projeto',
  bug_fix: 'Bugs resolvidos',
  learning: 'Aprendizados',
  preference: 'Preferências',
  documentation: 'Documentação',
  execution_summary: 'Resumos de execução',
};

/** Group key and label per memory for a mode. Projects beyond MAX_ARMS - 1 share one "Outros projetos" arm. */
export function groupsFor(memories: readonly LayoutMemory[], mode: GroupMode, clusters: Int16Array | null): { key: string[]; labels: Map<string, string> } {
  const labels = new Map<string, string>();
  if (mode === 'type') {
    const key = memories.map((memory) => memory.type);
    for (const type of key) labels.set(type, TYPE_LABEL[type] ?? type);
    return { key, labels };
  }
  if (mode === 'project') {
    const counts = new Map<string, number>();
    for (const memory of memories) counts.set(memory.projectId ?? '__global', (counts.get(memory.projectId ?? '__global') ?? 0) + 1);
    const kept = new Set([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_ARMS - 1).map(([id]) => id));
    const key = memories.map((memory) => {
      const id = memory.projectId ?? '__global';
      if (!kept.has(id)) { labels.set('__other', 'Outros projetos'); return '__other'; }
      labels.set(id, id === '__global' ? 'Globais' : memory.projectName ?? 'Projeto');
      return id;
    });
    return { key, labels };
  }
  // Semantic: clusters named by their most frequent tag, else their dominant type; no vector = its own arm.
  const key = memories.map((_, i) => (clusters && (clusters[i] ?? 0) >= 0 ? `c${clusters[i]}` : '__none'));
  const byCluster = new Map<string, LayoutMemory[]>();
  memories.forEach((memory, i) => {
    const cluster = key[i] ?? '__none';
    const list = byCluster.get(cluster);
    if (list) list.push(memory);
    else byCluster.set(cluster, [memory]);
  });
  for (const [cluster, members] of byCluster) {
    if (cluster === '__none') { labels.set(cluster, 'Sem embedding'); continue; }
    const tagCount = new Map<string, number>();
    const typeCount = new Map<string, number>();
    for (const member of members) {
      for (const tag of member.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      typeCount.set(member.type, (typeCount.get(member.type) ?? 0) + 1);
    }
    const topTag = [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const topType = [...typeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    labels.set(cluster, topTag && topTag[1] >= Math.max(2, members.length * 0.2) ? `#${topTag[0]}` : TYPE_LABEL[topType] ?? 'Grupo');
  }
  return { key, labels };
}

/**
 * Places every memory on a logarithmic spiral arm of its group. Along the arm: the first semantic axis (rank, so
 * the arm fills evenly); across it: the second axis; height: the third. Without a vector, a hash of the id.
 */
export function layoutGalaxy(memories: readonly LayoutMemory[], projection: Projection, mode: GroupMode, clusters: Int16Array | null): GalaxyLayout {
  const { key, labels } = groupsFor(memories, mode, clusters);
  const order = [...new Set(key)].sort((a, b) => (labels.get(a) ?? a).localeCompare(labels.get(b) ?? b, 'pt-BR'));
  const index = new Map(order.map((id, i) => [id, i]));
  const arms = Math.max(1, order.length);
  const positions = new Float32Array(memories.length * 3);
  const group = new Uint16Array(memories.length);
  const axis = (i: number, c: number, salt: number) => {
    const value = (projection.coords[i * 3 + c] ?? 0);
    return Number.isNaN(value) ? hashUnit(memories[i]?.id ?? '', salt) * 2 - 1 : value;
  };

  const members = order.map(() => [] as number[]);
  memories.forEach((_, i) => { const g = index.get(key[i] ?? '') ?? 0; group[i] = g; members[g]?.push(i); });
  const sums: [number, number, number][] = order.map(() => [0, 0, 0]);

  members.forEach((list, g) => {
    const armAngle = (g / arms) * Math.PI * 2;
    const ranked = [...list].sort((a, b) => axis(a, 0, 1) - axis(b, 0, 1) || (memories[a]?.id ?? '').localeCompare(memories[b]?.id ?? ''));
    ranked.forEach((i, rank) => {
      const along = list.length === 1 ? 0.5 : rank / (list.length - 1);
      // Denser near the core, like a real galaxy: radius grows with the square root of the position on the arm.
      const radius = DISK.inner + (DISK.outer - DISK.inner) * Math.sqrt(0.04 + 0.96 * along);
      const spread = DISK.armSpread * (0.55 + 0.45 * along);
      const theta = armAngle + DISK.twist * Math.log(radius / DISK.inner) + axis(i, 1, 2) * spread + (hashUnit(memories[i]?.id ?? '', 9) - 0.5) * 0.12;
      const lift = axis(i, 2, 3) * DISK.thickness * (1 - 0.55 * along);
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      positions.set([x, lift, z], i * 3);
      const sum = sums[g];
      if (sum) { sum[0] += x; sum[1] += lift; sum[2] += z; }
    });
  });

  const groups: GalaxyGroup[] = order.map((id, g) => {
    const count = members[g]?.length ?? 0;
    const sum = sums[g] ?? [0, 0, 0];
    return { id, label: labels.get(id) ?? id, count, angle: (g / arms) * Math.PI * 2, center: [sum[0] / count, sum[1] / count, sum[2] / count] };
  });
  return { mode, positions, group, groups };
}

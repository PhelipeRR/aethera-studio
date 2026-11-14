import type { Brain3DGraph, Brain3DMemory, BrainSimilarity } from '@neuralbridge/shared/brain3d';
import type { MemoryType } from '@neuralbridge/shared/domain';
import type { BrainCloud } from './anatomy';
import { placeMemories } from './layout';
import type { Network } from './network';

export interface KnowledgeEdge {
  /** Indices into `memories`. */
  a: number;
  b: number;
  /** link: stored in the database. similarity: calculated from embeddings, above the threshold. */
  kind: 'link' | 'similarity';
  /** The link's relation, or the similarity score. */
  label: string;
}

export interface KnowledgeModel {
  memories: Brain3DMemory[];
  positions: Float32Array;
  edges: KnowledgeEdge[];
  /** The same memories and edges as a network, for impulses caused by real events. */
  network: Network;
}

export interface KnowledgeFilters {
  similarity: boolean;
  /** all, only global memories, or one project id. */
  project: 'all' | 'global' | (string & {});
  type: MemoryType | null;
}

/** The knowledge layer: only real memories and relations that come from the database or the embeddings. */
export function buildKnowledge(graph: Brain3DGraph, similarity: BrainSimilarity | null, cloud: BrainCloud, filters: KnowledgeFilters): KnowledgeModel {
  const inProject = (memory: Brain3DMemory) => (filters.project === 'all' ? true : filters.project === 'global' ? memory.projectId === null : memory.projectId === filters.project);
  const memories = graph.memories.filter((memory) => inProject(memory) && (filters.type === null || memory.type === filters.type));
  const index = new Map(memories.map((memory, i) => [memory.id, i]));
  const { positions } = placeMemories(memories, cloud);
  const edges: KnowledgeEdge[] = [];
  const pairs = new Set<string>();
  const pair = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

  for (const link of graph.links) {
    const a = index.get(link.sourceId);
    const b = index.get(link.targetId);
    if (a === undefined || b === undefined || a === b || pairs.has(pair(a, b))) continue;
    pairs.add(pair(a, b));
    edges.push({ a, b, kind: 'link', label: link.relation });
  }
  if (filters.similarity && similarity?.available) {
    for (const edge of similarity.edges) {
      const a = index.get(edge.sourceId);
      const b = index.get(edge.targetId);
      if (a === undefined || b === undefined || a === b || edge.score < similarity.threshold || pairs.has(pair(a, b))) continue;
      pairs.add(pair(a, b));
      edges.push({ a, b, kind: 'similarity', label: edge.score.toFixed(2) });
    }
  }

  const adjacency: number[][] = memories.map(() => []);
  const flat = new Uint32Array(edges.length * 2);
  edges.forEach((edge, e) => {
    flat[e * 2] = edge.a;
    flat[e * 2 + 1] = edge.b;
    adjacency[edge.a]?.push(e);
    adjacency[edge.b]?.push(e);
  });
  const network: Network = {
    nodeCount: memories.length,
    nodeParticle: Uint32Array.from(memories.keys()),
    nodePositions: positions,
    edgeCount: edges.length,
    edges: flat,
    adjacency,
  };
  return { memories, positions, edges, network };
}

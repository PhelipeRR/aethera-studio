import type { BrainGraph } from '@neuralbridge/shared/brain';
import type { MemoryType } from '@neuralbridge/shared/domain';
import { TYPE_LABEL } from './labels';

export interface GraphFilters {
  /** undefined = every project; null = global memories only. */
  projectId?: string | null;
  tag?: string;
  groupByType: boolean;
}

export interface GraphNode {
  id: string;
  label: string;
  kind: 'memory' | 'pending';
  type: MemoryType | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  pending: boolean;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groupByType: boolean;
  stats: { memories: number; links: number; pending: number };
}

/** Unresolved [[titles]] share one node per title, case-insensitively, as the brain resolves them. */
export const pendingId = (title: string) => `pending:${title.trim().toLowerCase()}`;

export function buildGraphModel(graph: BrainGraph, filters: GraphFilters): GraphModel {
  const kept = graph.memories.filter(
    (memory) => (filters.projectId === undefined || memory.projectId === filters.projectId) && (!filters.tag || memory.tags.includes(filters.tag)),
  );
  const ids = new Set(kept.map((memory) => memory.id));
  const nodes: GraphNode[] = kept.map((memory) => ({ id: memory.id, label: memory.title, kind: 'memory', type: memory.type }));
  const pending = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const link of graph.links) {
    if (!ids.has(link.sourceId)) continue;
    if (link.targetId === null) {
      const id = pendingId(link.targetTitle);
      if (!pending.has(id)) pending.set(id, { id, label: link.targetTitle.trim(), kind: 'pending', type: null });
      edges.push({ id: `${link.sourceId}->${id}:${link.relation}`, source: link.sourceId, target: id, relation: link.relation, pending: true });
    } else if (ids.has(link.targetId)) {
      edges.push({ id: `${link.sourceId}->${link.targetId}:${link.relation}`, source: link.sourceId, target: link.targetId, relation: link.relation, pending: false });
    }
  }

  return {
    nodes: [...nodes, ...pending.values()],
    edges,
    groupByType: filters.groupByType,
    stats: { memories: nodes.length, links: edges.filter((edge) => !edge.pending).length, pending: pending.size },
  };
}

/** Cytoscape element definitions; type groups become compound parent nodes. */
export function toElements(model: GraphModel): { group: 'nodes' | 'edges'; data: Record<string, unknown> }[] {
  const groups = model.groupByType ? [...new Set(model.nodes.flatMap((node) => (node.type ? [node.type] : [])))] : [];
  return [
    ...groups.map((type) => ({ group: 'nodes' as const, data: { id: `group:${type}`, label: TYPE_LABEL[type], kind: 'group', type } })),
    ...model.nodes.map((node) => ({
      group: 'nodes' as const,
      data: { id: node.id, label: node.label, kind: node.kind, type: node.type, ...(model.groupByType && node.type ? { parent: `group:${node.type}` } : {}) },
    })),
    ...model.edges.map((edge) => ({ group: 'edges' as const, data: { ...edge } })),
  ];
}

/** Shortest chain of links between two nodes, following links in either direction. */
export function shortestPath(model: GraphModel, from: string, to: string): string[] | null {
  const adjacent = new Map<string, string[]>();
  for (const edge of model.edges) {
    adjacent.set(edge.source, [...(adjacent.get(edge.source) ?? []), edge.target]);
    adjacent.set(edge.target, [...(adjacent.get(edge.target) ?? []), edge.source]);
  }
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const current = queue.shift() as string;
    if (current === to) {
      const path: string[] = [];
      for (let node: string | null = to; node !== null; node = previous.get(node) ?? null) path.unshift(node);
      return path;
    }
    for (const next of adjacent.get(current) ?? []) {
      if (!previous.has(next)) {
        previous.set(next, current);
        queue.push(next);
      }
    }
  }
  return null;
}

export interface Neighbour {
  id: string;
  label: string;
  relation: string;
  pending: boolean;
}

export function neighbours(model: GraphModel, id: string): { outgoing: Neighbour[]; incoming: Neighbour[] } {
  const label = new Map(model.nodes.map((node) => [node.id, node.label]));
  return {
    outgoing: model.edges.filter((edge) => edge.source === id).map((edge) => ({ id: edge.target, label: label.get(edge.target) ?? edge.target, relation: edge.relation, pending: edge.pending })),
    incoming: model.edges.filter((edge) => edge.target === id).map((edge) => ({ id: edge.source, label: label.get(edge.source) ?? edge.source, relation: edge.relation, pending: false })),
  };
}

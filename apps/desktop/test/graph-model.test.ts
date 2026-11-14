import type { BrainGraph } from '@neuralbridge/shared/brain';
import { describe, expect, it } from 'vitest';
import { buildGraphModel, neighbours, pendingId, shortestPath, toElements } from '../src/renderer/src/features/brain/graph-model.js';

const graph: BrainGraph = {
  truncated: false,
  memories: [
    { id: 'a', title: 'Migrações', type: 'decision', projectId: 'api', tags: ['db'] },
    { id: 'b', title: 'Pool', type: 'bug_fix', projectId: 'api', tags: ['db', 'perf'] },
    { id: 'c', title: 'Índices', type: 'learning', projectId: 'api', tags: [] },
    { id: 'g', title: 'Estilo', type: 'preference', projectId: null, tags: [] },
    { id: 'x', title: 'Isolada', type: 'learning', projectId: 'web', tags: [] },
  ],
  links: [
    { sourceId: 'a', targetId: 'b', targetTitle: 'Pool', relation: 'references' },
    { sourceId: 'b', targetId: 'c', targetTitle: 'Índices', relation: 'references' },
    { sourceId: 'c', targetId: 'g', targetTitle: 'Estilo', relation: 'follows' },
    { sourceId: 'a', targetId: null, targetTitle: 'Cache', relation: 'references' },
    { sourceId: 'b', targetId: null, targetTitle: 'cache', relation: 'references' },
  ],
};

describe('buildGraphModel', () => {
  it('turns memories into nodes, links into directed edges, and unresolved titles into one pending node each', () => {
    const model = buildGraphModel(graph, { groupByType: false });
    expect(model.stats).toEqual({ memories: 5, links: 3, pending: 1 });
    expect(model.nodes.find((node) => node.id === pendingId('Cache'))).toMatchObject({ kind: 'pending', label: 'Cache' });
    expect(model.edges).toContainEqual({ id: 'a->b:references', source: 'a', target: 'b', relation: 'references', pending: false });
    expect(model.edges.filter((edge) => edge.target === pendingId('cache'))).toHaveLength(2);
  });

  it('filters by project or tag and drops edges whose ends were filtered out', () => {
    const api = buildGraphModel(graph, { projectId: 'api', groupByType: false });
    expect(api.nodes.filter((node) => node.kind === 'memory').map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(api.edges.some((edge) => edge.target === 'g')).toBe(false);
    expect(buildGraphModel(graph, { projectId: null, groupByType: false }).stats).toEqual({ memories: 1, links: 0, pending: 0 });
    const db = buildGraphModel(graph, { tag: 'db', groupByType: false });
    expect(db.stats).toEqual({ memories: 2, links: 1, pending: 1 });
  });

  it('groups memories by type as parent nodes when asked', () => {
    const elements = toElements(buildGraphModel(graph, { groupByType: true }));
    const parents = elements.filter((element) => element.data['kind'] === 'group').map((element) => element.data['label']);
    expect(parents).toEqual(expect.arrayContaining(['Decisão', 'Bug resolvido', 'Aprendizado', 'Preferência']));
    expect(elements.find((element) => element.data['id'] === 'a')?.data['parent']).toBe('group:decision');
    expect(elements.find((element) => element.data['id'] === pendingId('Cache'))?.data['parent']).toBeUndefined();
  });
});

describe('graph navigation', () => {
  const model = buildGraphModel(graph, { groupByType: false });

  it('finds the shortest path in either direction of the links', () => {
    expect(shortestPath(model, 'a', 'g')).toEqual(['a', 'b', 'c', 'g']);
    expect(shortestPath(model, 'g', 'a')).toEqual(['g', 'c', 'b', 'a']);
    expect(shortestPath(model, 'a', 'a')).toEqual(['a']);
    expect(shortestPath(model, 'a', 'x')).toBeNull();
  });

  it('lists what a memory points to and what points to it', () => {
    expect(neighbours(model, 'b')).toEqual({
      outgoing: [
        { id: 'c', label: 'Índices', relation: 'references', pending: false },
        { id: pendingId('Cache'), label: 'Cache', relation: 'references', pending: true },
      ],
      incoming: [{ id: 'a', label: 'Migrações', relation: 'references', pending: false }],
    });
  });
});

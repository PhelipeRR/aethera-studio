import { describe, expect, it } from 'vitest';
import type { Brain3DGraph, BrainActivityEntry, BrainSimilarity, TaskDetail } from '@neuralbridge/shared';
import { REGIONS, sampleBrain } from '../src/renderer/src/features/brain3d/anatomy.js';
import { ActivityTracker, activationsFromAccess, activationsFromTasks } from '../src/renderer/src/features/brain3d/activity.js';
import { buildKnowledge } from '../src/renderer/src/features/brain3d/knowledge.js';
import { placeMemories, regionForProject } from '../src/renderer/src/features/brain3d/layout.js';
import { chooseAutomaticQuality, QUALITY } from '../src/renderer/src/features/brain3d/quality.js';

const cloud = sampleBrain({ count: 8_000, interiorRatio: 0.1, seed: 2 });

function memory(id: string, projectId: string | null, extra: Partial<Brain3DGraph['memories'][number]> = {}): Brain3DGraph['memories'][number] {
  return { id, title: `Memória ${id}`, type: 'decision', projectId, projectName: projectId, trust: 'unverified', sourceKind: 'user', tags: [], updatedAt: '2026-10-29T00:00:00.000Z', ...extra };
}

describe('memory placement', () => {
  const memories = [memory('a', 'api'), memory('b', 'api'), memory('c', 'web'), memory('g', null)];

  it('puts each memory on the brain surface, by project region, stable when others come and go', () => {
    const placed = placeMemories(memories, cloud);
    expect(placed.positions).toHaveLength(12);
    for (let i = 0; i < memories.length; i++) {
      const project = memories[i]?.projectId ?? null;
      expect(REGIONS[(placed.regions[i] ?? 0)]).toBe(regionForProject(project).region);
    }
    expect(regionForProject(null).region).toBe('cerebellum');
    expect(regionForProject('api')).toEqual(regionForProject('api'));

    const fewer = placeMemories(memories.slice(2, 3), cloud);
    expect(Array.from(fewer.positions)).toEqual(Array.from(placed.positions.subarray(6, 9)));
    const more = placeMemories([memory('z', 'api'), ...memories], cloud);
    expect(Array.from(more.positions.subarray(3))).toEqual(Array.from(placed.positions));
  });

  it('spreads memories of one project instead of stacking them', () => {
    const many = Array.from({ length: 40 }, (_, i) => memory(`m${i}`, 'api'));
    const placed = placeMemories(many, cloud);
    const keys = new Set<string>();
    for (let i = 0; i < many.length; i++) keys.add(Array.from(placed.positions.subarray(i * 3, i * 3 + 3)).map((v) => v.toFixed(3)).join());
    expect(keys.size).toBe(40);
  });
});

describe('knowledge connections', () => {
  const graph: Brain3DGraph = {
    memories: [memory('a', 'api'), memory('b', 'api'), memory('c', 'web'), memory('d', 'web', { type: 'bug_fix' })],
    links: [
      { sourceId: 'a', targetId: 'b', relation: 'references', origin: 'wikilink' },
      { sourceId: 'c', targetId: 'a', relation: 'fixes', origin: 'explicit' },
    ],
    truncated: false,
  };
  const similarity: BrainSimilarity = {
    available: true,
    reason: null,
    threshold: 0.75,
    topK: 3,
    considered: 4,
    truncated: false,
    edges: [
      { sourceId: 'b', targetId: 'd', score: 0.81 },
      { sourceId: 'a', targetId: 'b', score: 0.9 },
    ],
  };

  it('shows stored links and calculated similarity as different, traceable kinds', () => {
    const model = buildKnowledge(graph, similarity, cloud, { similarity: true, project: 'all', type: null });
    expect(model.memories.map((m) => m.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(model.edges).toEqual([
      { a: 0, b: 1, kind: 'link', label: 'references' },
      { a: 2, b: 0, kind: 'link', label: 'fixes' },
      { a: 1, b: 3, kind: 'similarity', label: '0.81' },
    ]);
    // A pair already linked is not drawn twice; every edge comes from a link or a score above the threshold.
    expect(buildKnowledge(graph, similarity, cloud, { similarity: false, project: 'all', type: null }).edges.map((edge) => edge.kind)).toEqual(['link', 'link']);
  });

  it('filters by project and type, dropping connections to hidden memories', () => {
    const model = buildKnowledge(graph, similarity, cloud, { similarity: true, project: 'web', type: null });
    expect(model.memories.map((m) => m.id)).toEqual(['c', 'd']);
    expect(model.edges).toEqual([]);
    expect(buildKnowledge(graph, similarity, cloud, { similarity: true, project: 'all', type: 'bug_fix' }).memories.map((m) => m.id)).toEqual(['d']);
  });

  it('exposes the memories as a network that real impulses can follow', () => {
    const model = buildKnowledge(graph, similarity, cloud, { similarity: true, project: 'all', type: null });
    expect(model.network.nodeCount).toBe(4);
    expect(model.network.edgeCount).toBe(3);
    expect(model.network.adjacency[0]).toEqual([0, 1]);
  });
});

describe('real activity', () => {
  const task = (id: string, events: { kind: string; data: Record<string, unknown>; at?: string }[]): TaskDetail =>
    ({ id, events: events.map((event, i) => ({ id: i + 1, stepId: null, at: event.at ?? '2026-10-29T10:00:00.000Z', kind: event.kind, data: event.data })), steps: [] }) as unknown as TaskDetail;

  it('turns RAG context events into activations of the referenced memories only', () => {
    const activations = activationsFromTasks([
      task('t1', [
        { kind: 'rag_context', data: { references: ['memory://a', 'memory://b', 'file://x.ts'], estimatedTokens: 120 } },
        { kind: 'text', data: { text: 'memory://c' } },
      ]),
    ]);
    expect(activations.map((activation) => [activation.memoryId, activation.source, activation.client])).toEqual([
      ['a', 'task', 'tarefa t1'],
      ['b', 'task', 'tarefa t1'],
    ]);
  });

  it('takes agent retrievals through MCP from the access log, not the app’s own searches', () => {
    const entries: BrainActivityEntry[] = [
      { id: 1, memoryId: 'a', title: 'A', client: 'mcp:claude-code', action: 'search_hit', at: '2026-10-29T10:00:00.000Z' },
      { id: 2, memoryId: 'b', title: 'B', client: 'electron', action: 'search_hit', at: '2026-10-29T10:00:01.000Z' },
      { id: 3, memoryId: 'c', title: 'C', client: 'mcp:codex-mcp-client', action: 'recall', at: '2026-10-29T10:00:02.000Z' },
    ];
    expect(activationsFromAccess(entries).map((activation) => [activation.memoryId, activation.source, activation.client])).toEqual([
      ['a', 'mcp', 'Claude Code'],
      ['c', 'mcp', 'Codex'],
    ]);
  });

  it('reports each activation once, however often it is seen', () => {
    const tracker = new ActivityTracker();
    const [one] = activationsFromAccess([{ id: 1, memoryId: 'a', title: 'A', client: 'mcp:claude-code', action: 'recall', at: '2026-10-29T10:00:00.000Z' }]);
    if (!one) throw new Error('expected one activation');
    expect(tracker.ingest([one])).toHaveLength(1);
    expect(tracker.ingest([one])).toHaveLength(0);
    expect(tracker.recent).toHaveLength(1);
  });
});

describe('quality levels', () => {
  it('grow with the level and the automatic choice follows measured frame rate', () => {
    expect(QUALITY.low.particles).toBeLessThan(QUALITY.medium.particles);
    expect(QUALITY.medium.particles).toBeLessThan(QUALITY.high.particles);
    expect(chooseAutomaticQuality(58)).toBe('high');
    expect(chooseAutomaticQuality(40)).toBe('medium');
    expect(chooseAutomaticQuality(20)).toBe('low');
  });
});

describe('global memories filter', () => {
  it('keeps only memories without a project', async () => {
    const { buildKnowledge: build } = await import('../src/renderer/src/features/brain3d/knowledge.js');
    const graph: Brain3DGraph = { memories: [memory('a', 'api'), memory('g', null)], links: [], truncated: false };
    expect(build(graph, null, cloud, { similarity: false, project: 'global', type: null }).memories.map((m) => m.id)).toEqual(['g']);
  });
});

import { describe, expect, it } from 'vitest';
import { DISK, groupsFor, hashUnit, layoutGalaxy, nearestByMeaning, project, semanticClusters, type LayoutInput, type LayoutMemory } from '../src/renderer/src/features/galaxy/galaxy-layout.js';

// Unit vectors in 3 tight families plus a memory without a vector.
function fixture(): LayoutInput {
  const families = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
  const memories: LayoutMemory[] = [];
  const vectorIds: string[] = [];
  const values: number[] = [];
  families.forEach((base, f) => {
    for (let i = 0; i < 6; i++) {
      const id = `m${f}-${i}`;
      memories.push({ id, type: f === 0 ? 'decision' : 'learning', projectId: f === 2 ? 'p' : null, projectName: f === 2 ? 'Portal' : null, tags: f === 1 ? ['redis'] : [] });
      const v = base.map((value, j) => value + (j === 3 ? 0.05 * i : 0.01 * Math.sin(i + j)));
      const norm = Math.hypot(...v);
      vectorIds.push(id);
      values.push(...v.map((value) => value / norm));
    }
  });
  memories.push({ id: 'loose', type: 'bug_fix', projectId: null, projectName: null, tags: [] });
  return { memories, vectorIds, dim: 4, vectors: Float32Array.from(values) };
}

describe('galaxy layout', () => {
  it('projects every memory with a vector to [-1, 1] and marks the one without', () => {
    const input = fixture();
    const projection = project(input);
    expect(projection.hasVector.reduce((a, b) => a + b, 0)).toBe(18);
    expect(Number.isNaN((projection.coords[18 * 3] ?? 0))).toBe(true);
    for (let i = 0; i < 18 * 3; i++) expect(Math.abs((projection.coords[i] ?? 0))).toBeLessThanOrEqual(1);
    expect(projection.explained).toBeGreaterThan(0.5);
  });

  it('finds the meaning families as semantic clusters', () => {
    const input = fixture();
    const clusters = semanticClusters(input, 3);
    const of = (family: number) => new Set(Array.from({ length: 6 }, (_, i) => clusters[family * 6 + i]));
    expect(of(0).size).toBe(1);
    expect(of(1).size).toBe(1);
    expect(of(2).size).toBe(1);
    expect(new Set([...of(0), ...of(1), ...of(2)]).size).toBe(3);
    expect(clusters[18]).toBe(-1);
  });

  it('names semantic arms by frequent tag, and keeps memories without vectors apart', () => {
    const input = fixture();
    const { labels, key } = groupsFor(input.memories, 'semantic', semanticClusters(input, 3));
    expect([...labels.values()]).toContain('#redis');
    expect(key[18]).toBe('__none');
    expect(labels.get('__none')).toBe('Sem embedding');
  });

  it('places one star per memory, outside the black hole, deterministically', () => {
    const input = fixture();
    const projection = project(input);
    const a = layoutGalaxy(input.memories, projection, 'type', null);
    const b = layoutGalaxy(input.memories, project(input), 'type', null);
    expect(a.positions.length).toBe(input.memories.length * 3);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    for (let i = 0; i < input.memories.length; i++) {
      const radius = Math.hypot((a.positions[i * 3] ?? 0), (a.positions[i * 3 + 2] ?? 0));
      expect(radius).toBeGreaterThanOrEqual(DISK.inner - 0.01);
      expect(radius).toBeLessThanOrEqual(DISK.outer + 0.01);
    }
    expect(a.groups.reduce((sum, group) => sum + group.count, 0)).toBe(input.memories.length);
    expect(a.groups.map((group) => group.label).sort()).toEqual(['Aprendizados', 'Bugs resolvidos', 'Decisões']);
  });

  it('keeps memories of close meaning closer than memories of distant meaning', () => {
    const input = fixture();
    const layout = layoutGalaxy(input.memories, project(input), 'semantic', semanticClusters(input, 3));
    const at = (i: number) => [(layout.positions[i * 3] ?? 0), (layout.positions[i * 3 + 1] ?? 0), (layout.positions[i * 3 + 2] ?? 0)];
    const distance = (i: number, j: number) => Math.hypot(...at(i).map((value, c) => value - (at(j)[c] ?? 0)));
    let same = 0;
    let other = 0;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { same += distance(i, j); other += distance(i, 6 + j); }
    expect(same).toBeLessThan(other);
  });

  it('groups projects with globals and folds the long tail into one arm', () => {
    const memories: LayoutMemory[] = Array.from({ length: 14 }, (_, i) => ({ id: `x${i}`, type: 'decision', projectId: i === 0 ? null : `p${i}`, projectName: `Projeto ${i}`, tags: [] }));
    const { labels } = groupsFor(memories, 'project', null);
    expect(labels.size).toBeLessThanOrEqual(10);
    expect([...labels.values()]).toContain('Outros projetos');
    expect([...labels.values()]).toContain('Globais');
  });

  it('lists the nearest memories by meaning and nothing for a memory without a vector', () => {
    const input = fixture();
    const near = nearestByMeaning(input, 'm1-0', 3);
    expect(near.every((entry) => entry.id.startsWith('m1-'))).toBe(true);
    expect(nearestByMeaning(input, 'loose')).toEqual([]);
  });

  it('hashes ids to stable values in [0, 1)', () => {
    expect(hashUnit('abc')).toBe(hashUnit('abc'));
    expect(hashUnit('abc')).not.toBe(hashUnit('abd'));
    expect(hashUnit('abc')).toBeGreaterThanOrEqual(0);
    expect(hashUnit('abc')).toBeLessThan(1);
  });
});

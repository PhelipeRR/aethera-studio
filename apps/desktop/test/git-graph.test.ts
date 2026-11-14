import { describe, expect, it } from 'vitest';
import { layoutGitGraph } from '../src/renderer/src/pages/git-graph';
import type { GitHistoryCommit } from '@neuralbridge/shared/projects';

const commit = (hash: string, parents: string[] = []): GitHistoryCommit => ({ hash, parents, author: 'test', date: '2026-01-01T00:00:00.000Z', subject: hash, body: '', files: [] });

describe('layoutGitGraph', () => {
  it('creates deterministic edges for a merge and never invents a missing parent', () => {
    const result = layoutGitGraph([commit('merge', ['feature', 'main']), commit('feature', ['base']), commit('main', ['base']), commit('base')]);
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'merge', to: 'feature' }),
      expect.objectContaining({ from: 'merge', to: 'main' }),
      expect.objectContaining({ from: 'feature', to: 'base' }),
      expect.objectContaining({ from: 'main', to: 'base' }),
    ]));
    expect(result.danglingParents).toEqual([]);
    expect(layoutGitGraph([commit('tip', ['outside'])]).edges).toEqual([]);
    expect(layoutGitGraph([commit('tip', ['outside'])]).danglingParents).toEqual(['outside']);
  });

  it('keeps lane assignment stable for the same commit order', () => {
    const commits = [commit('merge', ['feature', 'main']), commit('feature', ['base']), commit('main', ['base']), commit('base')];
    expect(layoutGitGraph(commits)).toEqual(layoutGitGraph(commits));
  });

  it('lays out five thousand commits within a reproducible unit benchmark', () => {
    const commits = Array.from({ length: 5000 }, (_, index) => commit(`commit-${index.toString(16).padStart(40, '0')}`, index > 0 ? [`commit-${(index - 1).toString(16).padStart(40, '0')}`] : []));
    const started = performance.now();
    const result = layoutGitGraph(commits);
    const duration = performance.now() - started;
    expect(result.nodes).toHaveLength(5000);
    expect(result.edges).toHaveLength(4999);
    expect(duration).toBeLessThan(1000);
  });
});

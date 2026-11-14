import type { GitHistoryCommit } from '@neuralbridge/shared/projects';

export interface GitGraphNode {
  hash: string;
  row: number;
  lane: number;
}

export interface GitGraphEdge {
  from: string;
  to: string;
  fromLane: number;
  toLane: number;
  row: number;
  toRow: number;
}

export interface GitGraphLayout {
  nodes: GitGraphNode[];
  edges: GitGraphEdge[];
  danglingParents: string[];
  laneCount: number;
}

/** Deterministic first-parent lane assignment; edges only reference real commits in this page. */
export function layoutGitGraph(commits: readonly GitHistoryCommit[]): GitGraphLayout {
  const known = new Map(commits.map((commit, row) => [commit.hash, { commit, row }]));
  const lanes = new Map<string, number>();
  const nodes: GitGraphNode[] = [];
  const edges: GitGraphEdge[] = [];
  const danglingParents: string[] = [];
  let nextLane = 0;
  for (const [row, commit] of commits.entries()) {
    const lane = lanes.get(commit.hash) ?? nextLane++;
    nodes.push({ hash: commit.hash, row, lane });
    const parents = commit.parents.filter(Boolean);
    const firstParent = parents[0];
    if (firstParent) lanes.set(firstParent, lane);
    for (const parent of parents) {
      const target = known.get(parent);
      if (!target) {
        if (!danglingParents.includes(parent)) danglingParents.push(parent);
        continue;
      }
      const targetLane = lanes.get(parent) ?? (parent === firstParent ? lane : nextLane++);
      lanes.set(parent, targetLane);
      edges.push({ from: commit.hash, to: parent, fromLane: lane, toLane: targetLane, row, toRow: target.row });
    }
  }
  return { nodes, edges, danglingParents, laneCount: Math.max(nextLane, 1) };
}

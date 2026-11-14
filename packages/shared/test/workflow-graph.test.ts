import { describe, expect, it } from 'vitest';
import { graphToWorkflow, workflowToGraph } from '../src/workflow-graph.js';
import { normalizeWorkflow } from '../src/workflows.js';

describe('workflow graph conversion', () => {
  it('round trips ids, dependencies and step metadata', () => {
    const definition = normalizeWorkflow({ name: 'x', projectId: 'p', maxParallel: 2, steps: [{ id: 'a', title: 'A', prompt: 'one', agent: 'auto', mode: 'auto', dependsOn: [], requiresApproval: false }, { id: 'b', title: 'B', prompt: 'two', agent: 'claude', mode: 'claude', dependsOn: ['a'], requiresApproval: true }] });
    const graph = workflowToGraph(definition);
    expect(graphToWorkflow(graph, definition)).toEqual(definition);
  });
});

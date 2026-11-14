import type { WorkflowDefinitionV2, WorkflowStep } from './workflows.js';

export type WorkflowGraphNode = { id: string; type: 'start' | 'end' | 'step' | 'parallel' | 'merge'; position: { x: number; y: number }; data: Record<string, unknown> };
export type WorkflowGraphEdge = { id: string; source: string; target: string; data?: Record<string, unknown> };
export type WorkflowGraph = { nodes: WorkflowGraphNode[]; edges: WorkflowGraphEdge[] };

export function workflowToGraph(definition: WorkflowDefinitionV2): WorkflowGraph {
  const nodes = definition.steps.map((step, index) => ({ id: step.id, type: 'step' as const, position: { x: index * 220, y: 120 }, data: { step } }));
  const edges = definition.steps.flatMap((step) => step.dependsOn.map((source) => ({ id: `${source}->${step.id}`, source, target: step.id })));
  return { nodes, edges };
}

export function graphToWorkflow(graph: WorkflowGraph, base: WorkflowDefinitionV2): WorkflowDefinitionV2 {
  const steps = graph.nodes.filter((node) => node.type === 'step').map((node) => ({ ...(node.data.step as WorkflowStep), id: node.id, dependsOn: graph.edges.filter((edge) => edge.target === node.id).map((edge) => edge.source) }));
  return { ...base, steps };
}

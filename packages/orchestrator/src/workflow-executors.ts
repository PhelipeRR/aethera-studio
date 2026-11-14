import type { WorkflowStep } from '@neuralbridge/shared';
type NativeStep = Extract<WorkflowStep, { kind: 'rag' | 'validation' | 'git' }>;
export type NativeExecutorPorts = {
  rag: (query: string, topK: number, context: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }) => Promise<string>;
  validation: (command: string) => Promise<{ ok: boolean; output: string }>;
  git: (action: Extract<NativeStep, { kind: 'git' }>['action'], context: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }) => Promise<string>;
};
export function createWorkflowNativeExecutor(ports: NativeExecutorPorts) {
  return async (step: NativeStep, context: { inputs: Record<string, unknown>; outputs: Record<string, unknown> }): Promise<string> => {
    if (step.kind === 'rag') return ports.rag(step.query, step.topK, context);
    if (step.kind === 'validation') { const result = await ports.validation(step.command); if (!result.ok) throw new Error(`validation_failed: ${result.output}`); return result.output; }
    return ports.git(step.action, context);
  };
}

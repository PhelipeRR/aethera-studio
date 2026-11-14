export type WorkflowCheckpoint = { id: string; runId: string; workflowId: string; definitionVersion: number; sequence: number; completed: string[]; pending: string[]; artifacts: string[]; provider: string | null; approvalState: string | null; recoveryMeta: Record<string, unknown> };
type StoredRow = Record<string, unknown>;
export function createWorkflowCheckpointStore(ports: { insert: (row: StoredRow) => void; update: (id: string, patch: StoredRow) => void; claim?: (runId: string, stepId: string, claimId: string) => boolean }) {
  const claims = new Set<string>();
  return {
    checkpoint(value: WorkflowCheckpoint) { ports.insert({ id: value.id, runId: value.runId, workflowId: value.workflowId, definitionVersion: value.definitionVersion, sequence: value.sequence, completed: JSON.stringify(value.completed), pending: JSON.stringify(value.pending), artifacts: JSON.stringify(value.artifacts), provider: value.provider, approvalState: value.approvalState, recoveryMeta: JSON.stringify(value.recoveryMeta) }); },
    claimStep(runId: string, stepId: string, claimId: string) { if (ports.claim) return ports.claim(runId, stepId, claimId); const key = `${runId}:${stepId}`; if (claims.has(key)) return false; claims.add(key); ports.update(claimId, { runId, stepId, decision: 'claimed' }); return true; },
  };
}

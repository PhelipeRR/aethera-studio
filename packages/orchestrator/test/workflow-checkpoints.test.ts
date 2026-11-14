import { describe, expect, it } from 'vitest';
import { createWorkflowCheckpointStore } from '../src/workflow-checkpoints.js';
describe('workflow checkpoint store', () => {
  it('persists transitions and claims an active step only once', () => {
    const rows: Array<Record<string, unknown>> = [];
    const store = createWorkflowCheckpointStore({ insert: (row) => rows.push(row), update: (id, patch) => { const row = rows.find((item) => item.id === id) ?? Object.assign({ id }, patch); if (!rows.includes(row)) rows.push(row); Object.assign(row, patch); } });
    store.checkpoint({ id: 'c1', runId: 'r1', workflowId: 'w1', definitionVersion: 2, sequence: 1, completed: ['a'], pending: ['b'], artifacts: [], provider: null, approvalState: null, recoveryMeta: {} });
    expect(store.claimStep('r1', 'b', 'claim-1')).toBe(true);
    expect(store.claimStep('r1', 'b', 'claim-2')).toBe(false);
    expect(rows[0]).toMatchObject({ runId: 'r1', sequence: 1 });
  });
});

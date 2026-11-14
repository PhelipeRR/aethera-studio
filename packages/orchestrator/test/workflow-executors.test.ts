import { describe, expect, it } from 'vitest';
import { createWorkflowNativeExecutor } from '../src/workflow-executors.js';
describe('workflow native executors', () => {
  it('executes RAG, validation and git steps through injected safe ports', async () => {
    const calls: string[] = [];
    const execute = createWorkflowNativeExecutor({
      rag: async (query) => { calls.push(`rag:${query}`); return 'rag result'; },
      validation: async (command) => { calls.push(`validation:${command}`); return { ok: true, output: 'tests ok' }; },
      git: async (action) => { calls.push(`git:${action}`); return `git ${action}`; },
    });
    const context = { inputs: {}, outputs: {} };
    await expect(execute({ id: 'r', title: 'RAG', kind: 'rag', query: 'auth', topK: 3, dependsOn: [], requiresApproval: false }, context)).resolves.toBe('rag result');
    await expect(execute({ id: 'v', title: 'Tests', kind: 'validation', command: 'npm test', dependsOn: [], requiresApproval: false }, context)).resolves.toContain('tests ok');
    await expect(execute({ id: 'g', title: 'Diff', kind: 'git', action: 'diff', dependsOn: [], requiresApproval: false }, context)).resolves.toBe('git diff');
    expect(calls).toEqual(['rag:auth', 'validation:npm test', 'git:diff']);
  });
  it('does not treat failed validation as successful output', async () => {
    const execute = createWorkflowNativeExecutor({ rag: async () => '', validation: async () => ({ ok: false, output: 'failed' }), git: async () => '' });
    await expect(execute({ id: 'v', title: 'Tests', kind: 'validation', command: 'npm test', dependsOn: [], requiresApproval: false }, { inputs: {}, outputs: {} })).rejects.toThrow(/failed/);
  });
});

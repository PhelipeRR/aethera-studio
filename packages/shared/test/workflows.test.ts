import { describe, expect, it } from 'vitest';
import { compileWorkflow, interpolate, normalizeWorkflow, validateWorkflow } from '../src/workflows.js';

const step = (id: string, dependsOn: string[] = []) => ({ id, title: id, prompt: `run ${id}`, agent: 'auto' as const, mode: 'auto' as const, dependsOn, requiresApproval: false });

describe('workflow compiler', () => {
  it('validates dependencies and produces bounded deterministic layers', () => {
    const result = compileWorkflow({ name: 'Release', projectId: null, maxParallel: 2, steps: [step('build'), step('test', ['build']), step('docs', ['build'])] });
    expect(result.layers.map((layer) => layer.map((item) => item.id))).toEqual([['build'], ['test', 'docs']]);
  });

  it('rejects missing dependencies, duplicate ids and cycles', () => {
    expect(() => compileWorkflow({ name: 'x', projectId: null, maxParallel: 1, steps: [step('a', ['missing'])] })).toThrow(/invalid/);
    expect(() => compileWorkflow({ name: 'x', projectId: null, maxParallel: 1, steps: [step('a'), step('a')] })).toThrow(/duplicated/);
    expect(() => compileWorkflow({ name: 'x', projectId: null, maxParallel: 1, steps: [step('a', ['b']), step('b', ['a'])] })).toThrow(/cycle/);
  });

  it('normalizes a v1 definition, including the no-project read-only exception', () => {
    const normalized = normalizeWorkflow({ name: 'legacy', projectId: null, maxParallel: 1, steps: [step('legacy')] });
    expect(normalized).toMatchObject({ schemaVersion: 2, inputs: [], steps: [{ kind: 'agent', access: 'read-only' }] });
    expect(compileWorkflow({ name: 'legacy', projectId: null, maxParallel: 1, steps: [step('legacy')] }).definition.schemaVersion).toBe(2);
  });

  it('rejects a condition on a step it does not follow, and an edit without a project', () => {
    expect(() => compileWorkflow({ schemaVersion: 2, name: 'x', projectId: 'p', maxParallel: 1, inputs: [], steps: [{ id: 'c', title: 'C', kind: 'condition', when: { step: 'missing', contains: 'x' }, dependsOn: [], requiresApproval: false }] })).toThrow(/depender/);
    expect(() => compileWorkflow({ schemaVersion: 2, name: 'x', projectId: null, maxParallel: 1, inputs: [], steps: [{ id: 'a', title: 'A', kind: 'agent', prompt: 'x', agent: 'auto', mode: 'auto', access: 'edit', dependsOn: [], requiresApproval: false }] })).toThrow(/projectId/);
  });

  it('validates drafts without throwing and restricts interpolation to dependencies', () => {
    const result = validateWorkflow({ schemaVersion: 2, name: 'x', projectId: 'p', maxParallel: 1, inputs: [], steps: [{ id: 'a', title: 'A', kind: 'agent', prompt: '{{steps.b.output}}', agent: 'auto', mode: 'auto', access: 'edit', dependsOn: [], requiresApproval: false }, { id: 'b', title: 'B', kind: 'approval', message: 'ok', dependsOn: [], requiresApproval: false }] });
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'interpolation_dependency')).toBe(true);
  });

  it('interpolates only closed references and bounds untrusted outputs', () => {
    const output = interpolate('{{inputs.issue}} {{steps.a.output}}', { inputs: { issue: 'BUG-1' }, outputs: { a: 'x'.repeat(9000) } });
    expect(output).toContain('BUG-1');
    expect(output).toContain('[truncated]');
    expect(output).toContain('{{/untrusted}}');
  });
});

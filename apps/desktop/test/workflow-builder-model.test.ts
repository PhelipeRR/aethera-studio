import { compileWorkflow, type WorkflowDefinitionV2 } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { addDependency, createStep, duplicateStep, NODE_CATALOG, removeDependency, removeSteps } from '../src/renderer/src/features/workflows/builder/model';

const empty: WorkflowDefinitionV2 = { schemaVersion: 2, name: 'x', projectId: 'p', maxParallel: 2, inputs: [], steps: [] };
const three = (() => {
  let value = empty;
  for (const kind of ['claude', 'codex', 'generic'] as const) value = { ...value, steps: [...value.steps, createStep(kind, value)] };
  return value;
})();

describe('workflow builder model', () => {
  it('makes every catalogued block a step the compiler accepts', () => {
    for (const entry of NODE_CATALOG) {
      const anchor = createStep('generic', empty);
      const step = createStep(entry.kind, { ...empty, steps: [anchor] });
      const linked = addDependency({ ...empty, steps: [anchor, step] }, anchor.id, step.id);
      expect(() => compileWorkflow(linked), entry.kind).not.toThrow();
      expect(NODE_CATALOG.find((item) => item.matches(step))?.kind).toBe(entry.kind);
    }
  });

  it('connects steps and refuses a link that would close a loop', () => {
    const [a, b, c] = three.steps.map((step) => step.id) as [string, string, string];
    const chained = addDependency(addDependency(three, a, b), b, c);
    expect(chained.steps[2]?.dependsOn).toEqual([b]);
    expect(addDependency(chained, c, a)).toBe(chained);
    expect(addDependency(chained, a, a)).toBe(chained);
  });

  it('removes a link and a step with the links to it, keeping the last step', () => {
    const [a, b] = three.steps.map((step) => step.id) as [string, string];
    const linked = addDependency(three, a, b);
    expect(removeDependency(linked, a, b).steps[1]?.dependsOn).toEqual([]);
    expect(removeSteps(linked, [a]).steps.find((step) => step.id === b)?.dependsOn).toEqual([]);
    const single = removeSteps(three, three.steps.slice(1).map((step) => step.id));
    expect(removeSteps(single, [a])).toBe(single);
  });

  it('duplicates a step under a new id', () => {
    const copy = duplicateStep(three, 'step-1').steps.at(-1);
    expect(copy?.id).not.toBe('step-1');
    expect(copy?.title).toContain('cópia');
  });
});

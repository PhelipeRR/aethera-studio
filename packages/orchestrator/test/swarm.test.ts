import { describe, expect, it } from 'vitest';
import { buildHandoffs, detectSwarmConflicts, selectSpecialists } from '../src/swarm.js';

describe('specialist selection', () => {
  it('keeps trivial work bounded to one role', () => {
    expect(selectSpecialists('trivial', 'corrigir typo', 50_000)).toMatchObject({ roles: ['reviewer'], maxParallel: 1, requiresHumanApproval: false });
  });
  it('selects bounded specialists for complex security work', () => {
    const plan = selectSpecialists('complex', 'implementar fluxo com segurança e credenciais', 200_000);
    expect(plan.roles).toEqual(['architect', 'developer', 'qa', 'security', 'reviewer']);
    expect(plan.maxParallel).toBe(2);
    expect(plan.requiresHumanApproval).toBe(true);
  });
  it('creates read-only handoffs with explicit dependencies', () => {
    const handoffs = buildHandoffs(selectSpecialists('complex', 'implementar API', 200_000));
    expect(handoffs.find((item) => item.role === 'developer')).toMatchObject({ dependsOn: ['architect'], readOnly: false });
    expect(handoffs.filter((item) => item.role !== 'developer').every((item) => item.readOnly)).toBe(true);
  });
  it('audits files claimed by multiple specialists', () => {
    expect(detectSwarmConflicts([
      { role: 'developer', filesChanged: ['src/app.ts', 'src/shared.ts'] },
      { role: 'reviewer', filesChanged: ['src/shared.ts'] },
      { role: 'qa', filesChanged: ['tests/app.test.ts'] },
    ])).toEqual(['src/shared.ts']);
    expect(detectSwarmConflicts([{ role: 'developer', filesChanged: ['src/app.ts'] }, { role: 'qa', filesChanged: ['tests/app.test.ts'] }])).toEqual([]);
  });
});

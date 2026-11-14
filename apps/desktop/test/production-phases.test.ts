import { describe, expect, it } from 'vitest';
import type { ProductionRunView, ProductionState } from '@neuralbridge/shared/velix-production';
import { activeRun, flowPhases } from '../src/renderer/src/features/video/production-phases';

// R3: the header's four phases come from the persisted production, never from estimates.
type Stage = ProductionState['stages'][number];
const run = (over: Partial<ProductionRunView> = {}): ProductionRunView => ({ id: 'r1', projectId: 'p', status: 'running', topic: 'Tema', formatId: 'youtube-long', agent: 'claude', estimatedCostUsd: 0, actualCostUsd: 0, createdAt: '2026-11-09T10:00:00Z', updatedAt: '2026-11-09T10:00:00Z', ...over });
let clock = 0;
const stage = (kind: Stage['kind'], status: Stage['status']): Stage => ({ id: `${kind}-${clock}`, kind, status, progress: status === 'completed' ? 1 : 0, retryCount: 0, costEstimateUsd: 0, actualCostUsd: 0, taskId: null, error: null, outputArtifactIds: [], updatedAt: `2026-11-09T10:00:${String(clock++).padStart(2, '0')}Z` });
const state = (stages: Stage[], over: { run?: Partial<ProductionRunView>; approvals?: ProductionState['approvals'] } = {}) =>
  ({ run: run(over.run), stages, approvals: over.approvals ?? [], artifacts: [], qualityReports: [], budget: { currency: 'USD', limitUsd: 5, reserveUsd: 0, consumedUsd: 0, policy: 'x' }, brief: {} as ProductionState['brief'] }) as ProductionState;
const approval = { id: 'a1', stageId: 's', decision: 'approved' as const, note: null, createdAt: '2026-11-09T10:01:00Z' };

describe('activeRun', () => {
  it('follows the latest open production, then the latest one; none without runs', () => {
    expect(activeRun(undefined)).toBeNull();
    expect(activeRun([])).toBeNull();
    const open = run({ id: 'open', updatedAt: '2026-11-09T09:00:00Z' });
    const done = run({ id: 'done', status: 'completed', updatedAt: '2026-11-09T11:00:00Z' });
    expect(activeRun([done, open])?.id).toBe('open');
    expect(activeRun([run({ id: 'old', status: 'cancelled', updatedAt: '2026-11-08T00:00:00Z' }), done])?.id).toBe('done');
  });
});

describe('flowPhases', () => {
  it('starts with every phase pending and no current phase', () => {
    expect(flowPhases(state([], { run: { status: 'draft' } }))).toEqual({ phases: { descobrir: 'pending', planejar: 'pending', aprovar: 'pending', finalizar: 'pending' }, current: null });
  });

  it('marks research running as the current phase', () => {
    const result = flowPhases(state([stage('briefing', 'completed'), stage('research', 'running')]));
    expect(result.phases.descobrir).toBe('running');
    expect(result.current).toBe('descobrir');
  });

  it('completes a phase only once a later phase started', () => {
    expect(flowPhases(state([stage('briefing', 'completed'), stage('research', 'completed')])).phases.descobrir).toBe('running');
    const next = flowPhases(state([stage('briefing', 'completed'), stage('research', 'completed'), stage('script', 'running')]));
    expect(next.phases).toMatchObject({ descobrir: 'completed', planejar: 'running' });
    expect(next.current).toBe('planejar');
  });

  it('puts a stage waiting for a person on Aprovar, and that becomes the current phase', () => {
    const result = flowPhases(state([stage('briefing', 'completed'), stage('research', 'completed'), stage('script', 'awaiting_approval')], { run: { status: 'awaiting_approval' } }));
    expect(result.phases).toMatchObject({ planejar: 'running', aprovar: 'awaiting' });
    expect(result.current).toBe('aprovar');
  });

  it('counts past decisions as a completed approval', () => {
    expect(flowPhases(state([stage('script', 'completed'), stage('narration', 'running')], { approvals: [approval] })).phases.aprovar).toBe('completed');
  });

  it('reports failures first after approvals, and paused stages', () => {
    const failed = flowPhases(state([stage('briefing', 'completed'), stage('research', 'completed'), stage('script', 'completed'), stage('render', 'failed')]));
    expect(failed.phases.finalizar).toBe('failed');
    expect(failed.current).toBe('finalizar');
    const paused = flowPhases(state([stage('briefing', 'paused')], { run: { status: 'paused' } }));
    expect(paused.phases.descobrir).toBe('paused');
    expect(paused.current).toBe('descobrir');
    // After a restart the interrupted stage is pending again and the run paused: the phase reads as paused.
    expect(flowPhases(state([stage('research', 'pending')], { run: { status: 'paused' } })).phases.descobrir).toBe('paused');
  });

  it('uses only the latest stage of a kind after a retry', () => {
    const result = flowPhases(state([stage('research', 'failed'), stage('research', 'running')]));
    expect(result.phases.descobrir).toBe('running');
  });

  it('shows a finished production as completed with no current phase', () => {
    const all = ['briefing', 'research', 'script', 'storyboard', 'narration', 'sync', 'composition', 'render', 'quality', 'export'] as const;
    const result = flowPhases(state(all.map((kind) => stage(kind, 'completed')), { run: { status: 'completed' }, approvals: [approval] }));
    expect(result).toEqual({ phases: { descobrir: 'completed', planejar: 'completed', aprovar: 'completed', finalizar: 'completed' }, current: null });
  });

  it('shows a cancelled production as cancelled where work never finished', () => {
    const result = flowPhases(state([stage('briefing', 'completed'), stage('research', 'cancelled')], { run: { status: 'cancelled' } }));
    expect(result.phases).toMatchObject({ descobrir: 'cancelled', planejar: 'cancelled', aprovar: 'cancelled', finalizar: 'cancelled' });
    expect(result.current).toBeNull();
  });
});

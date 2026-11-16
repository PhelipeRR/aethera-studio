import { describe, expect, it } from 'vitest';
import { ProductionStageTracker, isProductionStage, stageOrigin } from '../src/main/production-stage-tracker.js';

/** Stage lifecycle only; whole-job events (`job_*`) are asserted separately. */
function stages<T extends { event: string }>(transitions: T[]): T[] {
  return transitions.filter((transition) => !transition.event.startsWith('job_'));
}

function sample(overrides: Partial<Parameters<ProductionStageTracker['observe']>[0]> = {}) {
  return {
    projectId: 'job_1',
    state: 'pesquisa',
    progressPct: 18,
    message: 'Pesquisando fatos...',
    completedStages: [],
    ...overrides,
  };
}

describe('ProductionStageTracker — ciclo de vida real das etapas', () => {
  it('emits stage_started when the pipeline enters a stage', () => {
    const tracker = new ProductionStageTracker();
    const transitions = stages(tracker.observe(sample()));
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.event).toBe('stage_started');
    expect(transitions[0]?.stage).toBe('pesquisa');
    expect(transitions[0]?.origin).toBe('pesquisa');
    expect(transitions[0]?.pct).toBe(18);
  });

  it('emits completed for the previous stage and started for the new one', () => {
    const tracker = new ProductionStageTracker();
    tracker.observe(sample());
    const transitions = tracker.observe(sample({ state: 'roteiro', progressPct: 30, message: 'Escrevendo roteiro' }));
    expect(transitions.map((transition) => transition.event)).toEqual(['stage_completed', 'stage_started']);
    expect(transitions[0]?.stage).toBe('pesquisa');
    expect(transitions[1]?.stage).toBe('roteiro');
  });

  it('marks a re-entered stage as retry', () => {
    const tracker = new ProductionStageTracker();
    tracker.observe(sample());
    tracker.observe(sample({ state: 'roteiro', progressPct: 30 }));
    const transitions = tracker.observe(sample({ state: 'pesquisa', progressPct: 22, message: 'Refazendo pesquisa' }));
    expect(transitions.map((transition) => transition.event)).toEqual(['stage_completed', 'stage_retry']);
    expect(transitions[1]?.stage).toBe('pesquisa');
  });

  it('reports a progress line only when the human message changed', () => {
    const tracker = new ProductionStageTracker();
    tracker.observe(sample());
    expect(tracker.observe(sample())).toEqual([]);
    const changed = tracker.observe(sample({ progressPct: 20, message: 'Dossiê recebido, validando' }));
    expect(changed).toHaveLength(1);
    expect(changed[0]?.event).toBe('log');
    expect(changed[0]?.pct).toBe(20);
  });

  it('emits stage_failed with the real error and closes the stage', () => {
    const tracker = new ProductionStageTracker();
    tracker.observe(sample());
    const all = tracker.observe(
      sample({ state: 'error', progressPct: 20, message: 'Falha na aquisição', error: 'download_failed: 403' }),
    );
    const transitions = stages(all);
    expect(transitions).toHaveLength(1);
    expect(all.at(-1)?.event).toBe('job_failed');
    expect(transitions[0]?.event).toBe('stage_failed');
    expect(transitions[0]?.severity).toBe('error');
    expect(transitions[0]?.stage).toBe('pesquisa');
    expect(transitions[0]?.details?.error).toBe('download_failed: 403');
  });

  it('maps paused states to stage_paused with warn severity', () => {
    const tracker = new ProductionStageTracker();
    tracker.observe(sample());
    const paused = tracker.observe(sample({ state: 'paused_pending_media', message: 'Aguardando mídia' }));
    expect(paused[0]?.event).toBe('stage_paused');
    expect(paused[0]?.severity).toBe('warn');

    const resumed = tracker.observe(sample({ state: 'aquisicao', progressPct: 40, message: 'Retomando' }));
    expect(resumed.map((transition) => transition.event)).toEqual(['stage_started']);
  });

  it('ignores idle and unknown states instead of inventing steps', () => {
    const tracker = new ProductionStageTracker();
    expect(tracker.observe(sample({ state: 'idle' }))).toEqual([]);
    expect(tracker.observe(sample({ state: 'estado_desconhecido' }))).toEqual([]);
  });

  it('keeps jobs isolated and can be reset', () => {
    const tracker = new ProductionStageTracker();
    tracker.observe(sample({ projectId: 'a', state: 'pesquisa' }));
    const other = stages(tracker.observe(sample({ projectId: 'b', state: 'roteiro' })));
    expect(other[0]?.event).toBe('stage_started');
    tracker.reset('a');
    const again = stages(tracker.observe(sample({ projectId: 'a', state: 'pesquisa' })));
    expect(again[0]?.event).toBe('stage_started');
  });

  it('tracks by jobId: two productions of the same project never share stage state', () => {
    const tracker = new ProductionStageTracker();
    tracker.observe(sample({ projectId: 'p', jobId: 'job_A', state: 'pesquisa' }));
    tracker.observe(sample({ projectId: 'p', jobId: 'job_A', state: 'roteiro' }));
    // a new production of the same project starts clean: pesquisa is "started", not a retry of job_A's
    const fresh = tracker.observe(sample({ projectId: 'p', jobId: 'job_B', state: 'pesquisa' }));
    expect(fresh.map((t) => t.event)).toEqual(['job_started', 'stage_started']);
  });

  it('opens each attempt with job_started and reports re-entered stages of a resumed job as retry', () => {
    const tracker = new ProductionStageTracker();
    const first = tracker.observe(sample({ jobId: 'job_R', attempt: 1, state: 'pesquisa' }));
    expect(first[0]).toMatchObject({ event: 'job_started', message: 'Produção iniciada' });
    const failed = tracker.observe(sample({ jobId: 'job_R', attempt: 1, state: 'error', error: 'timeout' }));
    expect(failed.map((t) => t.event)).toEqual(['stage_failed', 'job_failed']);
    // the same terminal snapshot written twice does not duplicate the outcome
    expect(tracker.observe(sample({ jobId: 'job_R', attempt: 1, state: 'error', error: 'timeout' }))).toEqual([]);
    const resumed = tracker.observe(sample({ jobId: 'job_R', attempt: 2, state: 'pesquisa' }));
    expect(resumed.map((t) => t.event)).toEqual(['job_started', 'stage_retry']);
    expect(resumed[0]?.message).toBe('Produção retomada (tentativa 2)');
  });

  it('closes the job with job_completed (editor), job_paused and job_cancelled', () => {
    const tracker = new ProductionStageTracker();
    tracker.observe(sample({ jobId: 'c', state: 'previa' }));
    expect(tracker.observe(sample({ jobId: 'c', state: 'editor', progressPct: 100 })).at(-1)?.event).toBe('job_completed');
    tracker.observe(sample({ jobId: 'p', state: 'aquisicao' }));
    expect(tracker.observe(sample({ jobId: 'p', state: 'paused_pending_media' })).at(-1)?.event).toBe('job_paused');
    tracker.observe(sample({ jobId: 'x', state: 'montagem' }));
    expect(tracker.observe(sample({ jobId: 'x', state: 'cancelled' })).at(-1)?.event).toBe('job_cancelled');
  });

  it('knows which states are production stages and which origin each stage belongs to', () => {
    expect(isProductionStage('montagem')).toBe(true);
    expect(isProductionStage('error')).toBe(false);
    expect(stageOrigin('pesquisa')).toBe('pesquisa');
    expect(stageOrigin('roteiro')).toBe('agent');
    expect(stageOrigin('audio_sfx_vfx')).toBe('narracao');
    expect(stageOrigin('previa')).toBe('renderizacao');
    expect(stageOrigin('qc')).toBe('vision');
  });
});

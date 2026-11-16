import { describe, expect, it } from 'vitest';
import {
  PIPELINE_PHASES,
  PIPELINE_STAGES,
  humorLabelOf,
  jobStatusOf,
  stageProgressOf,
  stageStateOf,
} from '../../../packages/desktop-shared/src/renderer/src/features/video/cinema/production-status-model';

describe('production status model', () => {
  it('counts stages from PIPELINE_STAGES, never from a fixed 8', () => {
    expect(PIPELINE_STAGES).toHaveLength(11);
    const progress = stageProgressOf({ state: 'roteiro', completedStages: ['prompt', 'interpretacao', 'pesquisa'] });
    expect(progress).toEqual({ current: 4, total: 11, completed: 3, label: 'Roteiro' });
  });

  it('ignores completed stages that are not shown in the stepper', () => {
    const all = [...PIPELINE_STAGES.map((stage) => stage.id), 'audio_sfx_vfx', 'qc'];
    const progress = stageProgressOf({ state: 'editor', completedStages: all });
    expect(progress.completed).toBe(11);
    expect(progress.current).toBe(11);
  });

  it('points a paused job at the next unfinished stage', () => {
    const progress = stageProgressOf({ state: 'paused_pending_research', completedStages: ['prompt', 'interpretacao'] });
    expect(progress.current).toBe(3);
    expect(progress.label).toBe('Pesquisa');
  });

  it('labels every backend state with text, not only color', () => {
    expect(jobStatusOf({ state: 'roteiro' })).toEqual({ kind: 'running', label: 'Rodando' });
    expect(jobStatusOf({ state: 'paused_pending_media', pendingMedia: [1, 2, 3] })).toEqual({ kind: 'waiting', label: 'Aguarda mídia (3)' });
    expect(jobStatusOf({ state: 'paused_pending_research' }).kind).toBe('waiting');
    expect(jobStatusOf({ state: 'error' })).toEqual({ kind: 'failed', label: 'Falhou' });
    expect(jobStatusOf({ state: 'cancelled' }).kind).toBe('cancelled');
    expect(jobStatusOf({ state: 'editor' })).toEqual({ kind: 'done', label: 'Pronto' });
  });

  it('marks the first open stage of a failed or waiting job', () => {
    const failed = { state: 'error', completedStages: ['prompt', 'interpretacao'] };
    expect(stageStateOf(failed, 'prompt')).toBe('done');
    expect(stageStateOf(failed, 'pesquisa')).toBe('failed');
    expect(stageStateOf(failed, 'roteiro')).toBe('pending');
    expect(stageStateOf({ state: 'paused_pending_media', completedStages: ['prompt'] }, 'interpretacao')).toBe('waiting');
    expect(stageStateOf({ state: 'roteiro', completedStages: [] }, 'roteiro')).toBe('active');
    expect(stageStateOf(null, 'prompt')).toBe('pending');
  });

  it('groups the 11 stages into 4 phases without losing any', () => {
    expect(PIPELINE_PHASES.flatMap((phase) => phase.stageIds)).toEqual(PIPELINE_STAGES.map((stage) => stage.id));
  });

  it('names the humor bands', () => {
    expect([0, 10, 35, 60, 90].map(humorLabelOf)).toEqual(['Desligado', 'Sutil', 'Pontual', 'Marcante', 'Comédia']);
  });
});

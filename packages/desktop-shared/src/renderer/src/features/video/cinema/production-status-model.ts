/**
 * Presentation model of the AI production screen. Pure functions over the job view the pipeline already sends: no
 * state, no IPC, nothing inferred that the backend did not report.
 */

/** Pipeline stages shown to the user, in order. Single source of truth for "Etapa N de 11". */
export const PIPELINE_STAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'prompt', label: 'Prompt' },
  { id: 'interpretacao', label: 'Interpretação' },
  { id: 'pesquisa', label: 'Pesquisa' },
  { id: 'roteiro', label: 'Roteiro' },
  { id: 'decupagem', label: 'Decupagem' },
  { id: 'aquisicao', label: 'Aquisição' },
  { id: 'validacao_visual', label: 'Validação visual' },
  { id: 'planejamento', label: 'Planejamento' },
  { id: 'montagem', label: 'Montagem' },
  { id: 'previa', label: 'Prévia' },
  { id: 'editor', label: 'Editor' },
];

/** The 11 stages grouped in 4 phases to lower the cognitive load of the stepper. */
export const PIPELINE_PHASES: ReadonlyArray<{ id: string; label: string; stageIds: readonly string[] }> = [
  { id: 'planning', label: 'Planejamento', stageIds: ['prompt', 'interpretacao', 'pesquisa', 'roteiro', 'decupagem'] },
  { id: 'media', label: 'Mídia', stageIds: ['aquisicao', 'validacao_visual'] },
  { id: 'assembly', label: 'Montagem', stageIds: ['planejamento', 'montagem', 'previa'] },
  { id: 'delivery', label: 'Entrega', stageIds: ['editor'] },
];

export const STAGE_DISPLAY_LABELS: Record<string, string> = {
  prompt: 'Prompt',
  interpretacao: 'Interpretação',
  pesquisa: 'Pesquisa Editorial',
  paused_pending_research: 'Pausado (Pesquisa Pendente)',
  roteiro: 'Roteiro',
  paused_pending_script: 'Pausado (Roteiro Pendente)',
  decupagem: 'Decupagem Semântica',
  aquisicao: 'Aquisição de Mídia',
  validacao_visual: 'Validação Visual',
  paused_pending_media: 'Pausado (Mídia Pendente)',
  planejamento: 'Planejamento',
  montagem: 'Montagem',
  audio_sfx_vfx: 'Áudio / SFX / VFX',
  qc: 'QC Editorial',
  previa: 'Prévia',
  editor: 'Concluído — Pronto para Editor',
  cancelled: 'Cancelado',
  error: 'Erro',
};

export interface JobStatusInput {
  state: string;
  completedStages?: readonly string[];
  pendingMedia?: readonly unknown[];
}

export type JobStatusKind = 'running' | 'waiting' | 'failed' | 'done' | 'cancelled';

export interface JobStatus {
  kind: JobStatusKind;
  /** Short state text, always shown next to the icon (color is never the only indicator). */
  label: string;
}

/** Backend states only: running, waiting for the user (paused_pending_*), failed, completed, cancelled. */
export function jobStatusOf(job: JobStatusInput): JobStatus {
  if (job.state === 'error') return { kind: 'failed', label: 'Falhou' };
  if (job.state === 'cancelled') return { kind: 'cancelled', label: 'Cancelado' };
  if (job.state === 'editor') return { kind: 'done', label: 'Pronto' };
  if (job.state === 'paused_pending_media') {
    const count = job.pendingMedia?.length ?? 0;
    return { kind: 'waiting', label: count > 0 ? `Aguarda mídia (${count})` : 'Aguarda mídia' };
  }
  if (job.state === 'paused_pending_research') return { kind: 'waiting', label: 'Pesquisa pendente' };
  if (job.state === 'paused_pending_script') return { kind: 'waiting', label: 'Roteiro pendente' };
  if (job.state.startsWith('paused_')) return { kind: 'waiting', label: 'Pausado' };
  return { kind: 'running', label: 'Rodando' };
}

export interface StageProgress {
  /** 1-based number of the current (or next) stage. */
  current: number;
  total: number;
  /** Stages of PIPELINE_STAGES the job reported as completed. */
  completed: number;
  /** Label of the current stage, or of the state when the job is paused/failed. */
  label: string;
}

/** "Etapa N de 11" derived from PIPELINE_STAGES, never from a hard-coded count. */
export function stageProgressOf(job: JobStatusInput): StageProgress {
  const total = PIPELINE_STAGES.length;
  const done = new Set(job.completedStages ?? []);
  const completed = PIPELINE_STAGES.filter((stage) => done.has(stage.id)).length;
  const index = PIPELINE_STAGES.findIndex((stage) => stage.id === job.state);
  if (index >= 0) {
    return { current: index + 1, total, completed, label: PIPELINE_STAGES[index]?.label ?? job.state };
  }
  const next = PIPELINE_STAGES.find((stage) => !done.has(stage.id));
  return {
    current: Math.min(total, completed + 1),
    total,
    completed,
    label: next?.label ?? STAGE_DISPLAY_LABELS[job.state] ?? job.state,
  };
}

export type StageState = 'done' | 'active' | 'waiting' | 'failed' | 'pending';

/** State of one stage for the stepper: the first unfinished stage carries the job's waiting/failed state. */
export function stageStateOf(job: JobStatusInput | null | undefined, stageId: string): StageState {
  if (!job) return 'pending';
  if (job.completedStages?.includes(stageId)) return 'done';
  if (job.state === stageId) return 'active';
  const firstOpen = PIPELINE_STAGES.find((stage) => !job.completedStages?.includes(stage.id));
  if (firstOpen?.id === stageId) {
    const status = jobStatusOf(job).kind;
    if (status === 'failed') return 'failed';
    if (status === 'waiting') return 'waiting';
  }
  return 'pending';
}

/** Semantic band of the humor slider, shown next to the number. */
export function humorLabelOf(intensity: number): string {
  if (intensity <= 0) return 'Desligado';
  if (intensity <= 25) return 'Sutil';
  if (intensity <= 50) return 'Pontual';
  if (intensity <= 75) return 'Marcante';
  return 'Comédia';
}

/** VRAM of each render profile, the same figures the render select always showed. */
export const RENDER_PROFILE_OPTIONS: ReadonlyArray<{ id: 'draft_540p' | 'review_720p' | 'master_1080p' | 'master_4k'; label: string; vram: string }> = [
  { id: 'draft_540p', label: 'Draft 540p', vram: '1,4 GB de VRAM' },
  { id: 'review_720p', label: 'Review 720p', vram: '2,4 GB de VRAM' },
  { id: 'master_1080p', label: 'Master 1080p', vram: '4,8 GB de VRAM' },
  { id: 'master_4k', label: 'Master 4K', vram: 'alto custo de VRAM' },
];

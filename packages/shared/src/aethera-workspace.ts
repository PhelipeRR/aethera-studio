import type { ProductionRunStatus, ProductionStageStatus, ProductionState } from './velix-production.js';

export type AetheraWorkspaceMode = 'automatic' | 'editor';

export const AETHERA_WORKSPACE_MODES: readonly AetheraWorkspaceMode[] = ['automatic', 'editor'];

export const AETHERA_RUN_STATUS_LABEL: Record<ProductionRunStatus, string> = {
  draft: 'Rascunho',
  running: 'Em execução',
  paused: 'Pausada',
  awaiting_approval: 'Aguardando aprovação',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

export const AETHERA_STAGE_STATUS_LABEL: Record<ProductionStageStatus, string> = {
  pending: 'Pendente',
  running: 'Em execução',
  paused: 'Pausada',
  awaiting_approval: 'Aguardando aprovação',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

/** Route used by the single-production workspace; the id is an opaque persisted run id. */
export function aetheraProductionRoute(runId: string): string {
  return `/aethera/productions/${encodeURIComponent(runId)}`;
}

/** A compact real-state summary for the monitor. No progress is invented when no stage has run. */
export function aetheraWorkspaceProgress(state: ProductionState): { completed: number; total: number; ratio: number } {
  const total = state.stages.length;
  const completed = state.stages.filter((stage) => stage.status === 'completed').length;
  return { completed, total, ratio: total === 0 ? 0 : completed / total };
}

export function aetheraStageTone(status: ProductionStageStatus): 'quiet' | 'active' | 'attention' | 'done' {
  if (status === 'completed') return 'done';
  if (status === 'running') return 'active';
  if (status === 'failed' || status === 'awaiting_approval') return 'attention';
  return 'quiet';
}

import type { ProductionRunView, ProductionState } from '@neuralbridge/shared/velix-production';

/*
 * R3 — the four flow cards of the Aethera header, tied to the real state of a persisted production. Pure: no fetching,
 * no React, so every stage and run status can be tested. Nothing here is estimated: a phase is "pending" until one of
 * its stages exists, and approval is only "awaiting" when a stage really waits for a person.
 */

export type FlowPhaseId = 'descobrir' | 'planejar' | 'aprovar' | 'finalizar';
export type FlowPhaseStatus = 'pending' | 'running' | 'paused' | 'awaiting' | 'completed' | 'failed' | 'cancelled';
type Stage = ProductionState['stages'][number];
type StageKind = Stage['kind'];

/** Which production stages belong to each phase. "Aprovar" has no stages of its own: it is the approvals of the others. */
export const PHASE_STAGES: Record<Exclude<FlowPhaseId, 'aprovar'>, readonly StageKind[]> = {
  descobrir: ['briefing', 'research', 'game_research', 'media_discovery', 'media_acquisition', 'visual_index'],
  planejar: ['script', 'storyboard', 'scene_matching'],
  finalizar: ['narration', 'sync', 'composition', 'render', 'quality', 'export'],
};
const ORDER: readonly FlowPhaseId[] = ['descobrir', 'planejar', 'aprovar', 'finalizar'];
const TERMINAL = new Set<ProductionRunView['status']>(['completed', 'cancelled']);

export const PHASE_STATUS_LABEL: Record<FlowPhaseStatus, string> = {
  pending: 'Pendente',
  running: 'Em andamento',
  paused: 'Pausada',
  awaiting: 'Aguardando você',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

/** The production the header follows: the most recently updated one still open; otherwise the most recent one. */
export function activeRun(runs: readonly ProductionRunView[] | undefined): ProductionRunView | null {
  if (!runs?.length) return null;
  const recent = [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return recent.find((run) => !TERMINAL.has(run.status)) ?? recent[0] ?? null;
}

/** Retries add stages of the same kind: only the latest of each kind tells where the production is. */
function latestByKind(stages: readonly Stage[]) {
  const latest = new Map<StageKind, Stage>();
  for (const stage of stages) {
    const known = latest.get(stage.kind);
    if (!known || stage.updatedAt >= known.updatedAt) latest.set(stage.kind, stage);
  }
  return latest;
}

function workPhase(kinds: readonly StageKind[], latest: Map<StageKind, Stage>, laterStarted: boolean, run: ProductionRunView): FlowPhaseStatus {
  const stages = kinds.map((kind) => latest.get(kind)).filter((stage): stage is Stage => !!stage);
  if (!stages.length) return run.status === 'cancelled' ? 'cancelled' : 'pending';
  const has = (status: Stage['status']) => stages.some((stage) => stage.status === status);
  if (has('failed')) return 'failed';
  if (has('running') || has('awaiting_approval')) return 'running';
  if (has('paused')) return 'paused';
  if (has('cancelled')) return 'cancelled';
  const allDone = stages.every((stage) => stage.status === 'completed');
  if (allDone && (laterStarted || run.status === 'completed')) return 'completed';
  if (run.status === 'cancelled') return 'cancelled';
  // A paused production (for example after a restart interrupted a stage) leaves its open stages pending.
  if (run.status === 'paused') return 'paused';
  return has('completed') ? 'running' : 'pending';
}

function approvalPhase(state: ProductionState): FlowPhaseStatus {
  if (state.stages.some((stage) => stage.status === 'awaiting_approval')) return 'awaiting';
  if (state.approvals.length) return 'completed';
  return state.run.status === 'cancelled' ? 'cancelled' : 'pending';
}

export type FlowPhases = { phases: Record<FlowPhaseId, FlowPhaseStatus>; current: FlowPhaseId | null };

/** Status of each phase and the one that needs attention now (null when nothing is in progress or waiting). */
export function flowPhases(state: ProductionState): FlowPhases {
  const latest = latestByKind(state.stages);
  const started = (phase: Exclude<FlowPhaseId, 'aprovar'>) => PHASE_STAGES[phase].some((kind) => latest.has(kind));
  const phases: Record<FlowPhaseId, FlowPhaseStatus> = {
    descobrir: workPhase(PHASE_STAGES.descobrir, latest, started('planejar') || started('finalizar'), state.run),
    planejar: workPhase(PHASE_STAGES.planejar, latest, started('finalizar'), state.run),
    aprovar: approvalPhase(state),
    finalizar: workPhase(PHASE_STAGES.finalizar, latest, false, state.run),
  };
  const pick = (status: FlowPhaseStatus) => ORDER.find((phase) => phases[phase] === status) ?? null;
  const current = pick('awaiting') ?? pick('failed') ?? pick('running') ?? pick('paused');
  return { phases, current };
}

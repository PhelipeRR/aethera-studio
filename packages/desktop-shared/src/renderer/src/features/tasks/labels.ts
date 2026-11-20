import type { AgentId, RunMode, TaskStatus } from '@neuralbridge/shared/domain';
import type { StepKind, TaskTokens } from '@neuralbridge/shared/tasks';

export const AGENT_LABEL: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex CLI', 'claude-gateway': 'Claude Gateway' };

export const MODE_LABEL: Record<RunMode, string> = { auto: 'Automático', claude: 'Claude Code', codex: 'Codex CLI', collab: 'Colaborativo' };

export const MODE_HINT: Record<RunMode, string> = {
  auto: 'O roteador escolhe pelo tipo de pedido e explica por quê.',
  claude: 'Só o Claude Code.',
  codex: 'Só o Codex CLI.',
  collab: 'Claude planeja e revisa, Codex implementa.',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Na fila',
  planning: 'Planejando',
  running: 'Executando',
  awaiting_approval: 'Aguardando aprovação',
  validating: 'Validando',
  paused: 'Pausada',
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};

export const STEP_LABEL: Record<StepKind, string> = { plan: 'Análise', implement: 'Implementação', review: 'Revisão', fix: 'Correção', validate: 'Validação' };

/** Collaborative plan steps read better with their own name. */
export function stepLabel(kind: StepKind, collaborative: boolean): string {
  return kind === 'plan' && collaborative ? 'Planejamento' : STEP_LABEL[kind];
}

const integer = new Intl.NumberFormat('pt-BR');
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });

/** Tokens exactly as the providers reported them; nothing is estimated here. */
export function formatTokens(tokens: TaskTokens): string | null {
  if (tokens.input === null && tokens.output === null) return null;
  const parts = [`${integer.format(tokens.input ?? 0)} tokens de entrada`, `${integer.format(tokens.output ?? 0)} de saída`];
  if (tokens.cached) parts.push(`${integer.format(tokens.cached)} em cache`);
  return parts.join(', ');
}

export function formatCost(costUsd: number | null): string | null {
  return costUsd === null ? null : `${money.format(costUsd)} (preço de API informado pelo provedor; no plano de assinatura é uma estimativa)`;
}

export function formatDuration(startedAt: string | null, finishedAt: string | null): string | null {
  if (!startedAt || !finishedAt) return null;
  const seconds = Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

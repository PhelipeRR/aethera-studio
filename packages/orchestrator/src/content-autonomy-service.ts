import type { AutonomyMode } from '@neuralbridge/shared';

export type ContentApprovalBoundary = 'briefing' | 'script' | 'production' | 'package' | 'publication';
export type ContentAutonomyPolicy = { mode: AutonomyMode; budgetUsd: number; activeExecutions: number; concurrencyLimit: number };

export function requiresContentApproval(mode: AutonomyMode, boundary: ContentApprovalBoundary): boolean {
  if (boundary === 'publication') return true;
  if (mode === 'manual') return true;
  return mode === 'assisted' && (boundary === 'script' || boundary === 'package');
}

export function canStartContentExecution(policy: ContentAutonomyPolicy, estimatedCostUsd: number): { allowed: boolean; reason: string | null } {
  if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) return { allowed: false, reason: 'Custo estimado inválido.' };
  if (policy.activeExecutions >= Math.max(1, Math.floor(policy.concurrencyLimit))) return { allowed: false, reason: 'Limite de execuções paralelas atingido.' };
  if (estimatedCostUsd > policy.budgetUsd) return { allowed: false, reason: 'Custo estimado excede o orçamento do canal/projeto.' };
  return { allowed: true, reason: null };
}

export function autonomyDecision(policy: ContentAutonomyPolicy, boundary: ContentApprovalBoundary, estimatedCostUsd: number): { allowed: boolean; approvalRequired: boolean; reason: string | null } {
  const capacity = canStartContentExecution(policy, estimatedCostUsd);
  if (!capacity.allowed) return { ...capacity, approvalRequired: false };
  return { allowed: true, approvalRequired: requiresContentApproval(policy.mode, boundary), reason: requiresContentApproval(policy.mode, boundary) ? `A etapa ${boundary} exige aprovação no modo ${policy.mode}.` : null };
}

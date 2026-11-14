import type { WorkflowFailureKind, WorkflowRecovery } from '@neuralbridge/shared';

export type FailureKind = WorkflowFailureKind;
export type RecoveryPolicy = WorkflowRecovery;
export type RecoveryAction = { action: 'retry' | 'fallback' | 'decision' | 'stop'; reason: string };
export type RecoveryPolicyInput = { failure: FailureKind; attempt: number; treeChanged: boolean; access: 'read-only' | 'edit'; policy: RecoveryPolicy; elapsedMs?: number };

/** Reads the failure from what the provider reported. Anything unrecognised is an execution failure, never retried. */
export function failureKindOf(message: string): FailureKind {
  if (/\b429\b|rate.?limit|too many requests/i.test(message)) return 'rate_limit';
  if (/API Error:\s*5\d\d|\b529\b|overloaded|sobrecarreg|internal server error|bad gateway|service unavailable/i.test(message)) return 'provider_overloaded';
  if (/(usage|quota|limit).*(exceed|reached|hit)|limite.*(tokens?|uso)/i.test(message)) return 'usage_limit';
  if (/(context|prompt).*(window|length|too large)|janela.*contexto|contexto.*(exced|grande)/i.test(message)) return 'context_limit';
  if (/not logged|unauthori[sz]ed|authentication|login/i.test(message)) return 'authentication';
  if (/access denied|permission denied|acesso negado/i.test(message)) return 'permission';
  if (/timeout|timed out|tempo limite/i.test(message)) return 'timeout';
  if (/ECONN|ENOTFOUND|EAI_AGAIN|network|socket hang up|disconnected/i.test(message)) return 'network';
  return 'execution';
}
export function backoffDelay(attempt: number, base: number, max: number, random = Math.random): number { return Math.min(max, base * 2 ** Math.max(0, attempt - 1)) * random(); }
export function decideRecovery(input: RecoveryPolicyInput): RecoveryAction {
  if (input.treeChanged && input.access === 'edit') return { action: 'decision', reason: 'A árvore mudou após uma etapa de edição.' };
  const retry = input.policy.retry;
  if (retry && retry.on.includes(input.failure) && input.attempt < retry.maxAttempts && (input.elapsedMs ?? 0) < retry.maxTotalMs) return { action: 'retry', reason: `Tentativa ${input.attempt + 1} de ${retry.maxAttempts}.` };
  const fallback = input.policy.fallback;
  if (fallback && fallback.on.includes(input.failure) && (input.access === 'read-only' || fallback.allowEdit)) return { action: 'fallback', reason: `Trocando para ${fallback.to}.` };
  return { action: 'stop', reason: `Falha ${input.failure} não pode ser recuperada.` };
}

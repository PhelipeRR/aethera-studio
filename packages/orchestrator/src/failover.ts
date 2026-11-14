import type { AgentId } from '@neuralbridge/shared';

export type AgentFailureKind = 'usage_limit' | 'context_limit' | 'authentication' | 'permission' | 'temporary' | 'execution' | 'unknown';

/** Conservative classification used only for read-only failover; it never treats a project permission error as transient. */
export function classifyAgentFailure(message: string): AgentFailureKind {
  if (/API Error:\s*5\d\d|overloaded|sobrecarreg|internal server error|bad gateway|service unavailable/i.test(message)) return 'temporary';
  if (/(usage|rate|quota|limit).*(exceed|reached|hit)|limite.*(tokens?|uso)|rate.?limit/i.test(message)) return 'usage_limit';
  if (/(context|prompt).*(window|length|too large)|janela.*contexto|contexto.*(exced|grande)/i.test(message)) return 'context_limit';
  if (/(not logged|unauthori[sz]ed|authentication|auth|login|não está com login)/i.test(message)) return 'authentication';
  if (/(access denied|permission denied|permission|acesso negado|permissão)/i.test(message)) return 'permission';
  if (/(timeout|timed out|temporar|unavailable|disconnected|network|spawn|não encontrado)/i.test(message)) return 'temporary';
  if (message) return 'execution';
  return 'unknown';
}

export function canReadOnlyFailover(kind: AgentFailureKind, from: AgentId, to: AgentId): boolean {
  return from !== to && (kind === 'usage_limit' || kind === 'context_limit' || kind === 'authentication' || kind === 'temporary');
}

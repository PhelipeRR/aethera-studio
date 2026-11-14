import type { AgentStatus } from '@neuralbridge/shared/agents';

/** What the CLI itself reports about the chosen agent; nothing is assumed when the check has not answered yet. */
export function agentLine(status: AgentStatus | undefined): { tone: 'ok' | 'warning' | 'error' | 'unknown'; text: string; detail?: string } {
  if (!status) return { tone: 'unknown', text: 'Verificando o agente…' };
  // Short words here: the card already shows the blocking reason below, and the full detail is in Agentes.
  if (!status.installed) return { tone: 'error', text: `${status.label} não instalado` };
  if (status.authenticated === false) return { tone: 'error', text: `${status.label} sem login` };
  if (status.problems[0]) return { tone: 'error', text: `${status.label} com problema`, detail: status.problems[0] };
  const version = status.version ? ` ${status.version}` : '';
  if (status.warnings[0]) return { tone: 'warning', text: `${status.label}${version}: ${status.warnings[0]}` };
  return { tone: 'ok', text: `${status.label}${version} pronto` };
}

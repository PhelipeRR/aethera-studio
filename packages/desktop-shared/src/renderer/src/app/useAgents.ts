import { useCallback, useEffect, useState } from 'react';
import type { AgentStatus } from '@neuralbridge/shared/agents';

/** Agent CLI status from the main process (cached there for a minute; refresh() forces a new check). */
export function useAgents() {
  const [agents, setAgents] = useState<AgentStatus[] | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((refresh: boolean) => {
    window.neuralbridge.agents
      .status(refresh)
      .then(
        (next) => {
          setAgents(next);
          setError(null);
        },
        () => setError('Não foi possível verificar os agentes.'),
      )
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => load(false), [load]);

  const refresh = () => {
    setChecking(true);
    load(true);
  };

  return { agents, checking, error, refresh };
}

export type AgentHealth = 'ready' | 'attention' | 'blocked';

export function healthOf(agent: AgentStatus): AgentHealth {
  if (!agent.installed || agent.problems.length) return 'blocked';
  return agent.warnings.length ? 'attention' : 'ready';
}

export const HEALTH_LABEL: Record<AgentHealth, string> = {
  ready: 'Pronto',
  attention: 'Pronto, com avisos',
  blocked: 'Indisponível',
};

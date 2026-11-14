import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import type { AgentStatus } from '@neuralbridge/shared/agents';
import { cn } from '@/lib/utils';
import { HEALTH_LABEL, healthOf } from './useAgents';

const ICON = { ready: CircleCheck, attention: CircleAlert, blocked: CircleX } as const;
const TONE = { ready: 'text-primary', attention: 'text-warning', blocked: 'text-destructive' } as const;

function loginText(agent: AgentStatus): string {
  if (agent.authenticated === true) return agent.authMethod ? `Login feito (${agent.authMethod})` : 'Login feito';
  if (agent.authenticated === false) return 'Sem login';
  return 'Login não confirmado';
}

/** Claude Code and Codex at a glance; `detailed` adds path, features and every message. */
export function AgentList({ agents, detailed = false }: { agents: AgentStatus[]; detailed?: boolean }) {
  return (
    <ul className="divide-y rounded-lg border">
      {agents.map((agent) => {
        const health = healthOf(agent);
        const Icon = ICON[health];
        return (
          <li key={agent.id} aria-label={agent.label} className="px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <h3 className="flex items-center gap-2 font-medium">
                <span className={cn('size-2 rounded-full', agent.id === 'claude' ? 'bg-agent-claude' : 'bg-agent-codex')} aria-hidden="true" />
                {agent.label}
              </h3>
              <span className={cn('flex items-center gap-1.5 text-[13px]', TONE[health])}>
                <Icon className="size-4" aria-hidden="true" />
                {HEALTH_LABEL[health]}
              </span>
            </div>
            {agent.installed && (
              <p className="mt-1 text-muted-foreground">
                <span className="font-mono text-[13px] text-foreground">{agent.version ?? 'versão desconhecida'}</span>
                <span aria-hidden="true"> · </span>
                {loginText(agent)}
              </p>
            )}
            {[...agent.problems, ...agent.warnings].length > 0 && (
              <ul className="mt-2 space-y-1">
                {agent.problems.map((problem) => (
                  <li key={problem} className="text-destructive">
                    {problem}
                  </li>
                ))}
                {agent.warnings.map((warning) => (
                  <li key={warning} className="text-warning">
                    {warning}
                  </li>
                ))}
              </ul>
            )}
            {detailed && agent.installed && (
              <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-[13px]">
                <dt className="text-muted-foreground">Executável</dt>
                <dd className="font-mono break-all">{agent.path}</dd>
                <dt className="text-muted-foreground">Testado com</dt>
                <dd className="font-mono">{agent.testedVersion}</dd>
                <dt className="text-muted-foreground">Recursos</dt>
                <dd className="font-mono">{agent.features.join(', ') || 'nenhum detectado'}</dd>
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}

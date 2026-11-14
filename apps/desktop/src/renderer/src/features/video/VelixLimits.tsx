import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChartColumnIncreasing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import aiChip from '@/assets/aethera/ai-chip.webp';
import { agentLine } from './agent-line';

const LABELS: Record<string, string> = { five_hour: 'Sessão atual', seven_day: 'Esta semana' };
const AGENT_NAME = { claude: 'Claude', codex: 'Codex' } as const;
const WARN_PERCENT = 75;
const HIGH_PERCENT = 90;

const resetText = (iso: string | null) => (iso ? `Reinicia ${new Intl.DateTimeFormat('pt-BR', { weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))}` : '');
const toneOf = (percent: number) => (percent >= HIGH_PERCENT ? 'bg-destructive' : percent >= WARN_PERCENT ? 'bg-warning' : 'bg-primary');
const textOf = (percent: number) => (percent >= HIGH_PERCENT ? 'text-destructive' : 'text-muted-foreground');

const DOT = { ok: 'bg-success', warning: 'bg-warning', error: 'bg-destructive', unknown: 'bg-muted-foreground/60' } as const;

/** Query key of an agent's usage. The page reads Claude's under the same key, because some steps always use Claude. */
export const limitsKey = (agent: 'claude' | 'codex') => ['velix-limits', agent] as const;

/*
 * R5 — "Agente de produção", as in the reference screen: the agent of new productions, what it does, its real status
 * and the usage meters of that same agent (read from its CLI, never estimated), with the AI chip on the right.
 */
export function VelixLimits() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['velix-settings'], queryFn: () => window.neuralbridge.video.settings() });
  // Same query as the shell's system status, so both share one check.
  const agents = useQuery({ queryKey: ['shell-status', 'agents'], queryFn: () => window.neuralbridge.agents.status(false), staleTime: 60_000 });
  const agent = settings.data?.agent ?? 'claude';
  const name = AGENT_NAME[agent];
  const limits = useQuery({ queryKey: limitsKey(agent), queryFn: () => window.neuralbridge.video.limits(false, agent), staleTime: 60_000, enabled: settings.isSuccess });
  const saveAgent = async (next: 'claude' | 'codex') => { await window.neuralbridge.video.saveSettings(settings.data?.projectId ?? null, next); await settings.refetch(); };
  const refresh = async () => {
    const next = await window.neuralbridge.video.limits(true, agent);
    client.setQueryData(limitsKey(agent), next);
  };
  const data = limits.data;
  const windows = (data?.windows ?? []).filter((item) => item.id in LABELS);
  const line = agentLine(agents.data?.find((item) => item.id === agent));
  // When the agent cannot run, the reason below already says what the status line would.
  const showLine = !(line.tone === 'error' && data?.reason && !data.available);
  return (
    <section aria-labelledby="aethera-agent-title" className="aethera-agent sg-panel @container relative overflow-hidden rounded-2xl">
      <img src={aiChip} alt="" aria-hidden="true" className="aethera-agent__chip pointer-events-none absolute -right-3 top-1/2 hidden h-40 w-auto -translate-y-1/2 @sm:block @lg:h-44" />
      <div className="relative space-y-3 p-5 @sm:max-w-[62%] @lg:max-w-[19rem]">
        <h2 id="aethera-agent-title" className="flex items-center gap-2.5 text-[15px] font-medium"><Bot className="size-5 text-primary" strokeWidth={1.6} aria-hidden="true" />Agente de produção</h2>
        <select aria-label="Agente das novas produções" aria-describedby="aethera-agent-policy" className="w-full rounded-lg border border-[var(--glass-border-strong)] bg-background/70 px-3 py-2.5 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={agent} onChange={(event) => void saveAgent(event.target.value as 'claude' | 'codex')}>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
        <p className="text-xs leading-relaxed text-muted-foreground">Responsável por pesquisa, roteiro e orquestração da produção.</p>
        <p id="aethera-agent-policy" className="sr-only">A escolha fica salva globalmente e é registrada quando uma nova produção começa. Produções existentes mantêm o agente original; falhas não trocam de agente automaticamente.</p>
        {showLine && <p title={line.detail} className="flex items-center gap-2 text-xs text-muted-foreground"><span className={cn('size-1.5 shrink-0 rounded-full', DOT[line.tone])} aria-hidden="true" />{line.text}</p>}
        <section aria-label={`Limite do ${name}`} className="space-y-2.5">
          {windows.map((item) => (
            <div key={item.id}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium">{LABELS[item.id]}</span>
                <span className={cn('whitespace-nowrap', textOf(item.percent))}>{item.percent}% usado</span>
              </div>
              <div role="progressbar" aria-label={LABELS[item.id]} aria-valuenow={item.percent} aria-valuemin={0} aria-valuemax={100} className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${toneOf(item.percent)}`} style={{ width: `${Math.min(item.percent, 100)}%` }} />
              </div>
              {item.resetsAt && <p className="mt-1 text-[11px] text-muted-foreground">{resetText(item.resetsAt)}</p>}
            </div>
          ))}
          {data && windows.length === 0 && !data.blocked && <p className="text-xs text-muted-foreground">O {name} não informou o uso agora.</p>}
          {!data && <p className="text-xs text-muted-foreground">Verificando o limite do {name}…</p>}
          {data?.reason && <p role="alert" className="text-xs text-destructive">{data.reason}</p>}
        </section>
        <Button variant="outline" size="sm" className="h-9 rounded-lg border-[var(--glass-border-strong)]" onClick={() => void refresh()} disabled={limits.isFetching}><ChartColumnIncreasing className="size-4 text-primary" aria-hidden="true" />Atualizar limite</Button>
      </div>
    </section>
  );
}

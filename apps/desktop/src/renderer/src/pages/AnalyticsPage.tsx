import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { TokenAlert, TokenBreakdown, TokenReport } from '@neuralbridge/shared/tasks';
import { Button } from '@/components/ui/button';
import { errorMessage, formatWhen } from '@/features/brain/format';
import { cn } from '@/lib/utils';

// Phase 22: token diagnostics. Every number is what Claude Code or Codex reported, except the context
// estimate, which is labelled as NeuralBridge's own; alerts are fixed rules over those numbers.

type Period = '24h' | '7d' | '30d' | 'all';
const PERIODS: { value: Period; label: string }[] = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'all', label: 'Tudo' },
];
const fmt = (value: number) => value.toLocaleString('pt-BR');
const SEVERITY = {
  critical: { icon: OctagonAlert, tone: 'text-destructive', label: 'Crítico' },
  warning: { icon: TriangleAlert, tone: 'text-warning', label: 'Atenção' },
  info: { icon: Info, tone: 'text-muted-foreground', label: 'Informação' },
} as const;

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <article className="sg-panel rounded-xl p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </article>
  );
}

function Breakdown({ title, rows }: { title: string; rows: TokenBreakdown[] }) {
  const top = Math.max(1, ...rows.map((row) => row.input + row.output));
  return (
    <section aria-label={title} className="sg-panel rounded-xl p-5">
      <h2 className="font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Sem dados informados no período.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="mb-1 flex justify-between gap-3 text-sm">
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {fmt(row.input + row.output)} · {row.steps === 1 ? '1 etapa' : `${row.steps} etapas`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, ((row.input + row.output) / top) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Alerts({ alerts }: { alerts: TokenAlert[] }) {
  return (
    <section aria-label="Alertas" className="sg-panel rounded-xl p-5">
      <h2 className="font-medium">Alertas e recomendações</h2>
      {alerts.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum alerta no período: orçamento, contexto, repetição e cache dentro dos limites.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {alerts.map((alert) => {
            const { icon: Icon, tone, label } = SEVERITY[alert.severity];
            return (
              <li key={`${alert.kind}:${alert.message}`} data-testid={`alert-${alert.kind}`} className="flex gap-3 text-sm">
                <Icon className={cn('mt-0.5 size-4 shrink-0', tone)} aria-label={label} />
                <div className="min-w-0">
                  <p>{alert.message}</p>
                  <p className="mt-0.5 text-muted-foreground">{alert.recommendation}</p>
                  {alert.taskIds.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-2 text-xs">
                      {alert.taskIds.slice(0, 5).map((id, index) => (
                        <Link key={id} to={`/runs/${id}`} className="text-primary hover:underline">
                          Execução {index + 1}
                        </Link>
                      ))}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function BudgetForm() {
  const client = useQueryClient();
  const budget = useQuery({ queryKey: ['analytics', 'budget'], queryFn: () => window.neuralbridge.analytics.budget() });
  const [draft, setDraft] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (tokens: number) => window.neuralbridge.analytics.saveBudget(tokens),
    onSuccess: (tokens) => {
      client.setQueryData(['analytics', 'budget'], tokens);
      setDraft(null);
    },
  });
  const value = draft ?? (budget.data !== undefined ? String(budget.data) : '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(Number(value));
  };
  return (
    <form onSubmit={submit} aria-label="Orçamento por tarefa" className="sg-panel rounded-xl p-5">
      <h2 className="font-medium">Orçamento por tarefa</h2>
      <p className="mt-1 text-sm text-muted-foreground">A tarefa para antes da próxima etapa quando os tokens informados passam deste valor. Vale para as próximas tarefas.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="token-budget" className="sr-only">
          Tokens por tarefa
        </label>
        <input
          id="token-budget"
          type="number"
          min={10_000}
          max={50_000_000}
          step={10_000}
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          className="h-9 w-40 rounded-md border border-input bg-background px-3 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <span className="text-sm text-muted-foreground">tokens</span>
        <Button type="submit" size="sm" disabled={save.isPending || draft === null}>
          Salvar orçamento
        </Button>
        {save.isSuccess && draft === null && (
          <span role="status" className="text-sm text-primary">
            Orçamento salvo.
          </span>
        )}
      </div>
      {save.error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {errorMessage(save.error)}
        </p>
      )}
    </form>
  );
}

function Report({ report }: { report: TokenReport }) {
  const { totals } = report;
  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Informado pelos agentes" value={fmt(totals.input + totals.output)} note={`${fmt(totals.input)} de entrada · ${fmt(totals.output)} de saída`} />
        <Stat label="Cache" value={report.cacheRate === null ? 'Indisponível' : `${Math.round(report.cacheRate * 100)}%`} note={`${fmt(totals.cached)} tokens de entrada vieram do cache`} />
        <Stat label="Contexto adicionado (estimativa)" value={fmt(totals.estimatedContext)} note="Calculado pelo Singularity, não pelo provedor" />
        <Stat label="Tarefas com métrica" value={`${totals.tasksWithData} de ${totals.tasks}`} note={totals.tasksWithoutData ? `${totals.tasksWithoutData} sem uso informado` : 'Todas informaram o uso'} />
      </section>
      <Alerts alerts={report.alerts} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Breakdown title="Por agente" rows={report.byAgent} />
        <Breakdown title="Por etapa" rows={report.byStep} />
        <Breakdown title="Por projeto" rows={report.byProject} />
      </div>
      <p className="text-xs text-muted-foreground">Gerado {formatWhen(report.generatedAt)}. Preços não são calculados: o Singularity só mostra o que os agentes informam.</p>
    </>
  );
}

export function AnalyticsPage({ description }: { description: string }) {
  const [period, setPeriod] = useState<Period>('7d');
  const report = useQuery({ queryKey: ['analytics', 'tokens', period], queryFn: () => window.neuralbridge.analytics.tokens(period) });
  const empty = report.data && report.data.totals.tasksWithData === 0;
  return (
    <>
      <div className="border-b px-8 py-7">
        <h1 className="text-[26px] leading-tight font-light tracking-[0.005em] text-foreground">Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <main className="space-y-6 px-8 py-7">
        <div data-tour="analytics-period" role="group" aria-label="Período" className="inline-flex rounded-lg border p-0.5">
          {PERIODS.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={period === item.value}
              onClick={() => setPeriod(item.value)}
              className={cn('rounded-md px-3 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', period === item.value ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground')}
            >
              {item.label}
            </button>
          ))}
        </div>
        {report.isPending ? (
          <p className="text-muted-foreground">Carregando métricas reais…</p>
        ) : report.error ? (
          <p role="alert" className="text-destructive">
            Não foi possível carregar as métricas: {errorMessage(report.error)}
          </p>
        ) : empty ? (
          <section className="flex min-h-56 flex-col items-center justify-center text-center">
            <CircleAlert className="mb-4 size-8 text-muted-foreground" aria-hidden="true" />
            <h2 className="font-medium">Ainda não há tokens reportados</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">As métricas aparecem quando Claude Code ou Codex CLI informam o uso de tokens durante uma execução. Nada é estimado no lugar delas.</p>
          </section>
        ) : (
          report.data && <Report report={report.data} />
        )}
        <div data-tour="analytics-budget"><BudgetForm /></div>
      </main>
    </>
  );
}

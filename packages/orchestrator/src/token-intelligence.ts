import type { DatabaseHandle } from '@neuralbridge/database';
import type { TokenAlert, TokenBreakdown, TokenReport } from '@neuralbridge/shared';

// Phase 22: token diagnostics from what the engine already records — provider-reported usage per step
// (token_analytics, source provider-result), NeuralBridge's own context estimates (neuralbridge-context),
// and the task events (token_budget, context, review_rejected). Nothing is guessed: a task without
// reported usage is counted as such, and every alert is a rule over these numbers.

const AGENT_LABEL: Record<string, string> = { claude: 'Claude Code', codex: 'Codex CLI' };
const STEP_LABEL: Record<string, string> = { plan: 'Planejamento/análise', implement: 'Implementação', review: 'Revisão', fix: 'Correção', validate: 'Validação' };
const THRESHOLD = { budget: 0.8, context: 0.8, repeated: 3, reviewRejections: 2, cacheInput: 500_000, cacheRate: 0.1 };
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

const RECOMMENDATION: Record<TokenAlert['kind'], string> = {
  budget: 'Divida o pedido em etapas menores ou aumente o orçamento por tarefa em Analytics, se o custo for esperado.',
  context: 'Comece uma conversa nova ou peça só a parte necessária: a janela cheia faz o agente esquecer o início e repetir trabalho.',
  repeated: 'Continue a conversa existente (o agente retoma a sessão e o cache) em vez de repetir o pedido; se falhou, ajuste o pedido com o erro.',
  review_loop: 'Deixe os critérios de aceite explícitos no pedido: revisões reprovadas seguidas refazem a implementação inteira.',
  cache: 'Reaproveite conversas em vez de abrir novas para o mesmo assunto: o provedor só usa cache dentro da mesma sessão.',
  missing: 'Nada a fazer no app: o agente não informou o uso nessas execuções (falha antes do fim ou versão do CLI sem métricas).',
};

const fmt = (value: number) => value.toLocaleString('pt-BR');
const percent = (part: number, whole: number) => Math.round((part / whole) * 100);
const quote = (prompt: string) => `“${prompt.trim().replace(/\s+/g, ' ').slice(0, 60)}”`;
const normalise = (prompt: string) => prompt.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

interface UsageRow {
  taskId: string;
  agent: string | null;
  kind: string | null;
  projectId: string | null;
  projectName: string | null;
  input: number | null;
  output: number | null;
  cached: number | null;
}

function breakdown(rows: UsageRow[], keyOf: (row: UsageRow) => string, labelOf: (key: string, row: UsageRow) => string): TokenBreakdown[] {
  const groups = new Map<string, TokenBreakdown>();
  for (const row of rows) {
    const key = keyOf(row);
    const entry = groups.get(key) ?? { key, label: labelOf(key, row), input: 0, output: 0, cached: 0, steps: 0 };
    entry.input += row.input ?? 0;
    entry.output += row.output ?? 0;
    entry.cached += row.cached ?? 0;
    entry.steps += 1;
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => b.input + b.output - (a.input + a.output) || a.key.localeCompare(b.key));
}

export function tokenReport(handle: DatabaseHandle, options: { since: string; now: Date }): TokenReport {
  const db = handle.sqlite;
  const periodTasks = db.prepare('SELECT id, prompt, status FROM tasks WHERE created_at >= ? ORDER BY created_at, id').all(options.since) as { id: string; prompt: string; status: string }[];
  const usage = (
    db
      .prepare(
        `SELECT a.task_id AS taskId, a.agent AS agent, s.kind AS kind, t.project_id AS projectId, p.name AS projectName,
                a.reported_input_tokens AS input, a.reported_output_tokens AS output, a.cached_tokens AS cached
           FROM token_analytics a JOIN tasks t ON t.id = a.task_id
           LEFT JOIN task_steps s ON s.id = a.step_id LEFT JOIN projects p ON p.id = t.project_id
          WHERE a.source = 'provider-result' AND t.created_at >= ?`,
      )
      .all(options.since) as UsageRow[]
  ).filter((row) => row.input !== null || row.output !== null);
  const estimated = (db.prepare("SELECT COALESCE(SUM(a.estimated_context_tokens), 0) AS total FROM token_analytics a JOIN tasks t ON t.id = a.task_id WHERE a.source = 'neuralbridge-context' AND t.created_at >= ?").get(options.since) as { total: number }).total;
  const events = db
    .prepare("SELECT e.task_id AS taskId, e.kind AS kind, e.data AS data FROM task_events e JOIN tasks t ON t.id = e.task_id WHERE t.created_at >= ? AND e.kind IN ('token_budget', 'context', 'review_rejected') ORDER BY e.id")
    .all(options.since) as { taskId: string; kind: string; data: string }[];

  const input = usage.reduce((sum, row) => sum + (row.input ?? 0), 0);
  const output = usage.reduce((sum, row) => sum + (row.output ?? 0), 0);
  const cached = usage.reduce((sum, row) => sum + (row.cached ?? 0), 0);
  const withData = new Set(usage.map((row) => row.taskId));
  const prompts = new Map(periodTasks.map((task) => [task.id, task.prompt]));
  const byAgent = breakdown(usage, (row) => row.agent ?? 'desconhecido', (key) => AGENT_LABEL[key] ?? key);

  const alerts: TokenAlert[] = [];
  const parse = (data: string): Record<string, unknown> => {
    try {
      return JSON.parse(data) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const used = (taskId: string) => usage.filter((row) => row.taskId === taskId).reduce((sum, row) => sum + (row.input ?? 0) + (row.output ?? 0), 0);

  for (const event of events.filter((item) => item.kind === 'token_budget')) {
    const budget = Number(parse(event.data)['configured']);
    const spent = used(event.taskId);
    if (budget > 0 && spent / budget >= THRESHOLD.budget) {
      alerts.push({ kind: 'budget', severity: spent >= budget ? 'critical' : 'warning', message: `${quote(prompts.get(event.taskId) ?? '')} usou ${percent(spent, budget)}% do orçamento (${fmt(spent)} de ${fmt(budget)} tokens).`, recommendation: RECOMMENDATION.budget, taskIds: [event.taskId] });
    }
  }
  const fullest = new Map<string, { used: number; window: number }>();
  for (const event of events.filter((item) => item.kind === 'context')) {
    const data = parse(event.data);
    const usedTokens = Number(data['usedTokens']);
    const window = Number(data['windowTokens']);
    if (!(window > 0) || !(usedTokens >= 0)) continue;
    const current = fullest.get(event.taskId);
    if (!current || usedTokens / window > current.used / current.window) fullest.set(event.taskId, { used: usedTokens, window });
  }
  for (const [taskId, context] of fullest) {
    if (context.used / context.window >= THRESHOLD.context) {
      alerts.push({ kind: 'context', severity: 'warning', message: `${quote(prompts.get(taskId) ?? '')} ocupou ${percent(context.used, context.window)}% da janela de contexto (${fmt(context.used)} de ${fmt(context.window)}).`, recommendation: RECOMMENDATION.context, taskIds: [taskId] });
    }
  }
  const rejections = new Map<string, number>();
  for (const event of events.filter((item) => item.kind === 'review_rejected')) rejections.set(event.taskId, (rejections.get(event.taskId) ?? 0) + 1);
  for (const [taskId, count] of rejections) {
    if (count >= THRESHOLD.reviewRejections) alerts.push({ kind: 'review_loop', severity: 'warning', message: `${quote(prompts.get(taskId) ?? '')} teve ${count} revisões reprovadas seguidas.`, recommendation: RECOMMENDATION.review_loop, taskIds: [taskId] });
  }
  const sameRequest = new Map<string, typeof periodTasks>();
  for (const task of periodTasks) sameRequest.set(normalise(task.prompt), [...(sameRequest.get(normalise(task.prompt)) ?? []), task]);
  for (const group of sameRequest.values()) {
    if (group.length < THRESHOLD.repeated) continue;
    const failed = group.filter((task) => task.status === 'failed').length;
    alerts.push({ kind: 'repeated', severity: 'info', message: `${quote(group[0]?.prompt ?? '')} foi pedido ${group.length} vezes no período${failed ? ` (${failed} falharam)` : ''}.`, recommendation: RECOMMENDATION.repeated, taskIds: group.map((task) => task.id) });
  }
  for (const agent of byAgent) {
    if (agent.input >= THRESHOLD.cacheInput && agent.cached / agent.input < THRESHOLD.cacheRate) {
      alerts.push({ kind: 'cache', severity: 'info', message: `${agent.label}: só ${percent(agent.cached, agent.input)}% dos ${fmt(agent.input)} tokens de entrada vieram do cache.`, recommendation: RECOMMENDATION.cache, taskIds: [] });
    }
  }
  const withoutData = periodTasks.filter((task) => task.status === 'completed' && !withData.has(task.id));
  if (withoutData.length) {
    alerts.push({ kind: 'missing', severity: 'info', message: `${withoutData.length === 1 ? '1 tarefa concluída' : `${withoutData.length} tarefas concluídas`} sem uso de tokens informado pelo agente: ficam fora dos totais.`, recommendation: RECOMMENDATION.missing, taskIds: withoutData.map((task) => task.id) });
  }
  alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.kind.localeCompare(b.kind) || a.message.localeCompare(b.message));

  return {
    since: options.since,
    generatedAt: options.now.toISOString(),
    totals: { input, output, cached, estimatedContext: estimated, tasks: periodTasks.length, tasksWithData: withData.size, tasksWithoutData: periodTasks.length - withData.size },
    cacheRate: input > 0 ? cached / input : null,
    byAgent,
    byStep: breakdown(usage, (row) => row.kind ?? 'outro', (key) => STEP_LABEL[key] ?? key),
    byProject: breakdown(usage, (row) => row.projectId ?? '', (key, row) => (key ? (row.projectName ?? key) : 'Sem projeto')),
    alerts,
  };
}

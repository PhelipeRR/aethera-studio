import { useState } from 'react';
import { CircleCheck, CircleX, FileDiff, LoaderCircle, OctagonX, ShieldAlert, Wrench } from 'lucide-react';
import { Link } from 'react-router';
import type { AgentId } from '@neuralbridge/shared/domain';
import { FINAL_TASK_STATUSES, type GuardianReport, type TaskDetail, type TaskEvent, type TaskStep } from '@neuralbridge/shared/tasks';
import { DiffView } from '@/components/DiffView';
import { Button } from '@/components/ui/button';
import { MarkdownView } from '@/features/brain/MarkdownView';
import { errorMessage } from '@/features/brain/format';
import { cn } from '@/lib/utils';
import { useApproveTask, useCancelTask, useHealTask } from './api';
import { TaskImages } from './ChatImages';
import { AGENT_LABEL, formatCost, formatDuration, formatTokens, STATUS_LABEL, stepLabel } from './labels';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const field = (value: unknown, key: string): unknown => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined);

export function AgentDot({ agent }: { agent: AgentId }) {
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', agent === 'claude' ? 'bg-agent-claude' : 'bg-agent-codex')} aria-hidden="true" />;
}

export function StatusBadge({ status, live = false }: { status: TaskDetail['status']; live?: boolean }) {
  const final = FINAL_TASK_STATUSES.includes(status);
  return (
    <span
      {...(live ? { role: 'status', 'aria-label': `Situação: ${STATUS_LABEL[status]}` } : {})}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap',
        status === 'completed' && 'border-primary/40 text-primary',
        status === 'failed' && 'border-destructive/40 text-destructive',
        status === 'awaiting_approval' && 'border-warning/50 text-warning',
        (status === 'cancelled' || status === 'pending') && 'text-muted-foreground',
      )}
    >
      {!final && status !== 'awaiting_approval' && <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Codex reports absolute paths: show them as the project-relative path the step recorded. */
function shortPath(path: string, files: string[]): string {
  const normalised = path.replaceAll('\\', '/');
  return files.find((file) => normalised.endsWith(`/${file}`)) ?? path;
}

/** Event kinds the step timeline shows; the rest (skills, context, capabilities) belong to the chat's side panel. */
const ACTIVITY_KINDS = new Set(['text', 'tool', 'file_change', 'permission_denied', 'error']);

/** What an agent did during one step, in the order it happened. */
function Activity({ events: all, files }: { events: TaskEvent[]; files: string[] }) {
  const events = all.filter((event) => ACTIVITY_KINDS.has(event.kind));
  if (!events.length) return null;
  return (
    <ol className="mt-2 space-y-2">
      {events.map((event) => {
        switch (event.kind) {
          case 'text':
            return (
              <li key={event.id} className="rounded-md bg-background px-3 py-2">
                <MarkdownView content={str(event.data['text'])} links={[]} />
              </li>
            );
          case 'tool':
            return (
              <li key={event.id} className="flex items-baseline gap-2 text-[13px] text-muted-foreground">
                <Wrench className="size-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
                <span className="font-mono text-[12.5px] break-all">
                  {str(event.data['name'])}
                  {str(event.data['summary']) && <span className="text-muted-foreground/80"> {str(event.data['summary'])}</span>}
                </span>
              </li>
            );
          case 'file_change':
            return (
              <li key={event.id} className="flex items-baseline gap-2 text-[13px]">
                <FileDiff className="size-3.5 shrink-0 translate-y-0.5 text-primary" aria-hidden="true" />
                <span className="font-mono text-[12.5px] break-all">{shortPath(str(event.data['path']), files)}</span>
                <span className="text-muted-foreground">{str(event.data['change'])}</span>
              </li>
            );
          case 'permission_denied':
            return (
              <li key={event.id} className="text-[13px] text-warning">
                Permissão negada para {str(event.data['tool'])}: {str(event.data['message'])}
              </li>
            );
          case 'error':
            return (
              <li key={event.id} className="text-[13px] text-destructive">
                {str(event.data['message'])}
              </li>
            );
          default:
            return null;
        }
      })}
    </ol>
  );
}

function StepBlock({ step, events, collaborative }: { step: TaskStep; events: TaskEvent[]; collaborative: boolean }) {
  const tokens = formatTokens(step.tokens);
  return (
    <li className="border-l-2 pl-4" style={{ borderColor: `var(--agent-${step.agent})` }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          <AgentDot agent={step.agent} />
          {AGENT_LABEL[step.agent]} · {stepLabel(step.kind, collaborative)}
        </span>
        <StatusBadge status={step.status} />
        {tokens && <span className="text-xs text-muted-foreground">{tokens}</span>}
      </div>
      {step.error && <p className="mt-1 text-[13px] text-destructive">{step.error}</p>}
      <Activity events={events} files={step.filesChanged} />
    </li>
  );
}

function PlanView({ plan }: { plan: unknown }) {
  const steps = list(field(plan, 'steps'));
  const acceptance = list(field(plan, 'acceptance'));
  return (
    <section aria-label="Plano" className="rounded-md border bg-background px-4 py-3 text-[13.5px]">
      <p className="font-medium">Plano: {str(field(plan, 'summary'))}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {steps.map((step, i) => (
          <li key={i}>
            <span className="font-medium">{str(field(step, 'title'))}</span>
            <span className="text-muted-foreground"> — {str(field(step, 'instructions'))}</span>
          </li>
        ))}
      </ol>
      {acceptance.length > 0 && (
        <>
          <p className="mt-2 text-muted-foreground">Critérios de aceite</p>
          <ul className="list-disc pl-5">
            {acceptance.map((item, i) => (
              <li key={i}>{str(item)}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ApprovalBox({ task, reasons }: { task: TaskDetail; reasons: string[] }) {
  const approve = useApproveTask();
  const cancel = useCancelTask();
  const failure = approve.error ?? cancel.error;
  return (
    <section role="alert" aria-label="Aprovação necessária" className="rounded-md border border-warning/50 bg-warning/5 px-4 py-3">
      <p className="flex items-center gap-2 font-medium text-warning">
        <ShieldAlert className="size-4" aria-hidden="true" />
        Este pedido pode apagar dados ou histórico. Nada foi executado ainda.
      </p>
      <ul className="mt-1 list-disc pl-6 text-[13.5px]">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => approve.mutate(task.id)} disabled={approve.isPending || cancel.isPending}>
          Aprovar e executar
        </Button>
        <Button size="sm" variant="outline" onClick={() => cancel.mutate(task.id)} disabled={approve.isPending || cancel.isPending}>
          Não executar
        </Button>
      </div>
      {failure && <p className="mt-2 text-[13px] text-destructive">{errorMessage(failure)}</p>}
    </section>
  );
}

const GUARDIAN_SEVERITY = { high: { label: 'Alto', tone: 'text-destructive' }, medium: { label: 'Médio', tone: 'text-warning' }, low: { label: 'Baixo', tone: 'text-muted-foreground' } } as const;

/** Phase 28: the security review of what the task changed; a high risk waits for the user's decision. */
const AGENT_NAME: Record<string, string> = { claude: 'Claude Code', codex: 'Codex CLI', 'claude-gateway': 'Claude Gateway' };
const CAPACITY_LABEL: Record<string, string> = { RATE_LIMITED: 'limite temporário', QUOTA_EXHAUSTED: 'limite de uso esgotado', AUTH_REQUIRED: 'precisa de login', UNAVAILABLE: 'indisponível', UNKNOWN: 'estado desconhecido' };

/** A task parked until an agent has capacity. Shows a recovery time only when the provider gave one. */
function CapacityBox({ task, data }: { task: TaskDetail; data: Record<string, unknown> }) {
  const [auto, setAuto] = useState(true);
  const retryAt = str(data['retryAt']);
  const agents = list(data['agents']) as { agent?: string; state?: string }[];
  return (
    <section aria-label="Aguardando capacidade" className="space-y-2 rounded-lg border border-warning/50 p-3 text-[13px]">
      <p className="font-medium">Aguardando capacidade dos agentes</p>
      <ul className="text-muted-foreground">{agents.map((item) => <li key={item.agent}>{AGENT_NAME[item.agent ?? ''] ?? item.agent}: {CAPACITY_LABEL[item.state ?? ''] ?? item.state}</li>)}</ul>
      <p className="text-muted-foreground">{retryAt ? `Previsão informada pelo provedor: ${new Date(retryAt).toLocaleString()}.` : 'O provedor não informou quando volta.'} O trabalho feito até aqui foi preservado.</p>
      <label className="flex items-center gap-2"><input type="checkbox" checked={auto} onChange={(event) => { setAuto(event.target.checked); void window.neuralbridge.tasks.setCapacityAutoResume(task.id, event.target.checked); }} /> Retomar automaticamente</label>
      <Button size="sm" variant="outline" onClick={() => void window.neuralbridge.tasks.retryCapacity(task.id)}>Tentar novamente</Button>
    </section>
  );
}

function GuardianReview({ task, report, pending }: { task: TaskDetail; report: GuardianReport; pending: boolean }) {
  const approve = useApproveTask();
  const cancel = useCancelTask();
  const failure = approve.error ?? cancel.error;
  if (report.risk === 'none') {
    return <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground"><ShieldAlert className="size-3.5" aria-hidden="true" /> {report.files === 0 ? 'Revisão de segurança: nenhuma alteração para revisar.' : `Revisão de segurança: nada encontrado em ${report.files === 1 ? '1 arquivo' : `${report.files} arquivos`}.`}</p>;
  }
  return (
    <section role={pending ? 'alert' : undefined} aria-label="Revisão de segurança" className={cn('rounded-md border px-4 py-3 text-[13.5px]', pending ? 'border-destructive/50 bg-destructive/5' : 'border-border')}>
      <p className={cn('flex items-center gap-2 font-medium', pending ? 'text-destructive' : '')}>
        <ShieldAlert className="size-4" aria-hidden="true" />
        {pending ? 'Revisão de segurança: risco alto. As alterações já estão nos arquivos; decida se ficam.' : 'Revisão de segurança'}
      </p>
      <ul className="mt-2 space-y-1">
        {report.findings.map((finding, index) => (
          <li key={`${finding.rule}-${index}`} data-testid={`guardian-${finding.rule}`} className="flex gap-2">
            <span className={cn('shrink-0 text-xs font-medium', GUARDIAN_SEVERITY[finding.severity].tone)}>{GUARDIAN_SEVERITY[finding.severity].label}</span>
            <span>
              {finding.message} <span className="font-mono text-[12px] text-muted-foreground">{finding.evidence}</span>
            </span>
          </li>
        ))}
      </ul>
      {pending && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => approve.mutate(task.id)} disabled={approve.isPending || cancel.isPending}>
            Aceitar alterações
          </Button>
          <Button size="sm" variant="outline" onClick={() => cancel.mutate(task.id)} disabled={approve.isPending || cancel.isPending}>
            Rejeitar
          </Button>
        </div>
      )}
      {failure && <p className="mt-2 text-[13px] text-destructive">{errorMessage(failure)}</p>}
    </section>
  );
}

/** Phase 26: the automatic fix — diagnosis with its evidence, the user's decision, validation attempts. */
function HealView({ task, events }: { task: TaskDetail; events: TaskEvent[] }) {
  const approve = useApproveTask();
  const cancel = useCancelTask();
  const proposal = events.find((event) => event.kind === 'heal_proposal')?.data;
  const decided = events.some((event) => event.kind === 'approved');
  const validations = events.filter((event) => event.kind === 'heal_validation');
  const rollback = events.find((event) => event.kind === 'heal_rollback');
  if (!proposal) return null;
  const pending = task.status === 'awaiting_approval' && !decided;
  return (
    <section role={pending ? 'alert' : undefined} aria-label="Correção automática" className={cn('space-y-2 rounded-md border px-4 py-3 text-[13.5px]', pending && 'border-warning/50 bg-warning/5')}>
      <p className="font-medium">Diagnóstico</p>
      <p>{str(proposal['diagnosis'])}</p>
      <p className="text-muted-foreground">Evidências:</p>
      <ul className="list-disc pl-6 text-muted-foreground">
        {list(proposal['evidence']).map((item) => (
          <li key={str(item)}>{str(item)}</li>
        ))}
      </ul>
      <p>
        <span className="font-medium">Correção proposta:</span> {str(proposal['plan'])}
      </p>
      <p className="text-muted-foreground">
        Validação: <span className="font-mono">{str(proposal['validation'])}</span>, executada pelo Singularity. Se não passar, os arquivos alterados voltam ao estado de antes.
      </p>
      {pending && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" onClick={() => approve.mutate(task.id)} disabled={approve.isPending || cancel.isPending}>
            Aplicar correção
          </Button>
          <Button size="sm" variant="outline" onClick={() => cancel.mutate(task.id)} disabled={approve.isPending || cancel.isPending}>
            Não aplicar
          </Button>
        </div>
      )}
      {validations.length > 0 && (
        <ol aria-label="Tentativas de validação" className="space-y-1">
          {validations.map((event) => (
            <li key={event.id} data-testid="heal-attempt">
              Tentativa {String(event.data['attempt'])}: {event.data['ok'] ? <span className="text-primary">passou</span> : <span className="text-destructive">não passou{event.data['timedOut'] ? ' (tempo esgotado)' : ''}</span>}
              {!event.data['ok'] && str(event.data['output']) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Saída</summary>
                  <pre className="max-h-40 overflow-auto rounded border bg-background px-2 py-1 font-mono text-[11.5px] whitespace-pre-wrap">{str(event.data['output'])}</pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
      {rollback && <p className="text-warning">Arquivos restaurados ao estado de antes da correção: {list(rollback.data['files']).map(str).join(', ') || 'nenhum'}.</p>}
    </section>
  );
}

function HealButton({ task }: { task: TaskDetail }) {
  const heal = useHealTask();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={heal.isPending || heal.isSuccess} onClick={() => heal.mutate(task.id)}>
        Diagnosticar e corrigir
      </Button>
      <span className="text-xs text-muted-foreground">Um agente analisa a falha com as evidências registradas e propõe uma correção; nada muda sem sua aprovação.</span>
      {heal.error && <p className="w-full text-[13px] text-destructive">{errorMessage(heal.error)}</p>}
    </div>
  );
}

/** One task: the request, why it went where it went, live progress per step, and the outcome. */
/** variant chat: the agent side flows in the conversation column without card chrome. */
export function TaskCard({ task, showPrompt = true, variant = 'card' }: { task: TaskDetail; showPrompt?: boolean; variant?: 'card' | 'chat' }) {
  const cancel = useCancelTask();
  const final = FINAL_TASK_STATUSES.includes(task.status);
  const of = (kind: string) => task.events.filter((event) => event.kind === kind);
  const routed = of('routed').at(-1);
  const collaborative = field(routed?.data, 'mode') === 'collab';
  const approval = of('approval_required').at(-1);
  const guardianEvent = of('guardian').at(-1);
  const waiting = of('waiting_capacity').at(-1);
  const guardian = guardianEvent ? (guardianEvent.data as unknown as GuardianReport) : null;
  const guardianPending = task.status === 'awaiting_approval' && guardian?.risk === 'high' && of('guardian_accepted').length === 0;
  const plan = of('plan').at(-1);
  const rejections = of('review_rejected');
  const diff = of('diff').at(-1);
  const files = [...new Set(task.steps.flatMap((step) => step.filesChanged))];
  const lastText = [...task.events].reverse().find((event) => event.kind === 'text');
  const showSummary = task.summary && task.status === 'completed' && str(lastText?.data['text']).trim() !== task.summary.trim() && !collaborative;
  const tokens = formatTokens(task.tokens);
  const cost = formatCost(task.tokens.costUsd);
  const duration = formatDuration(task.startedAt, task.finishedAt);

  return (
    <article aria-label={`Tarefa: ${task.prompt.slice(0, 80)}`} className="space-y-3">
      {showPrompt && (
        <div className="ml-auto w-fit max-w-[min(72ch,85%)] space-y-2">
          <TaskImages taskId={task.id} images={task.images} />
          <div className="ml-auto w-fit max-w-[min(72ch,85%)] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 break-words">
            <MarkdownView content={task.prompt} links={[]} />
          </div>
        </div>
      )}

      <div className={cn('space-y-3', variant === 'card' ? 'sg-panel rounded-lg px-5 py-4' : 'border-l-2 border-border/60 pl-5')}>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={task.status} live />
          {task.projectName ? <span className="text-[13px] text-muted-foreground">em {task.projectName}</span> : <span className="text-[13px] text-muted-foreground">sem projeto</span>}
          {!final && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => cancel.mutate(task.id)} disabled={cancel.isPending}>
              <OctagonX className="size-3.5" aria-hidden="true" />
              Cancelar
            </Button>
          )}
        </div>

        {routed && (
          <div className="text-[13px] text-muted-foreground">
            <p>
              Roteado para <span className="font-medium text-foreground">{collaborative ? 'Claude + Codex' : AGENT_LABEL[field(routed.data, 'mode') as AgentId]}</span>
              {field(routed.data, 'edit') ? ', com permissão para alterar arquivos do projeto.' : ', somente leitura.'}
            </p>
            <ul className="list-disc pl-5">
              {list(field(routed.data, 'reasons')).map((reason, i) => (
                <li key={i}>{str(reason)}</li>
              ))}
            </ul>
          </div>
        )}

        {task.status === 'awaiting_approval' && approval && !guardianPending && <ApprovalBox task={task} reasons={list(approval.data['reasons']).map(str)} />}
        <HealView task={task} events={task.events} />
        {of('agent_failover').map((event) => <p key={event.id} className="text-[13px] text-muted-foreground">Trocou de {AGENT_NAME[str(event.data['from'])] ?? str(event.data['from'])} para {AGENT_NAME[str(event.data['to'])] ?? str(event.data['to'])} e continuou de onde parou.</p>)}
        {task.status === 'paused' && waiting && <CapacityBox task={task} data={waiting.data} />}
        {guardian && <GuardianReview task={task} report={guardian} pending={guardianPending} />}
        {task.status === 'failed' && task.projectId && <HealButton task={task} />}
        {of('queued').length > 0 && task.status === 'pending' && <p className="text-[13px] text-muted-foreground">Outra tarefa está usando este projeto; esta começa assim que ela terminar.</p>}
        {plan && <PlanView plan={plan.data['plan']} />}

        {task.steps.length > 0 && (
          <ol aria-label="Etapas" className="space-y-4">
            {task.steps.map((step) => (
              <StepBlock key={step.id} step={step} events={task.events.filter((event) => event.stepId === step.id)} collaborative={collaborative} />
            ))}
          </ol>
        )}

        {rejections.map((rejection) => (
          <section key={rejection.id} aria-label="Revisão reprovada" className="rounded-md border border-warning/40 px-4 py-3 text-[13.5px]">
            <p className="font-medium">Revisão {String(rejection.data['round'] ?? '')} reprovada: o Codex vai corrigir</p>
            <ul className="mt-1 list-disc pl-5">
              {list(rejection.data['issues']).map((issue, i) => (
                <li key={i}>{str(field(issue, 'description'))}</li>
              ))}
            </ul>
          </section>
        ))}

        {showSummary && (
          <section aria-label="Resultado" className="rounded-md bg-background px-3 py-2">
            <MarkdownView content={task.summary ?? ''} links={[]} />
          </section>
        )}

        {task.status === 'completed' && (
          <p className="flex items-center gap-2 text-[13px] text-primary">
            <CircleCheck className="size-4" aria-hidden="true" />
            {collaborative ? 'Concluída com a revisão aprovada.' : 'Concluída.'}
            {duration && <span className="text-muted-foreground">Levou {duration}.</span>}
          </p>
        )}
        {task.error && (
          <p role="alert" className="flex items-start gap-2 text-[13.5px] text-destructive">
            <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {task.error}
          </p>
        )}

        {files.length > 0 && (
          <section aria-label="Arquivos alterados" className="text-[13px]">
            <p className="text-muted-foreground">Arquivos alterados</p>
            <ul className="mt-1 space-y-0.5 font-mono text-[12.5px]">
              {files.map((file) => (
                <li key={file} className="break-all">
                  {file}
                </li>
              ))}
            </ul>
          </section>
        )}
        {diff && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Ver diferenças</summary>
            <div className="mt-2">
              <DiffView text={str(diff.data['text'])} truncated={diff.data['truncated'] === true || str(diff.data['text']).endsWith('…')} />
              {task.projectId && (
                <Link to={`/projects/${task.projectId}`} className="mt-1 inline-block text-primary underline underline-offset-4 hover:no-underline">
                  Ver o estado atual do projeto
                </Link>
              )}
            </div>
          </details>
        )}

        {(tokens || cost) && (
          <p className="text-xs text-muted-foreground">
            {[tokens, cost].filter(Boolean).join(' · ')}
          </p>
        )}
        {cancel.error && <p className="text-[13px] text-destructive">{errorMessage(cancel.error)}</p>}
      </div>
    </article>
  );
}

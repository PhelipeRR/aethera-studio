import { useId, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router';
import type { LearningCandidate } from '@neuralbridge/shared/brain-settings';
import type { LearningStatus, MemoryType } from '@neuralbridge/shared/domain';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { useApproveLearning, useBrainSettings, useLearning, useRejectLearning } from './admin-api';
import { errorMessage, formatWhen } from './format';
import { MEMORY_TYPES, TYPE_LABEL } from './labels';

const FILTERS: { status: LearningStatus; label: string }[] = [
  { status: 'pending', label: 'Para revisar' },
  { status: 'approved', label: 'Salvas' },
  { status: 'rejected', label: 'Descartadas' },
  { status: 'blocked', label: 'Bloqueadas' },
];

const MODE_TEXT = {
  manual: 'Modo manual: as propostas dos agentes são ignoradas.',
  confirm: 'Cada proposta espera a sua revisão.',
  categories: 'Categorias autorizadas são salvas sozinhas; as demais esperam aqui.',
} as const;

function Origin({ candidate }: { candidate: LearningCandidate }) {
  const agent = candidate.agent === 'claude' ? 'Claude Code' : candidate.agent === 'codex' ? 'Codex CLI' : 'um agente';
  return (
    <p className="text-xs text-muted-foreground">
      Proposta por {agent} {candidate.projectName ? `em ${candidate.projectName}` : 'sem projeto'}, {formatWhen(candidate.createdAt)}
      {candidate.taskId && (
        <>
          {' · '}
          <Link to={`/runs/${candidate.taskId}`} className="underline underline-offset-4 hover:text-foreground">
            ver a tarefa
          </Link>
        </>
      )}
    </p>
  );
}

/** One pending proposal, editable before it becomes a memory. */
function PendingCard({ candidate }: { candidate: LearningCandidate }) {
  const id = useId();
  const approve = useApproveLearning();
  const reject = useRejectLearning();
  const [title, setTitle] = useState(candidate.title);
  const [content, setContent] = useState(candidate.content);
  const [type, setType] = useState<MemoryType>(candidate.type);
  const [discarding, setDiscarding] = useState(false);
  const busy = approve.isPending || reject.isPending;
  const failure = approve.error ?? reject.error;

  return (
    <li aria-label={`Proposta: ${candidate.title}`} className="space-y-3 sg-panel rounded-lg px-5 py-4">
      <Origin candidate={candidate} />
      {candidate.mergeTarget && (
        <p className="text-[13.5px]">
          Parecida com{' '}
          <Link to={`/memory/${candidate.mergeTarget.id}`} className="text-primary underline underline-offset-4">
            {candidate.mergeTarget.title}
          </Link>
          : aprovar acrescenta este texto a ela, em vez de criar outra.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <Field label="Título" htmlFor={`${id}-title`}>
          <Input id={`${id}-title`} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} disabled={Boolean(candidate.mergeTarget)} />
        </Field>
        <Field label="Tipo" htmlFor={`${id}-type`}>
          <Select id={`${id}-type`} value={type} onChange={(event) => setType(event.target.value as MemoryType)} disabled={Boolean(candidate.mergeTarget)}>
            {MEMORY_TYPES.map((option) => (
              <option key={option} value={option}>
                {TYPE_LABEL[option]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Conteúdo" htmlFor={`${id}-content`}>
        <Textarea id={`${id}-content`} rows={4} value={content} onChange={(event) => setContent(event.target.value)} />
      </Field>
      {candidate.tags.length > 0 && <p className="text-xs text-muted-foreground">Tags: {candidate.tags.join(', ')}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={busy || !title.trim() || !content.trim()}
          onClick={() => approve.mutate({ id: candidate.id, edits: { title, content, type } })}
        >
          {candidate.mergeTarget ? 'Juntar à memória existente' : 'Salvar na memória'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setDiscarding(true)}>
          Descartar
        </Button>
        {failure && (
          <p role="alert" className="text-[13px] text-destructive">
            {errorMessage(failure)}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Descartar esta proposta?"
        confirmLabel="Descartar"
        destructive
        onConfirm={() => {
          setDiscarding(false);
          reject.mutate(candidate.id);
        }}
      >
        <p>A proposta será removida da fila de aprendizado e não será salva como memória.</p>
      </ConfirmDialog>
    </li>
  );
}

function DecidedCard({ candidate }: { candidate: LearningCandidate }) {
  return (
    <li aria-label={`Proposta: ${candidate.title}`} className={cn('space-y-1.5 rounded-lg border px-5 py-3', candidate.status === 'blocked' && 'border-warning/50')}>
      <p className="flex items-center gap-2 font-medium">
        {candidate.status === 'blocked' && <ShieldAlert className="size-4 text-warning" aria-hidden="true" />}
        {candidate.memoryId ? (
          <Link to={`/memory/${candidate.memoryId}`} className="hover:underline">
            {candidate.title}
          </Link>
        ) : (
          candidate.title
        )}
        <span className="text-xs font-normal text-muted-foreground">{TYPE_LABEL[candidate.type]}</span>
      </p>
      {candidate.reason && <p className={cn('text-[13px]', candidate.status === 'blocked' ? 'text-warning' : 'text-muted-foreground')}>{candidate.reason}</p>}
      {candidate.status === 'blocked' && <p className="font-mono text-[12.5px] whitespace-pre-wrap text-muted-foreground">{candidate.content}</p>}
      <Origin candidate={candidate} />
    </li>
  );
}

/** Review queue for what agents proposed to remember (spec: controlled learning). */
export function LearningPage() {
  const [status, setStatus] = useState<LearningStatus>('pending');
  const settings = useBrainSettings();
  const list = useLearning(status);
  const pending = useLearning('pending');
  const mode = settings.data?.learning.mode;

  return (
    <div className="max-w-4xl space-y-5 px-8 py-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Situação das propostas" className="flex gap-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.status}
              type="button"
              role="tab"
              aria-selected={status === filter.status}
              onClick={() => setStatus(filter.status)}
              className={cn(
                'rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                status === filter.status && 'bg-accent font-medium text-foreground',
              )}
            >
              {filter.label}
              {filter.status === 'pending' && pending.data && pending.data.length > 0 && <span className="ml-1.5 text-primary">{pending.data.length}</span>}
            </button>
          ))}
        </div>
        {mode && (
          <p className="text-[13px] text-muted-foreground">
            {MODE_TEXT[mode]}{' '}
            <Link to="/memory/settings" className="underline underline-offset-4 hover:text-foreground">
              Mudar
            </Link>
          </p>
        )}
      </div>

      {list.error && <p role="alert" className="text-destructive">{errorMessage(list.error)}</p>}
      {list.data?.length === 0 && (
        <p className="text-muted-foreground">
          {status === 'pending'
            ? 'Nada para revisar. Ao terminar uma tarefa, os agentes podem propor o que vale lembrar: causas de bugs, decisões, convenções.'
            : 'Nenhuma proposta aqui.'}
        </p>
      )}
      <ul className="space-y-3">
        {list.data?.map((candidate) => (candidate.status === 'pending' ? <PendingCard key={candidate.id} candidate={candidate} /> : <DecidedCard key={candidate.id} candidate={candidate} />))}
      </ul>
    </div>
  );
}

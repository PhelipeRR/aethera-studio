import { useState } from 'react';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import type { LinkRef, MemoryDetail, MemoryVersion } from '@neuralbridge/shared/brain';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { useDeleteMemory, useMemory, useProjects, useRevalidateMemory, useSetMemoryConfidence, useStoreMemory, useVersions } from './api';
import { errorMessage, formatWhen } from './format';
import { CONFIDENCE_LABEL, EVIDENCE_LABEL, SOURCE_LABEL, TRUST_LABEL, TYPE_LABEL } from './labels';
import { MarkdownView } from './MarkdownView';
import { editorValueOf, MemoryEditor, toStoreInput } from './MemoryEditor';

function LinkList({ title, links, empty }: { title: string; links: LinkRef[]; empty: string }) {
  return (
    <section aria-label={title}>
      <h3 className="text-[13px] font-medium">{title}</h3>
      {links.length === 0 ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1 text-[13px]">
          {links.map((link) => (
            <li key={`${link.id ?? link.title}-${link.relation}-${link.origin}`}>
              {link.id ? (
                <Link to={`/memory/${link.id}`} className="text-primary underline-offset-4 hover:underline">
                  {link.title}
                </Link>
              ) : (
                <span className="text-muted-foreground" title="Ainda não existe uma memória com este título">
                  {link.title} <span className="text-xs">(pendente)</span>
                </span>
              )}
              {link.relation !== 'references' && <span className="ml-1.5 text-xs text-muted-foreground">{link.relation}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VersionList({ versions, current, selected, onSelect }: { versions: MemoryVersion[]; current: number; selected: number | null; onSelect: (version: number | null) => void }) {
  return (
    <section aria-label="Histórico de versões">
      <h3 className="text-[13px] font-medium">Histórico</h3>
      <ol className="mt-1.5 space-y-0.5 text-[13px]">
        {versions.map((version) => {
          const isCurrent = version.version === current;
          const active = selected === version.version || (selected === null && isCurrent);
          return (
            <li key={version.version}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(isCurrent ? null : version.version)}
                className={cn('w-full rounded px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring', active && 'bg-accent')}
              >
                <span className="font-mono">v{version.version}</span> · {SOURCE_LABEL[version.changedBy]}
                {isCurrent && ' · atual'}
                <span className="block text-xs text-muted-foreground">{formatWhen(version.createdAt)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const CHECK_LABEL = { ok: 'confere', missing: 'não existe mais', changed: 'mudou depois da memória', unchecked: 'não verificável aqui' } as const;

/** Confidence, its evidence and the user's own review (Phase 20). Nothing an agent writes raises it. */
function ConfidencePanel({ memory }: { memory: MemoryDetail }) {
  const confidence = useSetMemoryConfidence();
  const revalidate = useRevalidateMemory();
  const hasFiles = memory.evidence.some((item) => item.kind === 'file');
  const checked = revalidate.data;
  const error = confidence.error ?? revalidate.error;
  return (
    <section aria-label="Confiança" className={cn('mt-4 rounded-md border px-4 py-3 text-[13px]', memory.confidence === 'stale' && 'border-warning/50')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-medium">
          Confiança: <span className={cn(memory.confidence === 'stale' ? 'text-warning' : memory.confidence === 'reviewed' ? 'text-primary' : 'text-muted-foreground')}>{CONFIDENCE_LABEL[memory.confidence]}</span>
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {memory.confidence !== 'reviewed' && (
            <Button size="sm" variant="outline" disabled={confidence.isPending} onClick={() => confidence.mutate({ id: memory.id, confidence: 'reviewed' })}>
              Marcar como validada
            </Button>
          )}
          {memory.confidence !== 'stale' && (
            <Button size="sm" variant="outline" disabled={confidence.isPending} onClick={() => confidence.mutate({ id: memory.id, confidence: 'stale' })}>
              Marcar como desatualizada
            </Button>
          )}
          {hasFiles && (
            <Button size="sm" variant="outline" disabled={revalidate.isPending} onClick={() => revalidate.mutate(memory.id)}>
              Conferir evidências
            </Button>
          )}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">
        {memory.confidence === 'stale'
          ? 'Desatualizada: aparece depois das outras nas buscas e chega aos agentes com um aviso para conferir antes de usar.'
          : memory.confidence === 'reviewed'
            ? 'Validada por você. Se o texto mudar, volta a não verificada.'
            : 'Ainda não validada. Só você valida uma memória; o que os agentes escrevem nunca a valida.'}
      </p>
      {memory.evidence.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Sem evidências registradas (tarefa, conversa, arquivo ou link de origem).</p>
      ) : (
        <ul aria-label="Evidências" className="mt-2 space-y-0.5">
          {memory.evidence.map((item) => {
            const status = checked?.findings.find((finding) => finding.kind === item.kind && finding.ref === item.ref)?.status;
            return (
              <li key={`${item.kind}:${item.ref}`} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{EVIDENCE_LABEL[item.kind]}</span>
                <span className="min-w-0 font-mono text-[12px] break-all">{item.ref}</span>
                {status && <span className={cn(status === 'ok' ? 'text-primary' : status === 'unchecked' ? 'text-muted-foreground' : 'text-warning')}>— {CHECK_LABEL[status]}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {checked && (
        <p role="status" className="mt-2">
          {checked.findings.some((finding) => finding.status === 'missing' || finding.status === 'changed')
            ? 'Uma evidência sumiu ou mudou: a memória foi marcada como desatualizada.'
            : 'As evidências conferem. A confiança não muda sozinha: valide se o conteúdo continua certo.'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {errorMessage(error)}
        </p>
      )}
    </section>
  );
}

function Inspector({ memory }: { memory: MemoryDetail }) {
  const navigate = useNavigate();
  const versions = useVersions(memory.id);
  const projects = useProjects();
  const store = useStoreMemory();
  const remove = useDeleteMemory();
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hardDelete, setHardDelete] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const shown = selected === null ? null : versions.data?.find((version) => version.version === selected);
  const projectName = memory.projectId === null ? 'Global' : (projects.data?.find((project) => project.id === memory.projectId)?.name ?? memory.projectId);

  if (editing) {
    return (
      <div className="px-8 py-6">
        <MemoryEditor
          initial={editorValueOf(memory)}
          editing
          saving={store.isPending}
          error={store.error ? errorMessage(store.error) : null}
          onCancel={() => setEditing(false)}
          onSave={(value) =>
            store.mutate(toStoreInput(value, memory.id), {
              onSuccess: ({ changed }) => {
                setEditing(false);
                setMessage({ kind: 'ok', text: changed ? 'Alterações salvas.' : 'Nada mudou: nenhuma versão nova.' });
              },
            })
          }
        />
      </div>
    );
  }

  const restore = (version: MemoryVersion) =>
    store.mutate(
      { id: memory.id, title: version.title, content: version.content, type: version.type, tags: version.tags },
      {
        onSuccess: () => {
          setSelected(null);
          setMessage({ kind: 'ok', text: `Versão ${version.version} restaurada como versão nova.` });
        },
        onError: (error) => setMessage({ kind: 'error', text: errorMessage(error) }),
      },
    );

  return (
    <div className="grid gap-10 px-8 py-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <article aria-labelledby="memory-title" className="min-w-0">
        <Link to="/memory/explore" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Explorar
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h2 id="memory-title" className="min-w-0 text-lg font-semibold tracking-tight break-words">
            {shown ? shown.title : memory.title}
          </h2>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden="true" /> Editar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden="true" /> Excluir
            </Button>
          </div>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {TYPE_LABEL[memory.type]} · {projectName} · {TRUST_LABEL[memory.trust]} · criada por {SOURCE_LABEL[memory.source.kind]} · v{memory.version}, {formatWhen(memory.updatedAt)}
        </p>
        {memory.tags.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {memory.tags.map((tag) => (
              <Link key={tag} to={`/memory/explore?tag=${encodeURIComponent(tag)}`} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground hover:text-foreground">
                #{tag}
              </Link>
            ))}
          </p>
        )}
        {memory.trust === 'unverified' && memory.source.kind !== 'user' && (
          <p className="mt-3 text-[13px] text-muted-foreground">Escrita por um agente e ainda não revisada. Agentes recebem este conteúdo como referência, não como instrução.</p>
        )}
        <ConfidencePanel memory={memory} />
        {message && (
          <p role={message.kind === 'error' ? 'alert' : 'status'} className={cn('mt-3 text-[13px]', message.kind === 'error' ? 'text-destructive' : 'text-primary')}>
            {message.text}
          </p>
        )}

        {shown && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px]">
            <span>
              Você está vendo a versão {shown.version}, de {formatWhen(shown.createdAt)}.
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSelected(null)}>
                Ver atual
              </Button>
              <Button size="sm" disabled={store.isPending} onClick={() => restore(shown)}>
                Restaurar esta versão
              </Button>
            </span>
          </div>
        )}

        <div className="mt-6">
          {(shown ?? memory).content.trim() ? <MarkdownView content={(shown ?? memory).content} links={memory.outgoing} /> : <p className="text-muted-foreground">Sem conteúdo.</p>}
        </div>
      </article>

      <aside className="space-y-6 lg:border-l lg:pl-6">
        <LinkList title="Aponta para" links={memory.outgoing} empty="Nenhum link. Use [[Título]] no conteúdo." />
        <LinkList title="Citada por" links={memory.backlinks} empty="Nenhuma memória aponta para esta." />
        {versions.data && <VersionList versions={versions.data} current={memory.version} selected={selected} onSelect={setSelected} />}
      </aside>

      {deleting && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setDeleting(false);
              setHardDelete(false);
            }
          }}
          title={`Excluir "${memory.title}"?`}
          confirmLabel={hardDelete ? 'Excluir definitivamente' : 'Excluir'}
          destructive
          onConfirm={() =>
            remove.mutate(
              { id: memory.id, hard: hardDelete },
              {
                onSuccess: () => navigate('/memory/explore', { replace: true }),
                onError: (error) => setMessage({ kind: 'error', text: errorMessage(error) }),
              },
            )
          }
        >
          <p>A memória deixa de aparecer para você e para os agentes, e os links para ela ficam pendentes.</p>
          <label className="flex items-start gap-2 text-foreground">
            <input type="checkbox" checked={hardDelete} onChange={(event) => setHardDelete(event.target.checked)} className="mt-1 accent-[var(--destructive)]" />
            <span>
              Excluir definitivamente, com todo o histórico de versões.
              <span className="block text-muted-foreground">Não pode ser desfeito.</span>
            </span>
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}

export function MemoryPage() {
  const { id = '' } = useParams();
  const memory = useMemory(id);
  if (memory.isError) {
    return (
      <p role="alert" className="px-8 py-7 text-destructive">
        {errorMessage(memory.error)}
      </p>
    );
  }
  if (memory.isPending) return <p className="px-8 py-7 text-muted-foreground">Carregando…</p>;
  if (!memory.data) {
    return (
      <div className="px-8 py-7">
        <p>Esta memória não existe ou foi excluída.</p>
        <Link to="/memory/explore" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
          Voltar para Explorar
        </Link>
      </div>
    );
  }
  // key: switching between memories resets edit mode and the selected version.
  return <Inspector key={memory.data.id} memory={memory.data} />;
}

export function NewMemoryPage() {
  const navigate = useNavigate();
  const store = useStoreMemory();
  // ?title= comes from a pending node in the graph: creating it resolves the links that point to it.
  const [params] = useSearchParams();
  return (
    <div className="px-8 py-6">
      <MemoryEditor
        initial={{ ...editorValueOf(), title: params.get('title') ?? '' }}
        editing={false}
        saving={store.isPending}
        error={store.error ? errorMessage(store.error) : null}
        onCancel={() => navigate(-1)}
        onSave={(value) => store.mutate(toStoreInput(value), { onSuccess: ({ memory }) => navigate(`/memory/${memory.id}`, { replace: true }) })}
      />
    </div>
  );
}

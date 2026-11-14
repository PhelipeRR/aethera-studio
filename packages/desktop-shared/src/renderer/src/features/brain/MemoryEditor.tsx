import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Memory, StoreInput } from '@neuralbridge/shared/brain';
import type { MemoryType, Trust } from '@neuralbridge/shared/domain';
import { useBlocker } from 'react-router';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { useProjects } from './api';
import { MarkdownView } from './MarkdownView';
import { MEMORY_TYPES, TRUST_LABEL, TRUST_STATES, TYPE_LABEL } from './labels';

export interface EditorValue {
  title: string;
  content: string;
  type: MemoryType;
  projectId: string | null;
  tags: string;
  trust: Trust;
}

export function editorValueOf(memory?: Memory): EditorValue {
  return memory
    ? { title: memory.title, content: memory.content, type: memory.type, projectId: memory.projectId, tags: memory.tags.join(', '), trust: memory.trust }
    : { title: '', content: '', type: 'decision', projectId: null, tags: '', trust: 'reviewed' };
}

export function toStoreInput(value: EditorValue, id?: string): StoreInput {
  return {
    ...(id ? { id } : {}),
    title: value.title.trim(),
    content: value.content,
    type: value.type,
    projectId: value.projectId,
    tags: value.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
    trust: value.trust,
  };
}

/** Create/edit form. The project cannot change after creation (the brain refuses to move memories). */
export function MemoryEditor({
  initial,
  editing,
  saving,
  error,
  onSave,
  onCancel,
}: {
  initial: EditorValue;
  editing: boolean;
  saving: boolean;
  error: string | null;
  onSave: (value: EditorValue) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  /** Set once the user confirmed discarding, so the navigation that follows is not asked about again. */
  const discarded = useRef(false);
  const projects = useProjects();
  const set = <K extends keyof EditorValue>(key: K, next: EditorValue[K]) => setValue((current) => ({ ...current, [key]: next }));

  // Same rule as the brain's schema, checked here so the message can say exactly what is wrong.
  const titleProblem = /\[\[|\]\]/.test(value.title) ? 'O título não pode conter [[ ou ]]: eles marcam links no conteúdo.' : null;
  const problem = titleProblem ?? error;

  // Unsaved changes: ask before leaving the page or cancelling. A submitted form may navigate freely
  // (the caller moves to the saved memory); a failed save counts as unsaved again.
  const dirty = JSON.stringify(value) !== JSON.stringify(initial);
  useEffect(() => {
    if (error) submitted.current = false;
  }, [error]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !submitted.current && !discarded.current && currentLocation.pathname !== nextLocation.pathname);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (titleProblem) {
      titleRef.current?.focus();
      return;
    }
    submitted.current = true;
    onSave(value);
  };

  const cancel = () => (dirty ? setConfirmCancel(true) : onCancel());

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-5" aria-label={editing ? 'Editar memória' : 'Nova memória'}>
      <Field label="Título" htmlFor="memory-title" hint="Curto e específico. Outras memórias apontam para ele com [[Título]].">
        <Input ref={titleRef} id="memory-title" required maxLength={200} value={value.title} onChange={(event) => set('title', event.target.value)} aria-invalid={Boolean(titleProblem) || undefined} aria-describedby={titleProblem ? 'memory-problem' : undefined} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tipo" htmlFor="memory-type">
          <Select id="memory-type" value={value.type} onChange={(event) => set('type', event.target.value as MemoryType)}>
            {MEMORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Projeto" htmlFor="memory-project">
          <Select id="memory-project" value={value.projectId ?? ''} disabled={editing} onChange={(event) => set('projectId', event.target.value || null)}>
            <option value="">Global (todos os projetos)</option>
            {projects.data?.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Revisão" htmlFor="memory-trust">
          <Select id="memory-trust" value={value.trust} onChange={(event) => set('trust', event.target.value as Trust)}>
            {TRUST_STATES.map((trust) => (
              <option key={trust} value={trust}>
                {TRUST_LABEL[trust]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Tags" htmlFor="memory-tags" hint="Separadas por vírgula.">
        <Input id="memory-tags" value={value.tags} onChange={(event) => set('tags', event.target.value)} placeholder="banco, performance" />
      </Field>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="memory-content" className="text-[13px] font-medium">
            Conteúdo (Markdown)
          </label>
          <div role="group" aria-label="Modo do conteúdo" className="flex rounded-md border p-0.5 text-xs">
            {[false, true].map((mode) => (
              <button
                key={String(mode)}
                type="button"
                aria-pressed={preview === mode}
                onClick={() => setPreview(mode)}
                className={cn('rounded px-2.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring', preview === mode ? 'bg-accent text-foreground' : 'text-muted-foreground')}
              >
                {mode ? 'Pré-visualizar' : 'Escrever'}
              </button>
            ))}
          </div>
        </div>
        {preview ? (
          <div className="min-h-64 rounded-md border px-4 py-3">
            {value.content.trim() ? <MarkdownView content={value.content} links={[]} /> : <p className="text-muted-foreground">Nada para mostrar.</p>}
          </div>
        ) : (
          <Textarea id="memory-content" rows={14} value={value.content} onChange={(event) => set('content', event.target.value)} className="font-mono text-[13px]" />
        )}
      </div>

      {problem && (
        <p id="memory-problem" role="alert" className="text-destructive">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {editing ? 'Salvar alterações' : 'Criar memória'}
        </Button>
        <Button type="button" variant="outline" onClick={cancel}>
          Cancelar
        </Button>
      </div>

      {(confirmCancel || blocker.state === 'blocked') && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setConfirmCancel(false);
            if (blocker.state === 'blocked') blocker.reset();
          }}
          title="Descartar as alterações?"
          confirmLabel="Descartar"
          destructive
          onConfirm={() => {
            setConfirmCancel(false);
            discarded.current = true;
            if (blocker.state === 'blocked') blocker.proceed();
            else onCancel();
          }}
        >
          <p>O que você escreveu nesta memória ainda não foi salvo.</p>
        </ConfirmDialog>
      )}
    </form>
  );
}

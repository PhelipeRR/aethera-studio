import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, Check, ChevronDown, ChevronRight, ImagePlus, LoaderCircle, PanelLeftClose, PanelLeftOpen, PanelRightOpen, Pencil, Plus, Search, SendHorizontal, Square, Trash2, X } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { RUN_MODES, type AgentId, type RunMode } from '@neuralbridge/shared/domain';
import type { SkillSummary } from '@neuralbridge/shared/channels';
import { CONVERSATION_TITLE_MAX, FINAL_TASK_STATUSES, IMAGE_TYPES, IMAGES_PER_MESSAGE, type ImageUpload, type TaskDetail } from '@neuralbridge/shared/tasks';
import { BrandMark } from '@/app/BrandMark';
import { healthOf, useAgents } from '@/app/useAgents';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, formatWhen } from '@/features/brain/format';
import { useProjectList } from '@/features/projects/api';
import { usePersistentFlag } from '@/lib/use-persistent-flag';
import { cn } from '@/lib/utils';
import { useCancelTask, useDeleteThread, useKnownModels, useRenameThread, useResumeTask, useStartTask, useTaskList, useTaskUpdates, useThread } from './api';
import { conversationGroups, isNearBottom, nextComposerHeight, projectTree, type ConversationItem } from './chat-model';
import { DraftImages, useImageDraft } from './ChatImages';
import { AGENT_LABEL, MODE_LABEL } from './labels';
import { PANEL_COLLAPSED_KEY, SessionPanel, useNarrowWindow, type PanelSubject } from './SessionPanel';
import { StatusBadge, TaskCard } from './TaskCard';

export const HISTORY_COLLAPSED_KEY = 'nb.chat.history.collapsed';
const NO_PROJECT = '';
const MODE_SHORT: Record<RunMode, string> = { auto: 'Automático', claude: 'Claude Code', codex: 'Codex CLI', collab: 'Colaborativo' };

const iconButton =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';
const chip =
  'h-8 rounded-full border border-border bg-background px-3 text-[12.5px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60';

const explicitAgent = (mode: RunMode): AgentId | null => (mode === 'claude' || mode === 'codex' ? mode : null);

// --- history -----------------------------------------------------------------------------------

function ConversationRow({ item, active, onDelete }: { item: ConversationItem; active: boolean; onDelete: (item: ConversationItem) => void }) {
  const rename = useRenameThread();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (editing) {
    const save = (event?: FormEvent) => {
      event?.preventDefault();
      rename.mutate({ id: item.id, title }, { onSuccess: () => setEditing(false) });
    };
    return (
      <form onSubmit={save} className="flex items-center gap-1 rounded-md bg-accent px-1.5 py-1">
        <input
          ref={input}
          aria-label="Novo nome da conversa"
          value={title}
          maxLength={CONVERSATION_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setTitle(item.title);
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-[13px] outline-none focus-visible:border-ring"
        />
        <button type="submit" aria-label="Salvar nome" className={cn(iconButton, 'size-7')} disabled={rename.isPending}>
          <Check className="size-3.5" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Cancelar" className={cn(iconButton, 'size-7')} onClick={() => setEditing(false)}>
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </form>
    );
  }

  return (
    <div className={cn('group relative flex items-center rounded-md hover:bg-accent focus-within:bg-accent', active && 'bg-accent')}>
      <Link
        to={item.id.startsWith('imported:') ? `/chat?imported=${encodeURIComponent(item.id)}` : `/chat?thread=${item.id}`}
        aria-current={active ? 'page' : undefined}
        className="min-w-0 flex-1 rounded-md py-2 pr-1 pl-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="block truncate text-[13px]">{item.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{item.projectName ?? 'Sem projeto'}</span>
          {!FINAL_TASK_STATUSES.includes(item.status) && <StatusBadge status={item.status} />}
        </span>
      </Link>
      {/* Visible on hover and keyboard focus; always reachable by Tab. */}
      {!item.id.startsWith('imported:') && <div className="flex shrink-0 gap-0.5 pr-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={`Renomear “${item.title}”`}
          className={cn(iconButton, 'size-7')}
          onClick={() => {
            setTitle(item.title);
            setEditing(true);
          }}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
        </button>
        <button type="button" aria-label={`Excluir “${item.title}”`} className={cn(iconButton, 'size-7 hover:text-destructive')} onClick={() => onDelete(item)}>
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
      </div>}
    </div>
  );
}

function History({ current, onCollapse }: { current: string | null; onCollapse: () => void }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selectedProject = params.get('project');
  const recent = useTaskList({ limit: 200 });
  const projects = useProjectList();
  const imported = useQuery({ queryKey: ['imported-conversations'], queryFn: () => window.neuralbridge.importedConversations.list(), staleTime: 30_000 });
  const remove = useDeleteThread();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<ConversationItem | null>(null);
  const [now] = useState(() => new Date());
  const importedItems = (imported.data ?? []).map((item) => ({ id: item.id, title: item.title, lastAt: item.updatedAt ?? item.importedAt, status: 'completed' as const, projectId: item.projectId, projectName: projects.data?.find((project) => project.id === item.projectId)?.name ?? null, renamed: true, text: [item.title] }));
  const visibleTasks = selectedProject ? (recent.data ?? []).filter((task) => task.projectId === selectedProject) : recent.data ?? [];
  const allGroups = conversationGroups(visibleTasks, query, now);
  const needle = query.trim().toLocaleLowerCase();
  const conversations = [...allGroups.flatMap((group) => group.items), ...importedItems.filter((item) => (!selectedProject || item.projectId === selectedProject) && (!needle || item.title.toLocaleLowerCase().includes(needle)))];
  const byProject = new Map<string, ConversationItem[]>();
  for (const item of conversations) {
    const key = item.projectId ?? '';
    byProject.set(key, [...(byProject.get(key) ?? []), item]);
  }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const empty = !recent.isPending && !imported.isPending && conversations.length === 0;

  return (
    <aside aria-label="Histórico de conversas" className="flex w-60 shrink-0 flex-col border-r border-border/70 bg-sidebar/40 xl:w-72">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="text-[13px] font-medium">Conversas</h2>
        <Tooltip label="Recolher histórico" side="bottom">
          <button type="button" aria-label="Recolher histórico" aria-expanded="true" className={iconButton} onClick={onCollapse}>
            <PanelLeftClose className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      <div className="space-y-2 px-3 pb-3">
        <Link
          to={selectedProject ? `/chat?project=${encodeURIComponent(selectedProject)}` : '/chat'}
          className="flex h-9 items-center gap-2 rounded-md border border-border/80 bg-background px-2.5 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
          Nova conversa
        </Link>
        <label className="relative block">
          <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            aria-label="Pesquisar conversas"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar conversas"
            className="h-8 w-full rounded-md border border-border/70 bg-background pr-2 pl-8 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>
      </div>
      <nav aria-label="Conversas" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2 pb-4">
        {empty && <p className="px-2.5 text-[13px] text-muted-foreground">Suas conversas aparecem aqui.</p>}
        {!empty && allGroups.length === 0 && query.trim() !== '' && <p className="px-2.5 text-xs text-muted-foreground">Nenhuma conversa encontrada.</p>}
        {recent.error && (
          <p role="alert" className="px-2.5 text-xs text-destructive">
            {errorMessage(recent.error)}
          </p>
        )}
        {[...projectTree(projects.data ?? []).map(({ project, depth }) => ({ key: project.id, label: project.name, depth })), { key: '', label: 'Sem projeto', depth: 0 }].map((project) => {
          const items = byProject.get(project.key) ?? [];
          const running = items.filter((item) => !FINAL_TASK_STATUSES.includes(item.status)).length;
          const selected = selectedProject === project.key;
          // Closed by default, except where the reader already is: the open conversation, the chosen project, a search.
          const isCollapsed = !needle && (collapsed[project.key] ?? !(selected || items.some((item) => item.id === current)));
          return <section key={project.key || 'unassigned'} aria-label={`Projeto ${project.label}`} className="mb-2" style={{ marginLeft: `${project.depth * 0.625}rem` }}>
            <div className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
              <button type="button" className="rounded p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${isCollapsed ? 'Expandir' : 'Recolher'} ${project.label}`} aria-expanded={!isCollapsed} onClick={() => setCollapsed((currentState) => ({ ...currentState, [project.key]: !isCollapsed }))}>{isCollapsed ? <ChevronRight className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}</button>
              <Link to={project.key ? `/chat?project=${encodeURIComponent(project.key)}` : '/chat'} className="min-w-0 flex-1 truncate rounded px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">{project.label}</Link>{running > 0 && <span data-testid="project-running" className="flex items-center gap-1 text-primary"><LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /><span className="tabular-nums">{running}</span><span className="sr-only"> em execução</span></span>}<span className="tabular-nums">{items.length}</span>
            </div>
            {!isCollapsed && <ul className="space-y-0.5 pl-4">{items.length === 0 && query.trim() === '' ? <li className="px-2 py-1 text-[11px] text-muted-foreground">Nenhuma conversa</li> : items.map((item) => <li key={item.id}><ConversationRow item={item} active={item.id === current} onDelete={setDeleting} /></li>)}</ul>}
          </section>;
        })}
      </nav>
      {remove.error && (
        <p role="alert" className="border-t px-3 py-2 text-xs text-destructive">
          {errorMessage(remove.error)}
        </p>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir esta conversa?"
        confirmLabel="Excluir conversa"
        destructive
        onConfirm={() => {
          if (!deleting) return;
          const target = deleting;
          setDeleting(null);
          remove.mutate(target.id, {
            onSuccess: () => {
              if (target.id === current) void navigate('/chat');
            },
          });
        }}
      >
        <p>“{deleting?.title}” some do histórico e das Execuções, com etapas, registros e consumo de tokens. Arquivos alterados nos projetos e memórias salvas continuam onde estão.</p>
        <p>Não dá para desfazer.</p>
      </ConfirmDialog>
    </aside>
  );
}

// --- composer ----------------------------------------------------------------------------------

function Composer({
  placeholder,
  canSend,
  pending,
  running,
  onSubmit,
  onStop,
  stopping = false,
  controls,
  note,
  error,
  skills = [],
}: {
  placeholder: string;
  canSend: boolean;
  pending: boolean;
  /** A task is running: the button stops it instead of sending. */
  running: boolean;
  onSubmit: (prompt: string, images: ImageUpload[]) => Promise<unknown>;
  onStop?: () => void;
  stopping?: boolean;
  controls: ReactNode;
  note: ReactNode;
  error: unknown;
  skills?: SkillSummary[];
}) {
  const id = useId();
  const [prompt, setPrompt] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const images = useImageDraft();
  const [dragging, setDragging] = useState(false);
  const [skillIndex, setSkillIndex] = useState(0);
  const skillQuery = /^\/([^\s]*)$/u.exec(prompt)?.[1]?.toLocaleLowerCase() ?? null;
  const skillSuggestions = skillQuery === null ? [] : skills.filter((skill) => skill.valid && (skill.name.toLocaleLowerCase().includes(skillQuery) || skill.id.toLocaleLowerCase().split(/[:/\\]/u).at(-1)?.includes(skillQuery))).slice(0, 8);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${nextComposerHeight(element.scrollHeight, 44)}px`;
  }, [prompt]);

  const ready = prompt.trim() !== '' && canSend && !pending && !running;
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready) return;
    try {
      await onSubmit(prompt.trim(), images.uploads());
      setPrompt('');
      images.clear();
    } catch {
      // Shown through `error`; the text stays so nothing is lost.
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (skillSuggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setSkillIndex((current) => (current + (event.key === 'ArrowDown' ? 1 : skillSuggestions.length - 1)) % skillSuggestions.length);
      return;
    }
    if (skillSuggestions.length > 0 && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const selected = skillSuggestions[Math.min(skillIndex, Math.max(0, skillSuggestions.length - 1))];
      if (selected) setPrompt(`/${selected.name} `);
      return;
    }
    if (skillSuggestions.length > 0 && event.key === 'Escape') {
      event.preventDefault();
      setPrompt('');
      return;
    }
    // Enter sends, Shift+Enter breaks the line; never while an input method is composing a character.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const hasFiles = (event: DragEvent<HTMLDivElement>) => event.dataTransfer.types.includes('Files');

  return (
    <div className="shrink-0 border-t border-border/50 bg-background px-4 pt-3 pb-4 sm:px-6">
      <form onSubmit={submit} aria-label="Escrever mensagem" className="w-full">
        <div
          data-testid="composer-box"
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDragging(false);
            void images.add([...event.dataTransfer.files]);
          }}
          className={cn('rounded-2xl border border-input bg-card shadow-sm transition-colors focus-within:border-ring', dragging && 'border-ring ring-2 ring-ring/40')}
        >
          <DraftImages drafts={images.drafts} onRemove={images.remove} />
          <label htmlFor={id} className="sr-only">
            Mensagem
          </label>
          <textarea data-tour="tour-chat-input"
            ref={box}
            id={id}
            rows={1}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(event) => {
              const pasted = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
              if (!pasted.length) return;
              event.preventDefault();
              void images.add(pasted);
            }}
            placeholder={placeholder}
            maxLength={20_000}
            autoComplete="off"
            aria-describedby={`${id}-note`}
            className="block max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
          />
          {skillQuery !== null && (
            <div role="listbox" aria-label="Skills disponíveis" className="mx-3 mb-2 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-left shadow-lg">
              {skillSuggestions.length > 0 ? skillSuggestions.map((skill, index) => (
                <button type="button" role="option" aria-selected={index === skillIndex} key={skill.id} className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm', index === skillIndex && 'bg-accent')} onMouseDown={(event) => event.preventDefault()} onClick={() => { setPrompt(`/${skill.name} `); box.current?.focus(); }}>
                  <span className="font-medium">/{skill.name}</span><span className="min-w-0 truncate text-xs text-muted-foreground">{skill.description || 'Skill instalada'}</span>
                </button>
              )) : <p className="px-3 py-2 text-xs text-muted-foreground">Nenhuma skill encontrada.</p>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
            <input
              ref={picker}
              type="file"
              multiple
              hidden
              accept={Object.keys(IMAGE_TYPES).join(',')}
              aria-label="Escolher imagens"
              onChange={(event) => {
                void images.add([...(event.target.files ?? [])]);
                event.target.value = '';
              }}
            />
            <Tooltip label={`Anexar imagens (até ${IMAGES_PER_MESSAGE}; também dá para colar ou arrastar)`} side="top">
              <button type="button" aria-label="Anexar imagens" className={cn(iconButton, 'size-8 rounded-full')} disabled={images.drafts.length >= IMAGES_PER_MESSAGE} onClick={() => picker.current?.click()}>
                <ImagePlus className="size-4" aria-hidden="true" />
              </button>
            </Tooltip>
            {controls}
            <span className="ml-auto hidden text-[11px] text-muted-foreground 2xl:inline">Enter envia · Shift+Enter quebra a linha</span>
            {running ? (
              <Tooltip label="Parar a tarefa" side="top">
                <button
                  type="button"
                  aria-label="Parar"
                  onClick={onStop}
                  disabled={stopping}
                  className="ml-auto inline-flex size-9 items-center justify-center rounded-full bg-foreground text-background outline-none transition-opacity hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50 2xl:ml-0"
                >
                  <Square className="size-3.5 fill-current" aria-hidden="true" />
                </button>
              </Tooltip>
            ) : (
              <button
                type="submit"
                data-tour="tour-chat-submit"
                aria-label="Enviar"
                disabled={!ready}
                className="ml-auto inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-40 2xl:ml-0"
              >
                {pending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <SendHorizontal className="size-4" aria-hidden="true" />}
              </button>
            )}
          </div>
        </div>
        <div id={`${id}-note`} className="mt-2 px-1 text-[11.5px] text-muted-foreground">
          {note}
        </div>
        {images.problems.length > 0 && (
          <ul role="alert" aria-label="Imagens recusadas" className="mt-1 px-1 text-[13px] text-destructive">
            {images.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {Boolean(error) && (
          <p role="alert" className="mt-1 px-1 text-[13px] text-destructive">
            {errorMessage(error)}
          </p>
        )}
      </form>
    </div>
  );
}

/** A warning under the composer when the project lets agents run anything: the user should see it before sending. */
function FullAccessNote({ projectId }: { projectId: string | null }) {
  const projects = useProjectList();
  const project = projects.data?.find((entry) => entry.id === projectId);
  if (project?.permissionLevel !== 'full') return null;
  return (
    <span className="mt-1 block text-warning">
      Acesso total neste projeto: ao alterar arquivos, os agentes rodam comandos sem perguntar e sem sandbox. Mude em{' '}
      <Link to={`/projects/${project.id}`} className="underline underline-offset-2">
        Projetos
      </Link>
      .
    </span>
  );
}

function ModelNote({ mode }: { mode: RunMode }) {
  const agent = explicitAgent(mode);
  if (!agent) return <>No modo {MODE_LABEL[mode].toLowerCase()}, cada CLI usa o modelo configurado nele.</>;
  return <>Modelo: os CLIs não informam quais estão disponíveis. Deixe vazio para usar o padrão do {AGENT_LABEL[agent]}, ou digite um nome que ele aceite; as sugestões vêm de sessões anteriores.</>;
}

/** Project, agent and model chips for a new conversation: real projects, real agent availability, no invented models. */
function Selectors({
  projectId,
  setProjectId,
  mode,
  setMode,
  model,
  setModel,
}: {
  projectId: string;
  setProjectId: (value: string) => void;
  mode: RunMode;
  setMode: (value: RunMode) => void;
  model: string;
  setModel: (value: string) => void;
}) {
  const projects = useProjectList();
  const { agents } = useAgents();
  const known = useKnownModels();
  const listId = useId();
  const blocked = new Set(agents?.filter((agent) => healthOf(agent) === 'blocked').map((agent) => agent.id) ?? []);
  const agent = explicitAgent(mode);

  return (
    <>
      <label className="sr-only" htmlFor="chat-project">
        Projeto
      </label>
      <select id="chat-project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className={cn(chip, 'max-w-[13rem] truncate')}>
        <option value={NO_PROJECT}>Sem projeto</option>
        {projectTree(projects.data ?? []).map(({ project, depth }) => (
          <option key={project.id} value={project.id} disabled={!project.exists}>
            {'  '.repeat(depth)}{depth ? '└ ' : ''}{project.name}
            {!project.exists ? ' (pasta não encontrada)' : ''}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="chat-agent">
        Agente
      </label>
      <span className="relative inline-flex">
        {agent && (
          <span
            aria-hidden="true"
            className={cn('pointer-events-none absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-full', agent === 'claude' ? 'bg-agent-claude' : 'bg-agent-codex')}
          />
        )}
        <select id="chat-agent" value={mode} onChange={(event) => setMode(event.target.value as RunMode)} className={cn(chip, agent && 'pl-7')}>
          {RUN_MODES.map((option) => {
            const optionAgent = explicitAgent(option);
            const unavailable = optionAgent !== null && blocked.has(optionAgent);
            return (
              <option key={option} value={option} disabled={unavailable}>
                {MODE_SHORT[option]}
                {unavailable ? ' (indisponível)' : ''}
              </option>
            );
          })}
        </select>
      </span>

      <label className="sr-only" htmlFor="chat-model">
        Modelo
      </label>
      <input
        id="chat-model"
        list={agent ? listId : undefined}
        value={agent ? model : ''}
        onChange={(event) => setModel(event.target.value)}
        disabled={!agent}
        placeholder={agent ? 'Modelo padrão' : 'Modelo do CLI'}
        maxLength={100}
        spellCheck={false}
        autoComplete="off"
        className={cn(chip, 'w-36 placeholder:text-muted-foreground')}
      />
      {agent && (
        <datalist id={listId}>
          {(known.data?.[agent] ?? []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
    </>
  );
}

// --- conversation column -----------------------------------------------------------------------

interface ColumnLayout {
  historyCollapsed: boolean;
  onExpandHistory: () => void;
  panelOpen: boolean;
  onOpenPanel: () => void;
}

function ColumnHeader({ title, meta, layout }: { title: ReactNode; meta?: ReactNode; layout: ColumnLayout }) {
  const { historyCollapsed, onExpandHistory } = layout;
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/50 px-3 sm:px-4">
      {historyCollapsed && (
        <>
          <Tooltip label="Mostrar histórico" side="bottom">
            <button type="button" aria-label="Mostrar histórico" aria-expanded="false" className={iconButton} onClick={onExpandHistory}>
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
          <Tooltip label="Nova conversa" side="bottom">
            <Link to="/chat" aria-label="Nova conversa" className={iconButton}>
              <Plus className="size-4" aria-hidden="true" />
            </Link>
          </Tooltip>
        </>
      )}
      <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium">{title}</h2>
      {meta && <div className="flex min-w-0 shrink items-center gap-2 text-xs text-muted-foreground">{meta}</div>}
      {!layout.panelOpen && (
        <Tooltip label="Mostrar contexto e execução" side="bottom">
          <button type="button" data-tour="chat-context" aria-label="Mostrar contexto e execução" aria-expanded="false" className={iconButton} onClick={layout.onOpenPanel}>
            <PanelRightOpen className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </header>
  );
}

interface Draft {
  projectId: string;
  mode: RunMode;
  model: string;
  participants?: string[];
}

/** For a workspace: which of its projects the task concerns. Permissions do not change with the choice. */
function ParticipantPicker({ projectId, selected, onChange }: { projectId: string; selected: string[]; onChange: (next: string[]) => void }) {
  const projects = useProjectList();
  const children = projects.data?.filter((project) => project.parentProjectId === projectId) ?? [];
  if (!children.length) return null;
  return (
    <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <legend className="sr-only">Projetos desta tarefa</legend>
      <span>Projetos:</span>
      {children.map((project) => (
        <label key={project.id} className="flex items-center gap-1">
          <input type="checkbox" checked={selected.includes(project.id)} onChange={(event) => onChange(event.target.checked ? [...selected, project.id] : selected.filter((id) => id !== project.id))} />
          {project.name}
        </label>
      ))}
    </fieldset>
  );
}

function NewConversation({ layout, draft, setDraft }: { layout: ColumnLayout; draft: Draft; setDraft: (next: Draft) => void }) {
  const navigate = useNavigate();
  const { agents } = useAgents();
  const start = useStartTask();
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => window.neuralbridge.skills.list(), staleTime: 30_000 });
  const { projectId, mode, model } = draft;
  const setProjectId = (value: string) => setDraft({ ...draft, projectId: value, participants: [] });
  const setMode = (value: RunMode) => setDraft({ ...draft, mode: value });
  const setModel = (value: string) => setDraft({ ...draft, model: value });
  const usable = agents?.filter((agent) => healthOf(agent) !== 'blocked') ?? null;

  return (
    <>
      <ColumnHeader title="Nova conversa" layout={layout} />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center">
        <BrandMark className="mb-5 h-14 w-[72px] opacity-90" />
        <h2 className="text-2xl font-semibold tracking-tight">Em que vamos trabalhar?</h2>
        <p className="mt-2 max-w-md text-[14px] text-muted-foreground">
          Descreva uma tarefa ou faça uma pergunta. O Singularity escolhe entre Claude Code e Codex e explica por quê, ou usa o agente que você escolher.
        </p>
        {usable && usable.length === 0 && (
          <p role="alert" className="mt-5 text-[13.5px] text-warning">
            Nenhum agente está pronto. Veja o que falta em{' '}
            <Link to="/agents" className="underline underline-offset-4">
              Agentes
            </Link>
            .
          </p>
        )}
      </div>
      <Composer
        placeholder="Ex.: Analise este projeto, encontre a causa do erro no checkout e corrija com testes."
        canSend={usable?.length !== 0}
        pending={start.isPending}
        running={false}
        error={start.error}
        skills={skills.data ?? []}
        controls={<Selectors projectId={projectId} setProjectId={setProjectId} mode={mode} setMode={setMode} model={model} setModel={setModel} />}
        note={
          <>
            {projectId ? 'Os agentes trabalham na pasta do projeto. ' : 'Sem projeto, os agentes só respondem: nada é alterado. '}
            <ModelNote mode={mode} />
            <span className="mt-1 block">Dica: use <code>/nome-da-skill</code> para solicitar uma skill habilitada.</span>
            <FullAccessNote projectId={projectId || null} />
            {projectId && <span className="mt-1 block"><ParticipantPicker projectId={projectId} selected={draft.participants ?? []} onChange={(participants) => setDraft({ ...draft, participants })} /></span>}
          </>
        }
        onSubmit={async (prompt, images) => {
          const command = prompt.match(/^\/([a-z0-9][a-z0-9_-]*)(?:\s+|$)/i);
          let taskPrompt = prompt;
          let skillIds: string[] | undefined;
          if (command) {
            const alias = command[1]?.toLocaleLowerCase();
            if (!alias) throw new Error('Comando de skill inválido.');
            if (alias === 'video') {
              const instruction = prompt.slice(command[0].length).trim();
              if (!instruction) throw new Error('Descreva a composição depois de /video.');
              void navigate(`/video?instruction=${encodeURIComponent(instruction)}&origin=chat&agent=${encodeURIComponent(mode)}`);
              return;
            }
            const skill = (skills.data ?? []).find((item) => item.valid && (item.name.toLocaleLowerCase() === alias || item.id.toLocaleLowerCase().split(/[:/\\]/).at(-1) === alias));
            if (!skill) throw new Error(`Skill “/${alias}” não encontrada. Habilite uma skill correspondente em Skills.`);
            const preference = (await window.neuralbridge.skills.settings()).preferences.find((item) => item.skillId === skill.id);
            if (!preference?.enabled) throw new Error(`Skill “${skill.name}” está desabilitada. Habilite-a em Skills antes de usá-la.`);
            taskPrompt = prompt.slice(command[0].length).trim();
            if (!taskPrompt) throw new Error(`Descreva a tarefa depois de /${alias}.`);
            skillIds = [skill.id];
          }
          const chosen = explicitAgent(mode) && model.trim() ? model.trim() : null;
          const { id } = await start.mutateAsync({ prompt: taskPrompt, projectId: projectId || null, mode, model: chosen, ...(skillIds ? { skillIds } : {}), ...(images.length ? { images } : {}), ...(draft.participants?.length ? { participants: draft.participants } : {}) });
          void navigate(`/chat?thread=${id}`);
        }}
      />
    </>
  );
}

function Thread({ id, layout }: { id: string; layout: ColumnLayout }) {
  const thread = useThread(id);
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => window.neuralbridge.skills.list(), staleTime: 30_000 });
  const resume = useResumeTask();
  const cancel = useCancelTask();
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [behind, setBehind] = useState(false);
  const tasks: TaskDetail[] = thread.data ?? [];
  const last = tasks.at(-1);

  // Follow new output only while the reader is at the end; otherwise offer a way back down.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !thread.dataUpdatedAt) return;
    if (pinned.current) element.scrollTop = element.scrollHeight;
    else setBehind(true);
  }, [thread.dataUpdatedAt]);

  const toEnd = () => {
    const element = scroller.current;
    if (!element) return;
    pinned.current = true;
    setBehind(false);
    element.scrollTo({ top: element.scrollHeight });
  };

  const running = last ? !FINAL_TASK_STATUSES.includes(last.status) : false;
  const name = tasks[0]?.threadTitle ?? tasks[0]?.prompt ?? 'Conversa';

  return (
    <>
      <ColumnHeader
        title={thread.isPending ? 'Carregando…' : name}
        layout={layout}
        meta={
          last && (
            <>
              <span className="hidden truncate md:inline">{last.projectName ?? 'Sem projeto'}</span>
              <span aria-hidden="true" className="hidden md:inline">
                ·
              </span>
              <span className="whitespace-nowrap">{MODE_SHORT[last.mode]}</span>
            </>
          )
        }
      />
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={(event) => {
            pinned.current = isNearBottom(event.currentTarget);
            if (pinned.current) setBehind(false);
          }}
          className="h-full overflow-x-hidden overflow-y-auto"
        >
          <div role="log" aria-label="Mensagens" className="mx-auto w-full max-w-3xl space-y-10 px-4 py-8 sm:px-6">
            {thread.error && (
              <p role="alert" className="text-destructive">
                {errorMessage(thread.error)}
              </p>
            )}
            {tasks.map((task) => (
              <TaskCard key={task.id} task={task} variant="chat" />
            ))}
            {last && <p className="text-center text-[11px] text-muted-foreground">Última atividade {formatWhen(last.finishedAt ?? last.startedAt ?? last.createdAt)}</p>}
          </div>
        </div>
        {behind && (
          <button
            type="button"
            onClick={toEnd}
            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-popover px-3 py-1.5 text-xs shadow-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowDown className="size-3.5" aria-hidden="true" />
            Ir para o fim
          </button>
        )}
      </div>
      {last && (
        <Composer
          placeholder={running ? 'A tarefa está em andamento. Pare-a para pedir outra coisa.' : 'Peça um ajuste, uma explicação ou o próximo passo.'}
          canSend
          pending={resume.isPending}
          running={running}
          stopping={cancel.isPending}
          onStop={() => cancel.mutate(last.id)}
          error={resume.error ?? cancel.error}
        skills={skills.data ?? []}
          controls={
            <>
              <span className={cn(chip, 'inline-flex max-w-[13rem] items-center truncate hover:bg-background')} title="O projeto vale para toda a conversa">
                {last.projectName ?? 'Sem projeto'}
              </span>
              <span className={cn(chip, 'inline-flex items-center gap-1.5 hover:bg-background')} title="O agente vale para toda a conversa">
                {explicitAgent(last.mode) && <span aria-hidden="true" className={cn('size-2 rounded-full', last.mode === 'claude' ? 'bg-agent-claude' : 'bg-agent-codex')} />}
                {MODE_SHORT[last.mode]}
              </span>
              {last.model && <span className={cn(chip, 'inline-flex items-center font-mono text-[11.5px] hover:bg-background')}>{last.model}</span>}
            </>
          }
          note={
            <>
              Continua no mesmo projeto, agente e modelo; cada agente retoma a própria sessão.
              <FullAccessNote projectId={last.projectId} />
            </>
          }
          onSubmit={async (prompt, images) => {
            pinned.current = true;
            return resume.mutateAsync({ id: last.id, prompt, ...(images.length ? { images } : {}) });
          }}
        />
      )}
    </>
  );
}

export function ChatPage() {
  useTaskUpdates();
  const [params] = useSearchParams();
  const thread = params.get('thread');
  const projectFromUrl = params.get('project') ?? '';
  const [historyCollapsed, setHistoryCollapsed] = usePersistentFlag(HISTORY_COLLAPSED_KEY);
  const [panelCollapsed, setPanelCollapsed] = usePersistentFlag(PANEL_COLLAPSED_KEY);
  // In a narrow window the panel floats over the chat and starts closed, whatever the wide layout remembers.
  const narrow = useNarrowWindow();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const panelOpen = narrow ? drawerOpen : !panelCollapsed;
  const setPanelOpen = (open: boolean) => (narrow ? setDrawerOpen(open) : setPanelCollapsed(!open));
  const [draft, setDraft] = useState<Draft>({ projectId: projectFromUrl, mode: 'auto', model: '' });
  const open = useThread(thread);
  const tasks = thread ? (open.data ?? []) : [];
  const last = tasks.at(-1);
  const subject: PanelSubject = last
    ? { tasks, projectId: last.projectId, mode: last.mode, model: last.model }
    : { tasks, projectId: thread ? null : draft.projectId || null, mode: thread ? 'auto' : draft.mode, model: !thread && explicitAgent(draft.mode) && draft.model.trim() ? draft.model.trim() : null };
  const layout: ColumnLayout = { historyCollapsed, onExpandHistory: () => setHistoryCollapsed(false), panelOpen, onOpenPanel: () => setPanelOpen(true) };

  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      <h1 className="sr-only">Chat</h1>
      {!historyCollapsed && <History current={thread} onCollapse={() => setHistoryCollapsed(true)} />}
      <section aria-label="Conversa" className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {thread ? <Thread key={thread} id={thread} layout={layout} /> : <NewConversation layout={layout} draft={draft} setDraft={setDraft} />}
      </section>
      {panelOpen && <SessionPanel subject={subject} overlay={narrow} onClose={() => setPanelOpen(false)} />}
    </div>
  );
}

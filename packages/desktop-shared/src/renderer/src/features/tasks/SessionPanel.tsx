import { useCallback, useEffect, useId, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ExternalLink, FileText, FolderOpen, Image, PanelRightClose, RefreshCw, Square, Video } from 'lucide-react';
import { Link } from 'react-router';
import type { AgentId, RunMode } from '@neuralbridge/shared/domain';
import { canOpenOutput, FINAL_TASK_STATUSES, type TaskDetail } from '@neuralbridge/shared/tasks';
import type { McpServerInfo } from '@neuralbridge/shared/channels';
import { HEALTH_LABEL, healthOf, useAgents } from '@/app/useAgents';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, formatWhen } from '@/features/brain/format';
import { useProject } from '@/features/projects/api';
import { usePersistentFlag } from '@/lib/use-persistent-flag';
import { cn } from '@/lib/utils';
import { useCancelTask, useTaskList } from './api';
import { AGENT_LABEL } from './labels';
import {
  changeSummary,
  elapsedLabel,
  sessionConnectors,
  sessionContext,
  sessionSkills,
  taskOutputs,
  type ChangeCounts,
  type OutputKind,
  type SkillRow,
  type SkillState,
} from './panel-model';
import { AgentDot, StatusBadge } from './TaskCard';

export const PANEL_COLLAPSED_KEY = 'nb.chat.panel.collapsed';
const PANEL_WIDTH_KEY = 'nb.chat.panel.width';
const WIDTH = { min: 260, max: 480, fallback: 320, step: 16 };
const MODE_SHORT: Record<RunMode, string> = { auto: 'Automático', claude: 'Claude Code', codex: 'Codex CLI', collab: 'Colaborativo' };
const PERMISSION_SHORT = { standard: 'Padrão', commands: 'Comandos liberados', full: 'Acesso total' } as const;

const iconButton =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';
const smallButton =
  'inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11.5px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

/** What the panel describes: the open conversation, or the choices for a new one. */
export interface PanelSubject {
  tasks: TaskDetail[];
  projectId: string | null;
  mode: RunMode;
  model: string | null;
}

// --- layout helpers ------------------------------------------------------------------------------

function readWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(value) && value >= WIDTH.min && value <= WIDTH.max ? value : WIDTH.fallback;
  } catch {
    return WIDTH.fallback;
  }
}

function usePanelWidth(): [number, (next: number) => void] {
  const [width, setWidth] = useState(readWidth);
  const update = useCallback((next: number) => {
    const clamped = Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, next)));
    setWidth(clamped);
    try {
      window.localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
    } catch {
      // Not persisted this time; the panel still resizes.
    }
  }, []);
  return [width, update];
}

/** Below this width the panel floats over the chat instead of taking its space. */
export function useNarrowWindow(): boolean {
  // Below 1440 px, beside the menu and the history, a fourth column would squeeze the chat.
  const query = '(max-width: 1439px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** A clock that ticks every second only while something is running. */
function useNow(ticking: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

function Section({ id, title, count, defaultOpen = true, children }: { id: string; title: string; count?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [collapsed, setCollapsed] = usePersistentFlag(`nb.chat.panel.section.${id}`, !defaultOpen);
  const bodyId = useId();
  return (
    <section aria-label={title} className="border-b border-border/60 last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[12.5px] font-medium outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <ChevronDown className={cn('size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none', collapsed && '-rotate-90')} aria-hidden="true" />
          <span className="flex-1">{title}</span>
          {count !== undefined && <span className="text-[11.5px] font-normal text-muted-foreground">{count}</span>}
        </button>
      </h3>
      {!collapsed && (
        <div id={bodyId} className="px-4 pb-3 text-[12.5px]">
          {children}
        </div>
      )}
    </section>
  );
}

function Row({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono text-[11.5px]')}>{children}</dd>
    </div>
  );
}

const Unavailable = ({ children = 'Indisponível' }: { children?: ReactNode }) => <span className="text-muted-foreground">{children}</span>;

const formatNumber = (value: number) => value.toLocaleString('pt-BR');

// --- sections ------------------------------------------------------------------------------------

function Environment({ subject }: { subject: PanelSubject }) {
  const { agents } = useAgents();
  const project = useProject(subject.projectId ?? '');
  const detail = subject.projectId ? project.data : null;
  const last = subject.tasks.at(-1);
  return (
    <dl>
      <Row label="Ambiente">Local (este computador)</Row>
      <Row label="Projeto">{last?.projectName ?? detail?.name ?? <Unavailable>Sem projeto</Unavailable>}</Row>
      {detail && (
        <>
          <Row label="Diretório" mono>
            <span title={detail.rootPath}>{detail.rootPath}</span>
          </Row>
          <Row label="Branch" mono>
            {detail.git?.isRepo ? (detail.git.branch ?? <Unavailable>sem branch (HEAD destacado)</Unavailable>) : <Unavailable>não é um repositório Git</Unavailable>}
          </Row>
          <Row label="Agente do projeto">{detail.preferredAgent === 'auto' ? 'Automático' : AGENT_LABEL[detail.preferredAgent]}</Row>
          <Row label="Permissões">
            <span className={cn(detail.permissionLevel === 'full' && 'text-warning')}>{PERMISSION_SHORT[detail.permissionLevel]}</span>
          </Row>
        </>
      )}
      {subject.projectId && project.error && <p className="text-destructive">{errorMessage(project.error)}</p>}
      <Row label="Agente">{MODE_SHORT[subject.mode]}</Row>
      <Row label="Modelo">{subject.model ? <span className="font-mono text-[11.5px]">{subject.model}</span> : <Unavailable>padrão do CLI</Unavailable>}</Row>
      <div className="mt-2 space-y-1">
        {agents === null ? (
          <p className="text-muted-foreground">Verificando agentes…</p>
        ) : (
          agents.map((agent) => {
            const health = healthOf(agent);
            return (
              <p key={agent.id} className="flex items-center gap-2" data-testid={`panel-agent-${agent.id}`}>
                <AgentDot agent={agent.id} />
                <span className="flex-1">{agent.label}</span>
                <span className={cn('text-[11.5px]', health === 'ready' ? 'text-primary' : health === 'attention' ? 'text-warning' : 'text-destructive')}>
                  {HEALTH_LABEL[health]}
                  {agent.version ? ` · ${agent.version}` : ''}
                </span>
              </p>
            );
          })
        )}
      </div>
    </dl>
  );
}

function ContextSection({ tasks }: { tasks: TaskDetail[] }) {
  if (!tasks.length) return <p className="text-muted-foreground">Aparece depois da primeira resposta.</p>;
  const { agents, totalTokens, budget, remaining } = sessionContext(tasks);
  return (
    <div className="space-y-3">
      {agents.map((entry) => (
        <div key={entry.agent} data-testid={`context-${entry.agent}`}>
          <p className="flex items-center gap-2 font-medium">
            <AgentDot agent={entry.agent} />
            {AGENT_LABEL[entry.agent]}
            {entry.percent !== null && <span className="ml-auto font-normal text-muted-foreground">{entry.percent.toLocaleString('pt-BR')}%</span>}
          </p>
          {entry.percent !== null && (
            <div
              role="meter"
              aria-label={`Uso da janela de contexto do ${AGENT_LABEL[entry.agent]}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={entry.percent}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <div className={cn('h-full rounded-full', entry.percent >= 85 ? 'bg-warning' : 'bg-primary')} style={{ width: `${Math.min(100, entry.percent)}%` }} />
            </div>
          )}
          <dl className="mt-1">
            <Row label="Na janela">{entry.usedTokens === null ? <Unavailable /> : `${formatNumber(entry.usedTokens)} tokens`}</Row>
            <Row label="Limite">{entry.windowTokens === null ? <Unavailable /> : `${formatNumber(entry.windowTokens)} tokens`}</Row>
          </dl>
          {entry.agent === 'codex' && entry.usedTokens === null && <p className="mt-1 text-[11.5px] text-muted-foreground">O Codex CLI não informa o uso da janela de contexto.</p>}
        </div>
      ))}
      <dl className="border-t border-border/60 pt-2">
        <Row label="Total gasto">{totalTokens === null ? <Unavailable /> : `${formatNumber(totalTokens)} tokens`}</Row>
        <Row label="Orçamento global">{budget === null ? <Unavailable>não informado</Unavailable> : `${formatNumber(budget)} tokens`}</Row>
        <Row label="Restante">{remaining === null ? <Unavailable /> : `${formatNumber(remaining)} tokens`}</Row>
      </dl>
      <p className="text-[11.5px] text-muted-foreground">“Na janela” é o que a última chamada ocupou do contexto; “Total gasto” soma entrada e saída de todas as execuções da conversa.</p>
    </div>
  );
}

const SERVER_STATUS: Record<McpServerInfo['status'], { label: string; tone: string }> = {
  connected: { label: 'Conectado', tone: 'text-primary' },
  failed: { label: 'Falha ao conectar', tone: 'text-destructive' },
  needs_auth: { label: 'Precisa de login', tone: 'text-warning' },
  disabled: { label: 'Desativado', tone: 'text-muted-foreground' },
  not_checked: { label: 'Ativado (conexão não verificada)', tone: 'text-muted-foreground' },
  unknown: { label: 'Estado desconhecido', tone: 'text-muted-foreground' },
};

function Expandable({ summary, children, testId }: { summary: ReactNode; children: ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <li data-testid={testId}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded px-1 py-1 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {summary}
        <ChevronDown className={cn('size-3 shrink-0 text-muted-foreground', !open && '-rotate-90')} aria-hidden="true" />
      </button>
      {open && (
        <div id={id} className="mb-1 ml-1 border-l border-border/70 py-1 pl-3 text-[12px]">
          {children}
        </div>
      )}
    </li>
  );
}

function Connectors({ tasks }: { tasks: TaskDetail[] }) {
  const used = sessionConnectors(tasks);
  const [refresh, setRefresh] = useState(0);
  const configured = useQuery({ queryKey: ['mcp', 'servers', refresh], queryFn: () => window.neuralbridge.mcp.servers(refresh > 0), staleTime: 5 * 60_000 });
  return (
    <div className="space-y-3">
      {used.length > 0 && (
        <div>
          <p className="mb-1 text-[11.5px] text-muted-foreground">Nesta conversa</p>
          <ul>
            {used.map((connector) => (
              <Expandable
                key={`${connector.agent}-${connector.name}`}
                testId={`session-connector-${connector.name}`}
                summary={
                  <>
                    <AgentDot agent={connector.agent} />
                    <span className="min-w-0 flex-1 truncate font-medium">{connector.name}</span>
                    <span className="text-[11.5px] text-muted-foreground">{connector.calls === 1 ? '1 chamada' : `${connector.calls} chamadas`}</span>
                  </>
                }
              >
                <dl>
                  <Row label="Agente">{AGENT_LABEL[connector.agent]}</Row>
                  <Row label="Na sessão">{connector.status ?? <Unavailable>não informado pelo CLI</Unavailable>}</Row>
                  <Row label="Ferramentas" mono>
                    {connector.tools.length ? connector.tools.join(', ') : <Unavailable>nenhuma chamada</Unavailable>}
                  </Row>
                </dl>
              </Expandable>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[11.5px] text-muted-foreground">Configurados nos CLIs</p>
          <button type="button" className={smallButton} onClick={() => setRefresh(refresh + 1)} disabled={configured.isFetching}>
            <RefreshCw className={cn('size-3', configured.isFetching && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />
            Verificar
          </button>
        </div>
        {configured.isPending && <p className="text-muted-foreground">Consultando os CLIs…</p>}
        {configured.error && <p className="text-destructive">{errorMessage(configured.error)}</p>}
        {configured.data?.clients.map((client) => (
          <div key={client.id} className="mb-2">
            <p className="flex items-center gap-2 text-[11.5px] font-medium">
              <AgentDot agent={client.id} />
              {AGENT_LABEL[client.id]}
            </p>
            {!client.installed && <p className="text-muted-foreground">CLI não instalado.</p>}
            {client.error && <p className="text-destructive">Não foi possível listar: {client.error}</p>}
            {client.installed && !client.error && client.servers.length === 0 && <p className="text-muted-foreground">Nenhum servidor MCP configurado.</p>}
            <ul>
              {client.servers.map((server) => (
                <Expandable
                  key={server.name}
                  testId={`mcp-${client.id}-${server.name}`}
                  summary={
                    <>
                      <span className="min-w-0 flex-1 truncate">{server.name}</span>
                      <span className={cn('text-[11px]', SERVER_STATUS[server.status].tone)}>{SERVER_STATUS[server.status].label}</span>
                    </>
                  }
                >
                  <dl>
                    <Row label="Transporte">{server.transport ?? <Unavailable />}</Row>
                    {server.detail && <Row label="Detalhe">{server.detail}</Row>}
                  </dl>
                </Expandable>
              ))}
            </ul>
          </div>
        ))}
        {configured.data && (
          <p className="text-[11.5px] text-muted-foreground">
            Verificado {formatWhen(configured.data.checkedAt)}. O Claude Code inicia cada servidor para checar a conexão; o Codex só lista. Para registrar o Singularity, use{' '}
            <Link to="/mcp" className="underline underline-offset-2">
              MCP
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}

const SKILL_STATE: Record<SkillState, { label: string; tone: string; hint: string }> = {
  used: { label: 'Utilizada', tone: 'bg-primary/15 text-primary', hint: 'O agente invocou a skill e a chamada foi concluída.' },
  failed: { label: 'Falha', tone: 'bg-destructive/15 text-destructive', hint: 'A invocação da skill retornou erro.' },
  loaded: { label: 'Carregada', tone: 'border border-border text-foreground', hint: 'O conteúdo da skill chegou ao agente; não prova que as instruções foram aplicadas.' },
  available: { label: 'Disponível', tone: 'bg-muted text-muted-foreground', hint: 'Instalada e acessível ao agente, sem sinal de uso.' },
  unknown: { label: 'Indisponível', tone: 'border border-dashed border-border text-muted-foreground', hint: 'Instalada, mas o CLI deste agente não informa quando usa uma skill.' },
};

function SkillBadge({ state }: { state: SkillState }) {
  return (
    <Tooltip label={SKILL_STATE[state].hint} side="left">
      <span className={cn('rounded px-1.5 py-0.5 text-[10.5px] font-medium', SKILL_STATE[state].tone)}>{SKILL_STATE[state].label}</span>
    </Tooltip>
  );
}

function Skills({ tasks, mountedAt }: { tasks: TaskDetail[]; mountedAt: number }) {
  const installed = useQuery({ queryKey: ['skills'], queryFn: () => window.neuralbridge.skills.list(), staleTime: 30_000 });
  const [showAvailable, setShowAvailable] = useState(false);
  if (!tasks.length) return <p className="text-muted-foreground">As skills que os agentes usarem nesta conversa aparecem aqui.</p>;
  const view = sessionSkills(tasks, installed.data ?? []);
  const taskOf = (row: SkillRow) => tasks.find((task) => task.id === row.taskId);
  return (
    <div className="space-y-2">
      {view.active.length === 0 && <p className="text-muted-foreground">Nenhuma skill foi carregada ou usada nesta conversa.</p>}
      <ul>
        {view.active.map((row) => {
          const fresh = row.lastAt !== null && new Date(row.lastAt).getTime() > mountedAt;
          const run = taskOf(row);
          return (
            <Expandable
              // Remounts when new evidence arrives, so a fresh activation flashes once.
              key={`${row.agent}-${row.name}-${row.lastAt ?? ''}`}
              testId={`skill-${row.name}`}
              summary={
                <span className={cn('flex min-w-0 flex-1 items-center gap-2 rounded', fresh && 'animate-[nb-flash_1.6s_ease-out] motion-reduce:animate-none')}>
                  <AgentDot agent={row.agent} />
                  <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                  {row.activations > 1 && <span className="text-[11px] text-muted-foreground">{row.activations}×</span>}
                  <SkillBadge state={row.state} />
                </span>
              }
            >
              <dl>
                {row.listing?.description && <p className="mb-1 text-muted-foreground">{row.listing.description}</p>}
                <Row label="Agente">{AGENT_LABEL[row.agent]}</Row>
                <Row label="Origem">{row.listing ? row.listing.source : <Unavailable>não encontrada no Skills Manager</Unavailable>}</Row>
                <Row label="Ativações">{row.activations}</Row>
                {row.failures > 0 && <Row label="Falhas">{row.failures}</Row>}
                <Row label="Última">{row.lastAt ? formatWhen(row.lastAt) : <Unavailable />}</Row>
                {run && (
                  <Row label="Execução">
                    <Link to={`/runs/${run.id}`} className="underline underline-offset-2">
                      {run.prompt.slice(0, 60)}
                      {run.prompt.length > 60 ? '…' : ''}
                    </Link>
                  </Row>
                )}
                {row.evidence && (
                  <Row label="Evidência" mono>
                    {row.evidence}
                  </Row>
                )}
                {row.listing && (
                  <Row label="SKILL.md" mono>
                    <span title={row.listing.path}>{row.listing.path}</span>
                  </Row>
                )}
              </dl>
              <Link to="/skills" className={cn(smallButton, 'mt-1 -ml-1.5')}>
                <ExternalLink className="size-3" aria-hidden="true" />
                Abrir no Skills Manager
              </Link>
            </Expandable>
          );
        })}
      </ul>
      {view.unobservable.includes('codex') && (
        <p className="text-[11.5px] text-muted-foreground">O Codex CLI não informa quando usa uma skill: só a leitura de um SKILL.md aparece, como Carregada.</p>
      )}
      {view.available.length > 0 && (
        <div>
          <button type="button" aria-expanded={showAvailable} onClick={() => setShowAvailable(!showAvailable)} className={cn(smallButton, '-ml-1.5')}>
            <ChevronDown className={cn('size-3', !showAvailable && '-rotate-90')} aria-hidden="true" />
            {view.available.length} sem uso registrado
          </button>
          {showAvailable && (
            <ul className="mt-1 space-y-0.5" aria-label="Skills disponíveis">
              {view.available.map((row) => (
                <li key={`${row.agent}-${row.name}`} className="flex items-center gap-2 px-1" data-testid={`available-skill-${row.name}`}>
                  <AgentDot agent={row.agent} />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={row.listing?.description ?? row.name}>
                    {row.name}
                  </span>
                  <SkillBadge state={row.state} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const KIND_ICON: Record<OutputKind, typeof FileText> = { markdown: FileText, code: FileText, report: FileText, image: Image, video: Video, other: FileText };
const KIND_LABEL: Record<OutputKind, string> = { markdown: 'Markdown', code: 'Código', report: 'Relatório', image: 'Imagem', video: 'Vídeo', other: 'Outro' };

function Outputs({ tasks, root }: { tasks: TaskDetail[]; root: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const runs = [...tasks].reverse().map((task) => ({ task, files: taskOutputs(task, root) })).filter((entry) => entry.files.length > 0);
  if (!runs.length) return <p className="text-muted-foreground">Nenhum arquivo foi criado ou alterado pelos agentes nesta conversa.</p>;
  const act = (taskId: string, path: string, action: 'open' | 'reveal') => {
    setError(null);
    window.neuralbridge.tasks.outputFile(taskId, path, action).catch((failure: unknown) => setError(errorMessage(failure)));
  };
  return (
    <div className="space-y-3">
      {runs.map(({ task, files }, index) => (
        <div key={task.id}>
          <p className="mb-1 truncate text-[11.5px] text-muted-foreground" title={task.prompt}>
            {index === 0 ? 'Última execução' : 'Execução anterior'} · {task.prompt}
          </p>
          <ul className="space-y-0.5">
            {files.map((file) => {
              const Icon = KIND_ICON[file.kind];
              return (
                <li key={file.path} className="group flex items-center gap-1.5" data-testid="output-file">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label={KIND_LABEL[file.kind]} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]" title={`${file.path} (${file.change})`}>
                    {file.path}
                  </span>
                  {task.projectId && (
                    <>
                      {canOpenOutput(file.path) && (
                        <Tooltip label="Abrir" side="top">
                          <button type="button" aria-label={`Abrir ${file.path}`} className={iconButton} onClick={() => act(task.id, file.path, 'open')}>
                            <ExternalLink className="size-3.5" aria-hidden="true" />
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip label="Mostrar na pasta" side="top">
                        <button type="button" aria-label={`Mostrar ${file.path} na pasta`} className={iconButton} onClick={() => act(task.id, file.path, 'reveal')}>
                          <FolderOpen className="size-3.5" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <p className="text-[11.5px] text-muted-foreground">Só arquivos que os agentes informaram ter alterado.</p>
    </div>
  );
}

function Counts({ label, counts, testId }: { label: string; counts: ChangeCounts; testId: string }) {
  return (
    <div data-testid={testId}>
      <p className="text-[11.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
        <span>{counts.files === 1 ? '1 arquivo' : `${counts.files} arquivos`}</span>
        <span className="text-primary">+{counts.added}</span>
        <span className="text-destructive">−{counts.removed}</span>
        <span>{counts.created} novos</span>
        <span>{counts.deleted} excluídos</span>
      </p>
    </div>
  );
}

function Changes({ subject }: { subject: PanelSubject }) {
  const projectId = subject.projectId ?? '';
  const project = useProject(projectId);
  const lines = useQuery({ queryKey: ['projects', 'lines', projectId], queryFn: () => window.neuralbridge.projects.lineStats(projectId), enabled: projectId !== '' });
  if (!subject.projectId) return <p className="text-muted-foreground">Sem projeto, os agentes não alteram arquivos.</p>;
  const git = project.data?.git;
  if (project.isPending) return <p className="text-muted-foreground">Lendo o Git…</p>;
  if (!git?.isRepo) return <p className="text-muted-foreground">A pasta do projeto não é um repositório Git.</p>;
  const last = subject.tasks.at(-1);
  const runPaths = last ? taskOutputs(last, project.data?.rootPath ?? null).map((file) => file.path) : [];
  const summary = changeSummary(git.changes, lines.data ?? [], runPaths);
  return (
    <div className="space-y-2">
      <Counts label="Repositório inteiro (estado atual)" counts={summary.repository} testId="changes-repository" />
      {last && <Counts label="Arquivos da última execução" counts={summary.run} testId="changes-run" />}
      {lines.error && <p className="text-destructive">{errorMessage(lines.error)}</p>}
      <p className="text-[11.5px] text-muted-foreground">Linhas contam só arquivos já versionados; arquivos novos entram como novos.</p>
      <Link to={`/projects/${subject.projectId}`} className={cn(smallButton, '-ml-1.5')}>
        <ExternalLink className="size-3" aria-hidden="true" />
        Ver diff no projeto
      </Link>
    </div>
  );
}

function BackgroundTasks() {
  const list = useTaskList({ limit: 30 });
  const cancel = useCancelTask();
  const tasks = list.data ?? [];
  const active = tasks.filter((task) => !FINAL_TASK_STATUSES.includes(task.status));
  const finished = tasks.filter((task) => FINAL_TASK_STATUSES.includes(task.status)).slice(0, 5);
  const now = useNow(active.length > 0);
  const item = (task: (typeof tasks)[number]) => (
    <li key={task.id} className="flex items-start gap-2 py-1" data-testid="background-task">
      <span className="mt-1 flex shrink-0 gap-0.5">
        {task.agents.map((agent: AgentId) => (
          <AgentDot key={agent} agent={agent} />
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <Link to={`/runs/${task.id}`} className="block truncate outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={task.prompt}>
          {task.prompt}
        </Link>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
          <StatusBadge status={task.status} />
          {elapsedLabel(task.startedAt, task.finishedAt, now)}
        </span>
      </span>
      {!FINAL_TASK_STATUSES.includes(task.status) && (
        <Tooltip label="Cancelar tarefa" side="left">
          <button type="button" aria-label={`Cancelar “${task.prompt.slice(0, 40)}”`} className={iconButton} disabled={cancel.isPending} onClick={() => cancel.mutate(task.id)}>
            <Square className="size-3 fill-current" aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </li>
  );
  return (
    <div>
      {list.error && <p className="text-destructive">{errorMessage(list.error)}</p>}
      {active.length === 0 ? <p className="text-muted-foreground">Nenhuma tarefa em andamento.</p> : <ul>{active.map(item)}</ul>}
      {finished.length > 0 && (
        <>
          <p className="mt-2 text-[11.5px] text-muted-foreground">Recentes</p>
          <ul>{finished.map(item)}</ul>
        </>
      )}
      {cancel.error && <p className="text-destructive">{errorMessage(cancel.error)}</p>}
    </div>
  );
}

// --- panel ---------------------------------------------------------------------------------------

export function SessionPanel({ subject, overlay, onClose }: { subject: PanelSubject; overlay: boolean; onClose: () => void }) {
  const [width, setWidth] = usePanelWidth();
  const [mountedAt] = useState(() => Date.now());
  const project = useProject(subject.projectId ?? '');
  const root = subject.projectId ? (project.data?.rootPath ?? null) : null;
  const running = subject.tasks.some((task) => !FINAL_TASK_STATUSES.includes(task.status));
  const usedSkills = subject.tasks.length ? sessionSkills(subject.tasks, []).active.filter((row) => row.state === 'used').length : 0;
  const latest = subject.tasks.at(-1);
  const latestEvent = latest?.events.at(-1);
  const eventLabel = latestEvent ? ({ text: 'Mensagem do agente', tool: 'Ferramenta', file_change: 'Arquivo alterado', error: 'Erro', permission_denied: 'Permissão negada', routed: 'Roteamento', retry: 'Retry', fallback: 'Fallback', checkpoint: 'Checkpoint' } as Record<string, string>)[latestEvent.kind] ?? latestEvent.kind : null;

  useEffect(() => {
    if (!overlay) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlay, onClose]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) => setWidth(startWidth + (startX - moveEvent.clientX));
    const stop = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', stop);
      target.removeEventListener('pointercancel', stop);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', stop);
    target.addEventListener('pointercancel', stop);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setWidth(width + WIDTH.step);
    else if (event.key === 'ArrowRight') setWidth(width - WIDTH.step);
    else return;
    event.preventDefault();
  };

  return (
    <>
      {overlay && <div aria-hidden="true" className="absolute inset-0 z-20 bg-background/40" onClick={onClose} />}
      <aside
        data-tour="chat-context"
        aria-label="Contexto e execução"
        data-testid="session-panel"
        style={{ width }}
        className={cn('relative flex shrink-0 flex-col border-l border-border/70 bg-sidebar/40', overlay && 'absolute top-0 right-0 bottom-0 z-30 bg-background shadow-xl')}
      >
        {!overlay && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Largura do painel"
            aria-valuemin={WIDTH.min}
            aria-valuemax={WIDTH.max}
            aria-valuenow={width}
            tabIndex={0}
            onPointerDown={startDrag}
            onKeyDown={resizeByKey}
            className="absolute top-0 bottom-0 -left-1 z-10 w-2 cursor-col-resize outline-none hover:bg-ring/30 focus-visible:bg-ring/50"
          />
        )}
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-3">
          <h2 className="flex items-center gap-2 text-[13px] font-medium">
            Contexto e execução
            {running && <span className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" aria-label="Em execução" />}
          </h2>
          <Tooltip label="Recolher painel" side="bottom">
            <button type="button" aria-label="Recolher painel" aria-expanded="true" className={iconButton} onClick={onClose}>
              <PanelRightClose className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <section aria-label="Execução atual" className="border-b border-border/60 bg-card/40 px-4 py-3">
            <div className="flex items-start gap-2"><Activity className={cn('mt-0.5 size-4 shrink-0', running ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Execução atual</p>{latest ? <><p className="mt-1 truncate text-sm font-medium" title={latest.prompt}>{latest.prompt}</p><div className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge status={latest.status} live />{latest.agents.map((agent) => <span key={agent} className="inline-flex items-center gap-1 text-xs text-muted-foreground"><AgentDot agent={agent} />{AGENT_LABEL[agent]}</span>)}</div>{eventLabel && <p className="mt-2 truncate text-xs text-muted-foreground">Última atividade: {eventLabel} · {formatWhen(latestEvent?.at ?? latest.finishedAt ?? latest.createdAt)}</p>}</> : <p className="mt-1 text-xs text-muted-foreground">Selecione uma execução para acompanhar seus eventos.</p>}</div></div>
          </section>
          <Section id="environment" title="Ambiente">
            <Environment subject={subject} />
          </Section>
          <Section id="context" title="Contexto">
            <ContextSection tasks={subject.tasks} />
          </Section>
          <Section id="connectors" title="Conectores" defaultOpen={false}>
            <Connectors tasks={subject.tasks} />
          </Section>
          <Section id="skills" title="Skills" count={usedSkills ? `${usedSkills} ${usedSkills === 1 ? 'utilizada' : 'utilizadas'}` : undefined}>
            <Skills tasks={subject.tasks} mountedAt={mountedAt} />
          </Section>
          <Section id="outputs" title="Saídas">
            <Outputs tasks={subject.tasks} root={root} />
          </Section>
          <Section id="changes" title="Alterações">
            <Changes subject={subject} />
          </Section>
          <Section id="tasks" title="Tarefas em segundo plano">
            <BackgroundTasks />
          </Section>
        </div>
      </aside>
    </>
  );
}

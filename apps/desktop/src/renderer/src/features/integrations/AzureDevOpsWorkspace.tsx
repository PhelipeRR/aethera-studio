import { useCallback, useEffect, useMemo, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStartTask } from '@/features/tasks/api';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { AzureDevOpsSprintBoard } from './AzureDevOpsSprintBoard';
import { AzureDevOpsDiffPanel } from './AzureDevOpsDiffPanel';

const INPUT = 'mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
type View = 'prs' | 'boards' | 'sprints' | 'tasks';
const STATUS: Record<string, { label: string; tone: string }> = {
  connected: { label: 'Conectado', tone: 'border-success/40 bg-success/10 text-success' },
  login_required: { label: 'Login necessário', tone: 'border-warning/40 bg-warning/10 text-warning' },
  disconnected: { label: 'Não configurado', tone: 'border-muted bg-muted text-muted-foreground' },
  unavailable: { label: 'Indisponível', tone: 'border-destructive/40 bg-destructive/10 text-destructive' },
};

export function AzureDevOpsWorkspace() {
  const api = window.neuralbridge.azureDevOps;
  const startTask = useStartTask();
  const [connectionId, setConnectionId] = useState<string | null>(() => localStorage.getItem('azure-devops-connection-id'));
  const [status, setStatus] = useState('disconnected');
  const [baseUrl, setBaseUrl] = useState('https://tfs.hepta.com.br/tfs');
  const [collection, setCollection] = useState('CONFEA');
  const [project, setProject] = useState('Sistema Unificado');
  const [repo, setRepo] = useState(() => localStorage.getItem('azure-devops-repository-id') ?? '');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [repositories, setRepositories] = useState<Array<{ id: string; name: string; projectId: string | null; projectName: string | null }>>([]);
  const [prs, setPrs] = useState<Array<{ id: number; title: string; status: string; sourceRef: string; targetRef: string }>>([]);
  const [boards, setBoards] = useState<Array<{ id: string; name: string; url: string | null }>>([]);
  const [iterations, setIterations] = useState<Array<{ id: string; name: string; path: string | null; startDate: string | null; finishDate: string | null; state: string | null }>>([]);
  const [selectedIterationId, setSelectedIterationId] = useState('');
  const [tasks, setTasks] = useState<Array<{ id: number; title: string; description: string | null; state: string; type: string; assignedTo: string | null; parentId: number | null; url: string | null }>>([]);
  const [backlogType, setBacklogType] = useState<string | null>(null);
  const [backlogItems, setBacklogItems] = useState<Array<{ id: number; title: string; description: string | null; state: string; type: string; assignedTo: string | null; parentId: number | null; url: string | null }>>([]);
  const [selectedPr, setSelectedPr] = useState<{ id: number; title: string; description: string | null; mergeStatus: string | null; reviewers: string[] } | null>(null);
  const [threads, setThreads] = useState<Array<{ id: number; status: string; comments: Array<{ id: number; author: string | null; content: string; publishedAt: string | null }> }>>([]);
  const [changes, setChanges] = useState<Array<{ path: string; changeType: string; objectId: string | null; url: string | null; content: string | null; baseContent: string | null; targetContent: string | null }>>([]);
  const [reviewTab, setReviewTab] = useState<'overview' | 'files' | 'updates' | 'commits'>('overview');
  const [aiTaskId, setAiTaskId] = useState<string | null>(null);
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<'claude' | 'codex'>('claude');
  const [showDiff, setShowDiff] = useState(false);
  const [taskIds, setTaskIds] = useState('');
  const [view, setView] = useState<View>('prs');
  const [prStatus, setPrStatus] = useState<'active' | 'completed' | 'abandoned'>('active');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const statusView = STATUS[status] ?? { label: 'Indisponível', tone: 'border-destructive/40 bg-destructive/10 text-destructive' };
  const activeProject = useMemo(() => projects.find((item) => item.name === project) ?? projects[0], [projects, project]);

  const refresh = useCallback(async (id: string) => {
    setBusy(true); setMessage(null);
    try {
      const [connection, listedProjects, listedRepositories] = await Promise.all([api.azureDevOpsConnectionStatus(id), api.azureDevOpsProjects(id), api.azureDevOpsRepositories(id)]);
      setStatus(connection?.status ?? 'disconnected');
      if (connection) { setBaseUrl(connection.baseUrl); setCollection(connection.collection); setProject(connection.project); }
      setProjects(listedProjects);
      setRepositories(listedRepositories);
      const selectedRepo = listedRepositories.find((item) => item.id === repo) ?? listedRepositories.find((item) => item.projectName === project) ?? listedRepositories[0];
      if (selectedRepo && selectedRepo.id !== repo) { setRepo(selectedRepo.id); localStorage.setItem('azure-devops-repository-id', selectedRepo.id); }
      if (selectedRepo) setPrs(await api.azureDevOpsPullRequests({ id, repositoryId: selectedRepo.id }));
    } catch (error) { setStatus('login_required'); setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }, [api, project, repo]);
  useEffect(() => { if (!connectionId) return; const timer = window.setTimeout(() => { void refresh(connectionId); }, 0); return () => window.clearTimeout(timer); }, [connectionId, refresh]);
  useEffect(() => { const onSaved = (event: Event) => setConnectionId((event as CustomEvent<string>).detail); window.addEventListener('azure-devops-connection-saved', onSaved); return () => window.removeEventListener('azure-devops-connection-saved', onSaved); }, []);
  useEffect(() => {
    if (!aiTaskId) return;
    let active = true;
    const poll = async () => {
      try {
        const task = await window.neuralbridge.tasks.get(aiTaskId);
        if (!active) return;
        const text = task.events.map((event) => {
          const data = event.data as Record<string, unknown>;
          return typeof data.text === 'string' ? data.text : typeof data.output === 'string' ? data.output : '';
        }).filter(Boolean).join('\n');
        setAiAnswer(task.status === 'completed' ? task.summary || text || 'A análise terminou sem texto retornado.' : text || `Análise em andamento (${task.status})…`);
        if (!['completed', 'failed', 'cancelled'].includes(task.status)) window.setTimeout(() => { void poll(); }, 1000);
        else if (task.error) setAiAnswer(`A análise falhou: ${task.error}`);
      } catch (error) { if (active) setAiAnswer(errorMessage(error)); }
    };
    void poll();
    return () => { active = false; };
  }, [aiTaskId, api]);

  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await api.azureDevOpsConnectionSave({ baseUrl, collection, project, readOnly: false });
      setConnectionId(result.id); localStorage.setItem('azure-devops-connection-id', result.id); setStatus(result.status); setMessage('Conexão salva em modo somente leitura.');
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  };
  const loadView = async (next: View, statusFilter = prStatus) => {
    if (!connectionId) return;
    setView(next); setBusy(true); setMessage(null);
    try {
      if (next === 'prs' && repo.trim()) setPrs(await api.azureDevOpsPullRequests({ id: connectionId, repositoryId: repo.trim(), status: statusFilter }));
      if (next === 'boards') { const [boardList, sprintList] = await Promise.all([api.azureDevOpsBoards(connectionId), api.azureDevOpsIterations(connectionId)]); setBoards(boardList); setIterations(sprintList); const current = sprintList.find((item) => item.state?.toLowerCase() === 'current') ?? sprintList[0]; if (current) { setSelectedIterationId(current.id); setBacklogType('User Story'); setBacklogItems(await api.azureDevOpsQueryWorkItems({ id: connectionId, type: 'User Story', iterationPath: current.path ?? current.name })); } }
      if (next === 'sprints') setIterations(await api.azureDevOpsIterations(connectionId));
      if (next === 'tasks') { const ids = taskIds.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0); if (ids.length) setTasks(await api.azureDevOpsWorkItems({ id: connectionId, ids })); }
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!connectionId || !repo.trim() || view !== 'prs') return;
    let active = true;
    void api.azureDevOpsPullRequests({ id: connectionId, repositoryId: repo.trim(), status: prStatus }).then((items) => { if (active) setPrs(items); }).catch((error) => { if (active) setMessage(errorMessage(error)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [api, connectionId, repo, view, prStatus]);
  const openReview = async (pullRequestId: number) => {
    if (!connectionId || !repo.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const [detail, reviewThreads, reviewChanges] = await Promise.all([api.azureDevOpsPullRequestDetail({ id: connectionId, repositoryId: repo.trim(), pullRequestId }), api.azureDevOpsPullRequestThreads({ id: connectionId, repositoryId: repo.trim(), pullRequestId }), api.azureDevOpsPullRequestChanges({ id: connectionId, repositoryId: repo.trim(), pullRequestId })]);
      setSelectedPr(detail); setThreads(reviewThreads); setChanges(reviewChanges); setReviewTab('overview'); setAiTaskId(null); setAiAnswer(null); setShowDiff(false);
    } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); }
  };
  const analyzeReview = async () => {
    if (!selectedPr) return;
    const diffChanges = changes.filter((change) => change.content?.trim());
    if (!diffChanges.length) {
      setAiAnswer('Não foi possível iniciar uma revisão confiável: o TFS não retornou o diff dos arquivos desta PR. Verifique a autenticação e abra novamente a revisão.');
      return;
    }
    const prompt = [`Faça uma revisão técnica desta Pull Request do Azure DevOps/TFS. Não altere arquivos nem publique comentários. Entregue: resumo, riscos/regressões, bugs prováveis, pontos de segurança, testes faltantes e comentários sugeridos com arquivo/linha quando possível. Baseie suas conclusões nos dados e no diff abaixo; não invente arquivos ou alterações ausentes.`, `PR #${selectedPr.id}: ${selectedPr.title}`, `Descrição: ${selectedPr.description || 'Sem descrição.'}`, `Merge: ${selectedPr.mergeStatus ?? 'não informado'}`, `Revisores: ${selectedPr.reviewers.join(', ') || 'nenhum'}`, `Diff dos arquivos alterados:\n${diffChanges.map((change) => `### ${change.path} (${change.changeType})\n--- ANTES ---\n${change.baseContent ?? '(não disponível)'}\n+++ DEPOIS +++\n${change.targetContent ?? change.content ?? '(não disponível)'}`).join('\n\n')}`, changes.length > diffChanges.length ? `Arquivos sem conteúdo de diff: ${changes.length - diffChanges.length}` : '', `Discussões existentes:\n${threads.flatMap((thread) => thread.comments.map((comment) => `- ${comment.author ?? 'autor'}: ${comment.content}`)).join('\n') || '- nenhuma'}`].filter(Boolean).join('\n\n').slice(0, 19_500);
    setAiAnswer('Iniciando análise…');
    try { const { id } = await startTask.mutateAsync({ prompt, projectId: null, mode: aiProvider, access: 'read-only', model: null }); setAiTaskId(id); } catch (error) { setAiAnswer(`${aiProvider === 'claude' ? 'Claude' : 'Codex'} não conseguiu iniciar a análise: ${errorMessage(error)}`); }
  };
  const loadBacklog = async (type: string, iterationId = selectedIterationId) => { if (!connectionId) return; setBacklogType(type); setBusy(true); setMessage(null); try { const iteration = iterations.find((item) => item.id === iterationId); setBacklogItems(await api.azureDevOpsQueryWorkItems({ id: connectionId, type, iterationPath: iteration?.path ?? iteration?.name ?? null })); } catch (error) { setMessage(errorMessage(error)); } finally { setBusy(false); } };
  return <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6" aria-label="Área de trabalho Azure DevOps">
    <section className="sg-panel rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Workspace conectado</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">{project || 'Azure DevOps / TFS'}</h2><p className="mt-1 text-sm text-muted-foreground">Projetos, Pull Requests, boards e sprint em um só lugar.</p></div><span className={`rounded-full border px-3 py-1 text-sm font-medium ${statusView.tone}`} role="status">{statusView.label}</span></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Projetos visíveis</p><p className="mt-1 text-xl font-semibold">{projects.length}</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Pull Requests carregadas</p><p className="mt-1 text-xl font-semibold">{prs.length}</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Contexto atual</p><p className="mt-1 truncate text-sm font-medium">{activeProject?.name ?? project}</p></div></div>
      {projects.length > 0 && <ul aria-label="Projetos do TFS" className="mt-4 flex flex-wrap gap-2">{projects.map((item) => <li key={item.id} className={`rounded-full border px-3 py-1 text-xs ${item.name === project ? 'border-primary/50 bg-primary/10 text-primary' : 'text-muted-foreground'}`}>{item.name}</li>)}</ul>}
      <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => connectionId ? void refresh(connectionId) : void save()} disabled={busy}>{busy ? 'Atualizando…' : connectionId ? 'Atualizar dados' : 'Conectar TFS'}</Button>{connectionId && <Button variant="outline" onClick={() => void api.azureDevOpsOpenBrowser(connectionId)}>Abrir TFS para login</Button>}</div>
      <details className="mt-4 rounded-lg border bg-background/50 p-3" open={!connectionId}><summary className="cursor-pointer text-sm font-medium">{connectionId ? 'Alterar conexão' : 'Configurar conexão'}</summary><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="text-sm font-medium sm:col-span-3">URL do TFS<input aria-label="URL do TFS" className={INPUT} value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label><label className="text-sm font-medium">Collection<input aria-label="Collection do TFS" className={INPUT} value={collection} onChange={(event) => setCollection(event.target.value)} /></label><label className="text-sm font-medium sm:col-span-2">Projeto<input aria-label="Projeto do TFS" className={INPUT} value={project} onChange={(event) => setProject(event.target.value)} /></label></div><Button className="mt-3" variant="outline" onClick={() => void save()} disabled={busy || !baseUrl || !collection || !project}>Salvar conexão</Button></details>
      {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
    </section>
    <section className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="sg-panel rounded-xl p-3"><p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Navegação</p>{(['prs', 'boards', 'sprints', 'tasks'] as const).map((item) => <button key={item} type="button" onClick={() => void loadView(item)} className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 text-left text-sm transition-colors ${view === item ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}><span>{item === 'prs' ? 'Pull Requests' : item === 'boards' ? 'Boards' : item === 'sprints' ? 'Sprints' : 'Tasks'}</span><span className="text-xs">{item === 'prs' ? prs.length : item === 'boards' ? boards.length : item === 'sprints' ? iterations.length : tasks.length}</span></button>)}</aside>
      <section className="min-w-0 sg-panel rounded-xl p-5" aria-label={view === 'prs' ? 'Pull Requests' : view === 'boards' ? 'Boards' : view === 'sprints' ? 'Sprints' : 'Tasks'}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{view === 'prs' ? 'Pull Requests' : view === 'boards' ? 'Boards' : view === 'sprints' ? 'Sprints' : 'Tasks'}</h3><p className="mt-1 text-sm text-muted-foreground">{view === 'prs' ? 'Revise o que está ativo, concluído ou aguardando sua atenção.' : 'Dados carregados da conexão atual.'}</p></div>{view === 'prs' && <div className="flex flex-wrap gap-2"><select aria-label="Repositório TFS" className="h-9 min-w-56 rounded-md border bg-background px-3 text-sm" value={repo} onChange={(event) => { setRepo(event.target.value); localStorage.setItem('azure-devops-repository-id', event.target.value); }} disabled={!repositories.length}><option value="">{repositories.length ? 'Selecione um repositório' : 'Nenhum repositório carregado'}</option>{repositories.map((item) => <option key={item.id} value={item.id}>{item.name}{item.projectName ? ` · ${item.projectName}` : ''}</option>)}</select><Button variant="outline" onClick={() => void loadView('prs')} disabled={busy || !repo.trim()}>Carregar PRs</Button></div>}{view === 'tasks' && <div className="flex gap-2"><input aria-label="IDs das tasks" className="w-44 rounded-md border bg-background px-3 py-2 text-sm" value={taskIds} onChange={(event) => setTaskIds(event.target.value)} placeholder="42, 43" /><Button variant="outline" onClick={() => void loadView('tasks')} disabled={busy || !taskIds.trim()}>Carregar</Button></div>}</div>
        {view === 'prs' && <div className="mt-5 overflow-x-auto"><div className="mb-3 flex gap-5 border-b text-sm" role="tablist" aria-label="Status das Pull Requests"><button type="button" role="tab" aria-selected={prStatus === 'active'} onClick={() => { setPrStatus('active'); void loadView('prs', 'active'); }} className={prStatus === 'active' ? 'border-b-2 border-primary pb-2 font-medium' : 'pb-2 text-muted-foreground hover:text-foreground'}>Minhas / Ativas</button><button type="button" role="tab" aria-selected={prStatus === 'completed'} onClick={() => { setPrStatus('completed'); void loadView('prs', 'completed'); }} className={prStatus === 'completed' ? 'border-b-2 border-primary pb-2 font-medium' : 'pb-2 text-muted-foreground hover:text-foreground'}>Concluídas</button><button type="button" role="tab" aria-selected={prStatus === 'abandoned'} onClick={() => { setPrStatus('abandoned'); void loadView('prs', 'abandoned'); }} className={prStatus === 'abandoned' ? 'border-b-2 border-primary pb-2 font-medium' : 'pb-2 text-muted-foreground hover:text-foreground'}>Abandonadas</button></div>{prs.length ? <ul aria-label="Pull Requests do TFS" className="divide-y">{prs.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><p className="truncate font-medium">#{item.id} {item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.sourceRef} → {item.targetRef}</p></div><div className="flex items-center gap-2"><span className="rounded-full border px-2 py-1 text-xs text-muted-foreground">{item.status}</span><Button size="sm" variant="outline" onClick={() => void openReview(item.id)} disabled={busy}>Abrir revisão</Button></div></li>)}</ul> : <div className="rounded-lg border border-dashed p-8 text-center"><p className="font-medium">Nenhuma Pull Request carregada</p><p className="mt-1 text-sm text-muted-foreground">Informe o identificador do repositório para listar as PRs.</p></div>}{selectedPr && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPr(null); }}><article role="dialog" aria-modal="true" aria-label={`Revisão da Pull Request #${selectedPr.id}`} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden sg-panel rounded-xl shadow-2xl"><header className="flex flex-wrap items-start justify-between gap-3 border-b p-5"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pull Request · {selectedPr.mergeStatus ?? 'status indisponível'}</p><h4 className="mt-1 text-xl font-semibold">#{selectedPr.id} {selectedPr.title}</h4><p className="mt-1 text-sm text-muted-foreground">Revisores: {selectedPr.reviewers.join(', ') || 'nenhum'}</p></div><div className="flex gap-2"><Button onClick={() => void analyzeReview()} disabled={startTask.isPending}>{startTask.isPending ? 'Preparando análise…' : 'Analisar com IA'}</Button><label className="inline-flex items-center gap-2 text-xs font-medium">IA para analisar<select aria-label="IA para analisar a PR" className="h-10 rounded-md border bg-background px-2 text-sm" value={aiProvider} onChange={(event) => setAiProvider(event.target.value as 'claude' | 'codex')}><option value="claude">Claude</option><option value="codex">Codex</option></select></label><Button variant="ghost" onClick={() => setSelectedPr(null)}>Fechar</Button></div></header><nav className="flex gap-5 overflow-x-auto border-b px-5" role="tablist" aria-label="Seções da revisão"><button type="button" role="tab" aria-selected={reviewTab === 'overview'} onClick={() => setReviewTab('overview')} className={reviewTab === 'overview' ? 'border-b-2 border-primary py-3 text-sm font-medium' : 'py-3 text-sm text-muted-foreground'}>Visão geral</button><button type="button" role="tab" aria-selected={reviewTab === 'files'} onClick={() => setReviewTab('files')} className={reviewTab === 'files' ? 'border-b-2 border-primary py-3 text-sm font-medium' : 'py-3 text-sm text-muted-foreground'}>Arquivos ({changes.length})</button><button type="button" role="tab" aria-selected={reviewTab === 'updates'} onClick={() => setReviewTab('updates')} className={reviewTab === 'updates' ? 'border-b-2 border-primary py-3 text-sm font-medium' : 'py-3 text-sm text-muted-foreground'}>Atualizações ({threads.length})</button><button type="button" role="tab" aria-selected={reviewTab === 'commits'} onClick={() => setReviewTab('commits')} className={reviewTab === 'commits' ? 'border-b-2 border-primary py-3 text-sm font-medium' : 'py-3 text-sm text-muted-foreground'}>Commits</button></nav><div className="min-h-0 overflow-y-auto p-5">{reviewTab === 'overview' && <div className="space-y-5"><section><h5 className="font-medium">Descrição</h5><div className="markdown mt-2 text-sm text-muted-foreground"><Markdown remarkPlugins={[remarkGfm]}>{selectedPr.description || 'Sem descrição.'}</Markdown></div></section><section><h5 className="font-medium">Resumo da revisão</h5>{aiAnswer ? <div role="status" className="markdown mt-2 max-h-96 overflow-y-auto rounded-lg border bg-background p-4 text-sm"><Markdown remarkPlugins={[remarkGfm]}>{aiAnswer}</Markdown></div> : <p className="mt-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Clique em “Analisar com IA” para receber a revisão aqui mesmo. A análise não publica comentários automaticamente.</p>}</section></div>}{reviewTab === 'files' && <section><div className="flex items-center justify-between gap-3"><h5 className="font-medium">Arquivos alterados</h5><Button size="sm" variant="outline" onClick={() => setShowDiff(true)}>Abrir diff ({changes.length})</Button></div>{changes.length ? <ul aria-label="Arquivos alterados da PR" className="mt-3 divide-y rounded-lg border">{changes.map((change) => <li key={`${change.path}-${change.objectId ?? ''}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><span className="truncate">{change.path}</span><span className="shrink-0 text-xs text-muted-foreground">{change.changeType}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Nenhuma alteração retornada.</p>}</section>}{reviewTab === 'updates' && <section><h5 className="font-medium">Threads e comentários</h5>{threads.length ? <div className="mt-3 space-y-3">{threads.map((thread) => <div key={thread.id} className="rounded-lg border p-4"><p className="text-xs font-medium">Thread #{thread.id} · {thread.status}</p>{thread.comments.map((comment) => <p key={comment.id} className="mt-2 text-sm"><span className="font-medium">{comment.author ?? 'Autor desconhecido'}:</span> {comment.content}</p>)}</div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">Nenhum comentário.</p>}</section>}{reviewTab === 'commits' && <p className="text-sm text-muted-foreground">A lista de commits será carregada na próxima etapa da integração. Os arquivos e atualizações desta PR já estão disponíveis para revisão.</p>}</div></article></div>}</div>}
        {view === 'boards' && <div className="mt-5"><div className="grid gap-3 sm:grid-cols-2">{['User Story', 'Task', 'Bug', 'Feature', 'Epic'].map((type) => <button key={type} type="button" onClick={() => void loadBacklog(type)} className={`rounded-lg border p-4 text-left font-medium hover:border-primary/60 hover:bg-primary/5 ${backlogType === type ? 'border-primary bg-primary/10 text-primary' : ''}`}>{type === 'User Story' ? 'Stories / US' : `${type}s`}</button>)}</div>{backlogType && <div className="mt-5"><h4 className="font-semibold">{backlogType === 'User Story' ? 'User Stories' : `${backlogType}s`}</h4>{backlogItems.length ? <ul aria-label={`Itens do backlog ${backlogType}`} className="mt-3 divide-y rounded-lg border">{backlogItems.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><p className="font-medium">#{item.id} {item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.state}{item.assignedTo ? ` · ${item.assignedTo}` : ''}</p></div><span className="text-xs text-muted-foreground">{item.type}</span></li>)}</ul> : <p className="mt-3 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Nenhum item encontrado para este tipo.</p>}</div>}</div>}
        {view === 'sprints' && <ul aria-label="Sprints do TFS" className="mt-5 divide-y">{iterations.map((item) => <li key={item.id} className="py-4"><p className="font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.state ?? 'sem estado'} · {item.startDate ?? '?'} → {item.finishDate ?? '?'}</p></li>)}{!iterations.length && <li className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Clique em Sprints para carregar a iteração atual.</li>}</ul>}
        {view === 'tasks' && <ul aria-label="Tasks do TFS" className="mt-5 divide-y">{tasks.map((item) => <li key={item.id} className="py-4"><p className="font-medium">#{item.id} {item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.type} · {item.state}{item.assignedTo ? ` · ${item.assignedTo}` : ''}</p></li>)}{!tasks.length && <li className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Informe os IDs para carregar as tasks.</li>}</ul>}
      {view === 'boards' && <label className="mt-5 block text-sm font-medium">Sprint selecionada<select aria-label="Sprint selecionada" className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm" value={selectedIterationId} onChange={(event) => { setSelectedIterationId(event.target.value); if (backlogType) void loadBacklog(backlogType, event.target.value); }}>{iterations.length ? iterations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.state ?? 'sem estado'}</option>) : <option value="">Nenhuma sprint carregada</option>}</select></label>}
      </section>
    </section>
    <details className="sg-panel rounded-xl p-5"><summary className="cursor-pointer font-medium">Configuração avançada e operações de escrita</summary><div className="mt-4 text-sm text-muted-foreground">Para configurar URL, PAT e preparar operações com confirmação nativa, use a área de Configurações. O painel acima permanece focado em consultar e revisar o trabalho.</div></details>
    {view === 'boards' && connectionId && <AzureDevOpsSprintBoard connectionId={connectionId} iterations={iterations} selectedIterationId={selectedIterationId} onIterationChange={setSelectedIterationId} />}
    
    
    {showDiff && <AzureDevOpsDiffPanel changes={changes} onClose={() => setShowDiff(false)} />}
  </main>;
}





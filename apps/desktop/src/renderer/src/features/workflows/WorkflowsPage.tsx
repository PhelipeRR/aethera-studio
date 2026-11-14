import { lazy, Suspense, useMemo, useState, type ChangeEvent } from 'react';
import { Check, ChevronDown, PanelLeftClose, PanelLeftOpen, Play, Plus, Star, Download, Trash2, X, Settings2, Workflow } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { VirtualList } from '@/components/performance/VirtualList';
import type { WorkflowDefinitionV2, WorkflowStep } from '@neuralbridge/shared/workflows';
import { normalizeWorkflow, validateWorkflow } from '@neuralbridge/shared/workflows';
import { BlockPalette } from './builder/BlockPalette';
import { createStep, type NodeKind } from './builder/model';
import type { StepPosition } from './builder/WorkflowCanvas';

// The canvas library is heavy: only this screen pays for it.
const WorkflowCanvas = lazy(() => import('./builder/WorkflowCanvas').then((module) => ({ default: module.WorkflowCanvas })));

const empty: WorkflowDefinitionV2 = { schemaVersion: 2, name: 'Novo workflow', projectId: null, maxParallel: 1, inputs: [], steps: [{ id: 'step-1', title: 'Primeira etapa', kind: 'agent', prompt: 'Descreva o que esta etapa deve fazer.', agent: 'auto', mode: 'auto', access: 'read-only', dependsOn: [], requiresApproval: true }] };
const selectClass = 'mt-1 w-full rounded border bg-background px-2 py-2';
type LibraryTab = 'blocks' | 'templates' | 'saved';
const LIBRARY_TABS: [LibraryTab, string][] = [['blocks', 'Blocos'], ['templates', 'Modelos'], ['saved', 'Salvos']];
const RUN_LABEL: Record<string, string> = { pending: 'Na fila', running: 'Executando', waiting_approval: 'Esperando você', paused: 'Pausada', retrying: 'Nova tentativa', interrupted: 'Interrompida', completed: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada' };
const SEGMENT: Record<string, string> = { completed: 'bg-primary', skipped: 'bg-muted-foreground/40', running: 'bg-primary/60', awaiting_approval: 'bg-warning', needs_decision: 'bg-warning', failed: 'bg-destructive' };

function readPositions(layout: string | null | undefined): StepPosition[] {
  try {
    return (JSON.parse(layout ?? '{}') as { nodes?: StepPosition[] }).nodes ?? [];
  } catch {
    return [];
  }
}

function StepProperties({ step, definition, update, updateId, remove }: { step: WorkflowStep; definition: WorkflowDefinitionV2; update: (patch: Partial<WorkflowStep>) => void; updateId: (id: string) => void; remove: () => void }) {
  return (
    <>
      <Field label="Título" htmlFor="step-title"><Input id="step-title" value={step.title} onChange={(event) => update({ title: event.target.value })} /></Field>
      {step.kind === 'agent' && (
        <>
          <Field label="Prompt" htmlFor="step-prompt" hint="Use {{inputs.id}} ou {{steps.id.output}}."><Textarea id="step-prompt" rows={5} value={step.prompt} onChange={(event) => update({ prompt: event.target.value })} /></Field>
          <label className="block text-sm">Agente<select className={selectClass} value={step.agent} onChange={(event) => update({ agent: event.target.value as 'auto' | 'claude' | 'codex' })}><option value="auto">Automático</option><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
          <label className="block text-sm">Acesso<select className={selectClass} value={step.access} onChange={(event) => update({ access: event.target.value as 'read-only' | 'edit' })}><option value="read-only">Somente leitura</option><option value="edit">Edição</option></select></label>
          <Field label="Skills" htmlFor="step-skills" hint="Separadas por vírgula."><Input id="step-skills" value={(step.skillIds ?? []).join(', ')} onChange={(event) => { const skillIds = event.target.value.split(',').map((item) => item.trim()).filter(Boolean); update({ skillIds } as Partial<WorkflowStep>); }} /></Field>
          <Field label="Skills obrigatórias" htmlFor="step-required-skills" hint="A etapa para se alguma estiver indisponível."><Input id="step-required-skills" value={(step.requiredSkillIds ?? []).join(', ')} onChange={(event) => { const requiredSkillIds = event.target.value.split(',').map((item) => item.trim()).filter(Boolean); update({ requiredSkillIds } as Partial<WorkflowStep>); }} /></Field>
        </>
      )}
      {step.kind === 'approval' && <Field label="Mensagem" htmlFor="step-message"><Textarea id="step-message" rows={3} value={step.message} onChange={(event) => update({ message: event.target.value })} /></Field>}
      {step.kind === 'rag' && <Field label="Consulta" htmlFor="step-query"><Textarea id="step-query" rows={3} value={step.query} onChange={(event) => update({ query: event.target.value })} /></Field>}
      {step.kind === 'validation' && <Field label="Comando" htmlFor="step-command" hint="Só comandos de teste, build, lint e typecheck."><Input id="step-command" value={step.command} onChange={(event) => update({ command: event.target.value })} /></Field>}
      {step.kind === 'git' && <label className="block text-sm">Ação<select className={selectClass} value={step.action} onChange={(event) => update({ action: event.target.value as 'status' | 'diff' | 'log' | 'diff-range' })}><option value="status">Status</option><option value="diff">Diff local</option><option value="log">Histórico</option><option value="diff-range">Diff entre refs</option></select></label>}
      {step.kind === 'condition' && (
        <>
          <label className="block text-sm">Etapa observada<select className={selectClass} value={step.when.step} onChange={(event) => update({ when: { ...step.when, step: event.target.value } })}>{definition.steps.filter((item) => item.id !== step.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <Field label="Segue se a saída contiver" htmlFor="step-contains"><Input id="step-contains" value={step.when.contains} onChange={(event) => update({ when: { ...step.when, contains: event.target.value } })} /></Field>
        </>
      )}
      <p className="text-xs text-muted-foreground">Depende de: {step.dependsOn.join(', ') || 'nada'}</p>
      <details className="group border-t pt-3">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm text-muted-foreground">Avançado<ChevronDown className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
        <div className="mt-3 space-y-3">
      <Field label="Identificador" htmlFor="step-id"><Input id="step-id" value={step.id} onChange={(event) => updateId(event.target.value)} /></Field>
      <Field label="Tempo limite (segundos)" htmlFor="step-timeout" hint="Em branco usa o padrão."><Input id="step-timeout" type="number" min={1} value={step.timeoutMs === undefined ? '' : step.timeoutMs / 1000} onChange={(event) => update({ timeoutMs: event.target.value ? Number(event.target.value) * 1000 : undefined })} /></Field>
      <label className="block text-sm">Tentativas em falha temporária<select className={selectClass} value={step.recovery?.retry?.maxAttempts ?? 3} onChange={(event) => update({ recovery: { ...step.recovery, retry: { maxAttempts: Number(event.target.value), baseDelayMs: 2_000, maxDelayMs: 60_000, maxTotalMs: 600_000, jitter: 'full', on: ['rate_limit', 'provider_overloaded', 'network', 'timeout'] } } })}>{[1, 2, 3, 5].map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
      {step.kind === 'agent' && <label className="flex gap-2 text-sm"><input type="checkbox" checked={step.recovery?.fallback !== undefined} onChange={(event) => { const { retry, autoResume } = step.recovery ?? {}; const rest = { ...(retry ? { retry } : {}), ...(autoResume !== undefined ? { autoResume } : {}) }; update({ recovery: event.target.checked ? { ...rest, fallback: { to: step.agent === 'claude' ? 'codex' : 'claude', on: ['rate_limit', 'provider_overloaded', 'usage_limit'], allowEdit: false } } : rest }); }} /> Trocar de agente se o limite acabar</label>}
        </div>
      </details>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={step.requiresApproval} onChange={(event) => update({ requiresApproval: event.target.checked })} /> Exigir aprovação antes de iniciar</label>
      <Button type="button" variant="ghost" size="sm" onClick={remove}><Trash2 aria-hidden="true" /> Excluir etapa</Button>
    </>
  );
}

export function WorkflowsPage() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<string>();
  const [definition, setDefinition] = useState<WorkflowDefinitionV2>(empty);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [selectedStep, setSelectedStep] = useState<string | null>('step-1');
  const [templateFilter, setTemplateFilter] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [positions, setPositions] = useState<StepPosition[]>([]);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [activeRun, setActiveRun] = useState<string | null>(null);
  const [tab, setTab] = useState<LibraryTab>('blocks');
  const [libraryOpen, setLibraryOpen] = useState(true);
  const addBlock = (kind: NodeKind, position?: { x: number; y: number }) => {
    const step = createStep(kind, definition);
    const at = position ?? { x: 40 + definition.steps.length * 40, y: 40 + definition.steps.length * 24 };
    setPositions([...positions.filter((item) => item.id !== step.id), { id: step.id, x: Math.round(at.x), y: Math.round(at.y) }]);
    setDefinition({ ...definition, steps: [...definition.steps, step] });
    setSelectedStep(step.id);
  };
  const list = useQuery({ queryKey: ['workflows'], queryFn: () => window.neuralbridge.workflows.list() });
  const templates = useQuery({ queryKey: ['workflow-templates'], queryFn: () => window.neuralbridge.workflows.templates() });
  const projects = useQuery({ queryKey: ['projects'], queryFn: () => window.neuralbridge.projects.list() });
  const layoutJson = () => JSON.stringify({ nodes: positions });
  const save = useMutation({ mutationFn: () => window.neuralbridge.workflows.save(selected, definition), onSuccess: (result) => { setSelected(result.id); void window.neuralbridge.workflows.saveLayout(result.id, layoutJson()); void client.invalidateQueries({ queryKey: ['workflows'] }); } });
  const remove = useMutation({ mutationFn: () => window.neuralbridge.workflows.delete(selected ?? ''), onSuccess: () => { setSelected(undefined); setDefinition(empty); void client.invalidateQueries({ queryKey: ['workflows'] }); } });
  const run = useMutation({ mutationFn: () => window.neuralbridge.workflows.run(selected ?? '', true, definition.inputs.length ? runInputs : undefined), onSuccess: (result) => { setActiveRun(result.runId); void client.invalidateQueries({ queryKey: ['workflow-runs', selected] }); } });
  const runs = useQuery({ queryKey: ['workflow-runs', selected], queryFn: () => window.neuralbridge.workflows.runs(selected), enabled: selected !== undefined, refetchInterval: selected === undefined ? false : 2_000 });
  const shownRun = activeRun ?? runs.data?.[0]?.id ?? null;
  const steps = useQuery({ queryKey: ['workflow-steps', shownRun], queryFn: () => window.neuralbridge.workflows.steps(shownRun ?? ''), enabled: shownRun !== null, refetchInterval: 2_000 });
  const timeline = useQuery({ queryKey: ['workflow-timeline', shownRun], queryFn: () => window.neuralbridge.workflows.timeline(shownRun ?? ''), enabled: shownRun !== null, refetchInterval: 2_000 });
  const refresh = () => { void runs.refetch(); void steps.refetch(); };
  const pause = useMutation({ mutationFn: (runId: string) => window.neuralbridge.workflows.pause(runId), onSuccess: refresh });
  const resume = useMutation({ mutationFn: (runId: string) => window.neuralbridge.workflows.resume(runId), onSuccess: refresh });
  const cancel = useMutation({ mutationFn: (runId: string) => window.neuralbridge.workflows.cancel(runId), onSuccess: refresh });
  const approve = useMutation({ mutationFn: ({ runId, stepId }: { runId: string; stepId: string }) => window.neuralbridge.workflows.approveStep(runId, stepId), onSuccess: refresh });
  const reject = useMutation({ mutationFn: ({ runId, stepId }: { runId: string; stepId: string }) => window.neuralbridge.workflows.rejectStep(runId, stepId), onSuccess: refresh });
  const decide = useMutation({ mutationFn: ({ runId, stepId, choice }: { runId: string; stepId: string; choice: 'retry' | 'skip' | 'abort' }) => window.neuralbridge.workflows.decideStep(runId, stepId, choice), onSuccess: refresh });

  const load = async (id: string) => {
    const item = await window.neuralbridge.workflows.get(id);
    const normalized = normalizeWorkflow(item.definition);
    setSelected(id);
    setDefinition(normalized);
    setPositions(readPositions(item.layout));
    setSelectedStep(normalized.steps[0]?.id ?? null);
    setActiveRun(null);
  };
  const current = definition.steps.find((step) => step.id === selectedStep);
  const updateStep = (patch: Partial<WorkflowStep>) => setDefinition((value) => ({ ...value, steps: value.steps.map((step) => (step.id === selectedStep ? ({ ...step, ...patch } as WorkflowStep) : step)) }));
  const renameStep = (id: string) => {
    if (!selectedStep) return;
    setDefinition((value) => ({ ...value, steps: value.steps.map((step) => ({ ...step, id: step.id === selectedStep ? id : step.id, dependsOn: step.dependsOn.map((item) => (item === selectedStep ? id : item)) })) }));
    setPositions((value) => value.map((item) => (item.id === selectedStep ? { ...item, id } : item)));
    setSelectedStep(id);
  };
  const removeStep = () => {
    if (definition.steps.length <= 1) return;
    setDefinition((value) => ({ ...value, steps: value.steps.filter((step) => step.id !== selectedStep).map((step) => ({ ...step, dependsOn: step.dependsOn.filter((id) => id !== selectedStep) })) }));
    setSelectedStep(null);
  };
  const instantiateTemplate = async (templateId: string) => {
    const item = await window.neuralbridge.workflows.instantiateTemplate(templateId, definition.projectId);
    const normalized = normalizeWorkflow(item.definition);
    setDefinition(normalized);
    setSelected(undefined);
    setPositions([]);
    setSelectedStep(normalized.steps[0]?.id ?? null);
    setPreview(null);
  };
  const importTemplate = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const result = await window.neuralbridge.workflows.importTemplate(await file.text());
    const item = await window.neuralbridge.workflows.instantiateTemplate(result.id, definition.projectId);
    setDefinition(normalizeWorkflow(item.definition));
    void client.invalidateQueries({ queryKey: ['workflow-templates'] });
  };
  const toggleMode = (json: boolean) => {
    if (json) { setJsonText(JSON.stringify(definition, null, 2)); setJsonError(null); }
    setJsonMode(json);
  };
  const applyJson = (text: string) => {
    setJsonText(text);
    try {
      setDefinition(normalizeWorkflow(JSON.parse(text)));
      setJsonError(null);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message.slice(0, 300) : 'JSON inválido.');
    }
  };
  const validation = useMemo(() => validateWorkflow(definition), [definition]);
  const stepStates = useMemo(() => Object.fromEntries((steps.data ?? []).map((step) => [step.stepId, step.status])), [steps.data]);
  const categories = [...new Set((templates.data ?? []).map((template) => template.category))];
  const visibleTemplates = (templates.data ?? []).filter((template) => (!templateCategory || template.category === templateCategory) && `${template.name} ${template.category}`.toLowerCase().includes(templateFilter.toLowerCase()));
  const previewed = templates.data?.find((template) => template.id === preview);
  const fullAccess = projects.data?.find((project) => project.id === definition.projectId)?.permissionLevel === 'full';
  const edits = definition.steps.filter((step) => step.kind === 'agent' && step.access === 'edit').length;
  const shown = runs.data?.find((item) => item.id === shownRun);
  const pendingSteps = (steps.data ?? []).filter((step) => step.status === 'awaiting_approval' || step.status === 'needs_decision');
  const finishedSteps = (steps.data ?? []).filter((step) => step.status === 'completed' || step.status === 'skipped').length;
  const startedAt = timeline.data?.[0]?.createdAt;
  const endedAt = timeline.data?.at(-1)?.createdAt;
  const elapsed = startedAt && endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : null;
  const startRun = () => {
    const warning = fullAccess ? ' Este projeto está em Acesso total: etapas de edição rodam sem checagem de permissões.' : '';
    if (window.confirm(`Executar este workflow? ${edits} etapa(s) podem editar arquivos.${warning}`)) run.mutate();
  };

  return (
    <div data-tour="workflows-list" className="flex h-full min-h-[34rem] flex-col bg-background">
      <header className="flex flex-wrap items-center gap-2 border-b bg-card/30 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary"><Workflow className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0"><h1 className="truncate text-sm font-semibold">Workflows</h1><p className="hidden text-[11px] text-muted-foreground sm:block">Builder visual · desenhe, valide e acompanhe os agentes.</p></div>
        </div>
        <input aria-label="Nome" className="h-9 min-w-32 flex-1 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium outline-none hover:border-border focus-visible:border-ring sm:max-w-56" value={definition.name} onChange={(event) => setDefinition({ ...definition, name: event.target.value })} />
        <select aria-label="Projeto do workflow" className="h-8 max-w-40 rounded-md border bg-background px-2 text-xs" value={definition.projectId ?? ''} onChange={(event) => setDefinition({ ...definition, projectId: event.target.value || null })}><option value="">Sem projeto</option>{projects.data?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
        {save.isSuccess && <span className="flex items-center gap-1 text-xs text-primary"><Check className="size-3.5" aria-hidden="true" /> Workflow salvo e validado.</span>}
        {save.isError && <span role="alert" className="max-w-md truncate text-xs text-destructive" title={save.error.message}>{save.error instanceof Error ? save.error.message : 'Workflow inválido.'}</span>}
        <span className="flex-1" />
        <div className="flex rounded-md border bg-background/60 p-0.5">
          <button type="button" aria-label="Editor visual" aria-pressed={!jsonMode} className={`rounded px-2.5 py-1 text-xs ${jsonMode ? 'text-muted-foreground' : 'bg-accent'}`} onClick={() => toggleMode(false)}>Visual</button>
          <button type="button" aria-pressed={jsonMode} className={`rounded px-2.5 py-1 text-xs ${jsonMode ? 'bg-accent' : 'text-muted-foreground'}`} onClick={() => toggleMode(true)}>JSON</button>
        </div>
        <Button size="sm" variant="ghost" aria-label="Novo workflow" title="Novo workflow" onClick={() => { setSelected(undefined); setDefinition(empty); setPositions([]); setSelectedStep('step-1'); setActiveRun(null); }}><Plus aria-hidden="true" /></Button>
        {selected && <Button size="sm" variant="ghost" aria-label="Excluir" onClick={() => remove.mutate()} disabled={remove.isPending}><Trash2 aria-hidden="true" /></Button>}
        <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>Salvar e validar</Button>
        {selected && <Button data-tour="workflows-run" size="sm" aria-label="Executar workflow" onClick={startRun} disabled={run.isPending || !validation.ok}><Play aria-hidden="true" /> Executar</Button>}
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        {libraryOpen ? (
          <aside aria-label="Biblioteca de blocos" className="flex w-full shrink-0 flex-col border-b xl:w-60 xl:border-r xl:border-b-0">
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
              <div role="tablist" aria-label="Biblioteca" className="flex flex-1 gap-0.5">
                {LIBRARY_TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={`rounded px-2 py-1 text-xs ${tab === id ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => setTab(id)}>{label}</button>)}
              </div>
              <button type="button" aria-label="Recolher biblioteca" className="rounded p-1 text-muted-foreground hover:bg-accent" onClick={() => setLibraryOpen(false)}><PanelLeftClose className="size-4" aria-hidden="true" /></button>
            </div>
            <div className="max-h-64 min-h-0 flex-1 overflow-y-auto p-3 xl:max-h-none">
              {tab === 'blocks' && <BlockPalette onAdd={addBlock} />}
              {tab === 'templates' && (
                <div className="space-y-2">
                  <Input aria-label="Buscar templates" placeholder="Buscar" value={templateFilter} onChange={(event) => setTemplateFilter(event.target.value)} />
                  <select aria-label="Categoria" className="w-full rounded border bg-background px-2 py-1 text-xs" value={templateCategory} onChange={(event) => setTemplateCategory(event.target.value)}><option value="">Todas as categorias</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select>
                  <VirtualList items={visibleTemplates} itemHeight={48} ariaLabel="Templates disponíveis" renderItem={(template) => (
                    <div className="flex h-12 items-center gap-1">
                      <button type="button" aria-label={`Ver template ${template.name}`} onClick={() => setPreview(template.id)} className="block min-w-0 flex-1 rounded px-2 py-1 text-left text-xs hover:bg-accent"><span className="block truncate font-medium">{template.name}</span><span className="text-muted-foreground">{template.category}</span></button>
                      <button type="button" aria-label={`Favoritar ${template.name}`} className="rounded p-1 text-muted-foreground hover:text-foreground" onClick={() => void window.neuralbridge.workflows.favoriteTemplate(template.id, true)}><Star className="size-3.5" aria-hidden="true" /></button>
                      <button type="button" aria-label={`Exportar ${template.name}`} className="rounded p-1 text-muted-foreground hover:text-foreground" onClick={async () => { const payload = await window.neuralbridge.workflows.exportTemplate(template.id); const blob = new Blob([payload], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${template.id}.json`; anchor.click(); URL.revokeObjectURL(url); }}><Download className="size-3.5" aria-hidden="true" /></button>
                    </div>
                  )} />
                  {previewed && (
                    <div aria-label="Prévia do template" role="region" className="space-y-2 rounded border p-2 text-xs">
                      <p className="font-medium">{previewed.name}, versão {previewed.version}</p>
                      <p className="text-muted-foreground">{previewed.description}</p>
                      <p className="text-muted-foreground">Requer: {previewed.requirements.join(', ') || 'nada além de um agente'}</p>
                      <Button size="sm" className="w-full" onClick={() => void instantiateTemplate(previewed.id)}>Usar template</Button>
                    </div>
                  )}
                  <label className="block cursor-pointer rounded border px-2 py-1 text-center text-xs">Importar JSON<input className="hidden" type="file" accept="application/json" onChange={(event) => void importTemplate(event)} /></label>
                </div>
              )}
              {tab === 'saved' && (
                <div>
                  {list.isLoading && <p className="px-2 text-sm text-muted-foreground">Carregando…</p>}
                  {list.isError && <p role="alert" className="px-2 text-sm text-destructive">Não foi possível carregar os workflows.</p>}
                  {list.data?.length === 0 && <p className="px-2 text-xs text-muted-foreground">Salve um workflow para encontrá-lo aqui.</p>}
                  {(list.data ?? []).map((item) => <button key={item.id} type="button" onClick={() => void load(item.id)} className={`block w-full rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent ${item.id === selected ? 'bg-accent' : ''}`}>{item.name}<span className="block text-xs text-muted-foreground">versão {item.version}</span></button>)}
                </div>
              )}
            </div>
          </aside>
        ) : (
          <div className="border-b p-1 xl:border-r xl:border-b-0"><button type="button" aria-label="Abrir biblioteca" className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setLibraryOpen(true)}><PanelLeftOpen className="size-4" aria-hidden="true" /></button></div>
        )}

        <div className="relative min-h-[26rem] min-w-0 flex-1 bg-background">
          {jsonMode ? (
            <div className="h-full overflow-y-auto p-4">
              <Field label="Definição das etapas" htmlFor="workflow-definition" hint="O conteúdo é validado antes de ser salvo; dependências formam um DAG.">
                <Textarea id="workflow-definition" rows={24} className="font-mono text-xs" value={jsonText} onChange={(event) => applyJson(event.target.value)} />
                {jsonError && <p role="alert" className="mt-1 text-xs text-destructive">{jsonError}</p>}
              </Field>
            </div>
          ) : (
            <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Carregando o editor…</p>}>
              <WorkflowCanvas definition={definition} positions={positions} issues={validation.issues} states={stepStates} onChange={setDefinition} onPositions={setPositions} onSelect={setSelectedStep} onAdd={addBlock} />
            </Suspense>
          )}
        </div>

        {!jsonMode && (
          <aside aria-label="Propriedades da etapa" className="w-full shrink-0 space-y-3 overflow-y-auto border-t bg-card/20 p-4 xl:w-80 xl:border-l xl:border-t-0">
            {current ? (
              <>
                <div className="flex items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground"><Settings2 className="size-3.5" aria-hidden="true" /> Configuração</p><h2 className="mt-1 truncate text-sm font-semibold">{current.title}</h2><p className="mt-0.5 text-xs text-muted-foreground">Edite apenas o que esta etapa precisa.</p></div><button type="button" aria-label="Fechar propriedades" className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedStep(null)}><X className="size-4" aria-hidden="true" /></button></div>
                <StepProperties step={current} definition={definition} update={updateStep} updateId={renameStep} remove={removeStep} />
              </>
            ) : selected && definition.inputs.length > 0 ? <div><p className="text-sm font-medium">Entradas do workflow</p>{definition.inputs.map((input) => <Field key={input.id} label={input.label} htmlFor={`input-${input.id}`}><Input id={`input-${input.id}`} value={runInputs[input.id] ?? ''} onChange={(event) => setRunInputs({ ...runInputs, [input.id]: event.target.value })} /></Field>)}</div> : <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center"><Settings2 className="size-5 text-muted-foreground" aria-hidden="true" /><p className="mt-2 text-sm font-medium">Selecione uma etapa</p><p className="mt-1 text-xs text-muted-foreground">As propriedades e validações aparecerão aqui.</p></div>}
          </aside>
        )}
      </div>

      {validation.issues.length > 0 && <ul aria-label="Problemas do workflow" className="border-t px-3 py-1.5 text-xs text-destructive">{validation.issues.slice(0, 3).map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
      {run.isError && <p role="alert" className="border-t px-3 py-1.5 text-xs text-destructive">{run.error instanceof Error ? run.error.message : 'Não foi possível executar o workflow.'}</p>}

      {selected && (
        <section aria-label="Execuções do workflow" className="flex flex-wrap items-center gap-3 border-t px-3 py-2 text-[13px]">
          {shown ? (
            <>
              <span className={shown.status === 'failed' ? 'text-destructive' : shown.status === 'waiting_approval' || shown.status === 'interrupted' ? 'text-warning' : ''}>{RUN_LABEL[shown.status] ?? shown.status}</span>
              <div aria-hidden="true" className="flex min-w-24 flex-1 gap-0.5">{(steps.data ?? []).map((step) => <div key={step.stepId} className={`h-1.5 flex-1 rounded-full ${SEGMENT[step.status] ?? 'bg-muted'}`} />)}</div>
              <span className="text-xs text-muted-foreground">{finishedSteps} de {steps.data?.length ?? 0}{elapsed !== null ? `, ${elapsed} s` : ''}</span>
              {shown.error && <span className="max-w-sm truncate text-xs text-destructive" title={shown.error}>{shown.error}</span>}
              {pendingSteps.map((step) => (
                <span key={step.stepId} className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">{definition.steps.find((item) => item.id === step.stepId)?.title ?? step.stepId}</span>
                  {step.status === 'awaiting_approval' ? (
                    <><Button size="sm" variant="outline" onClick={() => reject.mutate({ runId: shown.id, stepId: step.stepId })}>Rejeitar</Button><Button size="sm" aria-label="Aprovar etapa" onClick={() => approve.mutate({ runId: shown.id, stepId: step.stepId })}>Aprovar</Button></>
                  ) : (
                    <><Button size="sm" variant="ghost" onClick={() => decide.mutate({ runId: shown.id, stepId: step.stepId, choice: 'abort' })}>Encerrar</Button><Button size="sm" variant="outline" onClick={() => decide.mutate({ runId: shown.id, stepId: step.stepId, choice: 'skip' })}>Pular</Button><Button size="sm" onClick={() => decide.mutate({ runId: shown.id, stepId: step.stepId, choice: 'retry' })}>Repetir etapa</Button></>
                  )}
                </span>
              ))}
              {['running', 'waiting_approval'].includes(shown.status) && <Button size="sm" variant="ghost" onClick={() => pause.mutate(shown.id)}>Pausar</Button>}
              {shown.status === 'paused' && <Button size="sm" variant="outline" onClick={() => resume.mutate(shown.id)}>Retomar</Button>}
              {['running', 'paused', 'waiting_approval', 'retrying', 'interrupted'].includes(shown.status) && <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('Cancelar esta execução?')) cancel.mutate(shown.id); }}>Cancelar</Button>}
              <details className="relative text-xs text-muted-foreground">
                <summary className="cursor-pointer">Histórico</summary>
                <div className="absolute right-0 bottom-7 z-10 max-h-64 w-72 overflow-y-auto rounded-md border bg-popover p-2 text-popover-foreground">
                  {(runs.data ?? []).slice(0, 5).map((item) => <button key={item.id} type="button" className="block w-full truncate rounded px-1 py-0.5 text-left hover:bg-accent" onClick={() => setActiveRun(item.id)}>{RUN_LABEL[item.status] ?? item.status}, {new Date(item.updatedAt).toLocaleString()}</button>)}
                  <ol className="mt-2 space-y-0.5 border-t pt-2">{timeline.data?.map((entry) => <li key={entry.sequence}>{new Date(entry.createdAt).toLocaleTimeString()}: {String(entry.recoveryMeta['event'] ?? 'evento')}{entry.recoveryMeta['step'] ? `, ${String(entry.recoveryMeta['step'])}` : ''}</li>)}</ol>
                </div>
              </details>
            </>
          ) : <span className="text-xs text-muted-foreground">Nenhuma execução ainda.</span>}
        </section>
      )}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, Check, CircleAlert, CircleDot, Clock3, LoaderCircle, Pause, Play, RotateCcw, ShieldCheck, Square, WandSparkles } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { AetheraSignature } from '@/app/AetheraMark';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { aetheraStageTone, aetheraWorkspaceProgress, AETHERA_RUN_STATUS_LABEL, AETHERA_STAGE_STATUS_LABEL } from '@neuralbridge/shared/aethera-workspace';
import type { ProductionStageKind, ProductionState } from '@neuralbridge/shared/velix-production';
import type { AetheraProductionPlan } from '@neuralbridge/shared/aethera-production-planner';
import { AetheraEditorMode } from './AetheraEditorMode';

const STAGE_LABEL: Record<ProductionStageKind, string> = {
  briefing: 'Briefing',
  research: 'Pesquisa',
  script: 'Roteiro',
  storyboard: 'Storyboard',
  narration: 'Narração',
  sync: 'Sincronização',
  composition: 'Composição',
  render: 'Render',
  quality: 'Qualidade',
  preview: 'Prévia',
  export: 'Exportação',
  game_research: 'Pesquisa de jogos',
  media_acquisition: 'Aquisição de mídia',
  visual_index: 'Indexação visual',
  scene_matching: 'Casamento de cenas',
  media_discovery: 'Descoberta de mídia',
};

function StatusIcon({ status }: { status: ProductionState['stages'][number]['status'] }) {
  if (status === 'completed') return <Check aria-hidden="true" className="size-4" />;
  if (status === 'running') return <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />;
  if (status === 'failed' || status === 'awaiting_approval') return <CircleAlert aria-hidden="true" className="size-4" />;
  return <CircleDot aria-hidden="true" className="size-4" />;
}

function EmptyWorkspace() {
  return (
    <main className="aethera-workspace" data-module="aethera">
      <div className="aethera-workspace__empty sg-panel">
        <WandSparkles aria-hidden="true" className="size-8 text-[var(--aethera-signal)]" />
        <h1>Produção não selecionada</h1>
        <p>Abra uma produção persistida para acompanhar as etapas no workspace Aethera.</p>
        <Link to="/video" className="aethera-workspace__link">Voltar ao Studio</Link>
      </div>
    </main>
  );
}

function WorkspaceLoading() {
  return (
    <main className="aethera-workspace" data-module="aethera" aria-busy="true">
      <div className="aethera-workspace__empty sg-panel">
        <LoaderCircle aria-hidden="true" className="size-8 animate-spin text-[var(--aethera-signal)]" />
        <h1>Carregando produção</h1>
        <p>Consultando o estado persistido da produção.</p>
      </div>
    </main>
  );
}

function StageRow({ stage }: { stage: ProductionState['stages'][number] }) {
  const tone = aetheraStageTone(stage.status);
  return (
    <li className={`aethera-stage aethera-stage--${tone}`}>
      <span className="aethera-stage__icon"><StatusIcon status={stage.status} /></span>
      <div className="aethera-stage__body">
        <div className="aethera-stage__heading">
          <span>{STAGE_LABEL[stage.kind]}</span>
          <span className="aethera-stage__status">{AETHERA_STAGE_STATUS_LABEL[stage.status]}</span>
        </div>
        <div className="aethera-stage__track" aria-hidden="true"><span style={{ width: `${Math.round(stage.progress * 100)}%` }} /></div>
        {stage.error && <p className="aethera-stage__error">{stage.error.message}</p>}
      </div>
    </li>
  );
}

function PlannerResult({ plan, onApply, pending }: { plan: AetheraProductionPlan; onApply: () => void; pending: boolean }) {
  return <div className="aethera-planner__result" role="status"><p><strong>{plan.status === 'ready' ? 'Plano pronto para revisão' : 'Dados necessários antes do plano'}</strong>{plan.topic ? ` · ${plan.topic}` : ''}</p>{plan.questions.length > 0 && <ul>{plan.questions.map((question) => <li key={question.id}>{question.prompt}</li>)}</ul>}{plan.steps.length > 0 && <ol>{plan.steps.map((step) => <li key={step.id}>{step.kind}</li>)}</ol>}<small>Voz: Aethera/OmniVoice (não comercial) · mídia: somente biblioteca já baixada · aprovações: {plan.approvals.join(', ')}.</small>{plan.status === 'ready' && <Button size="sm" type="button" onClick={onApply} disabled={pending}>{pending ? 'Agendando etapas…' : 'Aplicar e executar até a prévia'}</Button>}</div>;
}

function WorkspaceContent({ state }: { state: ProductionState }) {
  const client = useQueryClient();
  const api = window.neuralbridge.video;
  const [mode, setMode] = useState<'automatic' | 'editor'>(state.run.status === 'completed' ? 'editor' : 'automatic');
  const [prevRunStatus, setPrevRunStatus] = useState(state.run.status);
  if (state.run.status !== prevRunStatus) {
    setPrevRunStatus(state.run.status);
    if (state.run.status === 'completed') setMode('editor');
  }
  const progress = aetheraWorkspaceProgress(state);
  const currentStage = state.stages.find((stage) => stage.status === 'running' || stage.status === 'awaiting_approval') ?? state.stages.find((stage) => stage.status === 'pending');
  const finished = state.run.status === 'completed' || state.run.status === 'cancelled';
  const action = useMutation({
    mutationFn: (kind: 'pause' | 'resume' | 'cancel') => kind === 'pause' ? api.productionRunPause(state.run.id) : kind === 'resume' ? api.productionRunResume(state.run.id) : api.productionRunCancel(state.run.id),
    onSuccess: (next) => client.setQueryData(['aethera-production-workspace', state.run.id], next),
  });
  const [command, setCommand] = useState('');
  const providers = useQuery({ queryKey: ['aethera-auto-providers'], queryFn: () => api.aetheraAutoProviders(), staleTime: 30_000 });
  const activeAgentsLabel = providers.data?.providers.filter((item) => item.available).map((item) => item.id === 'claude' ? 'Claude' : item.id === 'codex' ? 'Codex' : 'Antigravity').join(' + ') || (state.run.agent === 'codex' ? 'Codex' : 'Claude');
  const planner = useMutation({ mutationFn: () => api.aetheraProductionPlan(command.trim()) });
  const applyPlan = useMutation({ mutationFn: () => planner.data ? api.aetheraProductionPlanApply({ runId: state.run.id, plan: planner.data }) : Promise.reject(new Error('Gere um plano antes de executar.')), onSuccess: (next) => client.setQueryData(['aethera-production-workspace', state.run.id], next) });

  return (
    <main className="aethera-workspace" data-module="aethera">
      <header className="aethera-workspace__topbar">
        <div className="aethera-workspace__brand"><AetheraSignature /><span className="aethera-workspace__divider" /><div><p className="aethera-workspace__eyebrow">Workspace de produção</p><h1>{state.run.topic}</h1></div></div>
        <div className="aethera-workspace__top-actions"><span className="aethera-workspace__mode"><WandSparkles aria-hidden="true" className="size-4" /> {mode === 'automatic' ? 'Automático' : 'Editor'}</span><Link to="/video" className="aethera-workspace__back"><ArrowLeft aria-hidden="true" className="size-4" /> Studio legado</Link></div>
      </header>

      <div className="aethera-workspace__meta" aria-label="Resumo da produção">
        <span className="aethera-status aethera-status--active"><CircleDot aria-hidden="true" className="size-3.5" />{AETHERA_RUN_STATUS_LABEL[state.run.status]}</span>
        <span><strong>{state.brief.format.width}×{state.brief.format.height}</strong> · {state.brief.format.fps} fps</span>
        <span><strong>{Math.round(state.brief.targetDurationSeconds)} s</strong> de duração alvo</span>
        <span><strong>{progress.completed}/{progress.total || 0}</strong> etapas concluídas</span>
      </div>

      <div className="aethera-workspace__grid">
        <aside className="aethera-workspace__rail sg-panel" aria-label="Fluxo automático">
          <p className="aethera-workspace__eyebrow">Fluxo ativo</p>
          <h2>Produção autônoma</h2>
          <p className="aethera-workspace__muted">O Aethera executa as etapas persistidas e para apenas quando precisa de uma decisão.</p>
          <ol className="aethera-workspace__rail-list">
            <li className={mode === 'automatic' ? 'is-active' : ''}><button type="button" onClick={() => setMode('automatic')}><span>01</span><div><strong>Automático</strong><small>Monitorar e executar</small></div></button></li>
            <li className={mode === 'editor' ? 'is-active' : ''}><button type="button" onClick={() => setMode('editor')}><span>02</span><div><strong>Editor</strong><small>Editar com prévia ao vivo</small></div></button></li>
          </ol>
          <div className="aethera-workspace__rail-note"><ShieldCheck aria-hidden="true" className="size-4" /><span>Direitos e aprovações continuam sob controle humano.</span></div>
        </aside>

        {mode === 'editor' ? <AetheraEditorMode state={state} /> : <>
        <section className="aethera-workspace__monitor sg-panel" aria-label="Monitor da produção">
          <div className="aethera-monitor__screen">
            <div className="aethera-monitor__scanline" aria-hidden="true" />
            <div className="aethera-monitor__copy"><span className="aethera-workspace__eyebrow">Monitor ao vivo</span><strong>{currentStage ? STAGE_LABEL[currentStage.kind] : 'Aguardando próxima etapa'}</strong><p>{currentStage?.status === 'awaiting_approval' ? 'Uma decisão sua é necessária para continuar.' : currentStage?.status === 'running' ? 'A etapa está sendo executada pelo pipeline persistido.' : state.run.status === 'completed' ? 'A produção terminou todas as etapas registradas.' : 'Nenhuma etapa em execução neste momento.'}</p></div>
            <div className="aethera-monitor__orb" aria-hidden="true"><span /></div>
          </div>
          <div className="aethera-monitor__progress"><div className="aethera-monitor__progress-label"><span>Progresso da produção</span><strong>{Math.round(progress.ratio * 100)}%</strong></div><div className="aethera-progress" role="progressbar" aria-label="Progresso da produção" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}><span style={{ width: `${Math.round(progress.ratio * 100)}%` }} /></div></div>
          <div className="aethera-monitor__facts"><span><Clock3 aria-hidden="true" className="size-4" /> Atualizado {new Date(state.run.updatedAt).toLocaleString('pt-BR')}</span><span><ShieldCheck aria-hidden="true" className="size-4" /> Direitos preservados por etapa</span></div>
        </section>

        <aside className="aethera-workspace__inspector sg-panel" aria-label="Estado da produção">
          <div className="aethera-inspector__heading"><div><p className="aethera-workspace__eyebrow">Estado</p><h2>Controle</h2></div><span className="aethera-inspector__dot" aria-hidden="true" /></div>
          <div className="aethera-inspector__actions">
            <Button size="sm" variant="outline" disabled={finished || action.isPending || state.run.status === 'paused'} onClick={() => action.mutate('pause')}><Pause aria-hidden="true" /> Pausar</Button>
            <Button size="sm" variant="outline" disabled={finished || action.isPending} onClick={() => action.mutate('resume')}><Play aria-hidden="true" /> Retomar</Button>
            <Button size="sm" variant="outline" disabled={finished || action.isPending} onClick={() => action.mutate('cancel')}><Square aria-hidden="true" /> Cancelar</Button>
          </div>
          <dl className="aethera-inspector__facts"><div><dt>Agentes ativos (RF-07)</dt><dd>{activeAgentsLabel}</dd></div><div><dt>Orçamento</dt><dd>US$ {state.budget.consumedUsd.toFixed(2)} / US$ {state.budget.limitUsd.toFixed(2)}</dd></div><div><dt>Aprovações</dt><dd>{state.approvals.length} registradas</dd></div></dl>
          {action.isError && <p role="alert" className="aethera-workspace__error">{errorMessage(action.error)}</p>}
        </aside>
        </>}
      </div>

      {mode === 'automatic' && <><section className="aethera-workspace__planner sg-panel" aria-labelledby="aethera-planner-title"><div className="aethera-stages__heading"><div><p className="aethera-workspace__eyebrow">ProductionPlanner</p><h2 id="aethera-planner-title">Comando para plano revisável</h2></div><span>Sem novas mídias</span></div><form className="aethera-planner__form" onSubmit={(event) => { event.preventDefault(); planner.mutate(); }}><input aria-label="Comando de produção Aethera" value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Aethera, crie um vídeo sobre jogos já baixados…" /><Button size="sm" type="submit" disabled={!command.trim() || planner.isPending}>{planner.isPending ? 'Planejando…' : 'Gerar plano'}</Button></form>{planner.data && <PlannerResult plan={planner.data} onApply={() => applyPlan.mutate()} pending={applyPlan.isPending} />}{planner.isError && <p role="alert" className="aethera-workspace__error">{errorMessage(planner.error)}</p>}{applyPlan.isError && <p role="alert" className="aethera-workspace__error">{errorMessage(applyPlan.error)}</p>}</section><section className="aethera-workspace__stages sg-panel" aria-labelledby="aethera-stages-title"><div className="aethera-stages__heading"><div><p className="aethera-workspace__eyebrow">Linha de execução</p><h2 id="aethera-stages-title">Etapas persistidas</h2></div><span>{state.stages.length ? `${state.stages.length} etapas` : 'Nenhuma etapa agendada'}</span></div>{state.stages.length ? <ol className="aethera-stages">{state.stages.map((stage) => <StageRow key={stage.id} stage={stage} />)}</ol> : <div className="aethera-workspace__empty-inline"><RotateCcw aria-hidden="true" className="size-4" /> Inicie o fluxo no Studio para agendar as primeiras etapas.</div>}</section></>}
    </main>
  );
}

export function AetheraProductionWorkspace() {
  const { id } = useParams();
  const api = window.neuralbridge.video;
  const state = useQuery({ queryKey: ['aethera-production-workspace', id], queryFn: () => api.productionRunState(id ?? ''), enabled: Boolean(id) });
  if (!id) return <EmptyWorkspace />;
  if (state.isLoading) return <WorkspaceLoading />;
  if (state.isError) return <main className="aethera-workspace" data-module="aethera"><div className="aethera-workspace__empty sg-panel"><CircleAlert aria-hidden="true" className="size-8 text-[var(--destructive)]" /><h1>Não foi possível carregar a produção</h1><p>{errorMessage(state.error)}</p><Link to="/video" className="aethera-workspace__link">Voltar ao Studio</Link></div></main>;
  return state.data ? <WorkspaceContent state={state.data} /> : <EmptyWorkspace />;
}

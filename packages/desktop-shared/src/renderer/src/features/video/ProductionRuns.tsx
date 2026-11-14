import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { FileText, Pause, Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { VIDEO_FORMATS, wordsForDuration, type ProductionBrief, type ProductionRunView, type ProductionState } from '@neuralbridge/shared/velix-production';
import { LONG_SCRIPT_THRESHOLD_WORDS, PRODUCTION_TYPES, planChapters, type ProductionTypeId } from '@neuralbridge/shared/velix-long-script';
import { ProductionEvidence } from './ProductionEvidence';
import { ProductionGameResearch } from './ProductionGameResearch';
import { ProductionMediaHunter } from './ProductionMediaHunter';
import { ProductionEditorialUse } from './ProductionEditorialUse';
import { ProductionMatchReview } from './ProductionMatchReview';
import { ProductionVisualIndex } from './ProductionVisualIndex';
import { ProductionReferenceValidation } from './ProductionReferenceValidation';
import { ProductionNarration } from './ProductionNarration';
import { ProductionRender } from './ProductionRender';
import { ProductionStoryboard } from './ProductionStoryboard';
import { ProductionTimeline } from './ProductionTimeline';
import { ProgressBar } from './ProgressBar';
import { ProductionDerivatives } from './ProductionDerivatives';
import { aetheraProductionRoute } from '@neuralbridge/shared/aethera-workspace';

const INPUT = 'mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
type FormatId = keyof typeof VIDEO_FORMATS;
type Pace = ProductionBrief['pace'];

const RUN_LABEL: Record<ProductionRunView['status'], string> = { draft: 'Rascunho', running: 'Em execução', paused: 'Pausada', awaiting_approval: 'Aguardando aprovação', completed: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada' };
const STAGE_LABEL: Record<ProductionState['stages'][number]['kind'], string> = { briefing: 'Briefing', research: 'Pesquisa', script: 'Roteiro', storyboard: 'Storyboard', narration: 'Narração', sync: 'Sincronização', composition: 'Composição', render: 'Render', quality: 'Qualidade', preview: 'Prévia', export: 'Exportação', game_research: 'Pesquisa de jogos', media_acquisition: 'Aquisição de mídia', visual_index: 'Indexação visual', scene_matching: 'Cenas por frase', media_discovery: 'Descoberta de mídia' };
const STAGE_STATUS: Record<ProductionState['stages'][number]['status'], string> = { pending: 'Pendente', running: 'Em execução', paused: 'Pausada', awaiting_approval: 'Aguardando aprovação', completed: 'Concluída', failed: 'Falhou', cancelled: 'Cancelada' };
const usd = (value: number) => `US$ ${value.toFixed(2)}`;

/** Persisted productions of the project: create one from a brief, follow its stages and act on pause, resume, cancel and approvals. */
export function ProductionRuns({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const api = window.neuralbridge.video;
  const [selected, setSelected] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [formatId, setFormatId] = useState<FormatId>('youtube-long');
  const [minutes, setMinutes] = useState(8);
  const [pace, setPace] = useState<Pace>('standard');
  const [productionType, setProductionType] = useState<ProductionTypeId>('documentary');
  const [budget, setBudget] = useState(5);
  const runs = useQuery({ queryKey: ['velix-production-runs', projectId], queryFn: () => api.productionRunList(projectId) });
  const runId = selected ?? runs.data?.[0]?.id ?? null;
  const state = useQuery({ queryKey: ['velix-production-run', runId], queryFn: () => api.productionRunState(runId ?? ''), enabled: !!runId });
  useEffect(() => api.onProductionRunChanged(({ runId: changed }) => {
    void client.invalidateQueries({ queryKey: ['velix-production-runs', projectId] });
    void client.invalidateQueries({ queryKey: ['velix-production-run', changed] });
  }), [api, client, projectId]);
  const refresh = (next: ProductionState) => { client.setQueryData(['velix-production-run', next.run.id], next); void runs.refetch(); };
  const words = wordsForDuration(minutes * 60, pace);
  const create = useMutation({
    mutationFn: () => {
      const { id, width, height, fps, aspectRatio, safeArea } = VIDEO_FORMATS[formatId];
      const format = { id, width, height, fps, aspectRatio, safeArea };
      return api.productionRunCreate({ projectId, brief: { schemaVersion: 1, projectId, format, productionType, topic: topic.trim(), targetDurationSeconds: minutes * 60, targetWords: words.estimate, language: 'pt-BR', audience: 'geral', tone: PRODUCTION_TYPES[productionType].tone, narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 5, pace, budgetUsd: budget } });
    },
    onSuccess: (next) => { setSelected(next.run.id); setTopic(''); refresh(next); },
  });
  const act = useMutation({
    mutationFn: (action: { kind: 'pause' | 'resume' | 'cancel'; runId: string } | { kind: 'decide'; stageId: string; decision: 'approved' | 'rejected' }) =>
      action.kind === 'decide' ? api.productionRunDecide({ stageId: action.stageId, decision: action.decision }) : action.kind === 'pause' ? api.productionRunPause(action.runId) : action.kind === 'resume' ? api.productionRunResume(action.runId) : api.productionRunCancel(action.runId),
    onSuccess: refresh,
  });
  const current = state.data;
  const finished = current && (current.run.status === 'cancelled' || current.run.status === 'completed');
  const scriptStage = current?.stages.filter((stage) => stage.kind === 'script').at(-1);
  const script = useQuery({ queryKey: ['velix-production-script', runId, scriptStage?.status, scriptStage?.outputArtifactIds.length], queryFn: () => api.productionRunScriptRead(runId ?? ''), enabled: !!runId && scriptStage?.status === 'completed' });
  const writeScript = useMutation({ mutationFn: (id: string) => api.productionRunScript({ runId: id }), onSuccess: refresh });
  const chapters = words.estimate > LONG_SCRIPT_THRESHOLD_WORDS ? planChapters(words.estimate).length : 0;
  return (
    <section aria-labelledby="velix-runs-title" className="space-y-4 sg-panel rounded-lg p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="velix-runs-title" className="font-medium">Produções persistidas</h2>
        <p className="text-xs text-muted-foreground">Cada etapa roda como tarefa do Singularity e é retomada após reiniciar o app.</p>
      </div>
      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))_auto] lg:items-end" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
        <label className="block text-sm font-medium">Tema<input aria-label="Tema da nova produção" className={INPUT} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Tema da produção" required /></label>
        <label className="block text-sm font-medium">Tipo<select aria-label="Tipo de produção" className={INPUT} value={productionType} onChange={(event) => { const next = event.target.value as ProductionTypeId; setProductionType(next); setPace(PRODUCTION_TYPES[next].pace); }}>{Object.entries(PRODUCTION_TYPES).map(([id, type]) => <option key={id} value={id}>{type.label}</option>)}</select></label>
        <label className="block text-sm font-medium">Formato<select aria-label="Formato" className={INPUT} value={formatId} onChange={(event) => setFormatId(event.target.value as FormatId)}>{Object.values(VIDEO_FORMATS).map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}</select></label>
        <label className="block text-sm font-medium">Duração (min)<input aria-label="Duração em minutos" type="number" min={0.25} max={180} step={0.25} className={INPUT} value={minutes} onChange={(event) => setMinutes(Number(event.target.value) || 0.25)} /></label>
        <label className="block text-sm font-medium">Ritmo<select aria-label="Ritmo da narração" className={INPUT} value={pace} onChange={(event) => setPace(event.target.value as Pace)}><option value="slow">Lento</option><option value="standard">Padrão</option><option value="fast">Rápido</option></select></label>
        <label className="block text-sm font-medium">Orçamento (US$)<input aria-label="Orçamento em dólares" type="number" min={0} max={10_000} step={0.5} className={INPUT} value={budget} onChange={(event) => setBudget(Math.max(0, Number(event.target.value) || 0))} /></label>
        <Button type="submit" className="min-h-11" disabled={!topic.trim() || create.isPending}>{create.isPending ? 'Criando…' : 'Nova produção'}</Button>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-full">Meta de narração: cerca de {words.estimate} palavras (faixa {words.min}–{words.max}). {chapters ? `Roteiro longo: ${chapters} capítulos escritos em lotes.` : 'Roteiro curto: uma chamada no formato Dossiê.'}</p>
      </form>
      {create.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(create.error)}</p>}
      {runs.data && runs.data.length > 0 && (
        <label className="block text-sm font-medium">Produção<select aria-label="Produção selecionada" className={INPUT} value={runId ?? ''} onChange={(event) => setSelected(event.target.value)}>{runs.data.map((run) => <option key={run.id} value={run.id}>{run.topic} · {VIDEO_FORMATS[run.formatId as FormatId]?.label ?? run.formatId} · {RUN_LABEL[run.status]}</option>)}</select></label>
      )}
      {runs.data?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma produção persistida neste projeto.</p>}
      {current && (
        <div className="space-y-3" aria-label="Estado da produção">
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className="rounded-full border px-2.5 py-1 text-xs font-medium">{RUN_LABEL[current.run.status]}</span>
            <span className="text-xs text-muted-foreground">Agente: {current.run.agent === 'codex' ? 'Codex' : 'Claude'} · Previsto {usd(current.run.estimatedCostUsd)} · Real {usd(current.run.actualCostUsd)} · Reservado {usd(current.budget.reserveUsd)} de {usd(current.budget.limitUsd)}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Link to={aetheraProductionRoute(current.run.id)} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium hover:border-primary hover:text-primary">Abrir workspace Aethera</Link>
              <Button size="sm" variant="outline" className="min-h-11" disabled={finished || current.run.status === 'paused' || act.isPending} onClick={() => act.mutate({ kind: 'pause', runId: current.run.id })}><Pause aria-hidden />Pausar</Button>
              <Button size="sm" variant="outline" className="min-h-11" disabled={finished || act.isPending} onClick={() => act.mutate({ kind: 'resume', runId: current.run.id })}><Play aria-hidden />Retomar</Button>
              <Button size="sm" variant="outline" className="min-h-11" disabled={finished || act.isPending} onClick={() => act.mutate({ kind: 'cancel', runId: current.run.id })}><Square aria-hidden />Cancelar</Button>
            </div>
          </div>
          {!scriptStage || scriptStage.status === 'cancelled' ? (
            <Button className="min-h-11" disabled={finished || writeScript.isPending} onClick={() => writeScript.mutate(current.run.id)}><FileText aria-hidden />{writeScript.isPending ? 'Agendando…' : 'Gerar roteiro'}</Button>
          ) : null}
          {writeScript.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(writeScript.error)}</p>}
          <ProgressBar label="Orçamento consumido" value={current.budget.limitUsd > 0 ? (current.budget.consumedUsd / current.budget.limitUsd) * 100 : 0} />
          {current.stages.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma etapa agendada ainda.</p> : (
            <ol className="space-y-2" aria-label="Etapas da produção">
              {current.stages.map((stage) => (
                <li key={stage.id} className="rounded border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{STAGE_LABEL[stage.kind]}</span><span className="text-xs text-muted-foreground">{STAGE_STATUS[stage.status]} · {usd(stage.actualCostUsd || stage.costEstimateUsd)}{stage.retryCount ? ` · ${stage.retryCount} nova(s) tentativa(s)` : ''} · {stage.outputArtifactIds.length} artefato(s)</span></div>
                  {(stage.status === 'running' || stage.status === 'paused') && <div className="mt-2"><ProgressBar label={`Progresso de ${STAGE_LABEL[stage.kind]}`} value={stage.progress > 0 ? stage.progress * 100 : null} /></div>}
                  {stage.error && <p className="mt-1 text-xs text-muted-foreground">{stage.error.message}</p>}
                  {stage.status === 'awaiting_approval' && (
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" className="min-h-11" disabled={act.isPending} onClick={() => act.mutate({ kind: 'decide', stageId: stage.id, decision: 'approved' })}>Aprovar custo</Button>
                      <Button size="sm" variant="outline" className="min-h-11" disabled={act.isPending} onClick={() => act.mutate({ kind: 'decide', stageId: stage.id, decision: 'rejected' })}>Rejeitar</Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <ProductionGameResearch state={current} onState={refresh} />
          <ProductionMediaHunter state={current} onState={refresh} />
          <ProductionEditorialUse state={current} />
          <ProductionVisualIndex state={current} onState={refresh} />
          <ProductionMatchReview state={current} onState={refresh} />
          <ProductionReferenceValidation state={current} />
          {script.data && (
            <div aria-label="Roteiro consolidado" className="space-y-2 rounded border p-3 text-sm">
              <p className="font-medium">{script.data.title}</p>
              <p className="text-xs text-muted-foreground">{script.data.words} palavras para uma meta de {script.data.targetWords} · {script.data.mode === 'chapters' ? `${script.data.chapters?.length ?? 0} capítulos · ${script.data.removedRepetitions?.length ?? 0} repetição(ões) removida(s)` : 'formato Dossiê v1'}</p>
              {(script.data.issues?.length ?? 0) > 0 && <ul aria-label="Pontos de revisão do roteiro" className="list-disc space-y-1 pl-5 text-xs">{script.data.issues?.map((issue) => <li key={`${issue.code}-${issue.chapter}`}>{issue.message}</li>)}</ul>}
              {script.data.chapters ? (
                <ol className="space-y-1 text-xs">{script.data.chapters.map((chapter) => <li key={chapter.n}><details><summary className="cursor-pointer">{chapter.n}. {chapter.title} · {chapter.words} palavras</summary><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{chapter.narration}</p></details></li>)}</ol>
              ) : <details><summary className="cursor-pointer text-xs">Narração</summary><p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{script.data.narration}</p></details>}
            </div>
          )}
          {scriptStage?.status === 'completed' && <ProductionEvidence state={current} onState={refresh} />}
          {current.stages.some((stage) => stage.kind === 'storyboard' && stage.status === 'completed') && <ProductionTimeline state={current} onState={refresh} />}
          {scriptStage?.status === 'completed' && <ProductionStoryboard state={current} onState={refresh} />}
          {current.stages.some((stage) => stage.kind === 'storyboard' && stage.status === 'completed') && <ProductionNarration state={current} onState={refresh} />}
          {current.stages.some((stage) => stage.kind === 'sync' && stage.status === 'completed') && <ProductionRender state={current} onState={refresh} />}
          {current.stages.some((stage) => stage.kind === 'sync' && stage.status === 'completed') && <ProductionDerivatives runId={current.run.id} />}
        </div>
      )}
      {(act.isError || state.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(act.error ?? state.error)}</p>}
    </section>
  );
}

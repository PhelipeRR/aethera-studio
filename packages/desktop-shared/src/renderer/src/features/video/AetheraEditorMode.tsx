import { useEffect, useMemo, useState } from 'react';
import { Film, Lock, Music2, RefreshCw, Save, Scissors, Sparkles, Unlock } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { assembleTimeline, type TimelineClip, type TimelineDocument, type TimelineOp } from '@neuralbridge/shared/aethera-timeline';
import { compileAetheraTimeline } from '@neuralbridge/shared/aethera-timeline-composition';
import { applyAetheraTimelineAssistantPlan, planAetheraTimelineCommand, type AetheraTimelineAssistantPlan } from '@neuralbridge/shared/aethera-timeline-assistant';
import type { StoryboardView } from '@neuralbridge/shared/velix-storyboard';
import type { ProductionState } from '@neuralbridge/shared/velix-production';
import AetheraTimelinePreview from './motion/AetheraTimelinePreview';
import { AetheraEditorialPlanPanel } from './AetheraEditorialPlanPanel';

const seconds = (ms: number) => `${(ms / 1_000).toFixed(1)} s`;

function sceneLabel(view: StoryboardView, sceneId: string) {
  const scene = view.scenes.find((item) => item.id === sceneId);
  return scene ? `Cena ${view.scenes.indexOf(scene) + 1}` : 'Clipe';
}

function clipForScene(timeline: TimelineDocument, sceneId: string): TimelineClip | null {
  return timeline.tracks.flatMap((track) => track.items).find((clip) => clip.sceneIds.includes(sceneId)) ?? null;
}

/** The footage (or, without footage, the graphic) a person can mark as real record, illustrative or reconstruction. */
function depictionClipForScene(timeline: TimelineDocument, sceneId: string): TimelineClip | null {
  const footage = timeline.tracks.find((track) => track.kind === 'video')?.items.filter((clip) => clip.sceneIds.includes(sceneId)) ?? [];
  return footage.find((clip) => !clip.id.startsWith('video:backdrop:')) ?? footage[0] ?? timeline.tracks.find((track) => track.kind === 'graphics')?.items.find((clip) => clip.sceneIds.includes(sceneId)) ?? null;
}

function textClipForScene(timeline: TimelineDocument, sceneId: string): TimelineClip | null {
  return timeline.tracks.find((track) => track.kind === 'text')?.items.find((clip) => clip.sceneIds.includes(sceneId)) ?? null;
}

function cameraForClip(clip: TimelineClip): 'static' | 'push-in' | 'pan' {
  if (clip.keyframes.some((keyframe) => keyframe.property === 'scale' && keyframe.value > 1)) return 'push-in';
  if (clip.keyframes.some((keyframe) => keyframe.property === 'x')) return 'pan';
  return 'static';
}

function transitionForClip(clip: TimelineClip): 'cut' | 'fade' | 'slide' {
  if (!clip.exit) return 'cut';
  return clip.exit.id === 'fade' || clip.exit.id === 'slide' ? clip.exit.id : 'cut';
}

function visualLabel(scene: StoryboardView['scenes'][number]): string {
  if (scene.visual.type === 'asset') return scene.visual.title;
  if (scene.visual.type === 'fallback') return `Fallback: ${scene.visual.kind}`;
  return 'Sem visual';
}

export function AetheraEditorMode({ state }: { state: ProductionState }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const storyboard = useQuery({ queryKey: ['aethera-editor-storyboard', runId], queryFn: () => api.storyboardGet(runId) });
  const timelineVersion = useQuery({ queryKey: ['aethera-timeline', runId], queryFn: () => api.aetheraTimelineGet(runId) });
  const timelineHistory = useQuery({ queryKey: ['aethera-timeline-history', runId], queryFn: () => api.aetheraTimelineHistory(runId), enabled: Boolean(timelineVersion.data) });
  const renders = useQuery({ queryKey: ['aethera-renders', runId], queryFn: () => api.productionRenders(runId) });
  const review = useQuery({ queryKey: ['aethera-review', runId], queryFn: () => api.aetheraReviewLatest(runId), enabled: Boolean(timelineVersion.data) });
  const view = storyboard.data;
  const baseTimeline = useMemo(() => view ? assembleTimeline({ runId, storyboard: { schemaVersion: 1, scenes: view.scenes, timing: view.timing, ...(view.scenes.find((scene) => scene.audio)?.audio?.key ? { narrationKey: view.scenes.find((scene) => scene.audio)?.audio?.key } : {}) }, format: state.brief.format }) : null, [runId, state.brief.format, view]);
  const timelineDocument = timelineVersion.data?.document ?? baseTimeline;
  const createTimeline = useMutation({ mutationFn: (document: TimelineDocument) => api.aetheraTimelineCreate({ runId, document }), onSuccess: (next) => client.setQueryData(['aethera-timeline', runId], next) });
  const applyTimeline = useMutation({ mutationFn: (input: { baseVersion: number; ops: AetheraTimelineAssistantPlan['ops']; command?: string }) => api.aetheraTimelineApply({ runId, ...input }), onSuccess: (next) => { client.setQueryData(['aethera-timeline', runId], next); setDraftTimeline(next.document); } });
  const restoreTimeline = useMutation({ mutationFn: (input: { baseVersion: number; version: number }) => api.aetheraTimelineRestore({ runId, ...input }), onSuccess: (next) => { client.setQueryData(['aethera-timeline', runId], next); setDraftTimeline(next.document); setUndoVersion(null); } });
  useEffect(() => { if (timelineVersion.isSuccess && timelineVersion.data === null && baseTimeline && !createTimeline.isPending && !createTimeline.data) createTimeline.mutate(baseTimeline); }, [baseTimeline, createTimeline, timelineVersion.data, timelineVersion.isSuccess, timelineVersion.isPending]);
  const [prevTimelineDoc, setPrevTimelineDoc] = useState<TimelineDocument | null>(timelineDocument);
  const [draftTimeline, setDraftTimeline] = useState<TimelineDocument | null>(null);
  const [undoVersion, setUndoVersion] = useState<number | null>(null);
  const [assistantCommand, setAssistantCommand] = useState('');
  const [assistantPlan, setAssistantPlan] = useState<AetheraTimelineAssistantPlan | null>(null);
  if (timelineDocument !== prevTimelineDoc) {
    setPrevTimelineDoc(timelineDocument);
    setDraftTimeline(timelineDocument);
    setUndoVersion(null);
    setAssistantPlan(null);
  }
  const [musicGenre, setMusicGenre] = useState('cinematic electronic');
  const [musicEmotion, setMusicEmotion] = useState('tensão controlada');
  const [musicIntensity, setMusicIntensity] = useState<'low' | 'medium' | 'high'>('medium');
  const generateMusic = useMutation({ mutationFn: () => timeline ? api.aetheraMusicGenerate({ runId, sceneIds: view?.scenes.map((scene) => scene.id) ?? [], genre: musicGenre.trim(), emotion: musicEmotion.trim(), intensity: musicIntensity, durationMs: Math.min(480_000, Math.max(10_000, timeline.durationMs)), mood: [musicGenre.trim(), musicEmotion.trim()].filter(Boolean) }) : Promise.reject(new Error('A timeline ainda não foi criada.')), onSuccess: () => client.invalidateQueries({ queryKey: ['aethera-timeline', runId] }) });
  const runReview = useMutation({ mutationFn: () => api.aetheraReviewRun({ runId, requestedCycles: 2 }), onSuccess: (next) => { client.setQueryData(['aethera-review', runId], next); client.invalidateQueries({ queryKey: ['aethera-timeline', runId] }); } });
  const renderFinal = useMutation({
    mutationFn: () => api.productionRunRender({
      runId,
      formatId: state.brief.format.id === 'custom' ? 'youtube-long' : state.brief.format.id,
    }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['aethera-renders', runId] }); void client.invalidateQueries({ queryKey: ['aethera-production-workspace', runId] }); },
  });
  const timeline = draftTimeline ?? timelineDocument;
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const selectedScene = view?.scenes.find((scene) => scene.id === selectedSceneId) ?? view?.scenes[0];
  const selectedClip = selectedScene && timeline ? clipForScene(timeline, selectedScene.id) : null;
  const sceneTextKey = selectedScene ? `${selectedScene.id}:${selectedScene.onScreenText}` : '';
  const [prevSceneTextKey, setPrevSceneTextKey] = useState(sceneTextKey);
  const [textDraft, setTextDraft] = useState(selectedScene?.onScreenText ?? '');
  if (sceneTextKey !== prevSceneTextKey) {
    setPrevSceneTextKey(sceneTextKey);
    if (selectedScene) setTextDraft(selectedScene.onScreenText);
  }
  const editTimeline = useMutation({
    mutationFn: (input: { baseVersion: number; op: TimelineOp }) => api.aetheraTimelineApply({ runId, baseVersion: input.baseVersion, ops: [input.op] }),
    onSuccess: (next) => { client.setQueryData(['aethera-timeline', runId], next); setDraftTimeline(next.document); },
  });
  if (storyboard.isLoading) return <section className="aethera-editor sg-panel" aria-busy="true"><p>Carregando timeline persistida…</p></section>;
  if (storyboard.isError || !view || !timeline) return <section className="aethera-editor sg-panel"><p role="alert">{errorMessage(storyboard.error ?? new Error('A timeline ainda não foi criada para esta produção.'))}</p></section>;
  const previewProps = compileAetheraTimeline(timeline, { fromMs: 0, durationMs: Math.max(1, timeline.durationMs) });
  const total = Math.max(1, timeline.durationMs);
  const selectedTextClip = selectedScene ? textClipForScene(timeline, selectedScene.id) : null;
  const selectedCamera = selectedClip ? cameraForClip(selectedClip) : selectedScene?.camera ?? 'static';
  const selectedTransition = selectedClip ? transitionForClip(selectedClip) : selectedScene?.transition ?? 'cut';
  const selectedDepictionClip = selectedScene && timeline ? depictionClipForScene(timeline, selectedScene.id) : null;
  const selectedLocked = selectedClip?.locked ?? selectedScene?.locked ?? false;
  const place = (startMs: number, durationMs: number) => ({ left: `${(startMs / total) * 100}%`, width: `${Math.max(1.2, (durationMs / total) * 100)}%` });

  return (
    <section className="aethera-editor" aria-label="Editor Aethera">
      <div className="aethera-editor__header">
        <div><p className="aethera-workspace__eyebrow">Revisão final & Edição</p><h2>Montagem assistida</h2></div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="aethera-editor__version">Timeline v{timeline.version} · {seconds(timeline.durationMs)} · {timeline.fps} fps</span>
          <Button size="sm" type="button" onClick={() => renderFinal.mutate()} disabled={renderFinal.isPending || !timelineVersion.data}>
            {renderFinal.isPending ? 'Renderizando…' : 'Aprovar e Exportar'}
          </Button>
        </div>
      </div>
      {renderFinal.isError && <p role="alert" className="aethera-workspace__error">{errorMessage(renderFinal.error)}</p>}
      {renders.data?.renders[0] && (
        <p className="aethera-editor__hint" role="status">
          Último render ({renders.data.renders[0].formatId}): {renders.data.renders[0].exportable ? 'pronto para exportar' : 'em revisão'} · {renders.data.renders[0].relativePath}
        </p>
      )}
      <div className="aethera-editor__layout">
        <div className="aethera-editor__center">
          <AetheraTimelinePreview props={previewProps} />
          <div className="aethera-editor__timeline sg-panel" aria-label="Timeline interativa"><div className="aethera-editor__ruler"><span>00:00</span><span>{seconds(total / 2)}</span><span>{seconds(total)}</span></div>{timeline.tracks.filter((track) => track.items.length > 0).map((track) => <div className="aethera-editor__track" key={track.id}><span className="aethera-editor__track-label">{track.label}</span><div className="aethera-editor__lane">{track.items.map((clip) => { const sceneId = clip.sceneIds[0]; if (!sceneId) return null; const active = sceneId === selectedScene?.id; return <button type="button" key={clip.id} aria-label={`${sceneLabel(view, sceneId)} · ${clip.label}`} aria-pressed={active} className={`aethera-editor__clip ${active ? 'is-active' : ''}`} style={place(clip.startMs, clip.durationMs)} onClick={() => setSelectedSceneId(sceneId)}><span>{sceneLabel(view, sceneId)}</span></button>; })}</div></div>)}</div>
          <p className="aethera-editor__hint"><Scissors aria-hidden="true" className="size-4" /> Selecione um clipe para ajustar câmera, transição, texto e bloqueio. Cada alteração cria uma nova versão persistida da timeline.</p>
        </div>
        <aside className="aethera-editor__inspector sg-panel" aria-label="Inspetor contextual"><div className="aethera-editor__panel-title"><div><p className="aethera-workspace__eyebrow">Inspetor</p><h3>{selectedScene ? `Cena ${view.scenes.indexOf(selectedScene) + 1}` : 'Nenhum clipe'}</h3></div><Film aria-hidden="true" className="size-5 text-[var(--aethera-signal)]" /></div>{selectedScene && selectedClip ? <><p className="aethera-editor__scene-copy">{selectedScene.narration}</p><dl className="aethera-editor__clip-meta"><div><dt>Entrada</dt><dd>{seconds(selectedClip.startMs)}</dd></div><div><dt>Duração</dt><dd>{seconds(selectedClip.durationMs)}</dd></div><div><dt>Fonte</dt><dd>{visualLabel(selectedScene)}</dd></div></dl><label className="aethera-editor__field">Câmera<select value={selectedCamera} disabled={!timelineVersion.data || editTimeline.isPending} onChange={(event) => editTimeline.mutate({ baseVersion: timeline.version, op: { op: 'setCamera', selector: { clipIds: [selectedClip.id] }, camera: event.target.value as 'static' | 'push-in' | 'pan' } })}><option value="static">Estática</option><option value="push-in">Push-in</option><option value="pan">Pan</option></select></label><label className="aethera-editor__field">Transição<select value={selectedTransition} disabled={!timelineVersion.data || editTimeline.isPending} onChange={(event) => editTimeline.mutate({ baseVersion: timeline.version, op: { op: 'setTransition', selector: { clipIds: [selectedClip.id] }, transition: event.target.value as 'cut' | 'fade' | 'slide', durationMs: 250 } })}><option value="cut">Corte</option><option value="fade">Dissolve</option><option value="slide">Deslize</option></select></label>{selectedDepictionClip && <label className="aethera-editor__field">Natureza da imagem<select value={selectedDepictionClip.depiction ?? 'real_record'} disabled={!timelineVersion.data || editTimeline.isPending} aria-describedby="aethera-depiction-hint" onChange={(event) => editTimeline.mutate({ baseVersion: timeline.version, op: { op: 'setDepiction', selector: { clipIds: [selectedDepictionClip.id] }, depiction: event.target.value as 'real_record' | 'illustrative' | 'reconstruction' } })}><option value="real_record">Registro real</option><option value="illustrative">Ilustrativa (selo na tela)</option><option value="reconstruction">Reconstituição (selo na tela)</option></select><span id="aethera-depiction-hint" className="aethera-editor__hint">Marcação humana; não altera direitos nem a origem da mídia.</span></label>}<label className="aethera-editor__field">Texto na tela<input value={textDraft} onChange={(event) => setTextDraft(event.target.value)} onBlur={() => { if (selectedTextClip && textDraft !== (selectedTextClip.source.kind === 'text' ? selectedTextClip.source.text : '')) editTimeline.mutate({ baseVersion: timeline.version, op: { op: 'setText', selector: { clipIds: [selectedTextClip.id] }, text: textDraft } }); }} placeholder="Sem texto sobreposto" /></label><Button size="sm" variant="outline" disabled={!selectedTextClip || !timelineVersion.data || editTimeline.isPending} onClick={() => { if (selectedTextClip) editTimeline.mutate({ baseVersion: timeline.version, op: { op: 'setText', selector: { clipIds: [selectedTextClip.id] }, text: textDraft } }); }}><Save aria-hidden="true" /> Salvar texto</Button><Button size="sm" variant="outline" disabled={!timelineVersion.data || editTimeline.isPending} onClick={() => editTimeline.mutate({ baseVersion: timeline.version, op: { op: 'setClipLock', selector: { clipIds: [selectedClip.id] }, locked: !selectedLocked } })}>{selectedLocked ? <Unlock aria-hidden="true" /> : <Lock aria-hidden="true" />}{selectedLocked ? 'Desbloquear cena' : 'Bloquear cena'}</Button>{selectedScene.visual.type === 'asset' && <p className="aethera-editor__rights"><Sparkles aria-hidden="true" className="size-4" /> Fonte já presente na produção: {selectedScene.visual.referenceId}. Nenhuma autorização foi alterada.</p>}</> : <p className="aethera-editor__scene-copy">Selecione um clipe na timeline para abrir suas propriedades.</p>}{editTimeline.isError && <p role="alert" className="aethera-workspace__error">{errorMessage(editTimeline.error)}</p>}</aside>
      </div>
      <AetheraEditorialPlanPanel runId={runId} timelineVersion={timelineVersion.data?.version ?? null} />
      <section className="aethera-editor__assistant sg-panel" aria-label="Revisão automática"><div className="aethera-editor__panel-title"><div><p className="aethera-workspace__eyebrow">Revisão</p><h3>Quality Director estrutural</h3></div><RefreshCw aria-hidden="true" className="size-5 text-[var(--aethera-signal)]" /></div><p className="aethera-editor__scene-copy">Analisa a mesma timeline compilada para o Player, aplica no máximo dois ciclos de correções estruturais de baixo risco e preserva direitos para revisão humana.</p><Button size="sm" variant="outline" onClick={() => runReview.mutate()} disabled={runReview.isPending || !timelineVersion.data}>{runReview.isPending ? 'Revisando…' : 'Executar revisão'}</Button>{runReview.isError && <p role="alert" className="aethera-workspace__error">{errorMessage(runReview.error)}</p>}{review.data && <div className="mt-3 space-y-2" role="status"><p className="aethera-editor__scene-copy">Timeline v{review.data.timelineVersion} · {review.data.findings.length} achado(s) · {review.data.cycles} ciclo(s) aplicado(s).</p>{review.data.findings.length > 0 ? <ul className="space-y-1 text-sm">{review.data.findings.map((finding) => <li key={finding.id}><span className="font-semibold">{finding.severity === 'blocking' ? 'Bloqueante' : 'Aviso'}:</span> {finding.message}</li>)}</ul> : <p className="text-sm text-emerald-300">Nenhum achado estrutural. A validação audiovisual do render continua separada.</p>}</div>}</section>
      <section className="aethera-editor__assistant sg-panel" aria-label="Assistente na timeline"><div className="aethera-editor__panel-title"><div><p className="aethera-workspace__eyebrow">Assistente</p><h3>Editar por comando</h3></div><Sparkles aria-hidden="true" className="size-5 text-[var(--aethera-signal)]" /></div><p className="aethera-editor__scene-copy">O assistente identifica as cenas afetadas, preserva o restante aprovado e permite desfazer qualquer versão.</p><div className="mb-2 flex flex-wrap gap-2">{['A introdução ficou lenta, deixe mais impactante', 'Aplique dissolve cinemático nas cenas', 'Aumente o ritmo da edição'].map((preset) => <button key={preset} type="button" className="rounded-md border border-[var(--sg-border)] px-2 py-1 text-xs opacity-80 hover:opacity-100" onClick={() => setAssistantCommand(preset)}>{preset}</button>)}</div><div className="aethera-editor__assistant-form"><input aria-label="Comando de edição" value={assistantCommand} onChange={(event) => setAssistantCommand(event.target.value)} placeholder="ex.: A introdução ficou lenta. Deixe mais impactante…" /><Button size="sm" variant="outline" onClick={() => setAssistantPlan(planAetheraTimelineCommand({ timeline, command: assistantCommand }))} disabled={!assistantCommand.trim()}>Propor edição</Button></div>{assistantPlan && <div className={`aethera-editor__assistant-result aethera-editor__assistant-result--${assistantPlan.status}`} role="status"><p>{assistantPlan.summary}</p>{assistantPlan.diff.length > 0 && <ul>{assistantPlan.diff.map((item) => <li key={item.clipId}>{item.kind}: {item.clipId}</li>)}</ul>}<div className="aethera-editor__assistant-actions"><Button size="sm" onClick={() => { const applied = applyAetheraTimelineAssistantPlan(timeline, assistantPlan); setUndoVersion(timeline.version); setDraftTimeline(applied.document); applyTimeline.mutate({ baseVersion: timeline.version, ops: assistantPlan.ops, ...(assistantPlan.command ? { command: assistantPlan.command } : {}) }); setAssistantPlan(null); }} disabled={assistantPlan.status !== 'ready' || !timelineVersion.data || applyTimeline.isPending}>Aplicar alteração</Button><Button size="sm" variant="outline" onClick={() => { if (!undoVersion || !timelineVersion.data) return; restoreTimeline.mutate({ baseVersion: timeline.version, version: undoVersion }); }} disabled={!undoVersion || restoreTimeline.isPending || !timelineVersion.data}>Desfazer</Button></div>{(applyTimeline.isError || restoreTimeline.isError) && <p role="alert" className="aethera-workspace__error">{errorMessage(applyTimeline.error ?? restoreTimeline.error)}</p>}</div>}{timelineHistory.data && timelineHistory.data.length > 1 && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="opacity-75">Histórico de versões:</span>{timelineHistory.data.slice(-5).reverse().map((ver) => <button key={ver.version} type="button" disabled={ver.version === timeline.version || restoreTimeline.isPending} className={`rounded border px-2 py-0.5 ${ver.version === timeline.version ? 'border-[var(--aethera-signal)] font-semibold' : 'border-[var(--sg-border)] opacity-80 hover:opacity-100'}`} onClick={() => restoreTimeline.mutate({ baseVersion: timeline.version, version: ver.version })}>v{ver.version}</button>)}</div>}</section>
      <section className="aethera-editor__assistant sg-panel" aria-label="Gerador musical local"><div className="aethera-editor__panel-title"><div><p className="aethera-workspace__eyebrow">Sound design local</p><h3>Trilha instrumental ACE-Step</h3></div><Music2 aria-hidden="true" className="size-5 text-[var(--aethera-signal)]" /></div><p className="aethera-editor__scene-copy">Gera somente no ACE-Step local, usando as cenas já presentes. A faixa fica registrada como não comercial e entra no mix com ducking; os 31 SFX não são alterados.</p><div className="aethera-editor__assistant-form"><input aria-label="Gênero da trilha" value={musicGenre} onChange={(event) => setMusicGenre(event.target.value)} placeholder="Gênero" /><input aria-label="Emoção da trilha" value={musicEmotion} onChange={(event) => setMusicEmotion(event.target.value)} placeholder="Emoção" /><select aria-label="Intensidade da trilha" value={musicIntensity} onChange={(event) => setMusicIntensity(event.target.value as 'low' | 'medium' | 'high')}><option value="low">Baixa</option><option value="medium">Média</option><option value="high">Alta</option></select><Button size="sm" variant="outline" onClick={() => generateMusic.mutate()} disabled={generateMusic.isPending || !musicGenre.trim() || !musicEmotion.trim() || !view.scenes.length}>{generateMusic.isPending ? 'Gerando localmente…' : 'Gerar trilha'}</Button></div>{generateMusic.data && <p className="aethera-editor__scene-copy" role="status">Trilha registrada: {generateMusic.data.track.id} · {generateMusic.data.cacheHit ? 'reutilizada do cache' : 'gerada agora'} · uso não comercial.</p>}{generateMusic.isError && <p role="alert" className="aethera-workspace__error">{errorMessage(generateMusic.error)}</p>}</section>
      <div className="aethera-editor__library sg-panel" aria-label="Biblioteca da produção"><div className="aethera-editor__panel-title"><div><p className="aethera-workspace__eyebrow">Biblioteca</p><h3>Mídias já usadas</h3></div><span>{view.scenes.length} cenas</span></div><ul>{view.scenes.map((scene, index) => <li key={scene.id}><button type="button" className={scene.id === selectedScene?.id ? 'is-active' : ''} onClick={() => setSelectedSceneId(scene.id)}><span>{String(index + 1).padStart(2, '0')}</span><span>{visualLabel(scene)}</span><small>{scene.visual.type === 'asset' ? 'fonte existente' : 'gráfico/fallback'}</small></button></li>)}</ul></div>
    </section>
  );
}

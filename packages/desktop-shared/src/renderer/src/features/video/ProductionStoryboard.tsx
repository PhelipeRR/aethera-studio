import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Copy, LayoutGrid, Lock, LockOpen, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { fallbackKinds, type FallbackKind, type StoryboardEdit, type StoryboardScene, type StoryboardView } from '@neuralbridge/shared/velix-storyboard';
import type { ProductionState } from '@neuralbridge/shared/velix-production';

const FALLBACK_LABEL: Record<FallbackKind, string> = { typography: 'Tipografia', document: 'Documento', chart: 'Gráfico verificado', animation: 'Animação' };
const RIGHTS_LABEL: Record<string, string> = { verified_allowed: 'Autorizada', conditional: 'Condicional', unverified: 'Direitos não verificados', blocked: 'Bloqueada', pending_review: 'Encontrada, aguardando revisão' };
const time = (ms: number) => { const total = Math.round(ms / 1_000); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };

function visualLabel(scene: StoryboardScene): string {
  if (scene.visual.type === 'asset') return `${scene.visual.kind === 'image' ? 'Imagem' : 'Vídeo'}: ${scene.visual.title}`;
  if (scene.visual.type === 'fallback') return `Fallback: ${FALLBACK_LABEL[scene.visual.kind]}`;
  return 'Sem mídia nem fallback';
}

/** The run's storyboard: every edit is a new version, saved on top of the one shown, so a restart restores it exactly. */
export function ProductionStoryboard({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const stage = state.stages.filter((item) => item.kind === 'storyboard').at(-1);
  const key = ['velix-storyboard', runId];
  const storyboard = useQuery({ queryKey: key, queryFn: () => api.storyboardGet(runId) });
  useEffect(() => { void client.invalidateQueries({ queryKey: key }); }, [stage?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [announcement, setAnnouncement] = useState('');
  const [swapping, setSwapping] = useState<string | null>(null);
  const [semanticCommand, setSemanticCommand] = useState('');
  const [semanticConfirmation, setSemanticConfirmation] = useState('');
  const set = (next: StoryboardView) => client.setQueryData(key, next);
  const generate = useMutation({ mutationFn: () => api.productionRunStoryboard(runId), onSuccess: onState });
  const edit = useMutation({
    mutationFn: (input: { edit: StoryboardEdit; announce?: string }) => api.storyboardEdit({ runId, baseVersion: storyboard.data?.version ?? 0, edit: input.edit }),
    onSuccess: (next, input) => { set(next); if (input.announce) setAnnouncement(input.announce); },
    onError: () => void storyboard.refetch(),
  });
  const semanticEdit = useMutation({
    mutationFn: () => api.storyboardSemanticEdit({ runId, baseVersion: storyboard.data?.version ?? 0, command: semanticCommand.trim() }),
    onSuccess: (result) => {
      if (result.status === 'needs_confirmation') {
        setSemanticConfirmation(result.plan.confirmation.question ?? 'Especifique melhor a cena ou o tipo visual desejado.');
        return;
      }
      set(result.view);
      setSemanticConfirmation('');
      setSemanticCommand('');
      setAnnouncement(`Edição aplicada. ${result.rerenderSegmentIds.length} segmento(s) marcado(s) para renderizar novamente.`);
    },
    onError: () => void storyboard.refetch(),
  });
  const reselect = useMutation({ mutationFn: () => api.storyboardReselect({ runId, baseVersion: storyboard.data?.version ?? 0 }), onSuccess: set });
  const candidates = useQuery({ queryKey: ['velix-storyboard-candidates', runId, swapping, storyboard.data?.version], queryFn: () => api.storyboardCandidates({ runId, sceneId: swapping ?? '' }), enabled: !!swapping });
  const view = storyboard.data;
  const finished = state.run.status === 'cancelled' || state.run.status === 'completed';
  const busy = edit.isPending || reselect.isPending || semanticEdit.isPending;
  return (
    <div aria-label="Storyboard da produção" className="space-y-3 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Storyboard{view ? ` · versão ${view.version}` : ''}</p>
        <div className="flex gap-2">
          {!view && (!stage || stage.status === 'cancelled') && <Button size="sm" className="min-h-11" disabled={finished || generate.isPending} onClick={() => generate.mutate()}><LayoutGrid aria-hidden />{generate.isPending ? 'Agendando…' : 'Gerar storyboard'}</Button>}
          {view && <Button size="sm" variant="outline" className="min-h-11" disabled={finished || busy} onClick={() => reselect.mutate()}><RefreshCw aria-hidden />Escolher mídia de novo</Button>}
        </div>
      </div>
      {view && (
        <form aria-label="Edição semântica" className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); if (!busy && semanticCommand.trim()) semanticEdit.mutate(); }}>
          <input aria-label="Comando de edição semântica" className="min-h-11 min-w-0 flex-1 rounded border bg-background px-2 text-sm" value={semanticCommand} onChange={(event) => setSemanticCommand(event.target.value)} placeholder="Ex.: troque a cena do jogo 2 por uma de combate" disabled={finished || busy} />
          <Button type="submit" size="sm" className="min-h-11" disabled={finished || busy || !semanticCommand.trim()}>{semanticEdit.isPending ? 'Interpretando…' : 'Editar com linguagem natural'}</Button>
        </form>
      )}
      {semanticConfirmation && <p role="alert" className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">Confirmação necessária: {semanticConfirmation}</p>}
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {view && (
        <p role="status" aria-label="Situação do storyboard" className={view.renderable ? 'text-xs text-muted-foreground' : 'text-xs font-medium text-destructive'}>
          {view.renderable ? `${view.scenes.length} cena(s), todas com mídia autorizada ou fallback declarado.` : `${view.issues.length} pendência(s) impedem o render.`}{view.timing === 'measured' ? ' Tempos medidos da narração.' : ' Tempos estimados pelo ritmo.'}
        </p>
      )}
      {view && view.issues.length > 0 && <ul aria-label="Pendências do storyboard" className="list-disc space-y-1 pl-5 text-xs">{view.issues.map((issue) => <li key={`${issue.sceneId}-${issue.code}`}>{issue.message}</li>)}</ul>}
      {view && (
        <ol className="space-y-2" aria-label="Cenas do storyboard">
          {view.scenes.map((scene, index) => {
            const number = index + 1;
            return (
              <li key={scene.id} className="space-y-2 rounded border p-2" aria-label={`Cena ${number}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium tabular-nums">Cena {number} · {time(scene.startMs)}–{time(scene.endMs)}{scene.chapter ? ` · Cap. ${scene.chapter}` : ''}{scene.claimIds.length ? ` · ${scene.claimIds.length} afirmação(ões)` : ''}</span>
                  <div className="flex flex-wrap gap-1">
                    <Button size="icon" variant="ghost" className="size-11" aria-label={`Mover cena ${number} para cima`} disabled={busy || index === 0 || scene.locked} onClick={() => edit.mutate({ edit: { op: 'move', sceneId: scene.id, toIndex: index - 1 }, announce: `Cena ${number} movida para a posição ${number - 1}.` })}><ArrowUp aria-hidden /></Button>
                    <Button size="icon" variant="ghost" className="size-11" aria-label={`Mover cena ${number} para baixo`} disabled={busy || index === view.scenes.length - 1 || scene.locked} onClick={() => edit.mutate({ edit: { op: 'move', sceneId: scene.id, toIndex: index + 1 }, announce: `Cena ${number} movida para a posição ${number + 1}.` })}><ArrowDown aria-hidden /></Button>
                    <Button size="icon" variant="ghost" className="size-11" aria-label={`Dividir cena ${number}`} disabled={busy || scene.locked} onClick={() => edit.mutate({ edit: { op: 'duplicate', sceneId: scene.id }, announce: `Cena ${number} dividida em duas.` })}><Copy aria-hidden /></Button>
                    <Button size="icon" variant={scene.locked ? 'secondary' : 'ghost'} className="size-11" aria-label={scene.locked ? `Desbloquear cena ${number}` : `Bloquear cena ${number}`} aria-pressed={scene.locked} disabled={busy} onClick={() => edit.mutate({ edit: { op: 'lock', sceneId: scene.id, locked: !scene.locked } })}>{scene.locked ? <Lock aria-hidden /> : <LockOpen aria-hidden />}</Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{scene.narration}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={scene.visual.type === 'none' ? 'font-medium text-destructive' : ''}>{visualLabel(scene)}</span>
                  {scene.visual.type === 'asset' && <span className="text-muted-foreground">· {scene.visual.reason}</span>}
                  <Button size="sm" variant="outline" className="min-h-11" aria-expanded={swapping === scene.id} disabled={busy || scene.locked} onClick={() => setSwapping(swapping === scene.id ? null : scene.id)}>Trocar mídia</Button>
                </div>
                <label className="block text-xs font-medium">Texto na tela
                  <input key={`${scene.id}-${view.version}`} aria-label={`Texto na tela da cena ${number}`} className="mt-1 min-h-11 w-full rounded border bg-background px-2 text-sm disabled:opacity-60" defaultValue={scene.onScreenText} disabled={busy || scene.locked} onBlur={(event) => { if (event.target.value !== scene.onScreenText) edit.mutate({ edit: { op: 'update', sceneId: scene.id, patch: { onScreenText: event.target.value } } }); }} />
                </label>
                {swapping === scene.id && (
                  <div aria-label={`Mídias para a cena ${number}`} className="space-y-2 rounded bg-muted/30 p-2">
                    {candidates.isPending && <p className="text-xs text-muted-foreground">Ordenando mídias…</p>}
                    {candidates.data?.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma mídia de vídeo ou imagem no projeto.</p>}
                    <ul className="space-y-1">
                      {candidates.data?.map((item) => (
                        <li key={item.referenceId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 flex-1">{item.title} <span className="text-muted-foreground">· {RIGHTS_LABEL[item.rightsStatus] ?? item.rightsStatus} · {item.reason}</span></span>
                          <Button size="sm" variant="outline" className="min-h-11" disabled={!item.eligible || busy} aria-label={`Usar ${item.title} na cena ${number}`} onClick={() => { edit.mutate({ edit: { op: 'replace', sceneId: scene.id, visual: { type: 'asset', referenceId: item.referenceId } } }); setSwapping(null); }}>Usar</Button>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-1">{fallbackKinds.map((kind) => <Button key={kind} size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => { edit.mutate({ edit: { op: 'replace', sceneId: scene.id, visual: { type: 'fallback', kind } } }); setSwapping(null); }}>{FALLBACK_LABEL[kind]}</Button>)}</div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {(generate.isError || edit.isError || semanticEdit.isError || reselect.isError || storyboard.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(generate.error ?? edit.error ?? semanticEdit.error ?? reselect.error ?? storyboard.error)}</p>}
    </div>
  );
}

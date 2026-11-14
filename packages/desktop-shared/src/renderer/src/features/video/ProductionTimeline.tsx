import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, History, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { buildTimeline, type TimelineMarker } from '@neuralbridge/shared/velix-timeline';
import type { StoryboardEdit, StoryboardView } from '@neuralbridge/shared/velix-storyboard';
import { VIDEO_FORMATS, type ProductionState } from '@neuralbridge/shared/velix-production';

type FormatId = keyof typeof VIDEO_FORMATS;
const MARKER_LABEL: Record<TimelineMarker, string> = { rights: 'Direitos', claim: 'Fato sem evidência', quality: 'Qualidade', locked: 'Bloqueada', estimated: 'Tempo estimado' };
const SOURCE_LABEL: Record<string, string> = { generated: 'gerada', edit: 'edição', sync: 'sincronização', restore: 'restauração' };
const seconds = (ms: number) => `${(ms / 1_000).toFixed(1)} s`;

/**
 * Multitrack editor over the versioned storyboard. The scene lane is a keyboard listbox: arrows select, Alt+arrows move,
 * S splits, L locks; every change is a new version, so history can be restored and only changed segments re-render.
 */
export function ProductionTimeline({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const key = ['velix-storyboard', runId];
  const storyboard = useQuery({ queryKey: key, queryFn: () => api.storyboardGet(runId) });
  const history = useQuery({ queryKey: ['velix-storyboard-history', runId, storyboard.data?.version], queryFn: () => api.storyboardHistory(runId), enabled: !!storyboard.data });
  const draftStage = state.stages.filter((stage) => stage.kind === 'render').at(-1);
  const preview = useQuery({ queryKey: ['velix-draft-preview', runId, draftStage?.status, draftStage?.id], queryFn: () => api.productionDraftPreview(runId) });
  const [selected, setSelected] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [formatId, setFormatId] = useState<FormatId>(state.brief.format.id === 'custom' ? 'youtube-long' : state.brief.format.id);
  const options = useRef<Array<HTMLLIElement | null>>([]);
  const view = storyboard.data;
  const timeline = useMemo(() => (view ? buildTimeline({ scenes: view.scenes, issues: view.issues, timing: view.timing }) : null), [view]);
  const set = (next: StoryboardView) => client.setQueryData(key, next);
  const edit = useMutation({
    mutationFn: (input: { edit: StoryboardEdit; announce: string; select?: number }) => api.storyboardEdit({ runId, baseVersion: view?.version ?? 0, edit: input.edit }),
    onSuccess: (next, input) => { set(next); setAnnouncement(input.announce); if (input.select !== undefined) setSelected(input.select); },
    onError: () => void storyboard.refetch(),
  });
  const restore = useMutation({ mutationFn: (version: number) => api.storyboardRestore({ runId, baseVersion: view?.version ?? 0, version }), onSuccess: (next, version) => { set(next); setAnnouncement(`Versão ${version} restaurada como versão ${next.version}.`); } });
  const draft = useMutation({ mutationFn: () => api.productionDraft({ runId, formatId }), onSuccess: onState });
  useEffect(() => { options.current[selected]?.focus({ preventScroll: true }); }, [selected, view?.version]);
  if (!view || !timeline) return null;
  const scenes = view.scenes;
  const index = Math.min(selected, scenes.length - 1);
  const current = scenes[index];
  const busy = edit.isPending || restore.isPending;
  const total = Math.max(1, timeline.durationMs);
  const place = (startMs: number, endMs: number) => ({ left: `${(startMs / total) * 100}%`, width: `${Math.max(0.6, ((endMs - startMs) / total) * 100)}%` });

  const onKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (!current || busy) return;
    const number = index + 1;
    if (event.key === 'ArrowRight' && !event.altKey) { event.preventDefault(); setSelected(Math.min(scenes.length - 1, index + 1)); }
    else if (event.key === 'ArrowLeft' && !event.altKey) { event.preventDefault(); setSelected(Math.max(0, index - 1)); }
    else if (event.key === 'Home') { event.preventDefault(); setSelected(0); }
    else if (event.key === 'End') { event.preventDefault(); setSelected(scenes.length - 1); }
    else if (event.altKey && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      const to = event.key === 'ArrowRight' ? index + 1 : index - 1;
      if (to < 0 || to >= scenes.length) return;
      if (current.locked) { setAnnouncement(`Cena ${number} está bloqueada.`); return; }
      edit.mutate({ edit: { op: 'move', sceneId: current.id, toIndex: to }, announce: `Cena ${number} movida para a posição ${to + 1}.`, select: to });
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (current.locked) { setAnnouncement(`Cena ${number} está bloqueada.`); return; }
      edit.mutate({ edit: { op: 'duplicate', sceneId: current.id }, announce: `Cena ${number} dividida em duas.`, select: index });
    } else if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      edit.mutate({ edit: { op: 'lock', sceneId: current.id, locked: !current.locked }, announce: current.locked ? `Cena ${number} desbloqueada.` : `Cena ${number} bloqueada.`, select: index });
    }
  };

  return (
    <div aria-label="Linha do tempo" className="space-y-3 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">Linha do tempo · versão {view.version}</p>
        <p className="text-xs text-muted-foreground">{seconds(timeline.durationMs)} · {timeline.measured ? 'tempos medidos da narração' : 'tempos estimados'}</p>
      </div>
      <p id="velix-timeline-keys" className="text-xs text-muted-foreground">Na faixa Cenas: setas escolhem a cena, Alt + setas movem, S divide, L bloqueia. Mover e dividir mantêm a narração medida quando cada cena tem seu clipe.</p>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="space-y-1 overflow-hidden">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
          <span className="text-xs font-medium">Cenas</span>
          <ul role="listbox" aria-label="Cenas na linha do tempo" aria-describedby="velix-timeline-keys" aria-activedescendant={current ? `timeline-scene-${current.id}` : undefined} className="relative h-11 rounded bg-muted/30 focus-within:ring-2 focus-within:ring-ring" onKeyDown={onKey}>
            {scenes.map((scene, position) => {
              const markers = timeline.tracks.find((track) => track.id === 'narration')?.items.find((item) => item.sceneId === scene.id)?.markers ?? [];
              const problems = markers.filter((marker) => marker !== 'estimated');
              return (
                <li key={scene.id} id={`timeline-scene-${scene.id}`} ref={(node) => { options.current[position] = node; }} role="option" aria-selected={position === index} tabIndex={position === index ? 0 : -1}
                  aria-label={`Cena ${position + 1}, ${seconds(scene.startMs)} a ${seconds(scene.endMs)}${problems.length ? `, ${problems.map((marker) => MARKER_LABEL[marker]).join(', ')}` : ''}`}
                  onClick={() => setSelected(position)}
                  className={`absolute top-0 flex h-11 cursor-pointer items-center justify-center gap-1 overflow-hidden border-r border-background px-1 text-[11px] outline-none ${position === index ? 'bg-primary text-primary-foreground' : 'bg-secondary'} ${problems.some((marker) => marker !== 'locked') ? 'ring-1 ring-inset ring-destructive' : ''}`}
                  style={place(scene.startMs, scene.endMs)}>
                  {scene.locked && <Lock aria-hidden className="size-3 shrink-0" />}
                  <span className="truncate">{position + 1}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {timeline.tracks.filter((track) => track.id !== 'narration' || track.items.length).map((track) => (
          <div key={track.id} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
            <span className="text-xs text-muted-foreground">{track.label}</span>
            {track.planned ? <span className="text-xs text-muted-foreground">Planejado: ainda sem material nesta faixa.</span> : (
              <ul aria-label={`Faixa ${track.label}`} className="relative h-6 rounded bg-muted/20">
                {track.items.map((item) => (
                  <li key={item.id} title={item.label} className={`absolute top-0 h-6 overflow-hidden truncate border-r border-background px-1 text-[10px] leading-6 ${item.markers.includes('rights') ? 'bg-destructive/30' : item.markers.includes('claim') ? 'bg-destructive/20' : 'bg-accent'}`} style={place(item.startMs, item.endMs)}>
                    <span className="sr-only">{`${seconds(item.startMs)}: `}</span>{item.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      {current && (
        <div aria-label="Cena selecionada" className="rounded bg-muted/30 p-2 text-xs">
          <p className="font-medium">Cena {index + 1} · {seconds(current.startMs)}–{seconds(current.endMs)}{current.audio ? ` · clipe de ${seconds(current.audio.durationMs)}` : ' · sem clipe medido'}</p>
          <p className="text-muted-foreground">{current.narration}</p>
          {view.issues.filter((issue) => issue.sceneId === current.id).map((issue) => <p key={issue.code} className="text-destructive">{issue.message}</p>)}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs font-medium">Prévia em<select aria-label="Formato da prévia" className="mt-1 min-h-11 rounded border bg-background px-2 text-sm" value={formatId} onChange={(event) => setFormatId(event.target.value as FormatId)}>{Object.values(VIDEO_FORMATS).map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}</select></label>
        <Button size="sm" variant="outline" className="min-h-11" disabled={draft.isPending || draftStage?.status === 'running' || view.timing !== 'measured'} onClick={() => draft.mutate()}><Eye aria-hidden />{draftStage?.status === 'running' ? 'Gerando prévia…' : 'Prévia rascunho'}</Button>
      </div>
      {preview.data && <video aria-label={`Prévia rascunho da versão ${preview.data.storyboardVersion}`} src={preview.data.url} controls className="max-h-72 w-full rounded border bg-black" />}
      {history.data && history.data.length > 1 && (
        <details className="text-xs"><summary className="flex min-h-11 cursor-pointer items-center gap-1 font-medium"><History aria-hidden className="size-4" />Versões ({history.data.length})</summary>
          <ol aria-label="Versões do storyboard" className="mt-1 space-y-1">
            {history.data.map((item) => (
              <li key={item.version} className="flex flex-wrap items-center justify-between gap-2">
                <span>Versão {item.version} · {SOURCE_LABEL[item.source] ?? item.source}{item.op ? ` (${item.op})` : ''} · {new Date(item.createdAt).toLocaleString('pt-BR')}</span>
                {item.version !== view.version && <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => restore.mutate(item.version)}>Restaurar versão {item.version}</Button>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {(edit.isError || restore.isError || draft.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(edit.error ?? restore.error ?? draft.error)}</p>}
    </div>
  );
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clapperboard, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { MatchReviewCandidate } from '@neuralbridge/shared/aethera-studio';
import type { RenderUseBasis } from '@neuralbridge/shared/aethera-render-use';
import type { StoryboardEdit, StoryboardScene } from '@neuralbridge/shared/velix-storyboard';
import type { ProductionState } from '@neuralbridge/shared/velix-production';

const BASIS: Record<RenderUseBasis, string> = { licensed: 'licenciada', editorial_use: 'uso editorial', preview_only: 'só prévia', not_allowed: 'não permitida' };
const clock = (ms: number) => { const total = Math.round(ms / 1_000); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };
const SELECT = 'mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Frame({ runId, candidate }: { runId: string; candidate: MatchReviewCandidate }) {
  const assetId = candidate.match.assetId;
  const atMs = Math.round((candidate.match.sourceStartMs + candidate.match.sourceEndMs) / 2);
  const frame = useQuery({ queryKey: ['aethera-segment-frame', assetId, atMs], queryFn: () => window.neuralbridge.video.productionSegmentFrame({ runId, assetId: assetId ?? '', atMs }), enabled: Boolean(assetId), staleTime: Infinity });
  return frame.data?.dataUrl
    ? <img src={frame.data.dataUrl} alt={`Quadro em ${clock(atMs)} de ${candidate.title}`} className="aspect-video w-32 shrink-0 rounded object-cover" />
    : <div aria-hidden className="flex aspect-video w-32 shrink-0 items-center justify-center rounded border text-muted-foreground"><Film className="size-5" /></div>;
}

/**
 * AP-02: the matching proposes cuts for review (no calibration yet); a person confirms which game each scene talks about
 * and accepts one proposed cut. Every change is a new storyboard version, so it can be undone from the history.
 */
export function ProductionMatchReview({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const isAethera = state.stages.some((item) => item.kind === 'visual_index');
  const matching = state.stages.filter((item) => item.kind === 'scene_matching').at(-1);
  const indexed = state.stages.some((item) => item.kind === 'visual_index' && item.status === 'completed');
  const busy = matching?.status === 'pending' || matching?.status === 'running';
  const storyboard = useQuery({ queryKey: ['velix-storyboard', runId], queryFn: () => api.storyboardGet(runId), enabled: isAethera });
  const subjects = useQuery({ queryKey: ['aethera-subjects', runId], queryFn: () => api.productionRunSubjects(runId), enabled: isAethera });
  const candidates = useQuery({ queryKey: ['aethera-match-candidates', runId, matching?.id, matching?.status], queryFn: () => api.productionMatchCandidates(runId), enabled: isAethera });
  const media = useQuery({ queryKey: ['aethera-media-use', runId], queryFn: () => api.productionMediaUse(runId), enabled: isAethera });
  const policy = useQuery({ queryKey: ['aethera-editorial-policy', runId], queryFn: () => api.productionEditorialPolicyGet(runId), enabled: isAethera });
  const start = useMutation({ mutationFn: () => api.productionRunSceneMatching(runId), onSuccess: onState });
  const edit = useMutation({
    mutationFn: (input: StoryboardEdit) => api.storyboardEdit({ runId, baseVersion: storyboard.data?.version ?? 0, edit: input }),
    onSuccess: (next) => client.setQueryData(['velix-storyboard', runId], next),
    onError: () => void storyboard.refetch(),
  });
  if (!isAethera || !storyboard.data) return null;
  const finished = state.run.status === 'cancelled' || state.run.status === 'completed';
  const basisOf = new Map((media.data ?? []).map((use) => [use.referenceId, use.basis] as const));
  const names = new Map((subjects.data ?? []).map((subject) => [subject.id, subject.title] as const));
  const shown = (scene: StoryboardScene, candidate: MatchReviewCandidate) => scene.visual.type === 'asset' && scene.visual.match?.segmentId === candidate.match.segmentId && scene.visual.match.sourceStartMs === candidate.match.sourceStartMs && scene.visual.match.sourceEndMs === candidate.match.sourceEndMs;
  return (
    <div aria-label="Cenas e trechos" className="space-y-3 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium"><Clapperboard aria-hidden className="mr-1 inline size-4" />Cenas e trechos</p>
          <p className="text-xs text-muted-foreground">Cada cena mostra um trecho de um jogo da pesquisa. Sem calibração, nenhum trecho entra sozinho: confirme o jogo da cena e escolha um trecho proposto.</p>
        </div>
        <Button size="sm" className="min-h-11" disabled={finished || busy || !indexed || start.isPending} onClick={() => start.mutate()}>{busy ? 'Casando…' : matching ? 'Casar de novo' : 'Casar cenas com trechos'}</Button>
      </div>
      {!indexed && <p className="text-xs text-muted-foreground">Conclua a indexação visual para propor trechos.</p>}
      {indexed && policy.data?.thirdPartyEditorialUse !== true && <p className="text-xs text-amber-200">O uso editorial de mídia de terceiros está desligado: nenhum trecho adquirido pode ser proposto. Ligue-o no painel "Uso editorial de mídia de terceiros" e case de novo.</p>}
      {indexed && policy.data?.thirdPartyEditorialUse === true && matching?.status === 'completed' && !(candidates.data ?? []).length && <p className="text-xs text-muted-foreground">Nenhum trecho proposto: confira o jogo de cada cena abaixo e case de novo.</p>}
      {matching?.status === 'failed' && matching.error && <p role="alert" className="text-sm text-destructive">{matching.error.message}</p>}
      {(start.isError || edit.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(start.error ?? edit.error)}</p>}
      <ol className="space-y-2">
        {storyboard.data.scenes.map((scene, index) => {
          const proposals = (candidates.data ?? []).filter((candidate) => candidate.match.sceneId === scene.id).slice(0, 4);
          const selectId = `scene-subject-${scene.id}`;
          return (
            <li key={scene.id} className="space-y-2 rounded border p-2">
              <p className="text-xs"><span className="font-medium">Cena {index + 1}</span> · {clock(scene.startMs)}–{clock(scene.endMs)}{scene.locked ? ' · bloqueada' : ''}</p>
              <p className="text-xs text-muted-foreground">{scene.narration}</p>
              <div>
                <label htmlFor={selectId} className="text-xs">Jogo da cena</label>
                <select id={selectId} className={SELECT} value={scene.subjectId ?? ''} disabled={finished || scene.locked || edit.isPending} onChange={(event) => edit.mutate({ op: 'assign_subject', sceneId: scene.id, subjectId: event.target.value || null })}>
                  <option value="">Nenhum (sem trecho de jogo)</option>
                  {(subjects.data ?? []).map((subject) => <option key={subject.id} value={subject.id}>{subject.title}</option>)}
                </select>
              </div>
              <p className="text-xs">Visual atual: {scene.visual.type === 'asset' ? `${scene.visual.title}${scene.visual.match ? ` · ${clock(scene.visual.match.sourceStartMs)}–${clock(scene.visual.match.sourceEndMs)}` : ' · desde o início'}` : scene.visual.type === 'fallback' ? 'gráfico (sem trecho)' : 'nenhum'}</p>
              {proposals.length > 0 && (
                <ul aria-label={`Trechos propostos para a cena ${index + 1}`} className="space-y-2">
                  {proposals.map((candidate) => {
                    const basis = basisOf.get(candidate.referenceId);
                    const current = shown(scene, candidate);
                    const otherGame = Boolean(scene.subjectId && candidate.match.subjectId && candidate.match.subjectId !== scene.subjectId);
                    return (
                      <li key={candidate.candidateKey} className="flex gap-3 rounded border p-2">
                        <Frame runId={runId} candidate={candidate} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate font-medium" title={candidate.title}>{candidate.title}</p>
                          <p className="text-xs text-muted-foreground">{clock(candidate.match.sourceStartMs)}–{clock(candidate.match.sourceEndMs)} · {candidate.match.subjectId ? names.get(candidate.match.subjectId) ?? 'jogo ?' : 'jogo não identificado'} · nota {Math.round(candidate.match.score * 100)} · {basis ? BASIS[basis] : 'base de uso ?'}</p>
                          <p className="text-xs">{candidate.match.reason}</p>
                          {current
                            ? <p className="text-xs font-medium">Trecho em uso nesta cena</p>
                            : <Button size="sm" variant="outline" className="min-h-11" disabled={finished || scene.locked || otherGame || basis === 'not_allowed' || edit.isPending} onClick={() => edit.mutate({ op: 'accept_match', sceneId: scene.id, candidateKey: candidate.candidateKey })}>Usar este trecho</Button>}
                          {otherGame && <p className="text-xs text-destructive">O trecho é de outro jogo; troque o jogo da cena para usá-lo.</p>}
                          {basis === 'not_allowed' && <p className="text-xs text-destructive">Sem base de uso: ligue o uso editorial ou decida esta fonte.</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

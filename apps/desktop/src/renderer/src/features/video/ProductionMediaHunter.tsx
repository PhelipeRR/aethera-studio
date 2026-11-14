import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Film, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { SourceCandidate } from '@neuralbridge/shared/aethera-media';
import type { MediaAcquisitionJob } from '@neuralbridge/shared/aethera-studio';
import type { ProductionState } from '@neuralbridge/shared/velix-production';
import { ProgressBar } from './ProgressBar';

const IDENTITY: Record<NonNullable<SourceCandidate['identity']>, string> = { verified: 'Jogo verificado', review_required: 'Jogo a revisar', rejected: 'Parece ser outro jogo' };
const KIND: Record<SourceCandidate['kind'], string> = { trailer: 'Trailer', gameplay: 'Gameplay', other: 'Outro' };
const STATUS: Record<SourceCandidate['status'], string> = { proposed: 'Sugerida', selected: 'Selecionada', rejected: 'Descartada', acquired: 'Adquirida', failed: 'Falhou', skipped: 'Não baixada' };
const JOB: Record<MediaAcquisitionJob['status'], string> = { queued: 'Na fila', running: 'Baixando', paused: 'Pausada (retoma do ponto salvo)', done: 'Concluída', failed: 'Falhou', skipped: 'Ignorada' };
const minutes = (seconds: number | null) => (seconds === null ? '—' : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`);

function Thumbnail({ candidate }: { candidate: SourceCandidate }) {
  const thumbnail = useQuery({ queryKey: ['aethera-thumbnail', candidate.id], queryFn: () => window.neuralbridge.video.studioCandidateThumbnail(candidate.id), staleTime: Infinity, enabled: Boolean(candidate.thumbnailUrl) });
  return thumbnail.data?.dataUrl
    ? <img src={thumbnail.data.dataUrl} alt={`Prévia de ${candidate.title}`} className="aspect-video w-32 shrink-0 rounded object-cover" />
    : <div aria-hidden className="flex aspect-video w-32 shrink-0 items-center justify-center rounded border text-muted-foreground"><Film className="size-5" /></div>;
}

/** AS-04: trailers and gameplay found for the researched games; the person previews, keeps or drops each source before download. */
export function ProductionMediaHunter({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const discovery = state.stages.filter((stage) => stage.kind === 'media_discovery').at(-1);
  const acquisition = state.stages.filter((stage) => stage.kind === 'media_acquisition').at(-1);
  const acquiring = acquisition?.status === 'running' || acquisition?.status === 'pending';
  const subjects = useQuery({ queryKey: ['aethera-subjects', runId], queryFn: () => api.productionRunSubjects(runId) });
  const candidatesKey = ['aethera-candidates', runId];
  const candidates = useQuery({ queryKey: candidatesKey, queryFn: () => api.productionRunCandidates(runId) });
  const jobs = useQuery({ queryKey: ['aethera-acquisitions', runId], queryFn: () => api.productionRunAcquisitions(runId), refetchInterval: acquiring ? 1_500 : false });
  useEffect(() => { void client.invalidateQueries({ queryKey: candidatesKey }); void jobs.refetch(); }, [discovery?.status, acquisition?.status, acquisition?.progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const discover = useMutation({ mutationFn: () => api.productionRunMediaDiscover({ runId }), onSuccess: onState });
  const decide = useMutation({ mutationFn: (input: { candidateId: string; status: 'selected' | 'proposed' }) => api.productionCandidateDecide(input), onSuccess: () => client.invalidateQueries({ queryKey: candidatesKey }) });
  const acquire = useMutation({ mutationFn: () => api.productionRunMediaAcquire({ runId }), onSuccess: onState });
  const finished = state.run.status === 'cancelled' || state.run.status === 'completed';
  const selected = (candidates.data ?? []).filter((candidate) => candidate.status === 'selected');
  const busyDiscovery = discovery?.status === 'running' || discovery?.status === 'pending';
  const error = discover.error ?? decide.error ?? acquire.error;
  if (!subjects.data?.length) return null;
  return (
    <div aria-label="Trailers e gameplays" className="space-y-3 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium"><Film aria-hidden className="mr-1 inline size-4" />Trailers e gameplays</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="min-h-11" disabled={finished || busyDiscovery || discover.isPending} onClick={() => discover.mutate()}><ScanSearch aria-hidden />{busyDiscovery ? 'Procurando…' : candidates.data?.length ? 'Procurar de novo' : 'Procurar vídeos'}</Button>
          <Button size="sm" className="min-h-11" disabled={finished || acquiring || !selected.length || acquire.isPending} onClick={() => acquire.mutate()}><Download aria-hidden />{acquiring ? 'Adquirindo…' : `Adquirir selecionados (${selected.length})`}</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Fontes: vídeos que o IGDB associa ao jogo e busca no YouTube pelo yt-dlp. O app confere a identidade do jogo antes de baixar; um vídeo de outro jogo nunca é baixado. Uso editorial não é autorização legal: a publicação continua exigindo sua aprovação.</p>
      {discovery?.status === 'failed' && discovery.error && <p role="alert" className="text-sm text-destructive">{discovery.error.message}</p>}
      {acquisition?.status === 'failed' && acquisition.error && <p role="alert" className="text-sm text-destructive">{acquisition.error.message}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{errorMessage(error)}</p>}
      {subjects.data.map((subject) => {
        const list = (candidates.data ?? []).filter((candidate) => candidate.subjectId === subject.id).sort((a, b) => b.score - a.score);
        if (!list.length) return null;
        return (
          <section key={subject.id} aria-label={`Fontes de ${subject.title}`} className="space-y-2">
            <p className="text-xs font-medium">{subject.title}</p>
            <ul className="space-y-2">
              {list.map((candidate) => {
                const job = (jobs.data ?? []).find((item) => item.idempotencyKey.startsWith(candidate.url));
                const locked = candidate.status === 'acquired' || acquiring;
                return (
                  <li key={candidate.id} className="flex gap-3 rounded border p-2">
                    <Thumbnail candidate={candidate} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <label className="flex min-h-11 items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={candidate.status === 'selected' || candidate.status === 'acquired'} disabled={locked || decide.isPending} onChange={(event) => decide.mutate({ candidateId: candidate.id, status: event.target.checked ? 'selected' : 'proposed' })} />
                        <span className="min-w-0"><span className="block truncate font-medium" title={candidate.title}>{candidate.title}</span>
                          <span className="block text-xs text-muted-foreground">{KIND[candidate.kind]} · {candidate.channel || 'canal desconhecido'}{candidate.official ? ' · canal oficial' : ''} · {candidate.maxHeight ? `${candidate.maxHeight}p` : 'resolução ?'} · {minutes(candidate.durationSeconds)} · {candidate.source === 'igdb_video' ? 'IGDB' : 'busca'}</span></span>
                      </label>
                      <p className="text-xs"><span className={candidate.identity === 'rejected' ? 'text-destructive' : candidate.identity === 'verified' ? '' : 'text-amber-200'}>{candidate.identity ? IDENTITY[candidate.identity] : 'Identidade não avaliada'}</span> · {STATUS[candidate.status]} · nota {Math.round(candidate.score * 100)} ({candidate.reasons.join(', ')})</p>
                      {candidate.identity === 'rejected' && candidate.status === 'selected' && <p className="text-xs text-destructive">Não será baixado: o título indica outro jogo.</p>}
                      <p className="truncate text-xs text-muted-foreground" title={candidate.url}>{candidate.url}</p>
                      {job && job.status !== 'done' && (
                        <div className="space-y-1">
                          <p className="text-xs">{JOB[job.status]}{job.attempt > 1 ? ` · tentativa ${job.attempt}` : ''}{job.error ? ` · ${job.error.message}` : ''}</p>
                          {job.status === 'running' && <ProgressBar label={`Download de ${candidate.title}`} value={job.bytesTotal ? (job.bytesDone / job.bytesTotal) * 100 : null} />}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

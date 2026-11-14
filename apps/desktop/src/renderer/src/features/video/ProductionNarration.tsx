import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AudioLines, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { ProductionState } from '@neuralbridge/shared/velix-production';
import { ProductionChannelVoice } from './ProductionChannelVoice';

const LICENSES = [
  ['provider', 'Revisei os termos do VoiceStudio'],
  ['model', 'Revisei a licença do modelo de voz'],
  ['voice', 'Revisei a licença da voz'],
  ['output', 'Posso publicar o áudio gerado'],
] as const;
type LicenseKey = (typeof LICENSES)[number][0];
const seconds = (ms: number) => `${(ms / 1_000).toFixed(1)} s`;

/** Speaks the storyboard with one local voice, then puts the scenes on the real clock of that narration. */
export function ProductionNarration({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const narrationStage = state.stages.filter((stage) => stage.kind === 'narration').at(-1);
  const syncStage = state.stages.filter((stage) => stage.kind === 'sync').at(-1);
  const key = ['velix-production-narration', runId];
  const voices = useQuery({ queryKey: ['velix-production-voices'], queryFn: () => api.productionVoices(), staleTime: 30_000 });
  const narration = useQuery({ queryKey: key, queryFn: () => api.productionNarrationGet(runId) });
  useEffect(() => {
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({ queryKey: ['velix-storyboard', runId] });
  }, [narrationStage?.status, syncStage?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [modelId, setModelId] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [reviewed, setReviewed] = useState<Record<LicenseKey, boolean>>({ provider: false, model: false, voice: false, output: false });
  const [confirmed, setConfirmed] = useState(false);
  const models = voices.data?.models.filter((model) => model.installed) ?? [];
  const model = modelId || models[0]?.id || '';
  const voice = voiceId || voices.data?.voices[0]?.id || '';
  const licensed = confirmed && LICENSES.every(([item]) => reviewed[item]);
  const speak = useMutation({
    mutationFn: () => api.productionRunNarration({ runId, modelId: model, voiceId: voice, language: state.brief.language, license: { provider: reviewed.provider ? 'reviewed' : 'unknown', model: reviewed.model ? 'reviewed' : 'unknown', voice: reviewed.voice ? 'reviewed' : 'unknown', output: reviewed.output ? 'reviewed' : 'unknown', userConfirmed: confirmed } }),
    onSuccess: onState,
  });
  const sync = useMutation({ mutationFn: () => api.productionRunSync(runId), onSuccess: onState });
  const data = narration.data;
  const running = narrationStage?.status === 'running' || syncStage?.status === 'running';
  const finished = state.run.status === 'cancelled' || state.run.status === 'completed';
  return (
    <div aria-label="Narração e sincronização" className="space-y-3 rounded border p-3 text-sm">
      <p className="font-medium">Narração e sincronização</p>
      <ProductionChannelVoice state={state} onState={onState} />
      {voices.data && !voices.data.available && <p className="text-xs text-destructive">VoiceStudio indisponível: {voices.data.error ?? 'inicie o VoiceStudio local.'}</p>}
      {voices.data?.available && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block text-xs font-medium">Modelo<select aria-label="Modelo de voz" className="mt-1 min-h-11 w-full rounded border bg-background px-2 text-sm" value={model} onChange={(event) => setModelId(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="block text-xs font-medium">Voz<select aria-label="Voz da narração" className="mt-1 min-h-11 w-full rounded border bg-background px-2 text-sm" value={voice} onChange={(event) => setVoiceId(event.target.value)}>{voices.data.voices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <fieldset className="space-y-1 sm:col-span-2"><legend className="text-xs font-medium">Licenças (cada uma é uma revisão sua)</legend>
            {LICENSES.map(([item, label]) => <label key={item} className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={reviewed[item]} onChange={(event) => setReviewed((current) => ({ ...current, [item]: event.target.checked }))} />{label}</label>)}
            <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo as revisões acima para esta produção</label>
          </fieldset>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="min-h-11" disabled={finished || running || speak.isPending || !model || !voice || !licensed} onClick={() => speak.mutate()}><AudioLines aria-hidden />{data?.manifest ? 'Gerar narração de novo' : 'Gerar narração'}</Button>
        <Button size="sm" variant="outline" className="min-h-11" disabled={finished || running || sync.isPending || !data?.manifest || data.stale} onClick={() => sync.mutate()}><Timer aria-hidden />Sincronizar com a narração</Button>
      </div>
      {data?.manifest && (
        <p className="text-xs text-muted-foreground">Narração de {seconds(data.manifest.durationMs)} em {data.manifest.blocks.length} bloco(s), voz {data.manifest.voiceId} ({data.manifest.modelId}), medida pelo FFprobe.</p>
      )}
      {data?.stale && <p role="alert" className="text-xs font-medium text-destructive">O storyboard mudou o que é falado depois desta narração: gere a narração de novo antes de sincronizar.</p>}
      {data?.sync && (
        <div aria-label="Relatório da sincronização" className="space-y-1 text-xs">
          <p role="status" className={data.sync.report.blocking ? 'font-medium text-destructive' : 'text-muted-foreground'}>{data.sync.report.matched} de {data.sync.report.expected} palavras reconhecidas ({Math.round(data.sync.report.ratio * 100)}%) · versão {data.sync.storyboardVersion} do storyboard no tempo real.{data.sync.report.blocking ? ' A sincronização não é confiável: revise a narração.' : ''}</p>
          {data.sync.report.issues.length > 0 && <ul aria-label="Problemas da sincronização" className="list-disc space-y-1 pl-5">{data.sync.report.issues.map((issue, index) => <li key={`${issue.code}-${issue.sceneId ?? 'geral'}-${index}`}>{issue.message}</li>)}</ul>}
        </div>
      )}
      {(speak.isError || sync.isError || narration.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(speak.error ?? sync.error ?? narration.error)}</p>}
    </div>
  );
}

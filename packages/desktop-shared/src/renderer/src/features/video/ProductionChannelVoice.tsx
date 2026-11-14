import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { ChannelVoiceView } from '@neuralbridge/shared/aethera-voice';
import type { ProductionState } from '@neuralbridge/shared/velix-production';

const SELECT = 'mt-1 min-h-11 w-full rounded border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const SPEEDS = [0.9, 1, 1.05, 1.12, 1.2] as const;
const PAUSES = [0, 300, 600, 1_000] as const;

function Authorize({ runId, view }: { runId: string; view: ChannelVoiceView }) {
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const commercial = view.license?.licenseCategory === 'commercial';
  const authorize = useMutation({
    mutationFn: () => window.neuralbridge.video.channelVoiceAuthorize({ runId, presetId: view.preset.id, scope: commercial ? 'commercial' : 'noncommercial', note }),
    onSuccess: (next) => { client.setQueryData(['aethera-channel-voices', runId], next); setNote(''); },
  });
  const id = `voice-authorization-${view.preset.id}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs">Motivo da autorização (obrigatório) — vale para as próximas produções até você revogar ou a licença do modelo mudar</label>
      <textarea id={id} rows={2} className={SELECT} value={note} aria-invalid={missing} aria-describedby={missing ? `${id}-missing` : undefined} onChange={(event) => { setNote(event.target.value); if (event.target.value.trim()) setMissing(false); }} placeholder={commercial ? 'Ex.: uso no canal conforme a licença comercial do modelo' : 'Ex.: canal sem monetização, uso não comercial'} />
      <Button size="sm" className="min-h-11" disabled={!view.license || authorize.isPending} onClick={() => { if (!note.trim()) { setMissing(true); document.getElementById(id)?.focus(); return; } setMissing(false); authorize.mutate(); }}>{commercial ? 'Autorizar uso desta voz' : 'Autorizar uso não comercial desta voz'}</Button>
      {missing && <p id={`${id}-missing`} role="alert" className="text-xs text-destructive">Escreva o motivo antes de autorizar.</p>}
      {authorize.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(authorize.error)}</p>}
    </div>
  );
}

/**
 * Aethera channel voice: an original voice designed in VoiceStudio (attributes + seed, nobody cloned), narrated under a
 * one-time, revocable authorization that follows the licence the provider declares for the model; per-scene speed and
 * pauses. The project's other voices are untouched.
 */
export function ProductionChannelVoice({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const voices = useQuery({ queryKey: ['aethera-channel-voices', runId], queryFn: () => api.channelVoices(runId) });
  const storyboard = useQuery({ queryKey: ['velix-storyboard', runId], queryFn: () => api.storyboardGet(runId) });
  const directions = useQuery({ queryKey: ['aethera-narration-directions', runId], queryFn: () => api.narrationDirections(runId) });
  const revoke = useMutation({ mutationFn: (presetId: string) => api.channelVoiceRevoke({ runId, presetId }), onSuccess: (next) => client.setQueryData(['aethera-channel-voices', runId], next) });
  const direct = useMutation({
    mutationFn: (input: { sceneId: string; speed?: number; pauseAfterMs?: number; clear?: boolean }) => api.narrationDirectionSet({ runId, ...input }),
    onSuccess: (next) => client.setQueryData(['aethera-narration-directions', runId], next),
  });
  const [narrationSpeed, setNarrationSpeed] = useState(1);
  const speak = useMutation({ mutationFn: (input: { presetId: string; speed: number }) => api.productionRunNarrationVoice({ runId, ...input }), onSuccess: onState });
  const narrationStage = state.stages.filter((stage) => stage.kind === 'narration').at(-1);
  const running = narrationStage?.status === 'running' || narrationStage?.status === 'pending';
  const finished = state.run.status === 'cancelled' || state.run.status === 'completed';
  if (!voices.data?.length) return null;
  const byScene = new Map((directions.data ?? []).map((direction) => [direction.sceneId, direction]));
  return (
    <div aria-label="Voz do canal" className="space-y-3 rounded border p-3 text-sm">
      <p className="font-medium"><Mic aria-hidden className="mr-1 inline size-4" />Voz do canal</p>
      {voices.data.map((view) => (
        <div key={view.preset.id} className="space-y-2 rounded border p-2">
          <p className="font-medium">{view.preset.name}</p>
          <p className="text-xs text-muted-foreground">Voz original desenhada no VoiceStudio ({view.preset.design.instruct} · seed {view.preset.design.seed} · {view.preset.speed}×), sem clonagem de pessoa real.</p>
          <p className="text-xs">Licença do modelo {view.preset.modelId}: {view.license ? `${view.license.license} · ${view.license.licenseCategory === 'noncommercial' ? 'uso não comercial' : view.license.licenseCategory} · inferência comercial: ${view.license.commercialInference}` : 'não informada pelo VoiceStudio'}</p>
          <p className="text-xs"><span className={view.valid ? '' : 'text-amber-200'}>{view.valid ? 'Autorizada' : 'Não autorizada'}</span> — {view.reason}</p>
          {view.useApproval && <p className="text-xs text-muted-foreground">Autorização: {view.useApproval.note} · {new Date(view.useApproval.grantedAt).toLocaleString('pt-BR')}</p>}
          {!view.valid && <Authorize runId={runId} view={view} />}
          <label className="block text-xs">Ritmo desta narração (o preset da voz não muda)
            <select aria-label="Ritmo desta narração" className={SELECT} value={narrationSpeed} disabled={running || speak.isPending} onChange={(event) => setNarrationSpeed(Number(event.target.value))}>
              {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="min-h-11" disabled={finished || running || !view.valid || speak.isPending} onClick={() => speak.mutate({ presetId: view.preset.id, speed: narrationSpeed })}>{running ? 'Narrando…' : 'Narrar com esta voz'}</Button>
            {view.useApproval && <Button size="sm" variant="outline" className="min-h-11" disabled={revoke.isPending} onClick={() => revoke.mutate(view.preset.id)}>Revogar autorização</Button>}
          </div>
        </div>
      ))}
      {storyboard.data && (
        <details>
          <summary className="cursor-pointer text-xs font-medium">Direção por cena (velocidade e pausa depois da cena)</summary>
          <p className="mt-1 text-xs text-muted-foreground">O motor de voz atual não tem controle de emoção: energia e expressividade vêm do texto, da pontuação e da velocidade. As pausas são silêncio real inserido depois da cena.</p>
          <ol className="mt-2 space-y-2">
            {storyboard.data.scenes.map((scene, index) => {
              const direction = byScene.get(scene.id);
              return (
                <li key={scene.id} className="grid gap-2 rounded border p-2 sm:grid-cols-[1fr_auto_auto]">
                  <p className="text-xs"><span className="font-medium">Cena {index + 1}.</span> {scene.narration}</p>
                  <label className="text-xs">Velocidade
                    <select className={SELECT} value={direction?.speed ?? ''} disabled={direct.isPending} onChange={(event) => direct.mutate(event.target.value ? { sceneId: scene.id, speed: Number(event.target.value), ...(direction?.pauseAfterMs ? { pauseAfterMs: direction.pauseAfterMs } : {}) } : direction?.pauseAfterMs ? { sceneId: scene.id, pauseAfterMs: direction.pauseAfterMs } : { sceneId: scene.id, clear: true })}>
                      <option value="">Padrão da voz</option>
                      {SPEEDS.map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
                    </select>
                  </label>
                  <label className="text-xs">Pausa depois
                    <select className={SELECT} value={direction?.pauseAfterMs ?? 0} disabled={direct.isPending} onChange={(event) => { const pause = Number(event.target.value); direct.mutate(pause || direction?.speed ? { sceneId: scene.id, ...(direction?.speed ? { speed: direction.speed } : {}), ...(pause ? { pauseAfterMs: pause } : {}) } : { sceneId: scene.id, clear: true }); }}>
                      {PAUSES.map((pause) => <option key={pause} value={pause}>{pause ? `${pause} ms` : 'Sem pausa'}</option>)}
                    </select>
                  </label>
                </li>
              );
            })}
          </ol>
        </details>
      )}
      {(voices.isError || speak.isError || revoke.isError || direct.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(voices.error ?? speak.error ?? revoke.error ?? direct.error)}</p>}
    </div>
  );
}

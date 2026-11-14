import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { AcquiredMediaUseView, RenderUseBasis } from '@neuralbridge/shared/aethera-render-use';
import type { ProductionState } from '@neuralbridge/shared/velix-production';

const BASIS: Record<RenderUseBasis, string> = { licensed: 'Licenciada (Rights Manager)', editorial_use: 'Uso editorial — não é licença', preview_only: 'Só na prévia, aguardando você', not_allowed: 'Não entra no vídeo' };
const TEXTAREA = 'mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Decision({ runId, use }: { runId: string; use: AcquiredMediaUseView }) {
  const client = useQueryClient();
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const ask = (decision: 'approved' | 'rejected') => { if (!note.trim()) { setMissing(true); document.getElementById(`editorial-note-${use.assetId}`)?.focus(); return; } setMissing(false); decide.mutate(decision); };
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => window.neuralbridge.video.productionMediaEditorialDecide({ runId, assetId: use.assetId, decision, note }),
    onSuccess: (next) => { client.setQueryData(['aethera-media-use', runId], next); setNote(''); },
  });
  const id = `editorial-note-${use.assetId}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs">Nota da decisão (obrigatória)</label>
      <textarea id={id} rows={2} className={TEXTAREA} value={note} aria-invalid={missing} aria-describedby={missing ? `${id}-missing` : undefined} onChange={(event) => { setNote(event.target.value); if (event.target.value.trim()) setMissing(false); }} placeholder="Ex.: trailer oficial, trecho curto com comentário" />
      {missing && <p id={`${id}-missing`} role="alert" className="text-xs text-destructive">Escreva o motivo da decisão antes de aprovar ou rejeitar.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="min-h-11" disabled={decide.isPending} onClick={() => ask('approved')}>Aprovar uso editorial</Button>
        <Button size="sm" variant="outline" className="min-h-11" disabled={decide.isPending} onClick={() => ask('rejected')}>Rejeitar</Button>
      </div>
      {decide.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(decide.error)}</p>}
    </div>
  );
}

/**
 * AP-02: third-party media enters a render only on a basis the person chose — the project's editorial-use policy and,
 * for sources under review, a decision per asset. Acquired media is never shown as licensed; legal clearance is shown as is.
 */
export function ProductionEditorialUse({ state }: { state: ProductionState }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const isAethera = state.stages.some((item) => item.kind === 'media_acquisition');
  const policy = useQuery({ queryKey: ['aethera-editorial-policy', runId], queryFn: () => api.productionEditorialPolicyGet(runId), enabled: isAethera });
  const media = useQuery({ queryKey: ['aethera-media-use', runId], queryFn: () => api.productionMediaUse(runId), enabled: isAethera });
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const enabled = policy.data?.thirdPartyEditorialUse ?? false;
  const toggle = useMutation({
    mutationFn: () => api.productionEditorialPolicySet({ runId, enabled: !enabled, note }),
    onSuccess: (next) => { client.setQueryData(['aethera-editorial-policy', runId], next); setNote(''); void client.invalidateQueries({ queryKey: ['aethera-media-use', runId] }); },
  });
  if (!isAethera || !media.data?.length) return null;
  return (
    <div aria-label="Uso editorial de mídia de terceiros" className="space-y-3 rounded border p-3 text-sm">
      <p className="font-medium"><Scale aria-hidden className="mr-1 inline size-4" />Uso editorial de mídia de terceiros</p>
      <p className="text-xs text-muted-foreground">Mídia adquirida não é mídia licenciada. Com a política ligada, trailers e gameplays entram no vídeo como uso editorial (comentário, análise, ranking); a situação jurídica continua a registrada na fonte e a publicação exige a sua aprovação (G4).</p>
      <div className="space-y-1 rounded border p-2">
        <p className="text-xs">Política deste projeto: <strong>{enabled ? 'ligada' : 'desligada'}</strong>{policy.data ? ` · ${policy.data.note}` : ' · nunca decidida'}</p>
        <label htmlFor="editorial-policy-note" className="text-xs">Motivo para {enabled ? 'desligar' : 'ligar'} (obrigatório)</label>
        <textarea id="editorial-policy-note" rows={2} className={TEXTAREA} value={note} aria-invalid={missing} aria-describedby={missing ? 'editorial-policy-missing' : undefined} onChange={(event) => { setNote(event.target.value); if (event.target.value.trim()) setMissing(false); }} placeholder="Ex.: ranking com comentário crítico, trechos curtos e créditos" />
        {missing && <p id="editorial-policy-missing" role="alert" className="text-xs text-destructive">Escreva o motivo antes de {enabled ? 'desligar' : 'ligar'} o uso editorial.</p>}
        <Button size="sm" variant={enabled ? 'outline' : 'default'} className="min-h-11" disabled={toggle.isPending} onClick={() => { if (!note.trim()) { setMissing(true); document.getElementById('editorial-policy-note')?.focus(); return; } setMissing(false); toggle.mutate(); }}>{enabled ? 'Desligar uso editorial' : 'Ligar uso editorial'}</Button>
        {toggle.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(toggle.error)}</p>}
      </div>
      <ul aria-label="Mídias adquiridas e base de uso" className="space-y-2">
        {media.data.map((use) => (
          <li key={use.assetId} className="space-y-1 rounded border p-2">
            <p className="truncate font-medium" title={use.title}>{use.title}</p>
            <p className="text-xs text-muted-foreground">{use.publisher} · situação jurídica: {use.legalClearance === 'unknown' ? 'desconhecida' : use.legalClearance}</p>
            <p className="text-xs"><span className={use.basis === 'not_allowed' ? 'text-destructive' : use.basis === 'preview_only' ? 'text-amber-200' : ''}>{BASIS[use.basis]}</span> — {use.reason}</p>
            <p className="truncate text-xs text-muted-foreground" title={use.url}>{use.url}</p>
            {use.usage === 'review_required' && enabled && use.decision === null && <Decision runId={runId} use={use} />}
            {use.decision && <p className="text-xs">Sua decisão: {use.decision === 'approved' ? 'uso editorial aprovado' : 'rejeitado'}</p>}
          </li>
        ))}
      </ul>
      {(policy.isError || media.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(policy.error ?? media.error)}</p>}
    </div>
  );
}

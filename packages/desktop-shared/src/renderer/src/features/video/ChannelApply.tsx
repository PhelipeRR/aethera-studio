import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { BrandIdentity } from '@neuralbridge/shared/velix-channel';
import { brandPieceDataUrl, evaluateBrandIdentity, renderBrandPiece } from '@neuralbridge/shared/velix-brand-pieces';
import { ProgressBar } from './ProgressBar';
import { piecePng, savePiece } from './save-piece';

type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
const CORNERS: Array<[Corner, string]> = [['bottomRight', 'Inferior direito'], ['bottomLeft', 'Inferior esquerdo'], ['topRight', 'Superior direito'], ['topLeft', 'Superior esquerdo']];
const MARK: Record<'ok' | 'warn' | 'fail', { icon: string; tone: string; label: string }> = {
  ok: { icon: '✓', tone: 'text-success', label: 'ok' },
  warn: { icon: '!', tone: 'text-warning', label: 'atenção' },
  fail: { icon: '✕', tone: 'text-destructive', label: 'precisa corrigir' },
};
const text = (value: unknown, key: 'description' | 'keywords') => { const channel = (value as { channel?: Record<string, unknown> } | null | undefined)?.channel; return typeof channel?.[key] === 'string' ? channel[key] : ''; };

/**
 * Review before the channel changes: the identity is checked, every change is listed with before and after, and the
 * person only ticks what goes. One approval on the system dialog covers exactly the ticked changes.
 */
export function ChannelApply({ projectId, identity, niche, connected, canWrite, branding, onOpenSettings }: { projectId: string; identity: BrandIdentity; niche: string; connected: boolean; canWrite: boolean; branding: unknown; onOpenSettings: () => void }) {
  const checks = evaluateBrandIdentity(identity);
  const blocked = checks.some((check) => check.status === 'fail');
  const current = useQuery({ queryKey: ['velix-channel-current-banner'], queryFn: () => window.neuralbridge.video.channelCurrentBanner(), enabled: connected, retry: false });
  const [banner, setBanner] = useState(true);
  const [watermark, setWatermark] = useState(true);
  const [corner, setCorner] = useState<Corner>('bottomRight');
  const [description, setDescription] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string | null>(null);
  const suggest = useMutation({ mutationFn: () => window.neuralbridge.video.channelOptimize({ projectId, query: niche.trim() || identity.tagline || identity.direction, referenceTitles: [], agent: 'claude' }) });
  const suggestDescription = () => { suggest.mutate(undefined, { onSuccess: (result) => setDescription(result.description) }); };
  const suggestKeywords = () => { suggest.mutate(undefined, { onSuccess: (result) => setKeywords(result.tags.join(', ')) }); };
  const [runId, setRunId] = useState<string | null>(null);
  const currentDescription = text(branding, 'description');
  const currentKeywords = text(branding, 'keywords');
  const changes = (banner ? 1 : 0) + (watermark ? 1 : 0) + (description !== null ? 1 : 0) + (keywords !== null ? 1 : 0);
  const apply = useMutation({
    mutationFn: async () => {
      const bannerPng = banner ? await piecePng(renderBrandPiece(identity, 'banner'), 2560, 1440, 'jpeg') : null;
      const watermarkPng = watermark ? await piecePng(renderBrandPiece(identity, 'watermark'), 150, 150) : null;
      return window.neuralbridge.video.channelIdentityApply({ projectId, ...(bannerPng ? { banner: { imageBase64: bannerPng } } : {}), ...(watermarkPng ? { watermark: { imageBase64: watermarkPng, position: corner } } : {}), ...(description === null ? {} : { description }), ...(keywords === null ? {} : { keywords }) });
    },
    onSuccess: (result) => setRunId(result.id),
  });
  const run = useQuery({ queryKey: ['velix-channel-identity-apply', runId], queryFn: () => window.neuralbridge.video.channelIdentityApplyStatus(runId ?? ''), enabled: !!runId, refetchInterval: (query) => (query.state.data?.status === 'running' || !query.state.data ? 300 : false) });
  const finished = run.data?.status === 'completed';
  const refetchCurrent = current.refetch;
  useEffect(() => { if (finished) void refetchCurrent(); }, [finished, refetchCurrent]);
  const running = apply.isPending || run.data?.status === 'running';

  return (
    <div role="region" aria-label="Aplicar no canal" className="space-y-4 rounded border p-3">
      <h4 className="font-medium">Avaliar e subir para o canal</h4>

      <div role="region" aria-label="Avaliação da identidade" className="space-y-1">
        <p className="text-sm font-medium">Avaliação · {checks.filter((check) => check.status === 'ok').length} de {checks.length} itens ok</p>
        <ul className="space-y-1 text-sm">{checks.map((check) => <li key={check.id} className="flex gap-2"><span aria-hidden className={`w-4 shrink-0 text-center font-bold ${MARK[check.status].tone}`}>{MARK[check.status].icon}</span><span><span className="font-medium">{check.label}</span> <span className="sr-only">({MARK[check.status].label})</span><span className="text-muted-foreground">— {check.detail}</span></span></li>)}</ul>
        {blocked && <p role="alert" className="text-sm text-destructive">Corrija os itens marcados com ✕ em “Editar identidade”, acima, antes de subir.</p>}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">O que vai mudar no canal</legend>
        <label className="flex items-start gap-2 rounded border p-2 text-sm"><input type="checkbox" className="mt-1" checked={banner} onChange={(event) => setBanner(event.target.checked)} aria-label="Trocar o banner" /><span className="min-w-0 flex-1 space-y-2"><span className="block font-medium">Banner</span>
          <span className="grid gap-2 sm:grid-cols-2">
            <span className="space-y-1"><span className="block text-xs text-muted-foreground">Hoje no canal</span>{current.isFetching ? <ProgressBar label="Buscando o banner atual" /> : current.data ? <img alt="Banner atual do canal" src={current.data} className="w-full rounded border" /> : <span className="block rounded border border-dashed p-4 text-center text-xs text-muted-foreground">{connected ? 'Sem banner ou não foi possível carregar.' : 'Conecte o canal para ver.'}</span>}</span>
            <span className="space-y-1"><span className="block text-xs text-muted-foreground">Novo</span><img alt="Banner novo" src={brandPieceDataUrl(identity, 'banner')} className="w-full rounded border" /></span>
          </span></span></label>
        <label className="flex items-start gap-2 rounded border p-2 text-sm"><input type="checkbox" className="mt-1" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} aria-label="Aplicar a marca d'água" /><span className="flex flex-1 flex-wrap items-center gap-3"><img alt="Marca d'água nova" src={brandPieceDataUrl(identity, 'watermark')} className="h-12 w-12 rounded border" /><span className="font-medium">Marca d&apos;água nos vídeos</span><select aria-label="Posição da marca d'água" className="rounded border bg-background px-2 py-1 text-xs" value={corner} onChange={(event) => setCorner(event.target.value as Corner)}>{CORNERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></span></label>
        <label className="flex items-start gap-2 rounded border p-2 text-sm"><input type="checkbox" className="mt-1" checked={description !== null} onChange={(event) => setDescription(event.target.checked ? currentDescription || identity.tagline : null)} aria-label="Trocar a descrição do canal" /><span className="flex-1 space-y-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Descrição do canal</span><Button type="button" size="sm" variant="outline" onClick={suggestDescription} disabled={suggest.isPending || !niche.trim()}>Sugerir</Button></span>{description !== null ? <textarea aria-label="Nova descrição do canal" maxLength={1000} className="min-h-20 w-full rounded border bg-background p-2 text-sm" value={description} onChange={(event) => setDescription(event.target.value)} /> : <span className="block text-xs text-muted-foreground">{currentDescription ? `Hoje: ${currentDescription.slice(0, 140)}${currentDescription.length > 140 ? '…' : ''}` : 'Hoje: sem descrição.'}</span>}</span></label>
        <label className="flex items-start gap-2 rounded border p-2 text-sm"><input type="checkbox" className="mt-1" checked={keywords !== null} onChange={(event) => setKeywords(event.target.checked ? currentKeywords : null)} aria-label="Trocar as palavras-chave do canal" /><span className="flex-1 space-y-1"><span className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">Palavras-chave do canal</span><Button type="button" size="sm" variant="outline" onClick={suggestKeywords} disabled={suggest.isPending || !niche.trim()}>Sugerir</Button></span>{keywords !== null ? <input aria-label="Novas palavras-chave do canal" maxLength={500} className="w-full rounded border bg-background px-2 py-1 text-sm" value={keywords} onChange={(event) => setKeywords(event.target.value)} /> : <span className="block text-xs text-muted-foreground">{currentKeywords ? `Hoje: ${currentKeywords}` : 'Hoje: sem palavras-chave.'}</span>}</span></label>
        <div className="flex flex-wrap items-center gap-3 rounded border border-dashed p-2 text-sm"><img alt="Foto de perfil nova" src={brandPieceDataUrl(identity, 'avatar')} className="h-12 w-12 rounded-full border" /><span className="min-w-0 flex-1 text-xs text-muted-foreground">Foto de perfil e nome do canal: o YouTube não deixa apps mudarem. Salve a foto e troque em studio.youtube.com → Personalização.</span><Button size="sm" variant="outline" onClick={() => void savePiece(identity, 'avatar', 'png')}>Salvar foto no PC</Button></div>
      </fieldset>

      {connected && !canWrite && <div role="note" className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed p-2 text-sm"><span>Para subir, autorize o envio e a edição do canal.</span><Button size="sm" variant="outline" onClick={onOpenSettings}>Abrir Configuração</Button></div>}
      {!connected && <div role="note" className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed p-2 text-sm"><span>Conecte o canal YouTube para subir a identidade.</span><Button size="sm" variant="outline" onClick={onOpenSettings}>Abrir Configuração</Button></div>}
      <div className="space-y-2">
        <Button onClick={() => apply.mutate()} disabled={!canWrite || blocked || changes === 0 || running}>{`Subir para o YouTube (${changes} ${changes === 1 ? 'mudança' : 'mudanças'})`}</Button>
        <p className="text-xs text-muted-foreground">Você aprova tudo de uma vez numa janela do sistema, que lista exatamente o que vai mudar.</p>
        {apply.isPending && <ProgressBar label="Gerando os PNGs e aguardando a sua aprovação" />}
        {run.data && <ProgressBar label={`Aplicando no canal · ${run.data.step}`} value={run.data.progress} />}
        {run.data && run.data.done.length > 0 && <ul className="space-y-0.5 text-sm">{run.data.done.map((item) => <li key={item}>✓ {item}</li>)}</ul>}
        {finished && <p role="status" className="text-sm">Identidade aplicada no canal. Pode levar alguns minutos para aparecer no YouTube.</p>}
        {run.data?.status === 'failed' && <p role="alert" className="text-sm text-destructive">{run.data.error}</p>}
        {apply.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(apply.error)}</p>}
        {suggest.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(suggest.error)}</p>}
      </div>
    </div>
  );
}

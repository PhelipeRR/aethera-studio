import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { BrandIdentity } from '@neuralbridge/shared/velix-channel';
import { brandPieceDataUrl, renderBrandPiece } from '@neuralbridge/shared/velix-brand-pieces';
import { ProgressBar } from './ProgressBar';
import { piecePng, savePiece } from './save-piece';

/** Video thumbnail in the channel's approved identity: the headline is the video's own, previewed live before it is used. */
export function ChannelThumbnail({ projectId, identity, title, selectedPath, onUse, onOpenIdentity }: { projectId: string; identity: BrandIdentity | null | undefined; title: string; selectedPath: string; onUse: (relativePath: string) => void; onOpenIdentity: () => void }) {
  const [headline, setHeadline] = useState<string | null>(null);
  const text = (headline ?? title).trim() || 'Título do vídeo aqui';
  const use = useMutation({
    mutationFn: async () => {
      if (!identity) throw new Error('invalid: aprove uma identidade visual primeiro.');
      const imageBase64 = await piecePng(renderBrandPiece(identity, 'thumbnail', { title: text }), 1280, 720, 'jpeg');
      return window.neuralbridge.video.channelSaveThumbnail({ projectId, title: text, imageBase64 });
    },
    onSuccess: (result) => onUse(result.relativePath),
  });
  const download = useMutation({ mutationFn: () => (identity ? savePiece(identity, 'thumbnail', 'png', { title: text }) : Promise.resolve(false)) });

  if (!identity) return <div role="note" className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed p-3 text-sm"><span>Para gerar a thumbnail no visual do canal, aprove uma identidade visual.</span><Button size="sm" variant="outline" onClick={onOpenIdentity}>Abrir Identidade visual</Button></div>;
  return (
    <div role="region" aria-label="Gerador de thumbnail" className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-sm font-medium">Thumbnail</h4><span className="text-xs text-muted-foreground">No visual {identity.direction} · 1280×720</span></div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <img alt="Prévia da thumbnail do vídeo" src={brandPieceDataUrl(identity, 'thumbnail', { title: text })} className="w-full rounded border" />
        <div className="space-y-2">
          <label className="block text-xs font-medium">Texto da thumbnail<textarea aria-label="Texto da thumbnail" maxLength={80} className="mt-1 min-h-20 w-full rounded border bg-background p-2 text-sm" placeholder={title || 'Título do vídeo aqui'} value={headline ?? ''} onChange={(event) => setHeadline(event.target.value || null)} /></label>
          <p className="text-xs text-muted-foreground">Vazio usa o título do vídeo. Até 4 a 6 palavras leem melhor no celular.</p>
          <Button size="sm" className="w-full" onClick={() => use.mutate()} disabled={use.isPending}>Usar nesta publicação</Button>
          <Button size="sm" variant="outline" className="w-full" onClick={() => download.mutate()} disabled={download.isPending}>Salvar no PC</Button>
        </div>
      </div>
      {use.isPending && <ProgressBar label="Gerando o PNG da thumbnail" />}
      {use.isSuccess && selectedPath === use.data.relativePath && <p role="status" className="text-xs text-muted-foreground">Thumbnail pronta: {use.data.relativePath}. Ela vai junto no envio.</p>}
      {download.data && <p role="status" className="text-xs text-muted-foreground">Thumbnail salva no computador.</p>}
      {use.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(use.error)}</p>}
      {download.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(download.error)}</p>}
    </div>
  );
}

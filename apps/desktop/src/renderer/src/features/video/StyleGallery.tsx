import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { recommendVideoStyles, wholeVideoStyles, type VideoStyle } from '@neuralbridge/shared/video-styles';
import { ProgressBar } from './ProgressBar';

const FAMILY: Record<VideoStyle['family'], string> = { dossie: 'Singularity', motionvelix: 'MotionVelix', remotion: 'Remotion', opuscar: 'Lemo-opuscar', onetake: 'One take', drawn: 'Desenhado', generated: 'Gerado por IA' };

/** Every registered style, for the Estúdio, which also offers layers when the video has a filmed base. */
export function useAllVideoStyles() {
  return useQuery({ queryKey: ['video-styles'], queryFn: () => window.neuralbridge.video.styles(), staleTime: Infinity });
}

export function useVideoStyles() {
  // The gallery chooses the style of a whole video; stings and overlays join through mixing.
  return useQuery({ queryKey: ['video-styles'], queryFn: () => window.neuralbridge.video.styles(), staleTime: Infinity, select: wholeVideoStyles });
}

/**
 * The style picker: what each style is for, what it needs, where it comes from and its license. With `preview`, the
 * chosen style can be seen with the person's own script before anything renders.
 */
export function StyleGallery({ styles, value, onChange, recommendText = '', preview, missing = {} }: {
  styles: readonly VideoStyle[]; value: string; onChange: (styleId: string) => void; recommendText?: string;
  preview?: (styleId: string) => Promise<string[]>; missing?: { narration?: boolean; footage?: boolean; faceVideo?: boolean };
}) {
  const recommended = recommendVideoStyles(styles, recommendText);
  const ordered = [...styles].sort((a, b) => (recommended.includes(b.id) ? 1 : 0) - (recommended.includes(a.id) ? 1 : 0));
  const frames = useMutation({ mutationFn: (styleId: string) => (preview ? preview(styleId) : Promise.resolve([])) });
  const blockedBy = (style: VideoStyle) => [style.needs.narration && missing.narration && 'narração', style.needs.footage && missing.footage && 'vídeo autorizado', style.needs.faceVideo && missing.faceVideo && 'vídeo de rosto'].filter((item): item is string => typeof item === 'string');
  const current = styles.find((style) => style.id === value);
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Estilo do vídeo" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {ordered.map((style) => {
          const blocked = blockedBy(style);
          const selected = style.id === value;
          return (
            <button key={style.id} type="button" role="radio" aria-checked={selected} disabled={blocked.length > 0} onClick={() => { onChange(style.id); frames.reset(); }}
              className={`space-y-1 rounded-lg border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${selected ? 'border-primary bg-primary/10' : 'hover:bg-muted/40'}`}>
              <span className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{style.label}</span>{recommended.includes(style.id) && <span className="rounded bg-primary/15 px-1.5 text-xs text-primary">Recomendado</span>}</span>
              <span className="block text-xs text-muted-foreground">{style.description}</span>
              <span className="flex flex-wrap gap-1 pt-1 text-[11px] text-muted-foreground">
                <span className="rounded border px-1">{FAMILY[style.family]}</span>
                {style.cost === 'paid' && <span className="rounded border px-1">Pago</span>}
                {style.license.noncommercial && <span className="rounded border px-1">Uso não comercial</span>}
                {style.needs.narration && <span className="rounded border px-1">Precisa de narração</span>}
                {style.needs.faceVideo && <span className="rounded border px-1">Precisa de vídeo de rosto</span>}
              </span>
              {blocked.length > 0 && <span className="block text-xs text-destructive">Falta: {blocked.join(', ')}.</span>}
            </button>
          );
        })}
      </div>
      {preview && current && (
        <div className="space-y-2">
          <Button size="sm" variant="outline" onClick={() => frames.mutate(current.id)} disabled={frames.isPending}>{`Ver "${current.label}" com o meu roteiro`}</Button>
          {frames.isPending && <ProgressBar label={`Gerando a prévia de ${current.label}`} />}
          {frames.data && frames.data.length > 0 && <div role="region" aria-label="Prévia do estilo" className="grid grid-cols-3 gap-2">{frames.data.map((frame, index) => <img key={index} src={frame} alt={`${current.label}, quadro ${index + 1} da prévia`} className="w-full rounded border bg-black" />)}</div>}
          {frames.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(frames.error)}</p>}
        </div>
      )}
      {current?.license.attribution && <p className="text-xs text-muted-foreground">Créditos: {current.license.attribution} ({current.license.name}).</p>}
    </div>
  );
}

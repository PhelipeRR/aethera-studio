import { useState } from 'react';
import { Play, Plus, WandSparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import directorChair from '@/assets/aethera/director-chair.webp';

/*
 * R4 — "Comece uma produção", as in the reference screen: the director's chair on the left in warm light, the call to
 * action on the right. Now includes a direct 1-prompt box to start an autonomous production and open the workspace/editor.
 */
export function AetheraStart({
  onNewVideo,
  onTemplate,
  onAutoProduce,
  autoPending = false,
}: {
  onNewVideo: () => void;
  onTemplate: () => void;
  onAutoProduce?: (prompt: string) => void;
  autoPending?: boolean;
}) {
  const [prompt, setPrompt] = useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || !onAutoProduce || autoPending) return;
    onAutoProduce(trimmed);
  };

  return (
    <section aria-labelledby="aethera-start-title" className="aethera-start sg-panel @container relative overflow-hidden rounded-2xl">
      <div className="grid h-full @md:grid-cols-[10rem_minmax(0,1fr)] @lg:grid-cols-[14rem_minmax(0,1fr)] @2xl:grid-cols-[17rem_minmax(0,1fr)]">
        <img src={directorChair} alt="" aria-hidden="true" className="aethera-start__photo h-40 w-full object-cover object-[62%_center] @md:h-full @md:min-h-48" />
        <div className="min-w-0 px-5 pb-5 pt-4 @md:py-6 @md:pl-6 @md:pr-5">
          <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-primary">Novo projeto</p>
          <h2 id="aethera-start-title" className="mt-2 text-2xl font-light leading-tight @2xl:text-[1.75rem] tracking-[0.005em] text-foreground">Comece uma produção</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Digite o tema ou prompt do vídeo para gerar tudo no automático e revisar direto no Editor.</p>
          {onAutoProduce && (
            <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                aria-label="Prompt do vídeo"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ex.: TOP 10 Jogos mais aguardados de 2027…"
                className="h-11 min-w-0 flex-1 rounded-lg border border-[var(--glass-border-strong)] bg-background/60 px-3.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="lg" className="h-11 shrink-0 rounded-lg px-5 font-medium shadow-[var(--glow-soft)]" disabled={!prompt.trim() || autoPending}>
                <WandSparkles className="size-4" aria-hidden="true" />
                {autoPending ? 'Gerando…' : 'Gerar no Automático'}
              </Button>
            </form>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            <Button size="sm" variant="outline" className="h-9 rounded-lg border-[var(--glass-border-strong)] px-4 font-medium" onClick={onNewVideo}><Plus className="size-4" aria-hidden="true" />Novo vídeo detalhado</Button>
            <Button size="sm" variant="outline" className="h-9 rounded-lg border-[var(--glass-border-strong)] px-4 font-medium" onClick={onTemplate}><Play className="size-4" aria-hidden="true" />Usar template</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

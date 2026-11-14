import { useEffect, useState } from 'react';
import type { CompanionHudState } from '@neuralbridge/shared/companion';

/** The way back to a hidden HUD, and the keyboard route to it: the floating window takes no focus until its panel is open. */
export function CompanionSettingsSection() {
  const [state, setState] = useState<CompanionHudState | null>(null);
  useEffect(() => {
    let disposed = false;
    void window.neuralbridge.companion.getHudState().then((value) => { if (!disposed) setState(value); }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);
  const change = (next: Partial<CompanionHudState>) => setState((current) => (current ? { ...current, ...next } : current));

  return (
    <section aria-labelledby="companion-heading">
      <h2 id="companion-heading" className="text-base font-medium">
        Companion
      </h2>
      <p className="mt-1 text-muted-foreground">Mascote flutuante que acompanha as sessões reais do TaskEngine.</p>
      {state && (
        <div className="mt-4 space-y-1">
          <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent">
            <input type="checkbox" checked={state.visible} onChange={(event) => { change({ visible: event.target.checked }); void window.neuralbridge.companion.setHudVisibility(event.target.checked); }} />
            <span className="font-medium">Mostrar na área de trabalho</span>
          </label>
          <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent">
            <input type="checkbox" checked={state.alwaysOnTop} onChange={(event) => { change({ alwaysOnTop: event.target.checked }); void window.neuralbridge.companion.setHudPinned(event.target.checked); }} />
            <span className="font-medium">Manter acima das outras janelas</span>
          </label>
          <div className="flex gap-2 px-3 pt-2">
            <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent" onClick={() => { change({ visible: true, mode: 'expanded' }); void window.neuralbridge.companion.openHudPanel(); }}>Abrir painel</button>
            <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent" onClick={() => void window.neuralbridge.companion.resetHudPosition()}>Restaurar posição</button>
          </div>
        </div>
      )}
    </section>
  );
}

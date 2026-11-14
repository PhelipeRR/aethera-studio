import * as React from 'react';
import { Command, Search, Settings, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ROUTES, type RouteIcon } from './routes';

type PaletteItem = { id: string; label: string; detail: string; path?: string; icon: RouteIcon; run?: () => void };

export function CommandPalette({ open, onClose, onToggleSidebar }: { open: boolean; onClose: () => void; onToggleSidebar: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [selected, setSelected] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);

  const items = React.useMemo<PaletteItem[]>(() => [
    ...ROUTES.map((route) => ({ id: route.path, label: route.label, detail: route.description, path: route.path, icon: route.icon })),
    { id: 'toggle-sidebar', label: 'Alternar sidebar', detail: 'Expandir ou recolher a navegação', icon: Command, run: onToggleSidebar },
    { id: 'settings', label: 'Abrir configurações', detail: 'Aparência e informações do aplicativo', path: '/settings', icon: Settings },
  ], [onToggleSidebar]);

  const filtered = items.filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  React.useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => { setQuery(''); setSelected(0); inputRef.current?.focus(); });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((value) => filtered.length ? (value + 1) % filtered.length : 0); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => filtered.length ? (value - 1 + filtered.length) % filtered.length : 0); return; }
      if (event.key === 'Enter' && filtered[selected]) {
        event.preventDefault();
        const item = filtered[selected];
        if (item.path) navigate(item.path);
        item.run?.();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [filtered, navigate, onClose, open, selected]);

  React.useEffect(() => {
    if (open) return;
    previousFocus.current?.focus();
  }, [open]);

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/65 px-4 pt-[12vh] backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="command-palette-title" className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/40">
      <h2 id="command-palette-title" className="sr-only">Command Palette</h2>
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search className="size-4 text-muted-foreground" aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} placeholder="Buscar módulos e comandos" aria-label="Buscar módulos e comandos" aria-controls="command-palette-results" aria-activedescendant={filtered[selected] ? `command-option-${filtered[selected].id.replace(/[^a-z0-9]+/gi, '-')}` : undefined} className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">ESC</kbd>
        <button type="button" onClick={onClose} aria-label="Fechar Command Palette" className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" /></button>
      </div>
      <div id="command-palette-results" className="max-h-[min(58vh,420px)] overflow-y-auto p-2" role="listbox" aria-label="Resultados">
        {filtered.length ? filtered.map((item, index) => { const Icon = item.icon; return <button key={item.id} type="button" role="option" id={`command-option-${item.id.replace(/[^a-z0-9]+/gi, '-')}`} aria-selected={index === selected} onMouseEnter={() => setSelected(index)} onClick={() => { if (item.path) navigate(item.path); item.run?.(); onClose(); }} className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring ${index === selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'}`}><span className={`flex size-8 shrink-0 items-center justify-center rounded-md ${index === selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}><Icon className="size-4" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.detail}</span></span><span className="hidden text-[10px] text-muted-foreground sm:inline">Enter</span></button>; }) : <div className="px-4 py-10 text-center"><Command className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">Nenhum resultado encontrado</p><p className="mt-1 text-xs text-muted-foreground">Tente buscar por um módulo ou comando disponível.</p></div>}
      </div>
      <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted-foreground"><span>↑↓ navegar</span><span>↵ abrir</span><span>Esc fechar</span></div>
    </section>
  </div>;
}

import * as React from 'react';
import { HelpCircle, ChevronLeft, ChevronRight, X, RotateCcw, Sparkles } from 'lucide-react';
import { useLocation } from 'react-router';
import { Button } from '@/components/ui/button';
import { TOUR_VERSION, type TourDefinition, type TourStatus } from './guided-tours-core';
import { getTourForPath } from './guided-tours-config';

const STORAGE_KEY = `nb.guided-tours.${TOUR_VERSION}`;
type Persisted = { onboarding: 'unseen' | 'skipped' | 'completed'; tours: Record<string, TourStatus> };
const defaultPersisted: Persisted = { onboarding: 'unseen', tours: {} };
function readPersisted(): Persisted { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '') as Persisted; } catch { return defaultPersisted; } }
function writePersisted(value: Persisted) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* UI still works for this session. */ } }

type ContextValue = { start: (path?: string) => void; reset: (path?: string) => void; onboarding: boolean };
const GuidedToursContext = React.createContext<ContextValue | null>(null);
export function useGuidedTours() { const value = React.useContext(GuidedToursContext); if (!value) throw new Error('useGuidedTours must be used inside GuidedToursProvider'); return value; }

function resolveTarget(selector: string): HTMLElement | null { return document.querySelector<HTMLElement>(selector); }

type TargetStatus = 'waiting' | 'ready' | 'missing' | 'hidden';

function isVisibleTarget(target: HTMLElement): boolean {
  const style = window.getComputedStyle(target);
  const rect = target.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && !target.hidden && target.getClientRects().length > 0 && (rect.width > 0 || rect.height > 0);
}

function TourOverlay({ tour, onClose }: { tour: TourDefinition; onClose: (status: 'completed' | 'skipped') => void }) {
  const [index, setIndex] = React.useState(0);
  const [targetStatus, setTargetStatus] = React.useState<TargetStatus>('waiting');
  const [popoverPosition, setPopoverPosition] = React.useState<{ top: number; left: number; width: number } | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const previousFocus = React.useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const current = tour.steps[index];

  React.useEffect(() => {
    if (!current) return;
    let settled = false;
    const inspect = () => {
      const target = resolveTarget(current.target);
      if (!target) setTargetStatus(settled ? 'missing' : 'waiting');
      else if (!isVisibleTarget(target)) setTargetStatus(settled ? 'hidden' : 'waiting');
      else setTargetStatus('ready');
    };
    inspect();
    const timer = window.setTimeout(() => { settled = true; inspect(); }, 300);
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-state'] });
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, [current]);

  React.useEffect(() => {
    if (targetStatus !== 'ready' || !current) return;
    const target = resolveTarget(current.target);
    if (!target || !isVisibleTarget(target)) return;
    const rect = target.getBoundingClientRect();
    const margin = 24;
    const outsideViewport = rect.top < margin || rect.bottom > window.innerHeight - margin;
    if (outsideViewport) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target.setAttribute('data-tour-active', 'true');
    return () => target.removeAttribute('data-tour-active');
  }, [current, targetStatus]);

  const reposition = React.useCallback(() => {
    const width = Math.min(420, Math.max(240, window.innerWidth - 32));
    const height = popoverRef.current?.getBoundingClientRect().height ?? 210;
    const target = current && targetStatus === 'ready' ? resolveTarget(current.target) : null;
    const rect = target && isVisibleTarget(target) ? target.getBoundingClientRect() : null;
    const minLeft = 16;
    const maxLeft = Math.max(minLeft, window.innerWidth - width - 16);
    const left = rect ? Math.min(maxLeft, Math.max(minLeft, rect.left + rect.width / 2 - width / 2)) : Math.max(minLeft, (window.innerWidth - width) / 2);
    const minTop = 16;
    const maxTop = Math.max(minTop, window.innerHeight - height - 16);
    const below = rect ? rect.bottom + 14 : maxTop;
    const above = rect ? rect.top - height - 14 : maxTop;
    const top = rect && below <= maxTop ? below : rect && above >= minTop ? above : Math.min(maxTop, Math.max(minTop, below));
    setPopoverPosition((previous) => previous?.top === top && previous.left === left && previous.width === width ? previous : { top, left, width });
  }, [current, targetStatus]);

  React.useLayoutEffect(() => {
    let frame = 0;
    const schedule = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(reposition); };
    schedule();
    // Text wraps again once the dialog gets its final width, so its real height arrives after the first measure.
    const resized = new ResizeObserver(schedule);
    if (popoverRef.current) resized.observe(popoverRef.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => { window.cancelAnimationFrame(frame); resized.disconnect(); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [reposition]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [current]);

  React.useEffect(() => () => { if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true }); }, []);

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose('skipped'); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    if (!focusable.length) return;
    const first = focusable.at(0);
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  if (!current) return null;
  const positionStyle = popoverPosition ? { top: popoverPosition.top, left: popoverPosition.left, width: popoverPosition.width } : undefined;
  return <div className="pointer-events-none fixed inset-0 isolate z-[1000]"><div className="absolute inset-0 z-0 bg-slate-950/35" /><div ref={(element) => { dialogRef.current = element; popoverRef.current = element; }} role="dialog" aria-modal="true" aria-labelledby="guided-tour-title" onKeyDown={onDialogKeyDown} className={`pointer-events-auto fixed z-[1001] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-primary/40 bg-card p-5 shadow-2xl motion-reduce:transition-none ${popoverPosition ? '' : 'bottom-6 left-1/2 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2'}`} style={positionStyle}><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">Tutorial · {index + 1}/{tour.steps.length}</p><h2 id="guided-tour-title" className="mt-1 text-lg font-semibold">{current.title}</h2></div><button type="button" aria-label="Fechar tutorial" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onClose('skipped')}><X className="size-4" /></button></div><p className="mt-3 break-words text-sm leading-6 text-muted-foreground">{current.description}</p>{targetStatus === 'waiting' && <p role="status" className="mt-3 rounded-md border border-border/70 bg-muted/30 p-2 text-xs text-muted-foreground">Localizando este controle por até 300 ms… você pode continuar ou pular enquanto a página termina de carregar.</p>}{targetStatus === 'missing' && <p role="status" className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">Este controle não está disponível neste estado da página. A etapa continua informativa e pode ser avançada sem executar nenhuma ação.</p>}{targetStatus === 'hidden' && <p role="status" className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">Este controle está oculto neste estado. Abra-o manualmente se quiser usá-lo; o tutorial não abrirá modais, painéis ou renderizações por você.</p>}<div className="mt-5 flex flex-wrap items-center justify-between gap-2"><button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={() => onClose('skipped')}>Pular tutorial</button><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => setIndex(Math.max(0, index - 1))} disabled={index === 0}><ChevronLeft className="size-4" aria-hidden="true" /> Anterior</Button><Button size="sm" onClick={() => index === tour.steps.length - 1 ? onClose('completed') : setIndex(index + 1)}>{index === tour.steps.length - 1 ? 'Concluir' : 'Próximo'}{index !== tour.steps.length - 1 && <ChevronRight className="size-4" aria-hidden="true" />}</Button></div></div></div></div>;
}

function Onboarding({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
  return <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[1100] flex justify-center p-4"><div role="dialog" aria-modal="false" aria-labelledby="onboarding-title" className="pointer-events-auto w-full max-w-lg rounded-2xl border border-primary/30 bg-card p-6 shadow-2xl"><div className="flex items-start gap-4"><Sparkles className="mt-1 size-6 shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0"><h2 id="onboarding-title" className="text-lg font-semibold">Conheça o Singularity</h2><p className="mt-2 break-words text-sm leading-6 text-muted-foreground">Os Guided Tours explicam cada área com segurança. Eles destacam controles, mas nunca iniciam agentes, alteram Git, renderizam vídeos ou publicam algo por você.</p><div className="mt-4 flex flex-wrap justify-end gap-2"><Button variant="ghost" size="sm" onClick={onSkip}>Pular por agora</Button><Button size="sm" onClick={onStart}>Iniciar tour da página</Button></div></div></div></div></div>;
}

export function GuidedToursProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const tour = getTourForPath(location.pathname);
  const sessionKey = tour?.id ?? location.pathname;
  return <GuidedToursSession key={sessionKey} tour={tour}>{children}</GuidedToursSession>;
}

function GuidedToursSession({ children, tour }: { children: React.ReactNode; tour: TourDefinition | undefined }) {
  const [persisted, setPersisted] = React.useState(readPersisted);
  const [active, setActive] = React.useState<TourDefinition | null>(null);
  const start = React.useCallback((path?: string) => { const next = path ? getTourForPath(path) : tour; if (next) setActive(next); }, [tour]);
  const reset = React.useCallback((path?: string) => { const next = path ? getTourForPath(path) : tour; if (!next) return; setPersisted((current) => { const value = { ...current, tours: { ...current.tours, [next.id]: 'idle' as TourStatus } }; writePersisted(value); return value; }); setActive(next); }, [tour]);
  const close = (status: 'completed' | 'skipped') => { if (!active) return; setPersisted((current) => { const value = { ...current, tours: { ...current.tours, [active.id]: status } }; writePersisted(value); return value; }); setActive(null); };
  const onboarding = persisted.onboarding === 'unseen';
  const finishOnboarding = (value: 'skipped' | 'completed') => { const next = { ...persisted, onboarding: value }; writePersisted(next); setPersisted(next); };
  return <GuidedToursContext.Provider value={{ start, reset, onboarding }}><style>{'[data-tour-active="true"]{position:relative;z-index:101;box-shadow:0 0 0 3px hsl(var(--primary)),0 0 0 7px hsl(var(--background));border-radius:8px}'}</style>{children}{onboarding && <Onboarding onSkip={() => finishOnboarding('skipped')} onStart={() => { finishOnboarding('completed'); if (tour) start(); }} />}{active && <TourOverlay tour={active} onClose={close} />}</GuidedToursContext.Provider>;
}

export function GuidedTourButton({ path }: { path?: string }) { const ctx = React.useContext(GuidedToursContext); if (!ctx) return null; const { start, reset } = ctx; const currentPath = path ?? (window.location.hash.replace(/^#/, '') || '/'); const tour = getTourForPath(currentPath); if (!tour) return null; return <div className="flex items-center gap-1"><button type="button" aria-label={`Iniciar tutorial de ${tour.title}`} title={`Iniciar tutorial: ${tour.title}`} className="inline-flex min-h-8 items-center gap-2 rounded-md border border-border/80 px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => start(path)}><HelpCircle className="size-4" aria-hidden="true" /> Tutorial</button><button type="button" aria-label="Reiniciar tutorial" title="Reiniciar tutorial desta página" className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" onClick={() => reset(path)}><RotateCcw className="size-3.5" aria-hidden="true" /></button></div>; }

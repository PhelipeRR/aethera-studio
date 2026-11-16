import * as React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Command,
  Cpu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Sparkles,
} from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { MeterBar } from '@/components/ui/glass';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { share } from '@/features/monitoring/format';
import { useMonitoring } from '@/features/monitoring/monitoring-store';
import { usePersistentFlag } from '@/lib/use-persistent-flag';
import { cn } from '@/lib/utils';
import { CommandPalette } from './CommandPalette';
import { DatabaseBanner } from './DatabaseBanner';
import type { AppRoute } from './routes';

export const AETHERA_SIDEBAR_COLLAPSED_KEY = 'aethera.sidebar.collapsed';

function AetheraPrismLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="aetheraPrism" x1="4" y1="4" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="55%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M18 3L32 30H24.5L18 17.5L11.5 30H4L18 3Z" fill="url(#aetheraPrism)" />
    </svg>
  );
}

export interface AetheraShellProps {
  routes: readonly AppRoute[];
}

export function AetheraShell({ routes }: AetheraShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = usePersistentFlag(AETHERA_SIDEBAR_COLLAPSED_KEY);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [appVersion, setAppVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    const nb = window.neuralbridge as unknown as { app?: { info?: () => Promise<{ version?: string }> } };
    nb?.app?.info?.().then((info) => {
      if (info?.version) setAppVersion(info.version);
    }).catch(() => {});
  }, []);

  const currentRoute = React.useMemo(() => {
    const exact = routes.find((r) => r.path === location.pathname);
    if (exact) return exact;
    return routes.find((r) => r.path !== '/aethera' && location.pathname.startsWith(r.path)) ?? routes[0];
  }, [location.pathname, routes]);

  React.useEffect(() => {
    document.documentElement.setAttribute('data-studio-theme', 'aethera');
    return () => document.documentElement.removeAttribute('data-studio-theme');
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? 'Expandir menu' : 'Recolher menu';
  const monitoring = useMonitoring();
  const lastSample = monitoring.samples.at(-1);
  const metricMissing = monitoring.state === 'unavailable' || monitoring.state === 'error' ? 'indisponível' : 'iniciando';
  const cpuPct = lastSample?.cpu.utilization ?? null;
  const ramPct = lastSample ? share(lastSample.memory.usedBytes, lastSample.memory.totalBytes) : null;
  const gpuPct = lastSample?.gpu.utilization ?? null;
  const fmtPct = (v: number | null) => (v == null ? '—' : `${Math.round(v)}%`);

  return (
    <TooltipProvider>
      <div
          data-studio-theme="aethera"
          className={cn(
            'grid h-full grid-rows-[60px_1fr] overflow-hidden bg-background text-foreground transition-[grid-template-columns] duration-200',
            collapsed ? 'grid-cols-[76px_minmax(0,1fr)]' : 'grid-cols-[236px_minmax(0,1fr)]',
          )}
        >
          {/* Top Studio Header — no Singularity MCP/RAG/Memories menus */}
          <header className="app-drag col-span-2 flex min-w-0 items-center justify-between gap-4 bg-background px-4 pr-36">
            <div className="app-no-drag flex items-center gap-3 min-w-0">
              <div className="flex items-center gap-2.5 pr-2">
                <AetheraPrismLogo className="size-7 shrink-0" />
                <div className="flex flex-col leading-none">
                  <span className="text-sm font-semibold tracking-[0.18em] text-foreground">AETHERA</span>
                  <span className="mt-0.5 text-[9px] font-semibold tracking-[0.28em] text-[#f59e0b] uppercase">Studio</span>
                </div>
              </div>

              <div className="hidden items-center gap-1 sm:flex">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label="Voltar"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate(1)}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-full bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label="Avançar"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>

              {currentRoute && (
                <span className="hidden truncate text-xs font-medium text-muted-foreground md:inline">
                  Estúdio / <span className="text-foreground">{currentRoute.label}</span>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="app-no-drag hidden h-11 max-w-md flex-1 cursor-pointer items-center gap-2.5 rounded-full bg-card px-4 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:flex"
              aria-label="Buscar projetos, cenas, mídias e comandos"
            >
              <Search className="size-4 shrink-0" />
              <span className="flex-1 truncate">Buscar projetos, mídias, cenas ou comandos...</span>
              <kbd className="flex items-center gap-0.5 rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                <Command className="size-2.5" />K
              </kbd>
            </button>

            <div className="app-no-drag flex items-center gap-2">
              <div className="hidden items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-medium text-foreground sm:flex">
                <span className="size-2 rounded-full bg-[var(--brand-lime)] ring-2 ring-[var(--brand-lime-soft)]" aria-hidden="true" /><Sparkles className="size-3.5" /> Cinema IA
              </div>
            </div>
          </header>

          {/* Left Studio Navigation Sidebar */}
          <aside
            aria-label="Navegação do Aethera Studio"
            className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
          >
            <nav className={cn('flex-1 overflow-x-hidden overflow-y-auto py-3', collapsed ? 'px-2' : 'px-3')}>
              <ul className="space-y-1">
                {routes.map((route) => {
                  const Icon = route.icon;
                  return (
                    <li key={route.path}>
                      <Tooltip label={route.label} disabled={!collapsed}>
                        <NavLink
                          to={route.path}
                          end={route.path === '/aethera'}
                          aria-label={collapsed ? route.label : undefined}
                          className={({ isActive }) =>
                            cn(
                              'flex h-10 cursor-pointer items-center rounded-2xl bg-card text-[13px] text-muted-foreground transition-colors duration-200',
                              'hover:text-foreground hover:shadow-[var(--elevation-1)] focus-visible:outline-2 focus-visible:outline-ring',
                              collapsed ? 'mx-auto w-10 justify-center px-0' : 'gap-3 px-3.5',
                              isActive && 'bg-primary font-medium text-primary-foreground hover:text-primary-foreground',
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <Icon className={cn('size-[18px] shrink-0', isActive && 'text-primary-foreground')} aria-hidden="true" />
                              {!collapsed && <span className="truncate">{route.label}</span>}
                            </>
                          )}
                        </NavLink>
                      </Tooltip>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {collapsed ? (
              <div className="mx-2 mb-2">
                <Tooltip label={`GPU: ${fmtPct(gpuPct)} · RAM: ${fmtPct(ramPct)} · CPU: ${fmtPct(cpuPct)}`}>
                  <div
                    aria-label="Monitoramento de hardware"
                    className="flex flex-col items-center gap-1 rounded-2xl bg-card px-1.5 py-2 text-[9px] font-mono tabular-nums text-muted-foreground"
                  >
                    <span className="text-foreground">G {fmtPct(gpuPct)}</span>
                    <span className="text-foreground">R {fmtPct(ramPct)}</span>
                    <span className="text-foreground">C {fmtPct(cpuPct)}</span>
                  </div>
                </Tooltip>
              </div>
            ) : (
              <div className="mx-3 mb-3 space-y-2.5 rounded-3xl bg-card p-4 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold tracking-wide text-foreground">Aethera Cinema</span>
                  <span className="rounded-full bg-[var(--brand-lavender-soft)] px-2 py-0.5 font-mono text-[10px] text-[var(--chip-violet-fg)]">
                    {appVersion ? `v${appVersion}` : 'v0.1'}
                  </span>
                </div>
                <div data-live-metric className="space-y-1.5 border-t border-border pt-2">
                  <MeterBar
                    label={lastSample?.gpu.temperatureC != null ? `GPU (${Math.round(lastSample.gpu.temperatureC)}°C)` : 'GPU'}
                    value={gpuPct}
                    missingLabel={metricMissing}
                  />
                  <MeterBar label="RAM" value={ramPct} missingLabel={metricMissing} />
                  <MeterBar label="CPU" value={cpuPct} missingLabel={metricMissing} />
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Cpu className="size-3 text-success" /> Local-first
                  </span>
                  <span className="rounded-full bg-[var(--brand-lime)] px-2 py-0.5 font-medium text-[var(--brand-ink)]">Pronto</span>
                </div>
              </div>
            )}

            <div className={cn('py-2.5', collapsed ? 'px-2' : 'px-3')}>
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={toggleLabel}
                className={cn(
                  'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-2xl px-3 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                  collapsed && 'justify-center px-0',
                )}
              >
                <ToggleIcon className="size-4 shrink-0" />
                {!collapsed && <span>{toggleLabel}</span>}
              </button>
            </div>
          </aside>

          {/* Main Studio Viewport */}
          <main className="relative min-h-0 min-w-0 overflow-y-auto bg-background">
            <DatabaseBanner />
            <Outlet />
          </main>
        </div>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onToggleSidebar={() => setCollapsed(!collapsed)}
        />
    </TooltipProvider>
  );
}

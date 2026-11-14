import * as React from 'react';
import { Command, FolderGit2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Search, Sparkles } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { usePersistentFlag } from '@/lib/use-persistent-flag';
import { cn } from '@/lib/utils';
import { BrandMark } from './BrandMark';
import { DatabaseBanner } from './DatabaseBanner';
import { visibleRoutes, type AppRoute, type RouteGroup } from './routes';
import { useExtensions } from './useExtensions';
import { CommandPalette } from './CommandPalette';
import { GuidedTourButton, GuidedToursProvider } from './guided-tours';
import { ShellSlotsProvider, useShellSlotState, useShellSlotTarget } from './shell-slots';
import { SystemStatus } from './SystemStatus';
import { TopNav } from './TopNav';

const NAV_GROUPS: readonly RouteGroup[] = ['Trabalho', 'Conhecimento', 'Integrações', 'Configurações'];
export const SIDEBAR_COLLAPSED_KEY = 'nb.sidebar.collapsed';
/** Width at which the contextual panel becomes a column instead of a drawer. */
const WIDE_QUERY = '(min-width: 1280px)';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() => window.matchMedia(query).matches);
  React.useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function NavItem({ route, collapsed }: { route: AppRoute; collapsed: boolean }) {
  const Icon = route.icon;
  return (
    <Tooltip label={route.label} disabled={!collapsed}>
      <NavLink
        to={route.path}
        end={route.path === '/'}
        className={({ isActive }) =>
          cn(
            'relative flex min-h-9 items-center gap-2.5 rounded-md border border-transparent px-2.5 text-[13px] text-muted-foreground outline-none',
            'transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-base)] ease-[var(--ease-out)]',
            'hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            collapsed && 'justify-center px-0',
            isActive && 'border-[var(--glass-border-strong)] bg-accent font-medium text-accent-foreground shadow-[var(--glow-soft)]',
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon className={cn('size-4 shrink-0', isActive && 'text-primary')} aria-hidden="true" />
            {/* The name stays in the accessibility tree when only the icon shows. */}
            <span className={collapsed ? 'sr-only' : 'truncate'}>{route.label}</span>
          </>
        )}
      </NavLink>
    </Tooltip>
  );
}

export interface AppShellProps {
  routes?: readonly AppRoute[];
  brandName?: string;
  brandSubtitle?: string;
}

function ShellBody({ routes: customRoutes, brandName = 'Singularity', brandSubtitle = 'AI Orchestrator' }: AppShellProps) {
  const location = useLocation();
  const extensions = useExtensions();
  const routes = customRoutes ?? visibleRoutes(extensions.data ?? []);
  const [collapsed, setCollapsed] = usePersistentFlag(SIDEBAR_COLLAPSED_KEY);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  // The drawer belongs to the page that opened it: it stays open only on that path.
  const [asideOpenPath, setAsideOpenPath] = React.useState<string | null>(null);
  const asideOpen = asideOpenPath === location.pathname;
  const setAsideOpen = (open: boolean) => setAsideOpenPath(open ? location.pathname : null);
  const wide = useMediaQuery(WIDE_QUERY);
  const aside = useShellSlotState('aside');
  const timeline = useShellSlotState('timeline');
  const attachAside = useShellSlotTarget('aside');
  const attachTimeline = useShellSlotTarget('timeline');
  const recentProjects = useQuery({ queryKey: ['projects', 'recent-shell'], queryFn: () => window.neuralbridge.projects.list(), staleTime: 60_000 });
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? 'Expandir menu' : 'Recolher menu';
  const drawer = aside.active && !wide;
  const asideLabel = aside.title ?? 'Painel contextual';

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); } };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  React.useEffect(() => {
    if (!drawer || !asideOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setAsideOpenPath(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawer, asideOpen]);

  return (
    <>
      <div
        className={cn(
          'grid h-full grid-rows-[48px_1fr] overflow-hidden transition-[grid-template-columns] duration-[var(--motion-base)] ease-[var(--ease-out)] motion-reduce:transition-none',
          collapsed ? 'grid-cols-[56px_minmax(0,1fr)]' : 'grid-cols-[236px_minmax(0,1fr)]',
        )}
      >
        <header className="app-drag col-span-2 flex min-w-0 items-center gap-3 border-b border-[var(--glass-border)] bg-[var(--glass-bg-strong)] pr-36 pl-4 backdrop-blur-[var(--glass-blur)]">
          <BrandMark className="h-7 w-9 shrink-0" />
          {/* Lote 50.04: the visible brand. The app's internal name (data folder, app id, MCP server) is unchanged (D-1). */}
          <span className="flex shrink-0 flex-col leading-none">
            <span className="sr-only">{brandName}, {brandSubtitle}</span>
            <span className="sg-display text-[13px] text-foreground" style={{ letterSpacing: '0.28em' }} aria-hidden="true">{brandName}</span>
            <span className="sg-display mt-1 hidden text-[8.5px] text-muted-foreground sm:block" style={{ letterSpacing: '0.34em' }} aria-hidden="true">{brandSubtitle}</span>
          </span>
          <div className="ml-2"><TopNav /></div>
          <div className="app-no-drag ml-auto"><GuidedTourButton path={location.pathname} /></div>
          <button type="button" onClick={() => setPaletteOpen(true)} className="app-no-drag ml-auto hidden h-8 min-w-0 max-w-96 flex-1 items-center gap-2 rounded-md border border-[var(--glass-border)] bg-card/70 px-3 text-left text-xs text-muted-foreground transition-colors duration-[var(--motion-base)] hover:border-[var(--glass-border-strong)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:flex" aria-label="Abrir Command Palette">
            <Search className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">Buscar projetos, tarefas e memória</span>
            <kbd className="flex shrink-0 items-center gap-0.5 rounded border border-border px-1.5 py-0.5 font-mono text-[10px]"><Command className="size-2.5" />K</kbd>
          </button>
          {drawer && (
            <Tooltip label={asideOpen ? `Fechar ${asideLabel}` : `Abrir ${asideLabel}`} side="bottom">
              <button type="button" onClick={() => setAsideOpen(!asideOpen)} aria-expanded={asideOpen} aria-controls="shell-aside" aria-label={asideOpen ? `Fechar ${asideLabel}` : `Abrir ${asideLabel}`} className="app-no-drag flex size-8 items-center justify-center rounded-md border border-[var(--glass-border)] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                {asideOpen ? <PanelRightClose className="size-4" aria-hidden="true" /> : <PanelRightOpen className="size-4" aria-hidden="true" />}
              </button>
            </Tooltip>
          )}
          <div className="app-no-drag hidden items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] text-primary sm:flex"><Sparkles className="size-3" aria-hidden="true" /> Local-first</div>
        </header>

        <aside aria-label="Menu" data-collapsed={collapsed} className="flex min-h-0 min-w-0 flex-col border-r border-[var(--glass-border)] bg-sidebar/90">
          <nav aria-label="Navegação principal" className={cn('flex-1 overflow-x-hidden overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
            {NAV_GROUPS.filter((group) => routes.some((route) => route.group === group)).map((group) => (
              <div key={group} className="mb-5 last:mb-0">
                <p id={`nav-${group}`} className={cn('mb-1.5 px-2.5 text-xs text-muted-foreground/80', collapsed && 'sr-only')}>
                  {group}
                </p>
                <ul aria-labelledby={`nav-${group}`} className="space-y-0.5">
                  {routes.filter((route) => route.group === group).map((route) => (
                    <li key={route.path}>
                      <NavItem route={route} collapsed={collapsed} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!collapsed && <div className="mt-6 border-t border-[var(--glass-border)] pt-4"><div className="mb-2 flex items-center justify-between px-2.5"><p className="sg-label text-[10px]">Recentes</p><FolderGit2 className="size-3.5 text-muted-foreground" aria-hidden="true" /></div>{recentProjects.data?.slice(0, 3).map((project) => <NavLink key={project.id} to={`/projects/${project.id}`} className="flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><span className={`size-1.5 shrink-0 rounded-full ${project.exists ? 'bg-primary' : 'bg-warning'}`} /><span className="truncate">{project.name}</span></NavLink>)}</div>}
          </nav>
          {/* Pinned above the collapse button (user decision, lote 50.06): the navigation scrolls on its own. */}
          {!collapsed && <div className="shrink-0 border-t border-[var(--glass-border)] px-3 pt-3 pb-2"><SystemStatus /></div>}
          <div className={cn('space-y-0.5 border-t border-[var(--glass-border)] py-3', collapsed ? 'px-2' : 'px-3')}>
            <Tooltip label={toggleLabel} disabled={!collapsed}>
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                aria-expanded={!collapsed}
                aria-label={toggleLabel}
                className={cn(
                  'flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  collapsed && 'justify-center px-0',
                )}
              >
                <ToggleIcon className="size-4 shrink-0" aria-hidden="true" />
                {!collapsed && <span>Recolher menu</span>}
              </button>
            </Tooltip>
          </div>
        </aside>

        <main className="sg-atmosphere flex min-h-0 min-w-0 flex-col overflow-hidden">
          <DatabaseBanner />
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
              <Outlet />
            </div>
            {drawer && asideOpen && <button type="button" tabIndex={-1} aria-hidden="true" className="fixed inset-0 top-12 z-30 bg-background/40 backdrop-blur-[2px]" onClick={() => setAsideOpen(false)} />}
            <aside
              id="shell-aside"
              ref={attachAside}
              aria-label={asideLabel}
              hidden={!aside.active}
              inert={drawer && !asideOpen ? true : undefined}
              className={cn(
                'min-h-0 w-[300px] shrink-0 space-y-4 overflow-y-auto p-4 pl-0',
                drawer && 'fixed top-12 right-0 bottom-0 z-40 w-[320px] border-l border-[var(--glass-border)] bg-[var(--glass-bg-strong)] pl-4 shadow-[var(--elevation-3)] backdrop-blur-[var(--glass-blur)] transition-transform duration-[var(--motion-slow)] ease-[var(--ease-out)] motion-reduce:transition-none',
                drawer && !asideOpen && 'translate-x-full',
              )}
            />
          </div>
          <div ref={attachTimeline} hidden={!timeline.active} className="shrink-0 border-t border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)]" />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onToggleSidebar={() => setCollapsed(!collapsed)} />
    </>
  );
}

export function AppShell(props: AppShellProps = {}) {
  return (
    <GuidedToursProvider>
      <TooltipProvider>
        <ShellSlotsProvider>
          <ShellBody {...props} />
        </ShellSlotsProvider>
      </TooltipProvider>
    </GuidedToursProvider>
  );
}

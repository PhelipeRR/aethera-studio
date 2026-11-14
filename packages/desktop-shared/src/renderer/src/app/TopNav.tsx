import { Bot, Brain, Database, FolderGit2, Layers, Plug, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { activeContextTab, CONTEXT_TABS, contextTabName, type ContextTab } from './shell-model';

const ICONS: Record<ContextTab['id'], LucideIcon> = {
  orchestrator: Layers,
  agents: Bot,
  mcp: Plug,
  rag: Database,
  memories: Brain,
  projects: FolderGit2,
};

/**
 * Top context tabs (lote 50.03), as in the Singularity reference. Shortcuts to existing routes: labels from 1360px,
 * icons with tooltips from 1024px, hidden below that (the sidebar already has every route).
 */
export function TopNav() {
  const { pathname } = useLocation();
  const active = activeContextTab(pathname);
  return (
    <nav aria-label="Atalhos de contexto" className="app-no-drag hidden min-w-0 lg:block">
      <ul className="flex items-center gap-1">
        {CONTEXT_TABS.map((tab) => {
          const Icon = ICONS[tab.id];
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <Tooltip label={tab.label} side="bottom">
                <Link
                  to={tab.to}
                  aria-label={contextTabName(tab)}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    'relative flex h-8 items-center gap-2 rounded-md border px-2.5 text-[13px] outline-none',
                    'transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-base)] ease-[var(--ease-out)] focus-visible:ring-2 focus-visible:ring-ring',
                    current ? 'border-[var(--glass-border-strong)] bg-accent text-accent-foreground shadow-[var(--glow-soft)]' : 'border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground',
                  )}
                >
                  <Icon className={cn('size-4 shrink-0', current && 'text-primary')} aria-hidden="true" />
                  <span className="hidden min-[1360px]:inline">{tab.label}</span>
                </Link>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

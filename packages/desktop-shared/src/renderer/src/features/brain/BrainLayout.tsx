import { Plus } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { PageHeader } from '@/app/PageHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useMemoryVisualization, type MemoryVisualization } from '@/features/galaxy/memory-visualization';

// The 3D tab follows the rollback switch (lote 50.06): Galáxia by default, Cérebro 3D when chosen in Settings.
// Both routes always work, so deep links to either never break.
function tabsFor(visualization: MemoryVisualization) {
  return [
    { to: '/memory', label: 'Visão geral', end: true },
    { to: '/memory/explore', label: 'Explorar', end: false },
    { to: '/memory/graph', label: 'Grafo', end: false },
    visualization === 'galaxy' ? { to: '/memory/galaxy', label: 'Galáxia', end: false } : { to: '/memory/brain', label: 'Cérebro 3D', end: false },
    { to: '/memory/learning', label: 'Aprendizados', end: false },
    { to: '/memory/settings', label: 'Configurações', end: false },
  ];
}

export function BrainLayout({ description }: { description: string }) {
  const visualization = useMemoryVisualization();
  return (
    <>
      <PageHeader
        title="Memória"
        description={description}
        actions={
          <Button asChild>
            <Link data-tour="memory-create" to="/memory/new">
              <Plus aria-hidden="true" />
              Nova memória
            </Link>
          </Button>
        }
      />
      <nav aria-label="Seções da memória" className="flex gap-1 border-b px-6">
        {tabsFor(visualization).map((tab) => (
            <NavLink data-tour={tab.to === '/memory/explore' ? 'memory-search' : undefined}
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'relative px-2.5 py-2.5 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                isActive && 'font-medium text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary',
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}

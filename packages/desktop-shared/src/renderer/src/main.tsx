import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Link, RouterProvider, useParams, type RouteObject } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/app/AppShell';
import { BrainLayout } from '@/features/brain/BrainLayout';
import { ExplorerPage } from '@/features/brain/ExplorerPage';
import { MemoryPage, NewMemoryPage } from '@/features/brain/MemoryPage';
import { OverviewPage } from '@/features/brain/OverviewPage';
import { LearningPage } from '@/features/brain/LearningPage';
import { BrainSettingsPage } from '@/features/brain/BrainSettingsPage';
import { PageHeader } from '@/app/PageHeader';
import { ROUTES } from '@/app/routes';
import { ProjectPage } from '@/features/projects/ProjectPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ChatPage } from '@/features/tasks/ChatPage';
import { RunPage, RunsPage } from '@/features/tasks/RunsPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { McpPage } from '@/pages/McpPage';
import { PlannedPage } from '@/pages/PlannedPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { WorkflowsPage } from '@/features/workflows/WorkflowsPage';
import { MissionControlPage } from '@/features/mission-control/MissionControlPage';
import { GitIntelligencePage } from '@/pages/GitIntelligencePage';
import { AzureDevOpsPage } from '@/pages/AzureDevOpsPage';
import { ExtensionsPage } from '@/pages/ExtensionsPage';
import { PersonalAgentPage } from '@/pages/PersonalAgentPage';
import { AetheraHomePage } from '@/features/aethera/AetheraHomePage';
import { ContentProjectPage } from '@/features/aethera/ContentProjectPage';
import { ContentQueuePage } from '@/features/aethera/ContentQueuePage';
import { ContentChannelSetupPage } from '@/features/aethera/ContentChannelSetupPage';
import { ContentPackagePage } from '@/features/aethera/ContentPackagePage';
import { ContentAnalyticsIdeasPage } from '@/features/aethera/ContentAnalyticsIdeasPage';
import { ContentVariantsPage } from '@/features/aethera/ContentVariantsPage';
import { ContentCalendarPage } from '@/features/aethera/ContentCalendarPage';
import { ContentLibraryPage } from '@/features/aethera/ContentLibraryPage';
import { AetheraProductionWorkspace } from '@/features/video/AetheraProductionWorkspace';
import { useExtensions } from '@/app/useExtensions';
import './styles.css';

// Lazy, so the main window does not load the HUD's animation library.
const CompanionHud = React.lazy(() => import('@/features/companion/CompanionHud').then(({ CompanionHud: Hud }) => ({ default: Hud })));
const GraphPage = React.lazy(() => import('@/features/brain/GraphPage').then(({ GraphPage: Page }) => ({ default: Page })));
const MonitoringPage = React.lazy(() => import('@/features/monitoring/MonitoringPage').then(({ MonitoringPage: Page }) => ({ default: Page })));
const GalaxyPage = React.lazy(() => import('@/features/galaxy/GalaxyPage').then(({ GalaxyPage: Page }) => ({ default: Page })));
const Brain3DPage = React.lazy(() => import('@/features/brain3d/Brain3DPage').then(({ Brain3DPage: Page }) => ({ default: Page })));
const AnalyticsPage = React.lazy(() => import('@/pages/AnalyticsPage').then(({ AnalyticsPage: Page }) => ({ default: Page })));
// Lote 50.02: design-system review page, reachable at #/design-system and deliberately absent from the navigation.
const DesignSystemPage = React.lazy(() => import('@/features/design-system/DesignSystemPage').then(({ DesignSystemPage: Page }) => ({ default: Page })));
const VelixPage = React.lazy(() => import('@/features/video/VelixPage').then(({ VelixPage: Page }) => ({ default: Page })));

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } });

function VelixRoute() {
  const extensions = useExtensions();
  if (extensions.isLoading) return <PageHeader title="Aethera" description="Verificando a extensão instalada..." />;
  if (!extensions.data?.some((item) => item.manifest.id === 'velix' && item.state === 'enabled')) return <div className="mx-auto w-full max-w-3xl p-6 lg:p-8"><PageHeader title="Aethera indisponível" description="A extensão Aethera não está instalada ou está desabilitada." /><a href="#/extensions" className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring">Abrir Extensões</a></div>;
  return <React.Suspense fallback={<PageHeader title="Aethera" description="Carregando o estúdio..." />}><VelixPage /></React.Suspense>;
}

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<PageHeader title="Carregando" description="Preparando esta área..." />}>{children}</React.Suspense>;
}

function ContentProjectRoute() {
  const { id = '' } = useParams();
  return <><nav aria-label="Ações do projeto" className="flex flex-wrap gap-2 border-b px-6 py-3 text-xs xl:px-8"><Link to={`/aethera/projects/${id}/package`} className="rounded border px-3 py-1.5 hover:border-primary hover:text-primary">Pacote de publicação</Link><Link to={`/aethera/projects/${id}/variants`} className="rounded border px-3 py-1.5 hover:border-primary hover:text-primary">Versões e Shorts</Link><Link to={`/aethera/projects/${id}/analytics/idea`} className="rounded border px-3 py-1.5 hover:border-primary hover:text-primary">Criar ideia a partir de analytics</Link></nav><ContentProjectPage /></>;
}

function AetheraWorkspaceNav() {
  return <nav aria-label="Áreas operacionais do Aethera" className="flex flex-wrap gap-2 border-b px-6 py-3 text-xs xl:px-8"><Link to="/aethera/queue" className="rounded-full border px-3 py-1.5 hover:border-primary hover:text-primary">Fila</Link><Link to="/aethera/calendar" className="rounded-full border px-3 py-1.5 hover:border-primary hover:text-primary">Calendário</Link><Link to="/aethera/library" className="rounded-full border px-3 py-1.5 hover:border-primary hover:text-primary">Biblioteca</Link><Link to="/aethera/channels/new" className="rounded-full border px-3 py-1.5 hover:border-primary hover:text-primary">Novo canal</Link></nav>;
}

if (new URLSearchParams(window.location.search).get('companion') === 'hud') {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');
  document.documentElement.classList.add('companion-window');
  createRoot(root).render(<React.Suspense fallback={null}><CompanionHud /></React.Suspense>);
} else {

const children: RouteObject[] = ROUTES.map((route) => {
  if (route.path === '/aethera') {
    return { path: 'aethera', children: [{ index: true, element: <><AetheraWorkspaceNav /><AetheraHomePage /></> }, { path: 'queue', element: <ContentQueuePage /> }, { path: 'calendar', element: <ContentCalendarPage /> }, { path: 'library', element: <ContentLibraryPage /> }, { path: 'channels/new', element: <ContentChannelSetupPage /> }, { path: 'projects/:id/package', element: <ContentPackagePage /> }, { path: 'projects/:id/analytics/idea', element: <ContentAnalyticsIdeasPage /> }, { path: 'projects/:id/variants', element: <ContentVariantsPage /> }, { path: 'projects/:id', element: <ContentProjectRoute /> }, { path: 'productions/:id', element: <AetheraProductionWorkspace /> }] };
  }
  if (route.path === '/projects') {
    return {
      path: 'projects',
      children: [
        { index: true, element: <ProjectsPage description={route.description} /> },
        {
          path: ':id',
          element: (
            <>
              <PageHeader title="Projetos" description={route.description} />
              <ProjectPage />
            </>
          ),
        },
      ],
    };
  }
  if (route.path === '/runs') {
    return {
      path: 'runs',
      children: [
        { index: true, element: <RunsPage description={route.description} /> },
        {
          path: ':id',
          element: (
            <>
              <PageHeader title="Execuções" description={route.description} />
              <RunPage />
            </>
          ),
        },
      ],
    };
  }
  if (route.path === '/memory') {
    return {
      path: 'memory',
      element: <BrainLayout description={route.description} />,
      children: [
        { index: true, element: <OverviewPage /> },
        { path: 'explore', element: <ExplorerPage /> },
        { path: 'graph', element: <LazyRoute><GraphPage /></LazyRoute> },
        { path: 'brain', element: <LazyRoute><Brain3DPage /></LazyRoute> },
        { path: 'galaxy', element: <LazyRoute><GalaxyPage /></LazyRoute> },
        { path: 'learning', element: <LearningPage /> },
        { path: 'settings', element: <BrainSettingsPage /> },
        { path: 'new', element: <NewMemoryPage /> },
        { path: ':id', element: <MemoryPage /> },
      ],
    };
  }
  const element =
    route.path === '/' ? (
      <DashboardPage description={route.description} />
    ) : route.path === '/agents' ? (
      <AgentsPage description={route.description} />
    ) : route.path === '/settings' ? (
      <SettingsPage description={route.description} />
    ) : route.path === '/chat' ? (
      <ChatPage />
    ) : route.path === '/mcp' ? (
      <McpPage description={route.description} />
    ) : route.path === '/analytics' ? (
      <LazyRoute><AnalyticsPage description={route.description} /></LazyRoute>
    ) : route.path === '/skills' ? (
      <SkillsPage description={route.description} />
    ) : route.path === '/workflows' ? (
      <WorkflowsPage />
    ) : route.path === '/monitoring' ? (
      <LazyRoute><MonitoringPage description={route.description} /></LazyRoute>
    ) : route.path === '/mission-control' ? (
      <MissionControlPage />
    ) : route.path === '/video' ? (
      <VelixRoute />
    ) : route.path === '/git-intelligence' ? (
      <GitIntelligencePage />
    ) : route.path === '/azure-devops' ? (
      <AzureDevOpsPage description={route.description} />
    ) : route.path === '/extensions' ? (
      <ExtensionsPage description={route.description} />
    ) : route.path === '/personal-agent' ? (
      <PersonalAgentPage description={route.description} />
    ) : route.planned ? (
      <PlannedPage route={{ ...route, planned: route.planned }} />
    ) : null;
  return route.path === '/' ? { index: true, element } : { path: route.path.slice(1), element };
});

children.push({ path: 'design-system', element: <LazyRoute><DesignSystemPage /></LazyRoute> });

const router = createHashRouter([{ path: '/', element: <AppShell />, children }]);

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
}

import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/app/AppShell';
import { PageHeader } from '@/app/PageHeader';
import { ROUTES } from '@/app/routes';
import { BrainLayout } from '@/features/brain/BrainLayout';
import { ExplorerPage } from '@/features/brain/ExplorerPage';
import { MemoryPage, NewMemoryPage } from '@/features/brain/MemoryPage';
import { OverviewPage } from '@/features/brain/OverviewPage';
import { LearningPage } from '@/features/brain/LearningPage';
import { BrainSettingsPage } from '@/features/brain/BrainSettingsPage';
import { ProjectPage } from '@/features/projects/ProjectPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { ChatPage } from '@/features/tasks/ChatPage';
import { RunPage, RunsPage } from '@/features/tasks/RunsPage';
import { WorkflowsPage } from '@/features/workflows/WorkflowsPage';
import { MissionControlPage } from '@/features/mission-control/MissionControlPage';
import { AgentsPage } from '@/pages/AgentsPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { McpPage } from '@/pages/McpPage';
import { SkillsPage } from '@/pages/SkillsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { GitIntelligencePage } from '@/pages/GitIntelligencePage';
import { AzureDevOpsPage } from '@/pages/AzureDevOpsPage';
import { ExtensionsPage } from '@/pages/ExtensionsPage';
import '../../../../../packages/desktop-shared/src/renderer/src/styles.css';

const GraphPage = React.lazy(() => import('@/features/brain/GraphPage').then(({ GraphPage: Page }) => ({ default: Page })));
const MonitoringPage = React.lazy(() => import('@/features/monitoring/MonitoringPage').then(({ MonitoringPage: Page }) => ({ default: Page })));
const GalaxyPage = React.lazy(() => import('@/features/galaxy/GalaxyPage').then(({ GalaxyPage: Page }) => ({ default: Page })));
const Brain3DPage = React.lazy(() => import('@/features/brain3d/Brain3DPage').then(({ Brain3DPage: Page }) => ({ default: Page })));
const AnalyticsPage = React.lazy(() => import('@/pages/AnalyticsPage').then(({ AnalyticsPage: Page }) => ({ default: Page })));

const ORCHESTRATOR_ROUTES = ROUTES.filter(
  (r) => r.extensionId !== 'velix' && r.extensionId !== 'personal-agent',
);

const descOf = (path: string, fallback = '') =>
  ORCHESTRATOR_ROUTES.find((r) => r.path === path)?.description ?? fallback;

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1 } } });

function LazyRoute({ children }: { children: React.ReactNode }) {
  return <React.Suspense fallback={<PageHeader title="Carregando" description="Preparando esta área..." />}>{children}</React.Suspense>;
}

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell routes={ORCHESTRATOR_ROUTES} brandName="Singularity" brandSubtitle="Orchestrator" />,
    children: [
      { index: true, element: <DashboardPage description={descOf('/')} /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'runs', element: <RunsPage description={descOf('/runs')} /> },
      { path: 'runs/:id', element: <RunPage /> },
      {
        path: 'memory',
        element: <BrainLayout description={descOf('/memory')} />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: 'explore', element: <ExplorerPage /> },
          { path: 'new', element: <NewMemoryPage /> },
          { path: 'graph', element: <LazyRoute><GraphPage /></LazyRoute> },
          { path: '3d', element: <LazyRoute><Brain3DPage /></LazyRoute> },
          { path: 'galaxy', element: <LazyRoute><GalaxyPage /></LazyRoute> },
          { path: 'learning', element: <LearningPage /> },
          { path: 'settings', element: <BrainSettingsPage /> },
          { path: ':id', element: <MemoryPage /> },
        ],
      },
      { path: 'brain-3d', element: <LazyRoute><Brain3DPage /></LazyRoute> },
      { path: 'galaxy', element: <LazyRoute><GalaxyPage /></LazyRoute> },
      { path: 'skills', element: <SkillsPage description={descOf('/skills')} /> },
      { path: 'projects', element: <ProjectsPage description={descOf('/projects')} /> },
      { path: 'projects/:id', element: <ProjectPage /> },
      { path: 'git-intelligence', element: <GitIntelligencePage /> },
      { path: 'azure-devops', element: <AzureDevOpsPage description={descOf('/azure-devops')} /> },
      { path: 'agents', element: <AgentsPage description={descOf('/agents')} /> },
      { path: 'mcp', element: <McpPage description={descOf('/mcp')} /> },
      { path: 'analytics', element: <LazyRoute><AnalyticsPage description={descOf('/analytics')} /></LazyRoute> },
      { path: 'workflows', element: <WorkflowsPage /> },
      { path: 'monitoring', element: <LazyRoute><MonitoringPage description={descOf('/monitoring')} /></LazyRoute> },
      { path: 'mission-control', element: <MissionControlPage /> },
      { path: 'extensions', element: <ExtensionsPage description={descOf('/extensions')} /> },
      { path: 'settings', element: <SettingsPage description={descOf('/settings')} /> },
    ],
  },
]);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

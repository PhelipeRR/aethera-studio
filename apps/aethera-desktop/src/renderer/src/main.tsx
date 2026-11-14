import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Bot,
  Calendar,
  Clapperboard,
  Film,
  FolderKanban,
  Home,
  Library,
  ListOrdered,
  Radio,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, Link, RouterProvider, useParams } from 'react-router';
import { AetheraShell } from '@/app/AetheraShell';
import { NotificationsOverlay } from '@/components/NotificationsOverlay';
import type { AppRoute } from '@/app/routes';
import { PageHeader } from '@/app/PageHeader';
import { AetheraSettingsPage } from '@/features/aethera/AetheraSettingsPage';
import { AetheraStudioHome } from '@/features/aethera/AetheraStudioHome';
import { AetheraProjectsPage } from '@/features/aethera/AetheraProjectsPage';
import { AetheraMediaLibraryPage } from '@/features/aethera/AetheraMediaLibraryPage';
import { AetheraAgentsPage } from '@/features/aethera/AetheraAgentsPage';
import { AetheraReviewRoomPage } from '@/features/aethera/AetheraReviewRoomPage';
import { AetheraStudioEditor } from '@/features/aethera/AetheraStudioEditor';
import { AetheraProductionWorkspace } from '@/features/video/AetheraProductionWorkspace';
import { CinemaDirectorPanel } from '@/features/video/CinemaDirectorPanel';
import { ContentAnalyticsIdeasPage } from '@/features/aethera/ContentAnalyticsIdeasPage';
import { ContentCalendarPage } from '@/features/aethera/ContentCalendarPage';
import { ContentChannelSetupPage } from '@/features/aethera/ContentChannelSetupPage';
import { ContentPackagePage } from '@/features/aethera/ContentPackagePage';
import { ContentProjectPage } from '@/features/aethera/ContentProjectPage';
import { ContentQueuePage } from '@/features/aethera/ContentQueuePage';
import { ContentVariantsPage } from '@/features/aethera/ContentVariantsPage';
import '@/styles.css';
import './aethera-theme.css';

const VelixPage = React.lazy(() =>
  import('@/features/video/VelixPage').then(({ VelixPage: Page }) => ({ default: Page })),
);

const AETHERA_ROUTES: readonly AppRoute[] = [
  { path: '/aethera', label: 'Home', icon: Home, group: 'Trabalho', description: 'Centro de produção audiovisual.' },
  { path: '/aethera/projects', label: 'Projeto Manual', icon: FolderKanban, group: 'Trabalho', description: 'Gerenciamento manual de produções.' },
  { path: '/aethera/cinema', label: 'Produção com IA', icon: Clapperboard, group: 'Trabalho', description: 'Direção criativa, storyboard e humor pontual.' },
  { path: '/video', label: 'Editor', icon: Film, group: 'Trabalho', description: 'Editor profissional com timeline multifaixa.' },
  { path: '/aethera/library', label: 'Biblioteca', icon: Library, group: 'Conhecimento', description: 'Mídias, áudios, roteiros e direitos.' },
  { path: '/agents', label: 'Agentes', icon: Bot, group: 'Integrações', description: 'Equipe cinematográfica de IA com fallback RF-07.' },
  { path: '/aethera/review', label: 'Revisão e Qualidade', icon: ShieldCheck, group: 'Trabalho', description: 'Sala de revisão audiovisual e Release Gates.' },
  { path: '/aethera/queue', label: 'Pipeline', icon: ListOrdered, group: 'Trabalho', description: 'Fila de produção e renderizações.' },
  { path: '/aethera/calendar', label: 'Calendário', icon: Calendar, group: 'Trabalho', description: 'Calendário editorial e agendamentos.' },
  { path: '/aethera/channels/new', label: 'Publicação', icon: Radio, group: 'Integrações', description: 'Canais YouTube, OAuth e distribuição.' },
  { path: '/settings', label: 'Configurações', icon: Settings, group: 'Configurações', description: 'Aparência, APIs e preferências do estúdio.' },
];

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function LazyRoute({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<PageHeader title="Aethera Studio" description="Carregando o estúdio..." />}>
      {children}
    </React.Suspense>
  );
}

function ContentProjectRoute() {
  const { id = '' } = useParams();
  return (
    <>
      <nav aria-label="Ações do projeto" className="flex flex-wrap gap-2 border-b border-border px-6 py-3 text-xs xl:px-8">
        <Link to={`/aethera/projects/${id}/package`} className="rounded-lg border border-border px-3 py-1.5 hover:border-primary hover:text-primary">Pacote de publicação</Link>
        <Link to={`/aethera/projects/${id}/variants`} className="rounded-lg border border-border px-3 py-1.5 hover:border-primary hover:text-primary">Versões e Shorts</Link>
        <Link to={`/aethera/projects/${id}/analytics/idea`} className="rounded-lg border border-border px-3 py-1.5 hover:border-primary hover:text-primary">Criar ideia a partir de analytics</Link>
      </nav>
      <ContentProjectPage />
    </>
  );
}

const router = createHashRouter([
  {
    path: '/',
    element: <AetheraShell routes={AETHERA_ROUTES} />,
    children: [
      { index: true, element: <AetheraStudioHome /> },
      {
        path: 'aethera',
        children: [
          { index: true, element: <AetheraStudioHome /> },
          { path: 'projects', element: <AetheraProjectsPage /> },
          { path: 'cinema', element: <CinemaDirectorPanel /> },
          { path: 'editor', element: <AetheraStudioEditor /> },
          { path: 'review', element: <AetheraReviewRoomPage /> },
          { path: 'queue', element: <ContentQueuePage /> },
          { path: 'calendar', element: <ContentCalendarPage /> },
          { path: 'library', element: <AetheraMediaLibraryPage /> },
          { path: 'channels/new', element: <ContentChannelSetupPage /> },
          { path: 'projects/:id/package', element: <ContentPackagePage /> },
          { path: 'projects/:id/analytics/idea', element: <ContentAnalyticsIdeasPage /> },
          { path: 'projects/:id/variants', element: <ContentVariantsPage /> },
          { path: 'projects/:id', element: <ContentProjectRoute /> },
          { path: 'productions/:id', element: <AetheraProductionWorkspace /> },
        ],
      },
      { path: 'video', element: <AetheraStudioEditor /> },
      { path: 'video/remotion', element: <LazyRoute><VelixPage /></LazyRoute> },
      { path: 'agents', element: <AetheraAgentsPage /> },
      { path: 'settings', element: <AetheraSettingsPage description="Aparência, APIs e preferências do Aethera Studio." /> },
      { path: '*', element: <AetheraStudioHome /> },
    ],
  },
]);

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <NotificationsOverlay />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

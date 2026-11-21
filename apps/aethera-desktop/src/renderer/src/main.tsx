import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BookOpen,
  Bot,
  Calendar,
  Clapperboard,
  Film,
  FolderKanban,
  Home,
  ImagePlus,
  Library,
  ListOrdered,
  Radio,
  Settings,
  ShieldCheck,
  SquareTerminal,
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
import { GeneralConsolePage } from '@/features/video/cinema/GeneralConsolePage';
import { ContentAnalyticsIdeasPage } from '@/features/aethera/ContentAnalyticsIdeasPage';
import { ContentCalendarPage } from '@/features/aethera/ContentCalendarPage';
import { ContentChannelSetupPage } from '@/features/aethera/ContentChannelSetupPage';
import { ContentPackagePage } from '@/features/aethera/ContentPackagePage';
import { ContentProjectPage } from '@/features/aethera/ContentProjectPage';
import { ContentQueuePage } from '@/features/aethera/ContentQueuePage';
import { ContentVariantsPage } from '@/features/aethera/ContentVariantsPage';
import { CreativeStudioPanel } from './CreativeStudioPanel';
import { RecapProductionPanel } from './RecapProductionPanel';
import '@/styles.css';
import './aethera-theme.css';

const VelixPage = React.lazy(() =>
  import('@/features/video/VelixPage').then(({ VelixPage: Page }) => ({ default: Page })),
);

const AETHERA_ROUTES: readonly AppRoute[] = [
  { path: '/aethera', label: 'Home', icon: Home, group: 'Trabalho', description: 'Centro de produção audiovisual.' },
  { path: '/aethera/projects', label: 'Projeto Manual', icon: FolderKanban, group: 'Trabalho', description: 'Gerenciamento manual de produções.' },
  { path: '/aethera/cinema', label: 'Produção com IA', icon: Clapperboard, group: 'Trabalho', description: 'Direção criativa, storyboard e humor pontual.' },
  { path: '/aethera/recap', label: 'Mangá Recap', icon: BookOpen, group: 'Trabalho', description: 'Gerador de recap de mangá/manhwa e importação por link.' },
  { path: '/aethera/console', label: 'Console Geral', icon: SquareTerminal, group: 'Trabalho', description: 'Eventos de todas as produções e serviços.' },
  { path: '/aethera/creative', label: 'Thumbs & Artes', icon: ImagePlus, group: 'Trabalho', description: 'Creative Studio: thumbnails, banners, avatar e marca d’água.' },
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
    <div className="space-y-4">
      <nav
        aria-label="Ações do projeto"
        className="mx-4 mt-4 flex flex-wrap items-center gap-2 rounded-[28px] bg-white px-5 py-3.5 text-xs shadow-2xs xl:mx-6"
      >
        <Link
          to={`/aethera/projects/${id}/package`}
          className="rounded-full bg-[#f4f4f6] px-4 py-2 font-semibold text-[#111111] transition-colors hover:bg-[#111111] hover:text-white"
        >
          Pacote de publicação
        </Link>
        <Link
          to={`/aethera/projects/${id}/variants`}
          className="rounded-full bg-[#f4f4f6] px-4 py-2 font-semibold text-[#111111] transition-colors hover:bg-[#111111] hover:text-white"
        >
          Versões e Shorts
        </Link>
        <Link
          to={`/aethera/projects/${id}/analytics/idea`}
          className="rounded-full bg-[#efe9fd] px-4 py-2 font-semibold text-[#2a1d5c] transition-colors hover:bg-[#b8a4f4] hover:text-[#111111]"
        >
          Criar ideia a partir de analytics
        </Link>
      </nav>
      <ContentProjectPage />
    </div>
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
          { path: 'recap', element: <div className="mx-auto max-w-[1600px] p-4 lg:p-6"><RecapProductionPanel /></div> },
          { path: 'console', element: <GeneralConsolePage /> },
          { path: 'creative', element: <div className="mx-auto max-w-[1600px] p-4 lg:p-6"><CreativeStudioPanel /></div> },
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

if (typeof document !== 'undefined') {
  document.documentElement.dataset.studioTheme = 'aethera';
}

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

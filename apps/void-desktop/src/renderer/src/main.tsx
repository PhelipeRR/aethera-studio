import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Blocks, Bot, Settings, Sparkles } from 'lucide-react';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router';
import { AppShell } from '@/app/AppShell';
import type { AppRoute } from '@/app/routes';
import { AgentsPage } from '@/pages/AgentsPage';
import { ExtensionsPage } from '@/pages/ExtensionsPage';
import { PersonalAgentPage } from '@/pages/PersonalAgentPage';
import { SettingsPage } from '@/pages/SettingsPage';
import '@/styles.css';

const CompanionHud = React.lazy(() => import('@/features/companion/CompanionHud').then(({ CompanionHud: Hud }) => ({ default: Hud })));

const VOID_ROUTES: readonly AppRoute[] = [
  { path: '/personal-agent', label: 'Void Pessoal', icon: Sparkles, group: 'Trabalho', description: 'Gmail, Google Agenda, Spotify, voz, reuniões e automações pessoais.' },
  { path: '/agents', label: 'Agentes', icon: Bot, group: 'Integrações', description: 'Claude Code e Codex CLI com fallback automático.' },
  { path: '/extensions', label: 'Extensões', icon: Blocks, group: 'Configurações', description: 'Companion HUD, Spotify, voz e extensões pessoais.' },
  { path: '/settings', label: 'Configurações', icon: Settings, group: 'Configurações', description: 'Aparência, privacidade, voz e informações do Void.' },
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

if (new URLSearchParams(window.location.search).get('companion') === 'hud') {
  const root = document.getElementById('root');
  if (root) {
    document.documentElement.classList.add('companion-window');
    createRoot(root).render(
      <React.Suspense fallback={null}>
        <CompanionHud />
      </React.Suspense>,
    );
  }
} else {
  const router = createHashRouter([
    {
      path: '/',
      element: <AppShell routes={VOID_ROUTES} brandName="Void" brandSubtitle="Personal AI" />,
      children: [
        { index: true, element: <PersonalAgentPage description="Gmail, Google Agenda, Spotify, voz, reuniões e automações pessoais." /> },
        { path: 'personal-agent', element: <PersonalAgentPage description="Gmail, Google Agenda, Spotify, voz, reuniões e automações pessoais." /> },
        { path: 'agents', element: <AgentsPage description="Claude Code e Codex CLI com fallback automático." /> },
        { path: 'extensions', element: <ExtensionsPage description="Companion HUD, Spotify e extensões do Void." /> },
        { path: 'settings', element: <SettingsPage description="Aparência, voz, permissões e informações do Void." /> },
      ],
    },
  ]);

  const root = document.getElementById('root');
  if (root) {
    createRoot(root).render(
      <React.StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </React.StrictMode>,
    );
  }
}

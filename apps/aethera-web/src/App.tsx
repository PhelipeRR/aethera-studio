import { AetheraMark } from './components/AetheraMark';
import { AppShell } from './components/AppShell';
import { AgentsPage } from './pages/AgentsPage';
import { CalendarPage } from './pages/CalendarPage';
import { CreativeStudioPage } from './pages/CreativeStudioPage';
import { EditorPage } from './pages/EditorPage';
import { HomePage } from './pages/HomePage';
import { ConsolePage, LibraryPage, SettingsPage } from './pages/LibraryConsolePages';
import { LoginPage } from './pages/LoginPage';
import { ManualProjectsPage } from './pages/ManualProjectsPage';
import { PipelineQueuePage } from './pages/PipelineQueuePage';
import { ProductionAIPage } from './pages/ProductionAIPage';
import { PublishingChannelsPage } from './pages/PublishingChannelsPage';
import { RemoteHostPage } from './pages/RemoteHostPage';
import { ReviewRoomPage } from './pages/ReviewRoomPage';
import { AuthProvider, useAuth } from './store/auth-store';
import { RemoteHostProvider } from './store/remote-host-store';
import { StudioProvider, useStudio } from './store/studio-store';

function StudioRouter() {
  const { activeSection } = useStudio();

  switch (activeSection) {
    case 'home':
      return <HomePage />;
    case 'manual_projects':
      return <ManualProjectsPage />;
    case 'production':
      return <ProductionAIPage />;
    case 'console':
      return <ConsolePage />;
    case 'creative':
      return <CreativeStudioPage />;
    case 'editor':
      return <EditorPage />;
    case 'library':
      return <LibraryPage />;
    case 'agents':
      return <AgentsPage />;
    case 'review':
      return <ReviewRoomPage />;
    case 'pipeline':
      return <PipelineQueuePage />;
    case 'calendar':
      return <CalendarPage />;
    case 'publishing':
      return <PublishingChannelsPage />;
    case 'remote':
      return <RemoteHostPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

function AuthenticatedAppGate() {
  const { authState } = useAuth();

  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-[#ececee] flex items-center justify-center px-4">
        <div className="rounded-[28px] bg-white px-8 py-7 shadow-2xs flex flex-col items-center gap-3 text-center">
          <AetheraMark />
          <p className="text-xs font-medium text-[#62626c]">Recuperando sessão autenticada...</p>
        </div>
      </div>
    );
  }

  if (authState === 'setup_required' || authState === 'unauthenticated') {
    return <LoginPage />;
  }

  return (
    <StudioProvider>
      <RemoteHostProvider>
        <AppShell>
          <StudioRouter />
        </AppShell>
      </RemoteHostProvider>
    </StudioProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AuthenticatedAppGate />
    </AuthProvider>
  );
}

export default App;

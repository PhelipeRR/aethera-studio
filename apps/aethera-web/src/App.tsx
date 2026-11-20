import { AppShell } from './components/AppShell';
import { AgentsPage } from './pages/AgentsPage';
import { CalendarPage } from './pages/CalendarPage';
import { CreativeStudioPage } from './pages/CreativeStudioPage';
import { EditorPage } from './pages/EditorPage';
import { HomePage } from './pages/HomePage';
import { ConsolePage, LibraryPage, SettingsPage } from './pages/LibraryConsolePages';
import { ManualProjectsPage } from './pages/ManualProjectsPage';
import { PipelineQueuePage } from './pages/PipelineQueuePage';
import { ProductionAIPage } from './pages/ProductionAIPage';
import { PublishingChannelsPage } from './pages/PublishingChannelsPage';
import { RemoteHostPage } from './pages/RemoteHostPage';
import { ReviewRoomPage } from './pages/ReviewRoomPage';
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

export function App() {
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

export default App;

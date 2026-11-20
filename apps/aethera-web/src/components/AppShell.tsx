import React, { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Film,
  FolderKanban,
  Home,
  ImagePlus,
  Library,
  ListOrdered,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  User,
  X,
} from 'lucide-react';
import type { NavSectionId } from '../domain/types';
import { useAuth } from '../store/auth-store';
import { useRemoteHost } from '../store/remote-host-store';
import { useStudio } from '../store/studio-store';
import { AetheraMark } from './AetheraMark';

export interface NavItem {
  id: NavSectionId;
  label: string;
  route: string;
  icon: React.ComponentType<{ className?: string }>;
}

// All 13 original Aethera Desktop routes + Remote Host Windows bridge
export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { id: 'home', label: 'Home', route: '/aethera', icon: Home },
  { id: 'manual_projects', label: 'Projeto Manual', route: '/aethera/projects', icon: FolderKanban },
  { id: 'production', label: 'Produção com IA', route: '/aethera/cinema', icon: Clapperboard },
  { id: 'console', label: 'Console Geral', route: '/aethera/console', icon: SquareTerminal },
  { id: 'creative', label: 'Thumbs & Artes', route: '/aethera/creative', icon: ImagePlus },
  { id: 'editor', label: 'Editor', route: '/video', icon: Film },
  { id: 'library', label: 'Biblioteca', route: '/aethera/library', icon: Library },
  { id: 'agents', label: 'Agentes', route: '/agents', icon: Bot },
  { id: 'review', label: 'Revisão e Qualidade', route: '/aethera/review', icon: ShieldCheck },
  { id: 'pipeline', label: 'Pipeline', route: '/aethera/queue', icon: ListOrdered },
  { id: 'calendar', label: 'Calendário', route: '/aethera/calendar', icon: Calendar },
  { id: 'publishing', label: 'Publicação', route: '/aethera/channels/new', icon: Radio },
  { id: 'remote', label: 'Remote Host', route: '/aethera/remote', icon: Server },
  { id: 'settings', label: 'Configurações', route: '/settings', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    activeSection,
    projects,
    renderJobs,
    canGoBack,
    canGoForward,
    navigate,
    openSettingsTab,
    goBack,
    goForward,
  } = useStudio();
  const { user, logout } = useAuth();
  const { connectionState: remoteState, activeComputer, jobs: remoteJobs } = useRemoteHost();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState('');

  const pendingReviewCount = useMemo(
    () => projects.filter((p) => p.status === 'awaiting_review').length,
    [projects],
  );
  const activeRendersCount = useMemo(
    () => renderJobs.filter((j) => j.status === 'queued' || j.status === 'rendering').length,
    [renderJobs],
  );
  const activeRemoteJobsCount = useMemo(
    () =>
      remoteJobs.filter(
        (j) => j.status === 'queued' || j.status === 'running' || j.status === 'awaiting_approval',
      ).length,
    [remoteJobs],
  );

  const currentNav = NAV_ITEMS.find((item) => item.id === activeSection) ?? NAV_ITEMS[0];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((open) => !open);
      } else if (e.key === 'Escape') {
        setCommandOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedNav = NAV_ITEMS.filter(
      (item) => !q || item.label.toLowerCase().includes(q) || item.route.toLowerCase().includes(q),
    );
    const matchedProjects = projects.filter(
      (p) => !q || p.title.toLowerCase().includes(q) || p.style.toLowerCase().includes(q),
    );
    return { matchedNav, matchedProjects };
  }, [query, projects]);

  const handleSelectNav = (id: NavSectionId) => {
    navigate(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#ececee] text-[#111111] flex flex-col">
      {/* Top Studio Header */}
      <header className="sticky top-0 z-30 h-16 bg-[#ececee]/95 backdrop-blur-sm px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu de navegação"
            className="lg:hidden shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white text-[#111111] shadow-xs hover:bg-[#f4f4f6]"
          >
            <Menu className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => navigate('home')}
            className="flex items-center shrink-0 focus-visible:outline-2 focus-visible:outline-[#8b6cf0] rounded-xl"
            aria-label="Ir para Home do Aethera Studio"
          >
            <span className="hidden sm:inline-flex">
              <AetheraMark />
            </span>
            <span className="inline-flex sm:hidden">
              <AetheraMark compact />
            </span>
          </button>

          <div className="hidden sm:flex items-center gap-1 ml-2">
            <button
              type="button"
              onClick={goBack}
              disabled={!canGoBack}
              aria-label="Voltar tela anterior"
              className="w-8 h-8 rounded-full bg-white text-[#111111] inline-flex items-center justify-center disabled:opacity-40 hover:bg-[#f4f4f6] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={goForward}
              disabled={!canGoForward}
              aria-label="Avançar tela"
              className="w-8 h-8 rounded-full bg-white text-[#111111] inline-flex items-center justify-center disabled:opacity-40 hover:bg-[#f4f4f6] transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="hidden md:flex items-center gap-1.5 text-sm text-[#62626c] truncate ml-1">
            <span>Estúdio</span>
            <span>/</span>
            <span className="font-semibold text-[#111111] truncate">{currentNav.label}</span>
          </div>
        </div>

        {/* Center Command Search Trigger */}
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          aria-label="Buscar projetos, mídias, cenas ou comandos"
          className="flex-1 min-w-0 max-w-md h-10 rounded-full bg-white px-3.5 sm:px-4 flex items-center justify-between gap-2 text-sm text-[#62626c] hover:ring-2 hover:ring-[#b8a4f4] transition-all shadow-2xs"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 shrink-0 text-[#62626c]" />
            <span className="truncate">Buscar projetos, mídias, cenas ou comandos...</span>
          </span>
          <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full bg-[#f4f4f6] text-[11px] font-mono text-[#62626c] shrink-0">
            ⌘K
          </kbd>
        </button>

        {/* Right Remote Host Status + Account + Logout */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigate('remote')}
            aria-label="Abrir painel do Remote Host Windows"
            title={activeComputer ? `${activeComputer.name} (${remoteState})` : 'Vincular PC Windows'}
            className={`h-9 px-3 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition-colors whitespace-nowrap shrink-0 ${
              remoteState === 'connected'
                ? 'bg-[#111111] text-white hover:bg-[#24242c]'
                : remoteState === 'offline'
                  ? 'bg-[#fde7f3] text-[#b42840] hover:bg-[#fbd0e7]'
                  : 'bg-white text-[#111111] hover:bg-[#f4f4f6]'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                remoteState === 'connected'
                  ? 'bg-[#d8fb4f]'
                  : remoteState === 'reconnecting' || remoteState === 'connecting'
                    ? 'bg-[#b8a4f4] animate-pulse'
                    : remoteState === 'offline'
                      ? 'bg-[#dc2626]'
                      : 'bg-[#9b9ba6]'
              }`}
            />
            <Server className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {remoteState === 'connected'
                ? 'PC Online'
                : remoteState === 'offline'
                  ? 'PC Offline'
                  : remoteState === 'reconnecting' || remoteState === 'connecting'
                    ? 'Reconectando'
                    : 'PC Remoto'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate('production')}
            className="shrink-0 h-9 px-3 sm:px-3.5 rounded-full bg-white text-[#111111] text-xs font-semibold inline-flex items-center gap-1.5 sm:gap-2 shadow-2xs hover:bg-[#d8fb4f] transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Cinema IA</span>
          </button>

          {user && (
            <button
              type="button"
              onClick={() => openSettingsTab('account')}
              aria-label={`Minha conta (${user.name})`}
              className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-white text-[#111111] text-xs font-semibold hover:bg-[#f4f4f6] shadow-2xs max-w-[140px]"
            >
              <User className="w-3.5 h-3.5 text-[#6a46d8] shrink-0" />
              <span className="truncate">{user.name}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Sair da conta"
            title="Sair da conta"
            className="h-9 w-9 sm:w-auto sm:px-3 rounded-full bg-white text-[#62626c] hover:text-[#b42840] hover:bg-[#fde7f3] text-xs font-semibold inline-flex items-center justify-center gap-1.5 shadow-2xs transition-colors shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">Sair</span>
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex min-h-0 px-3 lg:px-5 pb-6 gap-4">
        {/* Desktop Sidebar — All 13 Aethera Routes */}
        <aside
          aria-label="Navegação principal"
          className={`hidden lg:flex flex-col justify-between shrink-0 transition-all duration-200 ${
            collapsed ? 'w-16' : 'w-60'
          }`}
        >
          <nav className="flex flex-col gap-1 pt-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectNav(item.id)}
                  title={collapsed ? item.label : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={`h-10 rounded-2xl px-3 flex items-center justify-between gap-2 text-[13px] font-medium transition-all ${
                    isActive
                      ? 'bg-[#111111] text-white shadow-sm'
                      : 'bg-white text-[#1c1c22] hover:bg-[#f4f4f6]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!collapsed && item.id === 'review' && pendingReviewCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#d8fb4f] text-[#111111] shrink-0">
                      {pendingReviewCount}
                    </span>
                  )}
                  {!collapsed && item.id === 'pipeline' && activeRendersCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#b8a4f4] text-[#111111] shrink-0">
                      {activeRendersCount}
                    </span>
                  )}
                  {!collapsed && item.id === 'remote' && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        remoteState === 'connected'
                          ? 'bg-[#d8fb4f] text-[#111111]'
                          : 'bg-[#f4f4f6] text-[#62626c]'
                      }`}
                    >
                      {remoteState === 'connected'
                        ? activeRemoteJobsCount > 0
                          ? `${activeRemoteJobsCount} job`
                          : 'ON'
                        : 'OFF'}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral'}
            className="mt-4 h-10 rounded-2xl px-3 flex items-center gap-2 text-xs font-medium text-[#62626c] hover:text-[#111111] hover:bg-white/70 transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            {!collapsed && <span>Recolher menu</span>}
          </button>
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div
              className="fixed inset-0 bg-black/40"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />
            <div className="relative z-10 w-72 max-w-[82vw] bg-[#ececee] p-4 flex flex-col gap-3 shadow-xl overflow-y-auto">
              <div className="flex items-center justify-between">
                <AetheraMark />
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Fechar menu"
                  className="w-9 h-9 rounded-full bg-white inline-flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="flex flex-col gap-1.5 mt-2">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectNav(item.id)}
                      className={`h-10 rounded-2xl px-3.5 flex items-center justify-between text-sm font-medium ${
                        isActive ? 'bg-[#111111] text-white' : 'bg-white text-[#111111]'
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </span>
                      {item.id === 'review' && pendingReviewCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#d8fb4f] text-[#111111]">
                          {pendingReviewCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        )}

        {/* Active Page Canvas */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>

      {/* Command Palette Modal */}
      {commandOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Paleta de comandos do Aethera Studio"
          className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/35 backdrop-blur-[2px]"
          onClick={() => setCommandOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-[28px] bg-white p-4 shadow-2xl border border-[#e3e3e8]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-[#e3e3e8] pb-3">
              <Search className="w-4 h-4 text-[#62626c]" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Ir para módulo, rota ou projeto..."
                aria-label="Filtrar módulos e projetos"
                className="flex-1 text-sm bg-transparent outline-none text-[#111111] placeholder:text-[#62626c]"
              />
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                aria-label="Fechar busca"
                className="p-1.5 rounded-full hover:bg-[#f4f4f6]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-3 max-h-80 overflow-y-auto space-y-4">
              <div>
                <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[#62626c]">
                  Áreas do Estúdio ({searchResults.matchedNav.length})
                </div>
                <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {searchResults.matchedNav.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          navigate(item.id);
                          setCommandOpen(false);
                          setQuery('');
                        }}
                        className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left text-sm hover:bg-[#efe9fd] transition-colors"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <Icon className="w-4 h-4 text-[#6a46d8] shrink-0" />
                          <span className="font-medium text-[#111111] truncate">{item.label}</span>
                        </span>
                        <span className="text-[10px] font-mono text-[#62626c] shrink-0">{item.route}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-[#62626c]">
                  Produções ({searchResults.matchedProjects.length})
                </div>
                <div className="mt-1.5 space-y-1">
                  {searchResults.matchedProjects.map((proj) => (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => {
                        navigate('manual_projects', proj.id, 'overview');
                        setCommandOpen(false);
                        setQuery('');
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-left text-sm hover:bg-[#f4f4f6] transition-colors"
                    >
                      <span className="font-medium text-[#111111] truncate">{proj.title}</span>
                      <span className="text-xs text-[#62626c] shrink-0 ml-2">{proj.style}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

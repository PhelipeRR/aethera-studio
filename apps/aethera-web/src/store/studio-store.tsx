import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { HumanizeResult, YouTubeAgentAnalysis } from '../domain/briefing-parser';
import { createSeedState } from '../domain/seed-data';
import type {
  AgentProviderConfig,
  AgentRunRecord,
  BrandKit,
  ChannelConfig,
  ConsoleLogEntry,
  CreativeArtProject,
  CreativeArtType,
  CreativeLayer,
  DerivativeVariant,
  ManualProjectSubView,
  MediaAsset,
  NavSectionId,
  ProductionProject,
  PublicationPackage,
  RenderJob,
  SceneItem,
  StudioBootstrapState,
  StudioPreferences,
  TrendIdea,
} from '../domain/types';

export interface CreateProductionInput {
  title?: string;
  briefing: string;
  creationMode?: 'ai' | 'manual';
  channelId?: string | null;
  format: ProductionProject['format'];
  style: ProductionProject['style'];
  durationMin: number;
  humorLevel: number;
  ttsProvider: ProductionProject['ttsProvider'];
  ttsVoice: string;
  qualityPreset: ProductionProject['qualityPreset'];
  language: string;
  initialScript?: string;
}

interface NavLocation {
  section: NavSectionId;
  projectId?: string;
  subView?: ManualProjectSubView;
}

const SECTION_HASH_MAP: Record<NavSectionId, string> = {
  home: '#/aethera',
  manual_projects: '#/aethera/projects',
  production: '#/aethera/cinema',
  console: '#/aethera/console',
  creative: '#/aethera/creative',
  editor: '#/video',
  library: '#/aethera/library',
  agents: '#/agents',
  review: '#/aethera/review',
  pipeline: '#/aethera/queue',
  calendar: '#/aethera/calendar',
  publishing: '#/aethera/channels/new',
  remote: '#/aethera/remote',
  settings: '#/settings',
};

function parseHashLocation(): NavLocation {
  const hash = window.location.hash.replace(/^#/, '') || '/aethera';
  const projMatch = hash.match(/^\/aethera\/projects\/([^/]+)(?:\/(package|variants|analytics\/idea))?$/);
  if (projMatch) {
    const [, projectId, sub] = projMatch;
    const subView: ManualProjectSubView =
      sub === 'package'
        ? 'package'
        : sub === 'variants'
          ? 'variants'
          : sub === 'analytics/idea'
            ? 'analytics'
            : 'overview';
    return { section: 'manual_projects', projectId, subView };
  }
  if (hash === '/aethera/projects') return { section: 'manual_projects' };
  if (hash === '/aethera/cinema') return { section: 'production' };
  if (hash === '/aethera/console') return { section: 'console' };
  if (hash === '/aethera/creative') return { section: 'creative' };
  if (hash === '/video' || hash === '/aethera/editor') return { section: 'editor' };
  if (hash === '/aethera/library') return { section: 'library' };
  if (hash === '/agents') return { section: 'agents' };
  if (hash === '/aethera/review') return { section: 'review' };
  if (hash === '/aethera/queue') return { section: 'pipeline' };
  if (hash === '/aethera/calendar') return { section: 'calendar' };
  if (hash === '/aethera/channels/new') return { section: 'publishing' };
  if (hash === '/aethera/remote') return { section: 'remote' };
  if (hash === '/settings') return { section: 'settings' };
  return { section: 'home' };
}

function buildHash(section: NavSectionId, projectId?: string, subView?: ManualProjectSubView): string {
  if (section === 'manual_projects' && projectId && subView) {
    if (subView === 'package') return `#/aethera/projects/${projectId}/package`;
    if (subView === 'variants') return `#/aethera/projects/${projectId}/variants`;
    if (subView === 'analytics') return `#/aethera/projects/${projectId}/analytics/idea`;
    return `#/aethera/projects/${projectId}`;
  }
  return SECTION_HASH_MAP[section] ?? '#/aethera';
}

function fallbackInitialBootstrap(): StudioBootstrapState {
  const seed = createSeedState();
  return {
    ...seed,
    renderJobs: [],
    agentRuns: [],
    capabilities: {
      dbPath: 'apps/aethera-web/data/aethera-web.db',
      rendersDir: 'apps/aethera-web/data/renders',
      nodeVersion: 'loading',
      checkedAt: new Date().toISOString(),
      items: [],
      missingWorkspacePackages: [],
      presentWorkspacePackages: [],
    },
  };
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Erro HTTP ${res.status}`);
  }
  return data;
}

interface StudioContextValue extends StudioBootstrapState {
  loading: boolean;
  sseConnected: boolean;
  activeSection: NavSectionId;
  manualSubView: ManualProjectSubView;
  activeProjectId: string;
  activeProject: ProductionProject | undefined;
  canGoBack: boolean;
  canGoForward: boolean;
  navigate: (section: NavSectionId, projectId?: string, subView?: ManualProjectSubView) => void;
  setManualSubView: (subView: ManualProjectSubView) => void;
  goBack: () => void;
  goForward: () => void;
  selectProject: (projectId: string) => void;
  refreshBootstrap: () => Promise<void>;
  createProduction: (input: CreateProductionInput) => Promise<ProductionProject>;
  updateProject: (projectId: string, patch: Partial<ProductionProject>) => Promise<ProductionProject>;
  advanceStage: (projectId: string) => Promise<void>;
  completePipeline: (projectId: string) => Promise<void>;
  pausePipeline: (projectId: string) => Promise<void>;
  updateScene: (projectId: string, sceneId: string, patch: Partial<SceneItem>) => Promise<void>;
  addReviewComment: (projectId: string, timestampSec: number, text: string) => Promise<void>;
  toggleChecklistItem: (projectId: string, itemId: string) => Promise<void>;
  requestRevision: (projectId: string, instruction: string) => Promise<void>;
  approveProject: (projectId: string) => Promise<void>;
  scheduleProject: (projectId: string, dateIso: string | null) => Promise<void>;
  savePublicationPackage: (projectId: string, patch: Partial<PublicationPackage>) => Promise<ProductionProject>;
  generateDerivative: (projectId: string, formatId: DerivativeVariant['formatId']) => Promise<void>;
  decideDerivative: (projectId: string, variantId: string, decision: 'approved' | 'rejected') => Promise<void>;
  promoteDerivative: (projectId: string, variantId: string) => Promise<ProductionProject>;
  createIdeaFromAnalytics: (projectId: string, title: string, angle: string) => Promise<TrendIdea>;
  startFfmpegRender: (projectId: string, preset?: ProductionProject['qualityPreset']) => Promise<RenderJob>;
  cancelRenderJob: (jobId: string) => Promise<void>;
  createChannel: (input: Omit<ChannelConfig, 'id' | 'oauthStatus' | 'createdAt' | 'updatedAt'>) => Promise<ChannelConfig>;
  saveAgentProviders: (providers: AgentProviderConfig[]) => Promise<void>;
  testAgentProviderById: (providerId: string) => Promise<AgentProviderConfig>;
  runHumanize: (input: {
    text: string;
    tone: 'editorial' | 'conversacional' | 'documental';
    projectId?: string | null;
  }) => Promise<{
    result: HumanizeResult;
    providerUsed: string;
    executionMode: 'real_cli' | 'deterministic_fallback';
    notice: string;
  }>;
  runYouTubeAgent: (projectId: string) => Promise<{
    analysis: YouTubeAgentAnalysis;
    providerUsed: string;
    executionMode: 'real_cli' | 'deterministic_fallback';
    notice: string;
  }>;
  createCreativeArt: (input: {
    artType: CreativeArtType;
    prompt: string;
    headline: string;
    fidelity: CreativeArtProject['fidelity'];
    brandKitId: string;
  }) => Promise<CreativeArtProject>;
  runThumbnailLab: (input: {
    prompt: string;
    headline: string;
    fidelity: CreativeArtProject['fidelity'];
    brandKitId: string;
  }) => Promise<CreativeArtProject[]>;
  updateCreativeLayers: (artId: string, layers: CreativeLayer[]) => Promise<void>;
  toggleApproveCreative: (artId: string) => Promise<void>;
  saveBrandKit: (kit: Omit<BrandKit, 'id'>) => Promise<BrandKit>;
  addMediaAsset: (asset: Omit<MediaAsset, 'id' | 'addedAt'>) => Promise<void>;
  acquireViaYtDlp: (query: string) => Promise<{ ok: boolean; status: 'ok' | 'blocked'; message: string }>;
  updatePreferences: (patch: Partial<StudioPreferences>) => Promise<void>;
  resetWorkspace: () => Promise<void>;
  clearLogs: () => Promise<void>;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StudioBootstrapState>(() => fallbackInitialBootstrap());
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);

  const initialLoc = useMemo(() => parseHashLocation(), []);
  const [history, setHistory] = useState<NavSectionId[]>([initialLoc.section]);
  const [historyIdx, setHistoryIdx] = useState(0);
  const [manualSubView, setManualSubViewState] = useState<ManualProjectSubView>(
    initialLoc.subView ?? 'overview',
  );
  const [activeProjectId, setActiveProjectId] = useState<string>(
    initialLoc.projectId ?? state.projects[0]?.id ?? '',
  );

  const activeSection = history[historyIdx] ?? 'home';

  const refreshBootstrap = useCallback(async () => {
    try {
      const data = await apiJson<StudioBootstrapState>('/api/bootstrap');
      setState(data);
      setActiveProjectId((curr) =>
        curr && data.projects.some((p) => p.id === curr) ? curr : data.projects[0]?.id ?? '',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  useEffect(() => {
    const onHashChange = () => {
      const loc = parseHashLocation();
      setHistory((prev) => {
        const curr = prev[historyIdx];
        if (curr === loc.section) return prev;
        const next = [...prev.slice(0, historyIdx + 1), loc.section];
        setHistoryIdx(next.length - 1);
        return next;
      });
      if (loc.projectId) setActiveProjectId(loc.projectId);
      if (loc.subView) setManualSubViewState(loc.subView);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [historyIdx]);

  // Real-time Server-Sent Events subscription
  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('connected', () => {
      setSseConnected(true);
    });

    es.addEventListener('project_updated', (ev) => {
      const updated = JSON.parse((ev as MessageEvent).data) as ProductionProject;
      setState((prev) => {
        const exists = prev.projects.some((p) => p.id === updated.id);
        return {
          ...prev,
          projects: exists
            ? prev.projects.map((p) => (p.id === updated.id ? updated : p))
            : [updated, ...prev.projects],
        };
      });
    });

    es.addEventListener('render_progress', (ev) => {
      const job = JSON.parse((ev as MessageEvent).data) as RenderJob;
      setState((prev) => {
        const exists = prev.renderJobs.some((j) => j.id === job.id);
        return {
          ...prev,
          renderJobs: exists
            ? prev.renderJobs.map((j) => (j.id === job.id ? job : j))
            : [job, ...prev.renderJobs],
        };
      });
    });

    es.addEventListener('console_log', (ev) => {
      const log = JSON.parse((ev as MessageEvent).data) as ConsoleLogEntry;
      setState((prev) => {
        if (prev.consoleLogs.some((l) => l.id === log.id)) return prev;
        return {
          ...prev,
          consoleLogs: [log, ...prev.consoleLogs].slice(0, 150),
        };
      });
    });

    es.addEventListener('channel_updated', (ev) => {
      const ch = JSON.parse((ev as MessageEvent).data) as ChannelConfig;
      setState((prev) => {
        const exists = prev.channels.some((c) => c.id === ch.id);
        return {
          ...prev,
          channels: exists
            ? prev.channels.map((c) => (c.id === ch.id ? ch : c))
            : [ch, ...prev.channels],
        };
      });
    });

    es.addEventListener('idea_created', (ev) => {
      const idea = JSON.parse((ev as MessageEvent).data) as TrendIdea;
      setState((prev) => {
        if (prev.trendIdeas.some((i) => i.id === idea.id)) return prev;
        return { ...prev, trendIdeas: [idea, ...prev.trendIdeas] };
      });
    });

    es.addEventListener('agents_updated', (ev) => {
      const providers = JSON.parse((ev as MessageEvent).data) as AgentProviderConfig[];
      setState((prev) => ({ ...prev, agentProviders: providers }));
    });

    es.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      es.close();
    };
  }, []);

  const navigate = useCallback(
    (section: NavSectionId, projectId?: string, subView?: ManualProjectSubView) => {
      const nextProjId = projectId ?? activeProjectId;
      if (projectId) setActiveProjectId(projectId);
      if (subView) setManualSubViewState(subView);
      const nextHash = buildHash(section, nextProjId, subView);
      if (window.location.hash !== nextHash) {
        window.history.replaceState(null, '', nextHash);
      }
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIdx + 1);
        if (trimmed[trimmed.length - 1] === section) return trimmed;
        return [...trimmed, section];
      });
      setHistoryIdx((idx) => (history[idx] === section ? idx : idx + 1));
    },
    [history, historyIdx, activeProjectId],
  );

  const setManualSubView = useCallback(
    (subView: ManualProjectSubView) => {
      setManualSubViewState(subView);
      const nextHash = buildHash('manual_projects', activeProjectId, subView);
      window.history.replaceState(null, '', nextHash);
    },
    [activeProjectId],
  );

  const goBack = useCallback(() => {
    setHistoryIdx((idx) => {
      const next = Math.max(0, idx - 1);
      const sec = history[next];
      if (sec) window.history.replaceState(null, '', buildHash(sec));
      return next;
    });
  }, [history]);

  const goForward = useCallback(() => {
    setHistoryIdx((idx) => {
      const next = Math.min(history.length - 1, idx + 1);
      const sec = history[next];
      if (sec) window.history.replaceState(null, '', buildHash(sec));
      return next;
    });
  }, [history]);

  const selectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
  }, []);

  const upsertLocalProject = useCallback((proj: ProductionProject) => {
    setState((prev) => {
      const exists = prev.projects.some((p) => p.id === proj.id);
      return {
        ...prev,
        projects: exists
          ? prev.projects.map((p) => (p.id === proj.id ? proj : p))
          : [proj, ...prev.projects],
      };
    });
  }, []);

  const createProduction = useCallback(
    async (input: CreateProductionInput): Promise<ProductionProject> => {
      const created = await apiJson<ProductionProject>('/api/projects', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      upsertLocalProject(created);
      setActiveProjectId(created.id);
      return created;
    },
    [upsertLocalProject],
  );

  const updateProject = useCallback(
    async (projectId: string, patch: Partial<ProductionProject>): Promise<ProductionProject> => {
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      upsertLocalProject(updated);
      return updated;
    },
    [upsertLocalProject],
  );

  const advanceStage = useCallback(
    async (projectId: string) => {
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}/pipeline/advance`, {
        method: 'POST',
      });
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const completePipeline = useCallback(
    async (projectId: string) => {
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}/pipeline/complete`, {
        method: 'POST',
      });
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const pausePipeline = useCallback(
    async (projectId: string) => {
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}/pipeline/pause`, {
        method: 'POST',
      });
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const updateScene = useCallback(
    async (projectId: string, sceneId: string, patch: Partial<SceneItem>) => {
      // Optimistic local update for crisp typing, persisted to SQLite immediately
      setState((prev) => ({
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === projectId
            ? { ...p, scenes: p.scenes.map((s) => (s.id === sceneId ? { ...s, ...patch } : s)) }
            : p,
        ),
      }));
      const updated = await apiJson<ProductionProject>(
        `/api/projects/${projectId}/scenes/${sceneId}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      );
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const addReviewComment = useCallback(
    async (projectId: string, timestampSec: number, text: string) => {
      if (!text.trim()) return;
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ timestampSec, text }),
      });
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const toggleChecklistItem = useCallback(
    async (projectId: string, itemId: string) => {
      const updated = await apiJson<ProductionProject>(
        `/api/projects/${projectId}/checklist/${itemId}/toggle`,
        { method: 'POST' },
      );
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const requestRevision = useCallback(
    async (projectId: string, instruction: string) => {
      if (!instruction.trim()) return;
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}/revisions`, {
        method: 'POST',
        body: JSON.stringify({ instruction }),
      });
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const approveProject = useCallback(
    async (projectId: string) => {
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}/approve`, {
        method: 'POST',
      });
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const scheduleProject = useCallback(
    async (projectId: string, dateIso: string | null) => {
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}/schedule`, {
        method: 'POST',
        body: JSON.stringify({ dateIso }),
      });
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const savePublicationPackage = useCallback(
    async (projectId: string, patch: Partial<PublicationPackage>): Promise<ProductionProject> => {
      const updated = await apiJson<ProductionProject>(`/api/projects/${projectId}/package`, {
        method: 'PUT',
        body: JSON.stringify(patch),
      });
      upsertLocalProject(updated);
      return updated;
    },
    [upsertLocalProject],
  );

  const generateDerivative = useCallback(
    async (projectId: string, formatId: DerivativeVariant['formatId']) => {
      const res = await apiJson<{ project: ProductionProject }>(`/api/projects/${projectId}/derivatives`, {
        method: 'POST',
        body: JSON.stringify({ formatId }),
      });
      upsertLocalProject(res.project);
    },
    [upsertLocalProject],
  );

  const decideDerivative = useCallback(
    async (projectId: string, variantId: string, decision: 'approved' | 'rejected') => {
      const updated = await apiJson<ProductionProject>(
        `/api/projects/${projectId}/derivatives/${variantId}/decide`,
        { method: 'POST', body: JSON.stringify({ decision }) },
      );
      upsertLocalProject(updated);
    },
    [upsertLocalProject],
  );

  const promoteDerivative = useCallback(
    async (projectId: string, variantId: string): Promise<ProductionProject> => {
      const res = await apiJson<{ parent: ProductionProject; child: ProductionProject }>(
        `/api/projects/${projectId}/derivatives/${variantId}/promote`,
        { method: 'POST' },
      );
      upsertLocalProject(res.parent);
      upsertLocalProject(res.child);
      return res.child;
    },
    [upsertLocalProject],
  );

  const createIdeaFromAnalytics = useCallback(
    async (projectId: string, title: string, angle: string): Promise<TrendIdea> => {
      const idea = await apiJson<TrendIdea>(`/api/projects/${projectId}/analytics/idea`, {
        method: 'POST',
        body: JSON.stringify({ title, angle }),
      });
      setState((prev) => ({
        ...prev,
        trendIdeas: prev.trendIdeas.some((i) => i.id === idea.id)
          ? prev.trendIdeas
          : [idea, ...prev.trendIdeas],
      }));
      return idea;
    },
    [],
  );

  const startFfmpegRender = useCallback(
    async (projectId: string, preset?: ProductionProject['qualityPreset']): Promise<RenderJob> => {
      const job = await apiJson<RenderJob>('/api/renders', {
        method: 'POST',
        body: JSON.stringify({ projectId, preset }),
      });
      setState((prev) => ({
        ...prev,
        renderJobs: prev.renderJobs.some((j) => j.id === job.id)
          ? prev.renderJobs.map((j) => (j.id === job.id ? job : j))
          : [job, ...prev.renderJobs],
      }));
      return job;
    },
    [],
  );

  const cancelRenderJob = useCallback(async (jobId: string) => {
    const updated = await apiJson<RenderJob>(`/api/renders/${jobId}/cancel`, { method: 'POST' });
    setState((prev) => ({
      ...prev,
      renderJobs: prev.renderJobs.map((j) => (j.id === updated.id ? updated : j)),
    }));
  }, []);

  const createChannel = useCallback(
    async (input: Omit<ChannelConfig, 'id' | 'oauthStatus' | 'createdAt' | 'updatedAt'>): Promise<ChannelConfig> => {
      const ch = await apiJson<ChannelConfig>('/api/channels', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setState((prev) => ({
        ...prev,
        channels: prev.channels.some((c) => c.id === ch.id) ? prev.channels : [ch, ...prev.channels],
      }));
      return ch;
    },
    [],
  );

  const saveAgentProviders = useCallback(async (providers: AgentProviderConfig[]) => {
    const updated = await apiJson<AgentProviderConfig[]>('/api/agents/providers', {
      method: 'PATCH',
      body: JSON.stringify({ providers }),
    });
    setState((prev) => ({ ...prev, agentProviders: updated }));
  }, []);

  const testAgentProviderById = useCallback(async (providerId: string): Promise<AgentProviderConfig> => {
    const res = await apiJson<{ provider: AgentProviderConfig; runs: AgentRunRecord[] }>(
      `/api/agents/providers/${providerId}/test`,
      { method: 'POST' },
    );
    setState((prev) => ({
      ...prev,
      agentProviders: prev.agentProviders.map((p) => (p.id === res.provider.id ? res.provider : p)),
      agentRuns: res.runs,
    }));
    return res.provider;
  }, []);

  const runHumanize = useCallback(
    async (input: { text: string; tone: 'editorial' | 'conversacional' | 'documental'; projectId?: string | null }) => {
      const res = await apiJson<{
        result: HumanizeResult;
        providerUsed: string;
        executionMode: 'real_cli' | 'deterministic_fallback';
        notice: string;
        run: AgentRunRecord;
      }>('/api/agents/humanize', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setState((prev) => ({ ...prev, agentRuns: [res.run, ...prev.agentRuns].slice(0, 40) }));
      return res;
    },
    [],
  );

  const runYouTubeAgent = useCallback(async (projectId: string) => {
    const res = await apiJson<{
      analysis: YouTubeAgentAnalysis;
      providerUsed: string;
      executionMode: 'real_cli' | 'deterministic_fallback';
      notice: string;
      run: AgentRunRecord;
    }>('/api/agents/youtube', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    });
    setState((prev) => ({ ...prev, agentRuns: [res.run, ...prev.agentRuns].slice(0, 40) }));
    return res;
  }, []);

  const createCreativeArt = useCallback(
    async (input: {
      artType: CreativeArtType;
      prompt: string;
      headline: string;
      fidelity: CreativeArtProject['fidelity'];
      brandKitId: string;
    }): Promise<CreativeArtProject> => {
      const art = await apiJson<CreativeArtProject>('/api/creative/arts', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setState((prev) => ({ ...prev, creativeProjects: [art, ...prev.creativeProjects] }));
      return art;
    },
    [],
  );

  const runThumbnailLab = useCallback(
    async (input: {
      prompt: string;
      headline: string;
      fidelity: CreativeArtProject['fidelity'];
      brandKitId: string;
    }): Promise<CreativeArtProject[]> => {
      const variants = await apiJson<CreativeArtProject[]>('/api/creative/thumbnail-lab', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      setState((prev) => ({ ...prev, creativeProjects: [...variants, ...prev.creativeProjects] }));
      return variants;
    },
    [],
  );

  const updateCreativeLayers = useCallback(async (artId: string, layers: CreativeLayer[]) => {
    setState((prev) => ({
      ...prev,
      creativeProjects: prev.creativeProjects.map((a) =>
        a.id === artId
          ? { ...a, layers, headline: layers.find((l) => l.kind === 'headline')?.text ?? a.headline }
          : a,
      ),
    }));
    await apiJson<CreativeArtProject>(`/api/creative/arts/${artId}`, {
      method: 'PATCH',
      body: JSON.stringify({ layers }),
    });
  }, []);

  const toggleApproveCreative = useCallback(async (artId: string) => {
    const current = state.creativeProjects.find((a) => a.id === artId);
    const nextApproved = !(current?.approved ?? false);
    const updated = await apiJson<CreativeArtProject>(`/api/creative/arts/${artId}`, {
      method: 'PATCH',
      body: JSON.stringify({ approved: nextApproved }),
    });
    setState((prev) => ({
      ...prev,
      creativeProjects: prev.creativeProjects.map((a) => (a.id === artId ? updated : a)),
    }));
  }, [state.creativeProjects]);

  const saveBrandKit = useCallback(async (kit: Omit<BrandKit, 'id'>): Promise<BrandKit> => {
    const created = await apiJson<BrandKit>('/api/creative/brand-kits', {
      method: 'POST',
      body: JSON.stringify(kit),
    });
    setState((prev) => ({ ...prev, brandKits: [...prev.brandKits, created] }));
    return created;
  }, []);

  const addMediaAsset = useCallback(async (asset: Omit<MediaAsset, 'id' | 'addedAt'>) => {
    const created = await apiJson<MediaAsset>('/api/media', {
      method: 'POST',
      body: JSON.stringify(asset),
    });
    setState((prev) => ({ ...prev, mediaAssets: [created, ...prev.mediaAssets] }));
  }, []);

  const acquireViaYtDlp = useCallback(async (query: string) => {
    const res = await fetch('/api/media/acquire-ytdlp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      status: 'ok' | 'blocked';
      message: string;
      asset?: MediaAsset;
    };
    if (data.asset) {
      setState((prev) => ({ ...prev, mediaAssets: [data.asset!, ...prev.mediaAssets] }));
    }
    return { ok: data.ok, status: data.status, message: data.message };
  }, []);

  const updatePreferences = useCallback(async (patch: Partial<StudioPreferences>) => {
    const updated = await apiJson<StudioPreferences>('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    setState((prev) => ({ ...prev, preferences: updated }));
  }, []);

  const resetWorkspace = useCallback(async () => {
    const fresh = await apiJson<StudioBootstrapState>('/api/workspace/reset', { method: 'POST' });
    setState(fresh);
    setActiveProjectId(fresh.projects[0]?.id ?? '');
  }, []);

  const clearLogs = useCallback(async () => {
    await apiJson('/api/logs', { method: 'DELETE' });
    setState((prev) => ({ ...prev, consoleLogs: [] }));
  }, []);

  const activeProject = useMemo(
    () => state.projects.find((p) => p.id === activeProjectId) ?? state.projects[0],
    [state.projects, activeProjectId],
  );

  const value: StudioContextValue = {
    ...state,
    loading,
    sseConnected,
    activeSection,
    manualSubView,
    activeProjectId: activeProject?.id ?? '',
    activeProject,
    canGoBack: historyIdx > 0,
    canGoForward: historyIdx < history.length - 1,
    navigate,
    setManualSubView,
    goBack,
    goForward,
    selectProject,
    refreshBootstrap,
    createProduction,
    updateProject,
    advanceStage,
    completePipeline,
    pausePipeline,
    updateScene,
    addReviewComment,
    toggleChecklistItem,
    requestRevision,
    approveProject,
    scheduleProject,
    savePublicationPackage,
    generateDerivative,
    decideDerivative,
    promoteDerivative,
    createIdeaFromAnalytics,
    startFfmpegRender,
    cancelRenderJob,
    createChannel,
    saveAgentProviders,
    testAgentProviderById,
    runHumanize,
    runYouTubeAgent,
    createCreativeArt,
    runThumbnailLab,
    updateCreativeLayers,
    toggleApproveCreative,
    saveBrandKit,
    addMediaAsset,
    acquireViaYtDlp,
    updatePreferences,
    resetWorkspace,
    clearLogs,
  };

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio(): StudioContextValue {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error('useStudio must be used within StudioProvider');
  return ctx;
}

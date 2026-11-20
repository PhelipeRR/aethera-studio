import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clapperboard,
  FastForward,
  Film,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';
import { SyncConflictCard } from '../components/SyncConflictCard';
import { SyncStatusBadge } from '../components/SyncStatusBadge';
import { parseBriefingIntent } from '../domain/briefing-parser';
import { computeQualityScore, getPipelineProgressPct } from '../domain/pipeline-engine';
import { productionProjectToSyncedData } from '../domain/sync-mapper';
import type { ProductionProject, TrendIdea } from '../domain/types';
import { useRemoteHost } from '../store/remote-host-store';
import { useStudio } from '../store/studio-store';

type SubTab = 'create' | 'active' | 'review' | 'audit';

const HUMOR_LABEL = (v: number): string => {
  if (v <= 15) return 'Sério';
  if (v <= 45) return 'Pontual';
  if (v <= 70) return 'Leve';
  return 'Comédia';
};

export function ProductionAIPage() {
  const {
    projects,
    activeProject,
    trendIdeas,
    preferences,
    selectProject,
    createProduction,
    advanceStage,
    completePipeline,
    pausePipeline,
    startFfmpegRender,
    navigate,
  } = useStudio();

  const {
    connectionState: remoteState,
    hostStatus: remoteHostStatus,
    syncedProjects,
    syncConflicts,
    submitJob: submitRemoteJob,
    upsertSyncedProject,
    resolveSyncConflict,
    getProjectSyncBadge,
  } = useRemoteHost();

  const [tab, setTab] = useState<SubTab>('create');
  const [briefing, setBriefing] = useState('');
  const [format, setFormat] = useState<ProductionProject['format']>('youtube_1080p');
  const [style, setStyle] = useState<ProductionProject['style']>('Video Essay');
  const [durationMin, setDurationMin] = useState<number>(12);
  const [durationManual, setDurationManual] = useState(false);
  const [humorLevel, setHumorLevel] = useState<number>(35);
  const [ttsProvider, setTtsProvider] = useState<ProductionProject['ttsProvider']>(
    preferences.defaultTtsProvider,
  );
  const [ttsVoice, setTtsVoice] = useState('Narrador Épico (PT-BR)');
  const [qualityPreset, setQualityPreset] = useState<ProductionProject['qualityPreset']>(
    preferences.defaultQuality,
  );
  const [ideaFilter, setIdeaFilter] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncingProjectId, setSyncingProjectId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [remoteDispatching, setRemoteDispatching] = useState(false);

  const parsedIntent = useMemo(
    () => (briefing.trim().length > 0 ? parseBriefingIntent(briefing) : null),
    [briefing],
  );

  useEffect(() => {
    if (!parsedIntent) return;
    setStyle(parsedIntent.style);
    setFormat(parsedIntent.format);
    if (!durationManual && parsedIntent.durationDetected) {
      setDurationMin(parsedIntent.durationMin);
    }
    setHumorLevel(parsedIntent.humorLevel);
  }, [parsedIntent, durationManual]);

  const runningCount = useMemo(
    () => projects.filter((p) => p.status === 'producing').length,
    [projects],
  );

  const filteredIdeas = useMemo(() => {
    const q = ideaFilter.trim().toLowerCase();
    if (!q) return trendIdeas;
    return trendIdeas.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.source.toLowerCase().includes(q) ||
        i.angle.toLowerCase().includes(q),
    );
  }, [trendIdeas, ideaFilter]);

  const handleUseIdea = (idea: TrendIdea) => {
    setBriefing(idea.briefingTemplate);
    setDurationMin(idea.suggestedDurationMin);
    setStyle(idea.suggestedStyle);
    setDurationManual(false);
    setFormError(null);
    setTab('create');
  };

  const handleGenerate = async () => {
    if (briefing.trim().length < 8) {
      setFormError('Descreva o briefing do vídeo (mínimo 8 caracteres) antes de gerar.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await createProduction({
        briefing,
        creationMode: 'ai',
        format,
        style,
        durationMin,
        humorLevel,
        ttsProvider,
        ttsVoice,
        qualityPreset,
        language: parsedIntent?.language ?? preferences.defaultLanguage,
      });
      setBriefing('');
      setDurationManual(false);
      setTab('active');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispatchRemoteCinema = async () => {
    if (briefing.trim().length < 8) {
      setFormError('Descreva o briefing do vídeo (mínimo 8 caracteres) antes de enviar ao PC remoto.');
      return;
    }
    setFormError(null);
    setRemoteDispatching(true);
    try {
      const aspectRatio: '16:9' | '9:16' = format === 'shorts_9_16' ? '9:16' : '16:9';
      const mappedQuality =
        qualityPreset === 'cinema_4k'
          ? 'cinema_4k'
          : qualityPreset === 'master_1080p'
            ? 'master_1080p'
            : 'review_720p';

      // Create/register project in Bidirectional Sync Authority first so Desktop & Web share the exact same projectId
      const syncResult = await upsertSyncedProject({
        data: {
          title: briefing.trim().slice(0, 72),
          briefing: briefing.trim(),
          creationMode: 'ai',
          format,
          style,
          aspectRatio,
          language: parsedIntent?.language ?? preferences.defaultLanguage,
          durationMin,
          humorLevel,
          ttsProvider,
          ttsVoice,
          qualityPreset,
          status: 'producing',
          scheduledDate: null,
          humanizedScript: null,
          scenes: [],
          revisions: [],
          latestJobId: null,
          latestRenderMediaRefId: null,
          mediaRefs: [],
        },
      });

      await submitRemoteJob({
        operation: 'cinema.produce',
        title: briefing.trim().slice(0, 72),
        prompt: `${briefing.trim()} [Estilo: ${style}; Duração: ~${durationMin} min; Humor: ${humorLevel}%; TTS: ${ttsProvider}/${ttsVoice}]`,
        aspectRatio,
        qualityPreset: mappedQuality,
        useGpu: true,
        ...(syncResult.project ? { projectId: syncResult.project.id } : {}),
      });
      navigate('remote');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao enviar produção ao Remote Host.');
    } finally {
      setRemoteDispatching(false);
    }
  };

  const handleSyncProjectToPc = async (project: ProductionProject) => {
    setSyncingProjectId(project.id);
    setSyncNotice(null);
    try {
      const existing = syncedProjects.find((p) => p.id === project.id);
      const res = await upsertSyncedProject({
        id: project.id,
        expectedVersion: existing ? existing.version : null,
        data: productionProjectToSyncedData(project),
      });
      if (res.queued) {
        setSyncNotice('Alteração enfileirada como Pendente — será enviada ao PC assim que reconectar.');
      } else if (res.conflict) {
        setSyncNotice('Conflito de versão detectado! Resolva abaixo antes de sobrescrever.');
      } else if (res.ok && res.project) {
        setSyncNotice(`Projeto sincronizado com o PC/Desktop (v${res.project.version}).`);
      } else if (res.error) {
        setSyncNotice(res.error);
      }
    } finally {
      setSyncingProjectId(null);
    }
  };

  const desktopOnlySyncedProjects = useMemo(() => {
    const localIds = new Set(projects.map((p) => p.id));
    return syncedProjects.filter((sp) => !localIds.has(sp.id));
  }, [projects, syncedProjects]);

  const currentProject = activeProject ?? projects[0];
  const currentBadge = currentProject ? getProjectSyncBadge(currentProject.id) : null;
  const currentConflict = currentProject ? syncConflicts[currentProject.id] : undefined;
  const currentPct = currentProject ? getPipelineProgressPct(currentProject.stages) : 0;

  return (
    <div className="space-y-4">
      {/* Header Row */}
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#6a46d8]">
            AETHERA
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Produção com IA</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-9 px-3.5 rounded-full bg-[#f4f4f6] text-xs font-semibold text-[#111111] inline-flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${runningCount > 0 ? 'bg-[#d8fb4f]' : 'bg-[#62626c]'}`} />
            {runningCount} rodando
          </span>
          <button
            type="button"
            onClick={() => navigate('console')}
            className="h-9 px-3.5 rounded-full bg-[#f4f4f6] hover:bg-[#e3e3e8] text-xs font-semibold text-[#111111] inline-flex items-center gap-2"
          >
            <SquareTerminal className="w-3.5 h-3.5" />
            <span>Console Geral</span>
          </button>
        </div>
      </div>

      {/* Main 3-Zone Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left Productions Sidebar */}
        <aside className="xl:col-span-3 rounded-[28px] bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#62626c]">
              PRODUÇÕES
            </span>
            <span className="text-xs font-mono font-semibold text-[#111111]">{projects.length}</span>
          </div>

          <button
            type="button"
            onClick={() => setTab('create')}
            className="w-full h-10 rounded-2xl bg-[#f4f4f6] hover:bg-[#efe9fd] text-xs font-semibold text-[#111111] inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nova produção</span>
          </button>

          <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-0.5">
            {projects.map((proj) => {
              const selected = currentProject?.id === proj.id;
              const pct = getPipelineProgressPct(proj.stages);
              const badge = getProjectSyncBadge(proj.id);
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => {
                    selectProject(proj.id);
                    setTab('active');
                  }}
                  className={`w-full text-left rounded-2xl p-3 transition-all ${
                    selected
                      ? 'bg-[#111111] text-white'
                      : 'bg-[#f4f4f6] text-[#111111] hover:bg-[#e9e9ef]'
                  }`}
                >
                  <div className="text-xs font-semibold line-clamp-2">{proj.title}</div>
                  <div className="mt-2 flex items-center justify-between gap-1.5 text-[11px]">
                    <span className={selected ? 'text-[#d8fb4f]' : 'text-[#6a46d8]'}>{proj.style}</span>
                    <span className={`font-mono ${selected ? 'text-white/80' : 'text-[#62626c]'}`}>{pct}%</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-1">
                    <SyncStatusBadge state={badge.state} version={badge.version} inverted={selected} />
                  </div>
                </button>
              );
            })}
          </div>

          {desktopOnlySyncedProjects.length > 0 && (
            <div className="pt-3 border-t border-[#e3e3e8] space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#6a46d8]">
                  NO PC / DESKTOP
                </span>
                <span className="text-[11px] font-mono font-semibold text-[#6a46d8]">
                  {desktopOnlySyncedProjects.length}
                </span>
              </div>
              <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-0.5">
                {desktopOnlySyncedProjects.map((sp) => (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={() => navigate('remote')}
                    className="w-full text-left rounded-2xl bg-[#efe9fd] hover:bg-[#e5dbfc] p-2.5 transition-colors space-y-1.5"
                  >
                    <div className="text-xs font-semibold text-[#111111] line-clamp-1">{sp.data.title}</div>
                    <div className="flex items-center justify-between gap-1">
                      <SyncStatusBadge state="synced" version={sp.version} />
                      <span className="text-[10px] font-mono text-[#6a46d8]">{sp.origin}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Center Main Panel */}
        <section className="xl:col-span-6 rounded-[28px] bg-white p-5 sm:p-6 shadow-2xs space-y-5">
          <div role="tablist" aria-label="Etapas de Produção com IA" className="flex flex-wrap gap-2 border-b border-[#e3e3e8] pb-3">
            {(
              [
                { id: 'create', label: 'Criar' },
                { id: 'active', label: 'Produção ativa' },
                { id: 'review', label: 'Revisão' },
                { id: 'audit', label: 'Auditoria Editorial' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                  tab === t.id
                    ? 'bg-[#111111] text-white'
                    : 'bg-[#f4f4f6] text-[#62626c] hover:text-[#111111]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'create' && (
            <div className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-[#111111]">Briefing</h2>
                <p className="text-xs text-[#62626c] mt-0.5">
                  Descreva o vídeo. Antes de gerar, confira o que a IA entendeu e ajuste só o que precisar.
                </p>
              </div>

              <div>
                <label htmlFor="briefing-input" className="block text-xs font-semibold text-[#111111] mb-1.5">
                  Direção Criativa / Briefing
                </label>
                <textarea
                  id="briefing-input"
                  rows={4}
                  value={briefing}
                  onChange={(e) => {
                    setBriefing(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  placeholder="Ex.: Crie um vídeo cinematográfico sobre os 10 chefes mais difíceis de Elden Ring, com narrativa épica, humor pontual e duração de 12 minutos."
                  className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] focus:border-[#8b6cf0] focus:bg-white p-3.5 text-sm text-[#111111] placeholder:text-[#62626c] outline-none transition-colors"
                />
                {formError && (
                  <p role="alert" className="mt-1.5 text-xs font-medium text-[#d23c4f]">
                    {formError}
                  </p>
                )}
              </div>

              {parsedIntent && (
                <div className="rounded-2xl bg-[#efe9fd] px-3.5 py-2.5 flex flex-wrap items-center gap-2 text-xs">
                  <CheckCircle2 className="w-4 h-4 text-[#2f7d32] shrink-0" />
                  <span className="font-semibold text-[#111111]">Entendi:</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white font-semibold text-[#111111]">
                    {parsedIntent.style}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white font-mono text-[#111111]">
                    ~{durationMin} min
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white font-mono text-[#111111]">
                    {parsedIntent.aspectRatio}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white font-mono text-[#111111]">
                    {parsedIntent.language}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label htmlFor="format-select" className="block text-xs font-semibold text-[#111111] mb-1">
                    Formato
                  </label>
                  <select
                    id="format-select"
                    value={format}
                    onChange={(e) => setFormat(e.target.value as ProductionProject['format'])}
                    className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
                  >
                    <option value="youtube_1080p">Automático (YouTube 1080p • 16:9)</option>
                    <option value="youtube_4k">Cinema 4K (16:9)</option>
                    <option value="documentary_wide">Documentário Widescreen (16:9)</option>
                    <option value="shorts_9_16">Shorts / Reels Vertical (9:16)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="style-select" className="block text-xs font-semibold text-[#111111] mb-1">
                    Estilo
                  </label>
                  <select
                    id="style-select"
                    value={style}
                    onChange={(e) => setStyle(e.target.value as ProductionProject['style'])}
                    className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
                  >
                    <option value="Video Essay">Video Essay</option>
                    <option value="Documentário">Documentário</option>
                    <option value="Top 10">Top 10 / Ranking</option>
                    <option value="Análise Técnica">Análise Técnica</option>
                    <option value="Comédia Narrada">Comédia Narrada</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="duration-input" className="block text-xs font-semibold text-[#111111] mb-1">
                    Duração (min)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="duration-input"
                      type="number"
                      min={1}
                      max={60}
                      value={durationMin}
                      onChange={(e) => {
                        setDurationManual(true);
                        setDurationMin(Math.max(1, Math.min(60, Number(e.target.value) || 1)));
                      }}
                      className="w-24 h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-sm font-mono font-semibold text-[#111111]"
                    />
                    <span className="text-xs text-[#62626c]">
                      {durationManual ? 'definida manualmente' : 'sincronizada com o briefing'}
                    </span>
                  </div>
                </div>

                <div>
                  <label htmlFor="humor-range" className="block text-xs font-semibold text-[#111111] mb-1">
                    Humor — {humorLevel}% ({HUMOR_LABEL(humorLevel)})
                  </label>
                  <input
                    id="humor-range"
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={humorLevel}
                    onChange={(e) => setHumorLevel(Number(e.target.value))}
                    className="w-full accent-[#111111] mt-2"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2 border-t border-[#e3e3e8]">
                <div>
                  <label htmlFor="tts-provider" className="block text-xs font-semibold text-[#111111] mb-1">
                    Narração e provedor TTS
                  </label>
                  <select
                    id="tts-provider"
                    value={ttsProvider}
                    onChange={(e) => {
                      const val = e.target.value as ProductionProject['ttsProvider'];
                      setTtsProvider(val);
                      setTtsVoice(
                        val === 'elevenlabs'
                          ? 'Atlas Documental'
                          : val === 'webspeech'
                            ? 'Voz Nativa do Navegador'
                            : 'Narrador Épico (PT-BR)',
                      );
                    }}
                    className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
                  >
                    <option value="voicestudio">VoiceStudio Local (PT-BR)</option>
                    <option value="elevenlabs">ElevenLabs Neural</option>
                    <option value="webspeech">Web Speech API (Navegador)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="quality-preset" className="block text-xs font-semibold text-[#111111] mb-1">
                    Qualidade de render
                  </label>
                  <select
                    id="quality-preset"
                    value={qualityPreset}
                    onChange={(e) => setQualityPreset(e.target.value as ProductionProject['qualityPreset'])}
                    className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
                  >
                    <option value="review_720p">Review 720p (rápido)</option>
                    <option value="master_1080p">Master 1080p (YouTube)</option>
                    <option value="cinema_4k">Cinema 4K (Master)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#e3e3e8]">
                <span className="text-xs text-[#62626c]">
                  Voz selecionada: <strong className="text-[#111111]">{ttsVoice}</strong>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {remoteState === 'connected' ? (
                    <button
                      type="button"
                      disabled={remoteDispatching}
                      onClick={() => void handleDispatchRemoteCinema()}
                      className="h-11 px-5 rounded-full bg-[#d8fb4f] hover:brightness-95 text-[#111111] text-xs font-bold inline-flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      <Server className="w-4 h-4" />
                      <span>
                        {remoteDispatching
                          ? 'Enviando ao PC...'
                          : `Produzir no PC (${remoteHostStatus?.hostname ?? 'Remoto'})`}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => navigate('remote')}
                      className="h-11 px-4 rounded-full bg-[#f4f4f6] hover:bg-[#efe9fd] text-[#111111] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Server className="w-3.5 h-3.5 text-[#6a46d8]" />
                      <span>Conectar PC Windows</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleGenerate()}
                    className="h-11 px-6 rounded-full bg-[#111111] hover:bg-[#23232b] text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4 text-[#d8fb4f]" />
                    <span>{submitting ? 'Salvando...' : 'Gerar Direção & Storyboard'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'active' && currentProject && (
            <div className="space-y-4">
              {syncNotice && (
                <div className="rounded-2xl bg-[#f3fdd0] px-4 py-2.5 text-xs font-semibold text-[#111111] flex items-center justify-between gap-2">
                  <span>{syncNotice}</span>
                  <button type="button" onClick={() => setSyncNotice(null)} className="text-[#62626c] hover:text-[#111111]">
                    Fechar
                  </button>
                </div>
              )}

              {currentConflict && (
                <SyncConflictCard
                  conflict={currentConflict}
                  onResolve={async (projectId, strategy, clientData) => {
                    const res = await resolveSyncConflict(projectId, strategy, clientData);
                    if (res.ok) {
                      setSyncNotice(`Conflito resolvido com sucesso (${strategy}).`);
                    } else if (res.error) {
                      setSyncNotice(res.error);
                    }
                  }}
                />
              )}

              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#efe8ff] text-[#6a46d8] text-[11px] font-semibold">
                      StagedCinemaPipeline • {currentPct}%
                    </span>
                    {currentBadge && (
                      <SyncStatusBadge state={currentBadge.state} version={currentBadge.version} />
                    )}
                  </div>
                  <h2 className="mt-1.5 text-lg font-bold text-[#111111]">{currentProject.title}</h2>
                  <p className="text-xs text-[#62626c] mt-0.5">
                    {currentProject.style} • ~{currentProject.durationMin} min • {currentProject.aspectRatio}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={syncingProjectId === currentProject.id}
                    onClick={() => void handleSyncProjectToPc(currentProject)}
                    className="h-9 px-3.5 rounded-full bg-[#efe9fd] hover:bg-[#e4d9fb] text-[#2a1d5c] text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingProjectId === currentProject.id ? 'animate-spin' : ''}`} />
                    <span>
                      {syncingProjectId === currentProject.id
                        ? 'Sincronizando...'
                        : currentBadge?.state === 'synced'
                          ? 'Atualizar no PC'
                          : 'Sincronizar com PC/Desktop'}
                    </span>
                  </button>
                  {currentPct < 100 && (
                    <>
                      <button
                        type="button"
                        onClick={() => void advanceStage(currentProject.id)}
                        className="h-9 px-4 rounded-full bg-[#d8fb4f] text-[#111111] text-xs font-semibold inline-flex items-center gap-1.5 hover:brightness-95"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>Avançar etapa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void completePipeline(currentProject.id)}
                        className="h-9 px-4 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#24242c]"
                      >
                        <FastForward className="w-3.5 h-3.5 text-[#d8fb4f]" />
                        <span>Concluir 9 etapas</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void pausePipeline(currentProject.id)}
                        aria-label="Pausar pipeline"
                        className="h-9 px-3 rounded-full bg-[#f4f4f6] text-[#111111] text-xs font-semibold inline-flex items-center gap-1 hover:bg-[#e3e3e8]"
                      >
                        <Pause className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await startFfmpegRender(currentProject.id, currentProject.qualityPreset);
                      navigate('pipeline', currentProject.id);
                    }}
                    className="h-9 px-4 rounded-full bg-[#f3fdd0] text-[#111111] text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Render FFmpeg</span>
                  </button>
                  {remoteState === 'connected' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await submitRemoteJob({
                          operation: 'render.ffmpeg',
                          title: `Render Remoto • ${currentProject.title}`,
                          prompt: currentProject.briefing,
                          aspectRatio: currentProject.aspectRatio,
                          qualityPreset:
                            currentProject.qualityPreset === 'cinema_4k'
                              ? 'cinema_4k'
                              : currentProject.qualityPreset === 'master_1080p'
                                ? 'master_1080p'
                                : 'review_720p',
                          useGpu: true,
                          projectId: currentProject.id,
                        });
                        navigate('remote');
                      }}
                      className="h-9 px-4 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#24242c]"
                    >
                      <Server className="w-3.5 h-3.5 text-[#d8fb4f]" />
                      <span>Render no PC</span>
                    </button>
                  )}
                  {currentPct === 100 && (
                    <button
                      type="button"
                      onClick={() => navigate('review', currentProject.id)}
                      className="h-9 px-4 rounded-full bg-[#b8a4f4] text-[#111111] text-xs font-semibold inline-flex items-center gap-1.5"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Abrir na Revisão</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="w-full h-2.5 rounded-full bg-[#f4f4f6] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#111111] transition-all duration-300"
                  style={{ width: `${currentPct}%` }}
                />
              </div>

              <ol className="space-y-2">
                {currentProject.stages.map((stage) => (
                  <li
                    key={stage.id}
                    className={`rounded-2xl px-4 py-3 flex items-center justify-between gap-3 ${
                      stage.state === 'completed'
                        ? 'bg-[#f3fdd0]'
                        : stage.state === 'running'
                          ? 'bg-[#efe9fd] ring-1 ring-[#b8a4f4]'
                          : 'bg-[#f4f4f6]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#111111]">{stage.label}</span>
                        <span className="text-[11px] font-mono text-[#62626c]">({stage.agent})</span>
                      </div>
                      <p className="text-xs text-[#62626c] mt-0.5">{stage.summary}</p>
                    </div>
                    <span
                      className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        stage.state === 'completed'
                          ? 'bg-[#d8fb4f] text-[#111111]'
                          : stage.state === 'running'
                            ? 'bg-[#b8a4f4] text-[#111111]'
                            : stage.state === 'paused'
                              ? 'bg-[#f9a8d4] text-[#111111]'
                              : 'bg-white text-[#62626c]'
                      }`}
                    >
                      {stage.state === 'completed'
                        ? 'Concluída'
                        : stage.state === 'running'
                          ? 'Ativa'
                          : stage.state === 'paused'
                            ? 'Pausada'
                            : 'Aguardando'}
                    </span>
                  </li>
                ))}
              </ol>

              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-[#62626c]">
                    Storyboard Decupado ({currentProject.scenes.length} cenas)
                  </h3>
                  <button
                    type="button"
                    onClick={() => navigate('editor', currentProject.id)}
                    className="text-xs font-semibold text-[#6a46d8] hover:underline"
                  >
                    Editar na Timeline →
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {currentProject.scenes.map((scene) => (
                    <div key={scene.id} className="rounded-2xl bg-[#f4f4f6] p-3 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#111111]">
                          Cena {scene.index}: {scene.title}
                        </span>
                        <span className="font-mono text-[#62626c]">{scene.durationSec}s</span>
                      </div>
                      <p className="text-[11px] text-[#62626c] line-clamp-2">{scene.narration}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'review' && currentProject && (
            <div className="rounded-3xl bg-[#efe9fd] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#111111]">{currentProject.title}</h2>
                <span className="px-3 py-1 rounded-full bg-white text-xs font-bold text-[#111111]">
                  Score {computeQualityScore(currentProject)}/100
                </span>
              </div>
              <p className="text-xs text-[#2a1d5c]">
                {currentProject.checklist.filter((c) => c.passed).length}/{currentProject.checklist.length} Release
                Gates aprovados • {currentProject.comments.length} comentário(s) registrados.
              </p>
              <button
                type="button"
                onClick={() => navigate('review', currentProject.id)}
                className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-2"
              >
                <ShieldCheck className="w-4 h-4 text-[#d8fb4f]" />
                <span>Abrir Sala de Revisão Completa</span>
              </button>
            </div>
          )}

          {tab === 'audit' && currentProject && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold text-[#111111]">Auditoria Editorial — {currentProject.title}</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div className="rounded-2xl bg-[#f4f4f6] p-3.5">
                  <div className="text-[11px] text-[#62626c]">Cobertura visual</div>
                  <div className="mt-1 text-lg font-bold text-[#111111]">
                    {currentProject.scenes.filter((s) => s.mediaMatched).length}/{currentProject.scenes.length} cenas
                  </div>
                </div>
                <div className="rounded-2xl bg-[#f4f4f6] p-3.5">
                  <div className="text-[11px] text-[#62626c]">Revisões cirúrgicas</div>
                  <div className="mt-1 text-lg font-bold text-[#111111]">{currentProject.revisions.length}</div>
                </div>
                <div className="rounded-2xl bg-[#f4f4f6] p-3.5">
                  <div className="text-[11px] text-[#62626c]">Provedor de voz</div>
                  <div className="mt-1 text-sm font-bold text-[#111111] capitalize">{currentProject.ttsProvider}</div>
                </div>
              </div>
              <div className="rounded-2xl bg-[#f4f4f6] p-4 space-y-2">
                <div className="text-xs font-semibold text-[#111111]">Briefing original auditado</div>
                <p className="text-xs leading-relaxed text-[#62626c]">{currentProject.briefing}</p>
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Trend Radar */}
        <aside className="xl:col-span-3 rounded-[28px] bg-white p-5 shadow-2xs space-y-3.5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#111111]">Ideias pesquisadas</h2>
            <span className="text-[11px] font-medium text-[#62626c]">Trend Radar</span>
          </div>
          <p className="text-xs text-[#62626c] leading-relaxed">
            Fontes verificadas (YouTube, Google News, Reddit e Analytics). Usar uma ideia preenche o briefing.
          </p>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#62626c] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={ideaFilter}
              onChange={(e) => setIdeaFilter(e.target.value)}
              placeholder="Filtrar tendências..."
              aria-label="Filtrar ideias do Trend Radar"
              className="w-full h-9 rounded-full bg-[#f4f4f6] pl-8 pr-3 text-xs text-[#111111] outline-none focus:ring-2 focus:ring-[#b8a4f4]"
            />
          </div>

          <div className="space-y-2.5">
            {filteredIdeas.map((idea) => (
              <article key={idea.id} className="rounded-2xl bg-[#f4f4f6] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="px-2 py-0.5 rounded-full bg-white font-semibold text-[#111111]">
                    {idea.source}
                  </span>
                  <span className="font-mono font-semibold text-[#2f7d32]">Score {idea.score}</span>
                </div>
                <h3 className="text-xs font-bold text-[#111111] leading-snug">{idea.title}</h3>
                <p className="text-[11px] text-[#62626c] leading-relaxed">{idea.angle}</p>
                <button
                  type="button"
                  onClick={() => handleUseIdea(idea)}
                  className="w-full h-8 rounded-full bg-white hover:bg-[#111111] hover:text-white text-[#111111] text-[11px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Clapperboard className="w-3 h-3" />
                  <span>Usar ideia no briefing</span>
                </button>
              </article>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

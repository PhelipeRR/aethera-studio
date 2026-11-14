import React, { useEffect, useState } from 'react';

export const TREND_RADAR_PRESET_NICHES = [
  'Games',
  'Tecnologia e IA',
  'Cinema e Séries',
  'Anime e Mangá',
  'Ciência',
  'História',
  'Mistérios',
  'Curiosidades',
  'Cultura Pop',
  'Esportes',
] as const;

export type TrendPeriod = '24h' | '7d' | '30d' | '90d';
export type TrendFormat = 'auto' | 'top_10' | 'documentary' | 'analysis' | 'news' | 'curiosities';

export interface TrendSearchConfig {
  niche: string;
  subniche?: string;
  country: string;
  language: string;
  period: TrendPeriod;
  format: TrendFormat;
  ideaCount: number;
  targetDurationMin: number;
}

export interface TrendEvidenceSource {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  origin: 'youtube' | 'news' | 'reddit' | 'trends' | 'official';
  snippet?: string;
}

export interface TrendIdea {
  ideaId: string;
  title: string;
  niche: string;
  format: TrendFormat;
  summary: string;
  whyNow: string;
  evidences: TrendEvidenceSource[];
  interestPotential: string;
  competitionLevel: 'baixo' | 'moderado' | 'alto' | 'não verificável';
  competitionNotes: string;
  editorialDifferentiator: string;
  mediaAvailability: string;
  suggestedDurationMin: number;
  narrativeTone: string;
  productionChallenges: string[];
  directorNotes: {
    researchMedia: string;
    narrative: string;
    generalDirector: string;
    comedy: string;
    editCinema: string;
    quality: string;
  };
}

export interface CinematicBriefing {
  briefingId: string;
  ideaId: string;
  approachLabel: string;
  objective: string;
  targetAudience: string;
  openingHook: string;
  narrativeStructure: string;
  factsAndTopics: string;
  verifiableReferences: string[];
  sceneProposal: string;
  editingStyle: string;
  narrationAndMusic: string;
  sfxVfxMotion: string;
  contextualHumor: string;
  durationAndFormat: string;
  compiledPrompt: string;
  recommendedGenre: 'documentary' | 'gameplay_essay' | 'top_list' | 'trailer';
  recommendedFormat: 'youtube_16_9' | 'shorts_9_16';
  recommendedDurationMin: number;
  recommendedHumorIntensity: number;
  updatedAt: string;
}

export interface TrendSearchSession {
  sessionId: string;
  config: TrendSearchConfig;
  searchedAt: string;
  sources: TrendEvidenceSource[];
  providerWarnings: string[];
  noSourcesFound: boolean;
  ideas: TrendIdea[];
  briefings: Record<string, CinematicBriefing>;
  selectedIdeaId?: string;
}

export interface TrendRadarBridgeApi {
  trendRadarSearch?: (input: {
    config: TrendSearchConfig;
    sessionId?: string;
    appendMore?: boolean;
    refresh?: boolean;
  }) => Promise<TrendSearchSession>;
  trendRadarListSessions?: () => Promise<TrendSearchSession[]>;
  trendRadarGenerateBriefing?: (input: {
    sessionId: string;
    ideaId: string;
    alternativeApproach?: boolean;
  }) => Promise<CinematicBriefing>;
  trendRadarRefineBriefing?: (input: {
    sessionId: string;
    ideaId: string;
    instruction: string;
    updatedFields?: Partial<CinematicBriefing>;
  }) => Promise<CinematicBriefing>;
}

export interface AppliedTrendIdeaPayload {
  promptText: string;
  genre: 'documentary' | 'gameplay_essay' | 'top_list' | 'trailer';
  format: 'youtube_16_9' | 'shorts_9_16';
  durationMin: number;
  humorIntensity: number;
}

interface TrendRadarPanelProps {
  api: TrendRadarBridgeApi;
  onApplyIdea: (payload: AppliedTrendIdeaPayload) => void;
}

const FORMAT_LABELS: Record<TrendFormat, string> = {
  auto: 'Automático da IA',
  top_10: 'TOP 10',
  documentary: 'Documentário',
  analysis: 'Análise',
  news: 'Notícias',
  curiosities: 'Curiosidades',
};

const PERIOD_LABELS: Record<TrendPeriod, string> = {
  '24h': '24 horas',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
};

export function formatBriefingToProductionPrompt(
  idea: TrendIdea,
  briefing: CinematicBriefing,
): string {
  return [
    `Título: ${idea.title}`,
    `Nicho: ${idea.niche} | Duração alvo: ${briefing.recommendedDurationMin || idea.suggestedDurationMin} min | Tom: ${idea.narrativeTone}`,
    '',
    `Objetivo: ${briefing.objective}`,
    `Público-alvo: ${briefing.targetAudience}`,
    `Gancho de abertura: ${briefing.openingHook}`,
    `Estrutura narrativa: ${briefing.narrativeStructure}`,
    '',
    `Assuntos e fatos verificáveis: ${briefing.factsAndTopics}`,
    `Proposta de cenas: ${briefing.sceneProposal}`,
    '',
    `Estilo de edição: ${briefing.editingStyle}`,
    `Narração e música: ${briefing.narrationAndMusic}`,
    `SFX, VFX e motion graphics: ${briefing.sfxVfxMotion}`,
    `Humor contextual: ${briefing.contextualHumor}`,
    `Duração e formato: ${briefing.durationAndFormat}`,
  ].join('\n');
}

export const TrendRadarPanel: React.FC<TrendRadarPanelProps> = ({ api, onApplyIdea }) => {
  const [expanded, setExpanded] = useState(false);
  const [niche, setNiche] = useState<string>('Games');
  const [customNiche, setCustomNiche] = useState<string>('');
  const [subniche, setSubniche] = useState<string>('');
  const [country, setCountry] = useState<string>('BR');
  const [language, setLanguage] = useState<string>('pt-BR');
  const [period, setPeriod] = useState<TrendPeriod>('7d');
  const [format, setFormat] = useState<TrendFormat>('auto');
  const [ideaCount, setIdeaCount] = useState<number>(5);
  const [durationMin, setDurationMin] = useState<number>(10);

  const [sessions, setSessions] = useState<TrendSearchSession[]>([]);
  const [activeSession, setActiveSession] = useState<TrendSearchSession | null>(null);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [refineInstruction, setRefineInstruction] = useState<string>('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!api.trendRadarListSessions) return;
    api
      .trendRadarListSessions()
      .then((list) => {
        if (!active) return;
        setSessions(list);
        const firstSession = list[0];
        if (firstSession && !activeSession) {
          setActiveSession(firstSession);
          if (firstSession.selectedIdeaId) {
            setSelectedIdeaId(firstSession.selectedIdeaId);
          }
        }
      })
      .catch(() => {
        // Ignore initial history load error
      });
    return () => {
      active = false;
    };
  }, [api]);

  const effectiveNiche = customNiche.trim() || niche;

  const buildConfig = (): TrendSearchConfig => ({
    niche: effectiveNiche,
    ...(subniche.trim() ? { subniche: subniche.trim() } : {}),
    country: country.trim() || 'BR',
    language: language.trim() || 'pt-BR',
    period,
    format,
    ideaCount: Math.max(1, Math.min(10, ideaCount || 5)),
    targetDurationMin: Math.max(1, Math.min(60, durationMin || 10)),
  });

  const handleSearch = async (opts?: { appendMore?: boolean; refresh?: boolean }) => {
    if (!api.trendRadarSearch) return;
    setLoadingSearch(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const session = await api.trendRadarSearch({
        config: buildConfig(),
        ...((opts?.appendMore || opts?.refresh) && activeSession?.sessionId
          ? { sessionId: activeSession.sessionId }
          : {}),
        ...(opts?.appendMore ? { appendMore: true } : {}),
        ...(opts?.refresh ? { refresh: true } : {}),
      });
      setActiveSession(session);
      setSessions((prev) => [session, ...prev.filter((s) => s.sessionId !== session.sessionId)]);
      if (!opts?.appendMore) {
        setSelectedIdeaId(session.ideas[0]?.ideaId ?? null);
      }
      setStatusMessage(
        `${session.ideas.length} ideias carregadas com ${session.sources.length} fonte(s) verificada(s).`,
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingSearch(false);
    }
  };

  const handleSelectIdea = async (ideaId: string, alternativeApproach = false) => {
    setSelectedIdeaId(ideaId);
    if (!activeSession || !api.trendRadarGenerateBriefing) return;
    setLoadingBriefing(true);
    setErrorMessage(null);
    try {
      const briefing = await api.trendRadarGenerateBriefing({
        sessionId: activeSession.sessionId,
        ideaId,
        alternativeApproach,
      });
      const nextSession: TrendSearchSession = {
        ...activeSession,
        selectedIdeaId: ideaId,
        briefings: { ...activeSession.briefings, [ideaId]: briefing },
      };
      setActiveSession(nextSession);
      setSessions((prev) => prev.map((s) => (s.sessionId === nextSession.sessionId ? nextSession : s)));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingBriefing(false);
    }
  };

  const handleUpdateBriefingField = async (
    field: keyof CinematicBriefing,
    value: string,
  ) => {
    if (!activeSession || !selectedIdeaId) return;
    const current = activeSession.briefings[selectedIdeaId];
    if (!current) return;
    const updated: CinematicBriefing = { ...current, [field]: value };
    setActiveSession({
      ...activeSession,
      briefings: {
        ...activeSession.briefings,
        [selectedIdeaId]: updated,
      },
    });
    if (api.trendRadarRefineBriefing) {
      try {
        await api.trendRadarRefineBriefing({
          sessionId: activeSession.sessionId,
          ideaId: selectedIdeaId,
          instruction: 'Edição manual do usuário',
          updatedFields: { [field]: value },
        });
      } catch {
        // Local optimistic update remains
      }
    }
  };

  const handleRefineBriefing = async () => {
    if (!activeSession || !selectedIdeaId || !api.trendRadarRefineBriefing) return;
    const instruction = refineInstruction.trim() || 'Aprofundar gancho inicial e ritmo visual';
    setLoadingBriefing(true);
    setErrorMessage(null);
    try {
      const briefing = await api.trendRadarRefineBriefing({
        sessionId: activeSession.sessionId,
        ideaId: selectedIdeaId,
        instruction,
      });
      const nextSession: TrendSearchSession = {
        ...activeSession,
        briefings: { ...activeSession.briefings, [selectedIdeaId]: briefing },
      };
      setActiveSession(nextSession);
      setSessions((prev) => prev.map((s) => (s.sessionId === nextSession.sessionId ? nextSession : s)));
      setRefineInstruction('');
      setStatusMessage('Briefing cinematográfico refinado com os diretores RF-07.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingBriefing(false);
    }
  };

  const selectedIdea =
    activeSession?.ideas.find((idea) => idea.ideaId === selectedIdeaId) ?? null;
  const selectedBriefing =
    selectedIdea && activeSession
      ? activeSession.briefings[selectedIdea.ideaId] ?? null
      : null;

  const handleUseIdea = () => {
    if (!selectedIdea || !selectedBriefing) return;
    const promptText = formatBriefingToProductionPrompt(selectedIdea, selectedBriefing);
    onApplyIdea({
      promptText,
      genre: selectedBriefing.recommendedGenre,
      format: selectedBriefing.recommendedFormat,
      durationMin: selectedBriefing.recommendedDurationMin || selectedIdea.suggestedDurationMin || durationMin || 10,
      humorIntensity: selectedBriefing.recommendedHumorIntensity ?? 35,
    });
    setStatusMessage(
      'Briefing preenchido abaixo em "Direção Criativa / Briefing". Revise e clique em "Gerar Direção & Storyboard" quando quiser iniciar.',
    );
  };

  return (
    <section
      className="rounded-xl border border-[#2a2342] bg-[#0e0b18]/90 p-4 space-y-4"
      data-testid="trend-radar-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 text-left group"
          aria-expanded={expanded}
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[#2d2647] bg-[#161124] text-xs text-purple-300 group-hover:border-purple-500/60">
            {expanded ? '▾' : '▸'}
          </span>
          <div>
            <span className="block text-[11px] uppercase tracking-wider text-purple-300 font-semibold">
              Pesquisa Inteligente &amp; Pauta
            </span>
            <h3 className="text-base font-semibold text-white">
              Radar de Tendências e Ideias com IA
            </h3>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {sessions.length > 0 && (
            <select
              aria-label="Histórico de pesquisas de tendências"
              value={activeSession?.sessionId ?? ''}
              onChange={(e) => {
                const found = sessions.find((s) => s.sessionId === e.target.value);
                if (found) {
                  setActiveSession(found);
                  setSelectedIdeaId(found.selectedIdeaId ?? found.ideas[0]?.ideaId ?? null);
                }
              }}
              className="rounded-lg border border-[#2d2647] bg-[#161124] px-2.5 py-1.5 text-xs text-slate-200"
            >
              {sessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.config.niche}
                  {s.config.subniche ? ` / ${s.config.subniche}` : ''} ({PERIOD_LABELS[s.config.period]}) ·{' '}
                  {s.ideas.length} ideias
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg border border-[#2d2647] bg-[#161124] px-3 py-1.5 text-xs text-slate-300 hover:text-white"
          >
            {expanded ? 'Recolher Radar' : 'Expandir Radar'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4">
          {/* Nichos sugeridos + livre */}
          <div className="space-y-2">
            <label className="block text-xs text-slate-300 font-medium">
              Nicho (escolha uma sugestão ou digite livremente)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TREND_RADAR_PRESET_NICHES.map((item) => {
                const active = !customNiche.trim() && niche === item;
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setNiche(item);
                      setCustomNiche('');
                    }}
                    className={`rounded-full px-3 py-1 text-xs transition ${
                      active
                        ? 'bg-purple-600 text-white'
                        : 'border border-[#2d2647] bg-[#161124] text-slate-300 hover:border-purple-500/60'
                    }`}
                  >
                    {item}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
              <input
                type="text"
                value={customNiche}
                onChange={(e) => setCustomNiche(e.target.value)}
                placeholder="Ou digite qualquer nicho personalizado (ex: Aviação Militar, Culinária Coreana...)"
                className="rounded-lg border border-[#2d2647] bg-[#140f22] px-3 py-2 text-xs text-white placeholder-slate-500"
              />
              <input
                type="text"
                value={subniche}
                onChange={(e) => setSubniche(e.target.value)}
                placeholder="Subnicho ou assunto específico (opcional)"
                className="rounded-lg border border-[#2d2647] bg-[#140f22] px-3 py-2 text-xs text-white placeholder-slate-500"
              />
            </div>
          </div>

          {/* Configuração da pesquisa */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">País</label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Idioma</label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Período</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as TrendPeriod)}
                className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2.5 py-1.5 text-xs text-white"
              >
                {(Object.keys(PERIOD_LABELS) as TrendPeriod[]).map((p) => (
                  <option key={p} value={p}>
                    {PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Formato</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as TrendFormat)}
                className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2.5 py-1.5 text-xs text-white"
              >
                {(Object.keys(FORMAT_LABELS) as TrendFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Qtd. Ideias</label>
              <input
                type="number"
                min={1}
                max={10}
                value={ideaCount}
                onChange={(e) => setIdeaCount(Number(e.target.value) || 5)}
                className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2.5 py-1.5 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">Duração (min)</label>
              <input
                type="number"
                min={1}
                max={60}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value) || 10)}
                className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2.5 py-1.5 text-xs text-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={loadingSearch}
              onClick={() => void handleSearch()}
              className="rounded-lg bg-gradient-to-r from-purple-600 to-amber-500 px-4 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              {loadingSearch ? 'Pesquisando fontes reais...' : 'Pesquisar tendências'}
            </button>
            {activeSession && (
              <>
                <button
                  type="button"
                  disabled={loadingSearch}
                  onClick={() => void handleSearch({ refresh: true })}
                  className="rounded-lg border border-[#2d2647] bg-[#161124] px-3 py-2 text-xs text-slate-200 hover:border-purple-500/60 disabled:opacity-50"
                >
                  Atualizar tendências
                </button>
                <button
                  type="button"
                  disabled={loadingSearch}
                  onClick={() => void handleSearch({ appendMore: true })}
                  className="rounded-lg border border-[#2d2647] bg-[#161124] px-3 py-2 text-xs text-slate-200 hover:border-purple-500/60 disabled:opacity-50"
                >
                  Pesquisar mais
                </button>
              </>
            )}
          </div>

          {statusMessage && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
              {statusMessage}
            </div>
          )}
          {errorMessage && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
              {errorMessage}
            </div>
          )}
          {activeSession && activeSession.providerWarnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-950/25 px-3 py-2 text-[11px] text-amber-200 space-y-0.5">
              {activeSession.providerWarnings.map((warn, idx) => (
                <div key={idx}>{warn}</div>
              ))}
            </div>
          )}

          {/* Lista de ideias + Briefing */}
          {activeSession && activeSession.ideas.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-5 space-y-2 max-h-[520px] overflow-y-auto pr-1">
                {activeSession.ideas.map((idea) => {
                  const selected = idea.ideaId === selectedIdeaId;
                  return (
                    <button
                      key={idea.ideaId}
                      type="button"
                      onClick={() => void handleSelectIdea(idea.ideaId)}
                      className={`w-full text-left rounded-xl border p-3 transition space-y-1.5 ${
                        selected
                          ? 'border-purple-500 bg-[#1a1330]'
                          : 'border-[#28213e] bg-[#120e1f] hover:border-purple-500/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-white leading-snug">
                          {idea.title}
                        </span>
                        <span className="shrink-0 rounded bg-purple-900/60 px-2 py-0.5 text-[10px] text-purple-200">
                          {FORMAT_LABELS[idea.format]} · {idea.suggestedDurationMin}m
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 line-clamp-2">{idea.summary}</p>
                      <div className="text-[11px] text-amber-200/90">
                        <span className="font-medium">Por que agora:</span> {idea.whyNow}
                      </div>
                      <div className="flex flex-wrap gap-2 text-[10px] text-slate-400 pt-0.5">
                        <span>Fontes: {idea.evidences.length}</span>
                        <span>Concorrência: {idea.competitionLevel}</span>
                        <span>Tom: {idea.narrativeTone}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="lg:col-span-7 rounded-xl border border-[#28213e] bg-[#120e1f] p-3.5 space-y-3 max-h-[520px] overflow-y-auto">
                {!selectedIdea && (
                  <p className="text-xs text-slate-400">
                    Selecione uma ideia ao lado para inspecionar fontes, parecer dos diretores e gerar o briefing cinematográfico editável.
                  </p>
                )}

                {selectedIdea && (
                  <>
                    <div className="space-y-1">
                      <div className="text-xs text-purple-300 font-medium">
                        {selectedIdea.niche} · {FORMAT_LABELS[selectedIdea.format]} ·{' '}
                        {selectedIdea.suggestedDurationMin} min
                      </div>
                      <h4 className="text-sm font-semibold text-white">{selectedIdea.title}</h4>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-300">
                      <div className="rounded-lg bg-[#171226] p-2">
                        <span className="font-semibold text-slate-200">Potencial de interesse:</span>{' '}
                        {selectedIdea.interestPotential}
                      </div>
                      <div className="rounded-lg bg-[#171226] p-2">
                        <span className="font-semibold text-slate-200">Diferencial editorial:</span>{' '}
                        {selectedIdea.editorialDifferentiator}
                      </div>
                      <div className="rounded-lg bg-[#171226] p-2">
                        <span className="font-semibold text-slate-200">Mídias disponíveis:</span>{' '}
                        {selectedIdea.mediaAvailability}
                      </div>
                      <div className="rounded-lg bg-[#171226] p-2">
                        <span className="font-semibold text-slate-200">Dificuldades de produção:</span>{' '}
                        {selectedIdea.productionChallenges.join('; ')}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold text-slate-200">
                        Evidências e fontes verificadas ({selectedIdea.evidences.length})
                      </div>
                      {selectedIdea.evidences.length === 0 ? (
                        <div className="text-[11px] text-amber-300">
                          Nenhuma fonte externa verificada foi encontrada para esta ideia neste período.
                        </div>
                      ) : (
                        <ul className="space-y-1 text-[11px]">
                          {selectedIdea.evidences.map((src, idx) => (
                            <li key={`${src.url}_${idx}`} className="text-slate-300">
                              <span className="text-purple-300">[{src.source}]</span>{' '}
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline hover:text-white"
                              >
                                {src.title}
                              </a>{' '}
                              {src.publishedAt && (
                                <span className="text-slate-400">
                                  ({new Date(src.publishedAt).toLocaleDateString('pt-BR')})
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {loadingBriefing && (
                      <div className="text-xs text-purple-300">
                        Gerando briefing cinematográfico com os diretores RF-07...
                      </div>
                    )}

                    {selectedBriefing && (
                      <div className="space-y-2.5 border-t border-[#28213e] pt-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-white">
                            Briefing Cinematográfico Automático (Editável)
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleSelectIdea(selectedIdea.ideaId, true)}
                              className="rounded-lg border border-[#2d2647] bg-[#161124] px-2.5 py-1 text-[11px] text-slate-200 hover:border-purple-500/60"
                            >
                              Gerar outra abordagem
                            </button>
                            <button
                              type="button"
                              onClick={handleUseIdea}
                              className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                            >
                              Usar esta ideia
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              Objetivo do vídeo
                            </label>
                            <textarea
                              rows={2}
                              value={selectedBriefing.objective}
                              onChange={(e) =>
                                void handleUpdateBriefingField('objective', e.target.value)
                              }
                              className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              Público-alvo
                            </label>
                            <textarea
                              rows={2}
                              value={selectedBriefing.targetAudience}
                              onChange={(e) =>
                                void handleUpdateBriefingField('targetAudience', e.target.value)
                              }
                              className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              Gancho de abertura
                            </label>
                            <textarea
                              rows={2}
                              value={selectedBriefing.openingHook}
                              onChange={(e) =>
                                void handleUpdateBriefingField('openingHook', e.target.value)
                              }
                              className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              Estrutura narrativa
                            </label>
                            <textarea
                              rows={2}
                              value={selectedBriefing.narrativeStructure}
                              onChange={(e) =>
                                void handleUpdateBriefingField('narrativeStructure', e.target.value)
                              }
                              className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              Estilo de edição
                            </label>
                            <input
                              type="text"
                              value={selectedBriefing.editingStyle}
                              onChange={(e) =>
                                void handleUpdateBriefingField('editingStyle', e.target.value)
                              }
                              className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              Narração e música
                            </label>
                            <input
                              type="text"
                              value={selectedBriefing.narrationAndMusic}
                              onChange={(e) =>
                                void handleUpdateBriefingField('narrationAndMusic', e.target.value)
                              }
                              className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              SFX, VFX e motion graphics
                            </label>
                            <input
                              type="text"
                              value={selectedBriefing.sfxVfxMotion}
                              onChange={(e) =>
                                void handleUpdateBriefingField('sfxVfxMotion', e.target.value)
                              }
                              className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-slate-400 mb-0.5">
                              Humor contextual & Duração/Formato
                            </label>
                            <input
                              type="text"
                              value={`${selectedBriefing.contextualHumor} | ${selectedBriefing.durationAndFormat}`}
                              onChange={(e) =>
                                void handleUpdateBriefingField('contextualHumor', e.target.value)
                              }
                              className="w-full rounded-lg border border-[#2d2647] bg-[#140f22] px-2 py-1.5 text-[11px] text-white"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <input
                            type="text"
                            value={refineInstruction}
                            onChange={(e) => setRefineInstruction(e.target.value)}
                            placeholder="Instrução para refinar o briefing (ex: foco em bastidores, mais ritmo)"
                            className="flex-1 min-w-[220px] rounded-lg border border-[#2d2647] bg-[#140f22] px-2.5 py-1.5 text-xs text-white placeholder-slate-500"
                          />
                          <button
                            type="button"
                            disabled={loadingBriefing}
                            onClick={() => void handleRefineBriefing()}
                            className="rounded-lg border border-purple-500/60 bg-purple-900/30 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-900/50 disabled:opacity-50"
                          >
                            Refinar briefing
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

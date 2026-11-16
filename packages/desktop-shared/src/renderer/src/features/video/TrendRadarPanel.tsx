import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/utils';

import {
  FORMAT_LABELS,
  PERIOD_LABELS,
  TREND_RADAR_PRESET_NICHES,
  formatBriefingToProductionPrompt,
  formatIsoDates,
  type AppliedTrendIdeaPayload,
  type BriefingTextField,
  type CinematicBriefing,
  type TrendFormat,
  type TrendPeriod,
  type TrendRadarBridgeApi,
  type TrendSearchConfig,
  type TrendSearchSession,
} from './trend-radar-model';

export * from './trend-radar-model';

interface TrendRadarPanelProps {
  api: TrendRadarBridgeApi;
  onApplyIdea: (payload: AppliedTrendIdeaPayload) => void;
  /** Opens the radar already expanded (used inside the "Pesquisar novas ideias" dialog). */
  defaultExpanded?: boolean;
}

export const TrendRadarPanel: React.FC<TrendRadarPanelProps> = ({ api, onApplyIdea, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [niche, setNiche] = useState<string>('Games');
  const [customNiche, setCustomNiche] = useState<string>('');
  const [subniche, setSubniche] = useState<string>('');
  const [country, setCountry] = useState<string>('BR');
  const [language, setLanguage] = useState<string>('pt-BR');
  const [period, setPeriod] = useState<TrendPeriod>('7d');
  const [format, setFormat] = useState<TrendFormat>('auto');
  const [ideaCount, setIdeaCount] = useState<number>(5);
  const [durationMin, setDurationMin] = useState<number>(10);
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const searchResultsCount = activeSession?.ideas.length ?? 0;
  const filtersSummary = `${country.trim() || 'BR'} · ${language.trim() || 'pt-BR'} · ${ideaCount} ideias · ${durationMin} min`;

  const briefingFields: { key: BriefingTextField; label: string; rows: number }[] = [
    { key: 'objective', label: 'Objetivo do vídeo', rows: 2 },
    { key: 'targetAudience', label: 'Público-alvo', rows: 2 },
    { key: 'openingHook', label: 'Gancho de abertura', rows: 2 },
    { key: 'narrativeStructure', label: 'Estrutura narrativa', rows: 2 },
    { key: 'editingStyle', label: 'Estilo de edição', rows: 2 },
    { key: 'narrationAndMusic', label: 'Narração e música', rows: 2 },
    { key: 'sfxVfxMotion', label: 'SFX, VFX e motion graphics', rows: 2 },
    { key: 'contextualHumor', label: 'Humor contextual', rows: 2 },
    { key: 'durationAndFormat', label: 'Duração e formato', rows: 1 },
  ];

  return (
    <section className="flex flex-col gap-5 text-foreground" data-testid="trend-radar-panel" aria-label="Radar de tendências">
      {!defaultExpanded && (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Pesquisa inteligente e pauta</p>
            <h3 className="text-base font-semibold tracking-tight">Radar de Tendências e Ideias com IA</h3>
          </div>
          <Button type="button" variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            <ChevronDown className={cn('transition-transform motion-reduce:transition-none', expanded && 'rotate-180')} aria-hidden />
            {expanded ? 'Recolher Radar' : 'Expandir Radar'}
          </Button>
        </div>
      )}

      {expanded && (
        <>
          {/* 1. O que pesquisar */}
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[13px] font-medium">Nicho</legend>
              <div className="flex flex-wrap gap-1.5">
                {TREND_RADAR_PRESET_NICHES.map((item) => {
                  const active = !customNiche.trim() && niche === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setNiche(item);
                        setCustomNiche('');
                      }}
                      className={cn(
                        'h-8 cursor-pointer rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-transparent text-muted-foreground hover:border-primary/50 hover:text-foreground',
                      )}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 gap-3 pt-1 md:grid-cols-2">
                <Input
                  aria-label="Nicho personalizado"
                  value={customNiche}
                  onChange={(e) => setCustomNiche(e.target.value)}
                  placeholder="Outro nicho (ex.: Aviação Militar, Culinária Coreana)"
                />
                <Input
                  aria-label="Subnicho ou assunto específico"
                  value={subniche}
                  onChange={(e) => setSubniche(e.target.value)}
                  placeholder="Subnicho ou assunto específico (opcional)"
                />
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <Field label="Período" htmlFor="trend-period">
                <Select id="trend-period" value={period} onChange={(e) => setPeriod(e.target.value as TrendPeriod)}>
                  {(Object.keys(PERIOD_LABELS) as TrendPeriod[]).map((p) => (
                    <option key={p} value={p}>
                      {PERIOD_LABELS[p]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Formato" htmlFor="trend-format">
                <Select id="trend-format" value={format} onChange={(e) => setFormat(e.target.value as TrendFormat)}>
                  {(Object.keys(FORMAT_LABELS) as TrendFormat[]).map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_LABELS[f]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                type="button"
                className="sm:col-span-2 lg:col-span-1"
                disabled={loadingSearch}
                onClick={() => void handleSearch()}
              >
                {loadingSearch ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden /> : <Search aria-hidden />}
                {loadingSearch ? 'Pesquisando fontes reais...' : 'Pesquisar tendências'}
              </Button>
            </div>

            <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex cursor-pointer items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <SlidersHorizontal className="size-3.5" aria-hidden />
                  Mais filtros
                  <span className="text-muted-foreground/80">· {filtersSummary}</span>
                  <ChevronDown className={cn('size-3.5 transition-transform motion-reduce:transition-none', filtersOpen && 'rotate-180')} aria-hidden />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 md:grid-cols-4">
                <Field label="País" htmlFor="trend-country">
                  <Input id="trend-country" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} />
                </Field>
                <Field label="Idioma" htmlFor="trend-language">
                  <Input id="trend-language" value={language} onChange={(e) => setLanguage(e.target.value)} />
                </Field>
                <Field label="Qtd. de ideias" htmlFor="trend-idea-count">
                  <Input
                    id="trend-idea-count"
                    type="number"
                    min={1}
                    max={10}
                    value={ideaCount}
                    onChange={(e) => setIdeaCount(Number(e.target.value) || 5)}
                  />
                </Field>
                <Field label="Duração (min)" htmlFor="trend-duration">
                  <Input
                    id="trend-duration"
                    type="number"
                    min={1}
                    max={60}
                    value={durationMin}
                    onChange={(e) => setDurationMin(Number(e.target.value) || 10)}
                  />
                </Field>
              </CollapsibleContent>
            </Collapsible>
          </div>

          {/* Feedback */}
          <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
            {errorMessage && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
            {statusMessage && !errorMessage && (
              <Alert>
                <CheckCircle2 className="text-success" aria-hidden />
                <AlertDescription>{statusMessage}</AlertDescription>
              </Alert>
            )}
            {activeSession && activeSession.providerWarnings.length > 0 && (
              <Alert variant="warning">
                <AlertTriangle aria-hidden />
                <AlertDescription>
                  {activeSession.providerWarnings.map((warn, idx) => (
                    <p key={idx}>{warn}</p>
                  ))}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* 2. Resultados */}
          {!activeSession && !loadingSearch && (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Escolha um nicho e clique em <span className="font-medium text-foreground">Pesquisar tendências</span>. As ideias
              aparecem aqui com fontes reais e um briefing pronto para editar.
            </p>
          )}
          {activeSession && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold tracking-tight">Ideias encontradas</h3>
                  <Badge variant="muted">{searchResultsCount}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {sessions.length > 1 && (
                    <Select
                      aria-label="Histórico de pesquisas de tendências"
                      className="h-8 w-auto max-w-[260px] text-xs"
                      value={activeSession.sessionId}
                      onChange={(e) => {
                        const found = sessions.find((s) => s.sessionId === e.target.value);
                        if (found) {
                          setActiveSession(found);
                          setSelectedIdeaId(found.selectedIdeaId ?? found.ideas[0]?.ideaId ?? null);
                        }
                      }}
                    >
                      {sessions.map((s) => (
                        <option key={s.sessionId} value={s.sessionId}>
                          {s.config.niche}
                          {s.config.subniche ? ` / ${s.config.subniche}` : ''} ({PERIOD_LABELS[s.config.period]}) · {s.ideas.length} ideias
                        </option>
                      ))}
                    </Select>
                  )}
                  <Button type="button" variant="ghost" size="sm" disabled={loadingSearch} onClick={() => void handleSearch({ refresh: true })}>
                    <RefreshCw aria-hidden /> Atualizar tendências
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={loadingSearch} onClick={() => void handleSearch({ appendMore: true })}>
                    <Plus aria-hidden /> Pesquisar mais
                  </Button>
                </div>
              </div>

              {activeSession.ideas.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Nenhuma ideia com fonte verificável neste período. Tente outro nicho ou um período maior.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                  <ul
                    aria-label="Ideias encontradas"
                    className="flex max-h-[min(60vh,640px)] flex-col gap-2 overflow-y-auto pr-1"
                  >
                    {activeSession.ideas.map((idea) => {
                      const selected = idea.ideaId === selectedIdeaId;
                      return (
                        <li key={idea.ideaId}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => void handleSelectIdea(idea.ideaId)}
                            className={cn(
                              'flex w-full cursor-pointer flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              selected ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40 hover:bg-muted/40',
                            )}
                          >
                            <span className="flex items-start justify-between gap-2">
                              <span className="line-clamp-2 text-sm font-medium leading-snug">{idea.title}</span>
                              <Badge variant={selected ? 'default' : 'secondary'} className="shrink-0">
                                {FORMAT_LABELS[idea.format]} · {idea.suggestedDurationMin} min
                              </Badge>
                            </span>
                            <span className="line-clamp-2 text-xs text-muted-foreground">{idea.summary}</span>
                            <span className="line-clamp-1 text-xs text-foreground/80">
                              <span className="font-medium text-primary">Por que agora:</span> {formatIsoDates(idea.whyNow)}
                            </span>
                            <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              <span>{idea.evidences.length} fonte(s)</span>
                              <span>Concorrência {idea.competitionLevel}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="relative max-h-[min(60vh,640px)] overflow-y-auto rounded-lg border border-border bg-card">
                    {!selectedIdea ? (
                      <p className="p-6 text-sm text-muted-foreground">
                        Selecione uma ideia para ver fontes, parecer dos diretores e o briefing cinematográfico editável.
                      </p>
                    ) : (
                      <>
                        <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-border bg-card/95 p-4 backdrop-blur">
                          <div className="flex flex-col gap-1">
                            <p className="text-xs text-muted-foreground">
                              {selectedIdea.niche} · {FORMAT_LABELS[selectedIdea.format]} · {selectedIdea.suggestedDurationMin} min · Tom{' '}
                              {selectedIdea.narrativeTone}
                            </p>
                            <h4 className="text-base font-semibold leading-snug tracking-tight">{selectedIdea.title}</h4>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" disabled={!selectedBriefing || loadingBriefing} onClick={handleUseIdea}>
                              <Sparkles aria-hidden /> Usar esta ideia
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={loadingBriefing}
                              onClick={() => void handleSelectIdea(selectedIdea.ideaId, true)}
                            >
                              <Shuffle aria-hidden /> Gerar outra abordagem
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-col gap-5 p-4">
                          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-2">
                            {[
                              ['Potencial de interesse', selectedIdea.interestPotential],
                              ['Diferencial editorial', selectedIdea.editorialDifferentiator],
                              ['Mídias disponíveis', selectedIdea.mediaAvailability],
                              ['Dificuldades de produção', selectedIdea.productionChallenges.join('; ')],
                            ].map(([term, value]) => (
                              <div key={term} className="flex flex-col gap-0.5">
                                <dt className="text-xs font-medium text-muted-foreground">{term}</dt>
                                <dd className="text-[13px] leading-relaxed text-foreground/90">{value}</dd>
                              </div>
                            ))}
                          </dl>

                          <div className="flex flex-col gap-2">
                            <h5 className="text-xs font-medium text-muted-foreground">
                              Fontes verificadas ({selectedIdea.evidences.length})
                            </h5>
                            {selectedIdea.evidences.length === 0 ? (
                              <p className="text-[13px] text-warning">
                                Nenhuma fonte externa verificada foi encontrada para esta ideia neste período.
                              </p>
                            ) : (
                              <ul className="flex flex-col gap-2">
                                {selectedIdea.evidences.map((src, idx) => (
                                  <li key={`${src.url}_${idx}`} className="flex items-start gap-2 text-[13px]">
                                    <Badge variant="outline" className="mt-0.5 shrink-0">
                                      {src.source}
                                    </Badge>
                                    <span className="min-w-0">
                                      <a
                                        href={src.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-foreground underline-offset-4 hover:text-primary hover:underline"
                                      >
                                        {src.title}
                                        <ExternalLink className="ml-1 inline size-3 align-baseline" aria-hidden />
                                        <span className="sr-only"> (abre em nova janela)</span>
                                      </a>
                                      {src.publishedAt && (
                                        <span className="ml-1.5 text-xs text-muted-foreground">
                                          {new Date(src.publishedAt).toLocaleDateString('pt-BR')}
                                        </span>
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {loadingBriefing && (
                            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
                              <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
                              Gerando briefing cinematográfico com os diretores RF-07...
                            </p>
                          )}

                          {selectedBriefing && (
                            <div className="flex flex-col gap-3 border-t border-border pt-4">
                              <div>
                                <h5 className="text-sm font-semibold tracking-tight">Briefing cinematográfico</h5>
                                <p className="text-xs text-muted-foreground">Gerado automaticamente. Edite antes de usar a ideia.</p>
                              </div>
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                {briefingFields.map(({ key, label, rows }) => (
                                  <Field key={key} label={label} htmlFor={`trend-briefing-${key}`}>
                                    <Textarea
                                      id={`trend-briefing-${key}`}
                                      rows={rows}
                                      className="text-[13px]"
                                      value={selectedBriefing[key]}
                                      onChange={(e) => void handleUpdateBriefingField(key, e.target.value)}
                                    />
                                  </Field>
                                ))}
                              </div>
                              <div className="flex flex-wrap items-end gap-2 pt-1">
                                <div className="min-w-[220px] flex-1">
                                  <Field label="Refinar com a IA" htmlFor="trend-refine">
                                    <Input
                                      id="trend-refine"
                                      value={refineInstruction}
                                      onChange={(e) => setRefineInstruction(e.target.value)}
                                      placeholder="Ex.: foco em bastidores, mais ritmo"
                                    />
                                  </Field>
                                </div>
                                <Button type="button" variant="secondary" disabled={loadingBriefing} onClick={() => void handleRefineBriefing()}>
                                  <Wand2 aria-hidden /> Refinar briefing
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
};

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AetheraEvolutionCore, CinemaGenre, DeliveryFormat } from '@neuralbridge/cinema';

export const PRESET_NICHES = [
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
export type TrendFormat = 'top_10' | 'documentary' | 'analysis' | 'news' | 'curiosities' | 'auto';

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
  recommendedGenre: CinemaGenre;
  recommendedFormat: DeliveryFormat;
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

export interface TrendRadarConnectors {
  searchYouTube?: (query: string, config: TrendSearchConfig) => Promise<TrendEvidenceSource[]>;
  searchNews?: (query: string, config: TrendSearchConfig) => Promise<TrendEvidenceSource[]>;
  searchReddit?: (query: string, config: TrendSearchConfig) => Promise<TrendEvidenceSource[]>;
  searchTrends?: (query: string, config: TrendSearchConfig) => Promise<TrendEvidenceSource[]>;
  synthesizeWithRF07?: (input: {
    prompt: string;
    config: TrendSearchConfig;
    sources: TrendEvidenceSource[];
    excludeTitles: string[];
    memories: string[];
  }) => Promise<TrendIdea[] | null>;
  refineBriefingWithRF07?: (input: {
    idea: TrendIdea;
    briefing: CinematicBriefing;
    instruction: string;
  }) => Promise<Partial<CinematicBriefing> | null>;
}

const PERIOD_MAX_AGE_MS: Record<TrendPeriod, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export function isWithinPeriod(publishedAt: string, period: TrendPeriod, nowMs = Date.now()): boolean {
  if (!publishedAt) return true;
  const parsed = Date.parse(publishedAt);
  if (Number.isNaN(parsed)) return true;
  return nowMs - parsed <= PERIOD_MAX_AGE_MS[period];
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isDuplicateIdeaTitle(candidate: string, existingTitles: string[]): boolean {
  const key = normalizeTitleKey(candidate);
  if (!key) return false;
  return existingTitles.some((existing) => normalizeTitleKey(existing) === key);
}

function mapFormatToGenre(format: TrendFormat, niche: string): CinemaGenre {
  if (format === 'top_10') return 'top_list';
  if (format === 'documentary') return 'documentary';
  if (format === 'analysis' && /game/i.test(niche)) return 'gameplay_essay';
  if (/game/i.test(niche)) return 'gameplay_essay';
  return 'documentary';
}

function formatLabelPt(format: TrendFormat): string {
  switch (format) {
    case 'top_10':
      return 'TOP 10';
    case 'documentary':
      return 'Documentário';
    case 'analysis':
      return 'Análise';
    case 'news':
      return 'Notícias';
    case 'curiosities':
      return 'Curiosidades';
    default:
      return 'Automático IA';
  }
}

export class TrendRadarEngine {
  private readonly storePath: string;

  constructor(
    private readonly storageDir: string,
    private readonly evolutionCore: AetheraEvolutionCore,
    private readonly connectors: TrendRadarConnectors = {},
  ) {
    mkdirSync(storageDir, { recursive: true });
    this.storePath = join(storageDir, 'trend-radar-history.json');
  }

  private loadSessions(): TrendSearchSession[] {
    if (!existsSync(this.storePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.storePath, 'utf8')) as { sessions?: TrendSearchSession[] };
      return Array.isArray(parsed.sessions) ? parsed.sessions : [];
    } catch {
      return [];
    }
  }

  private saveSessions(sessions: TrendSearchSession[]): void {
    mkdirSync(this.storageDir, { recursive: true });
    writeFileSync(this.storePath, JSON.stringify({ version: 1, sessions: sessions.slice(0, 30) }, null, 2), 'utf8');
  }

  listSessions(): TrendSearchSession[] {
    return this.loadSessions();
  }

  getSession(sessionId: string): TrendSearchSession | null {
    return this.loadSessions().find((s) => s.sessionId === sessionId) ?? null;
  }

  async searchTrends(
    rawConfig: Partial<TrendSearchConfig>,
    options?: { excludeTitles?: string[]; appendToSessionId?: string },
  ): Promise<TrendSearchSession> {
    const niche = (rawConfig.niche ?? '').trim() || 'Curiosidades';
    const config: TrendSearchConfig = {
      niche,
      ...(rawConfig.subniche?.trim() ? { subniche: rawConfig.subniche.trim() } : {}),
      country: rawConfig.country?.trim() || 'BR',
      language: rawConfig.language?.trim() || 'pt-BR',
      period: rawConfig.period ?? '7d',
      format: rawConfig.format ?? 'auto',
      ideaCount: Math.min(10, Math.max(1, Number(rawConfig.ideaCount) || 5)),
      targetDurationMin: Math.min(60, Math.max(1, Number(rawConfig.targetDurationMin) || 12)),
    };

    const query = [config.niche, config.subniche].filter(Boolean).join(' ').trim();
    const providerWarnings: string[] = [];
    const collected: TrendEvidenceSource[] = [];

    const runProvider = async (
      name: string,
      fn?: (q: string, cfg: TrendSearchConfig) => Promise<TrendEvidenceSource[]>,
    ) => {
      if (!fn) return;
      try {
        const res = await fn(query, config);
        for (const item of res) {
          if (!item.url || !item.title) continue;
          if (!isWithinPeriod(item.publishedAt, config.period)) continue;
          if (!collected.some((c) => c.url === item.url)) {
            collected.push(item);
          }
        }
      } catch (err) {
        providerWarnings.push(
          `Falha no provedor ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    await Promise.all([
      runProvider('YouTube', this.connectors.searchYouTube),
      runProvider('Notícias', this.connectors.searchNews),
      runProvider('Reddit', this.connectors.searchReddit),
      runProvider('Tendências', this.connectors.searchTrends),
    ]);

    const historySessions = this.loadSessions();
    const historicalTitles = [
      ...(options?.excludeTitles ?? []),
      ...historySessions.flatMap((s) => s.ideas.map((i) => i.title)),
    ];

    const noSourcesFound = collected.length === 0;
    let ideas: TrendIdea[] = [];

    if (!noSourcesFound) {
      const memories = this.evolutionCore
        .retrieveRelevantMemories({ text: query })
        .map((m) => m.content);

      if (this.connectors.synthesizeWithRF07) {
        try {
          const rfIdeas = await this.connectors.synthesizeWithRF07({
            prompt: query,
            config,
            sources: collected,
            excludeTitles: historicalTitles,
            memories,
          });
          if (Array.isArray(rfIdeas) && rfIdeas.length > 0) {
            ideas = rfIdeas.filter((i) => !isDuplicateIdeaTitle(i.title, historicalTitles));
          }
        } catch (err) {
          providerWarnings.push(
            `Fallback determinístico RF-07 ativado: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (ideas.length === 0) {
        ideas = this.buildGroundedIdeasFromSources(config, collected, historicalTitles);
      }
    }

    const searchedAt = new Date().toISOString();
    if (options?.appendToSessionId) {
      const existingIdx = historySessions.findIndex((s) => s.sessionId === options.appendToSessionId);
      if (existingIdx >= 0) {
        const prev = historySessions[existingIdx];
        if (prev) {
          const mergedIdeas = [
            ...prev.ideas,
            ...ideas.filter((n) => !isDuplicateIdeaTitle(n.title, prev.ideas.map((o) => o.title))),
          ];
          const updated: TrendSearchSession = {
            ...prev,
            config,
            searchedAt,
            sources: collected,
            providerWarnings,
            noSourcesFound,
            ideas: mergedIdeas,
          };
          historySessions[existingIdx] = updated;
          this.saveSessions(historySessions);
          return updated;
        }
      }
    }

    const session: TrendSearchSession = {
      sessionId: `radar_${randomUUID().slice(0, 8)}`,
      config,
      searchedAt,
      sources: collected,
      providerWarnings,
      noSourcesFound,
      ideas,
      briefings: {},
    };
    this.saveSessions([session, ...historySessions]);
    return session;
  }

  private buildGroundedIdeasFromSources(
    config: TrendSearchConfig,
    sources: TrendEvidenceSource[],
    excludeTitles: string[],
  ): TrendIdea[] {
    const out: TrendIdea[] = [];
    const formatsCycle: TrendFormat[] =
      config.format === 'auto'
        ? ['documentary', 'analysis', 'top_10', 'curiosities', 'news']
        : [config.format];

    const youtubeCount = sources.filter((s) => s.origin === 'youtube').length;
    const newsCount = sources.filter((s) => s.origin === 'news').length;
    const redditCount = sources.filter((s) => s.origin === 'reddit').length;

    const competitionLevel: TrendIdea['competitionLevel'] =
      youtubeCount >= 4 ? 'alto' : youtubeCount >= 2 ? 'moderado' : youtubeCount >= 1 ? 'baixo' : 'não verificável';

    for (let i = 0; i < config.ideaCount && i < Math.max(sources.length, config.ideaCount); i += 1) {
      const anchor = sources[i % sources.length];
      if (!anchor) continue;
      const relatedSources = [
        anchor,
        ...sources.filter((s) => s.url !== anchor.url).slice(0, 2),
      ];
      const chosenFormat = formatsCycle[i % formatsCycle.length] ?? 'documentary';
      const cleanAnchorTitle = anchor.title.replace(/\s*[-|•].*$/, '').trim();
      let candidateTitle =
        chosenFormat === 'top_10'
          ? `Top 10 fatos e destaques sobre ${cleanAnchorTitle}`
          : chosenFormat === 'news'
            ? `O que mudou agora em ${config.niche}: ${cleanAnchorTitle}`
            : chosenFormat === 'analysis'
              ? `Análise completa: ${cleanAnchorTitle} e o impacto em ${config.niche}`
              : chosenFormat === 'curiosities'
                ? `Curiosidades e bastidores pouco conhecidos: ${cleanAnchorTitle}`
                : `${cleanAnchorTitle}: a história e os fatos por trás do tema`;

      if (isDuplicateIdeaTitle(candidateTitle, [...excludeTitles, ...out.map((o) => o.title)])) {
        candidateTitle = `${candidateTitle} (Abordagem ${i + 1} · ${config.period})`;
      }

      out.push({
        ideaId: `idea_${randomUUID().slice(0, 8)}`,
        title: candidateTitle,
        niche: config.subniche ? `${config.niche} / ${config.subniche}` : config.niche,
        format: chosenFormat,
        summary: `Pauta baseada em ${relatedSources.length} fonte(s) real(is) coletada(s) no período de ${config.period}, explorando "${cleanAnchorTitle}" sob o recorte de ${config.niche}.`,
        whyNow: `Fonte publicada/indexada em ${anchor.publishedAt || 'data recente'} (${anchor.source}) com presença em ${newsCount} notícia(s), ${youtubeCount} vídeo(s) e ${redditCount} discussão(ões) de comunidade.`,
        evidences: relatedSources,
        interestPotential: `Interesse sustentado por cobertura simultânea verificada em ${relatedSources.map((r) => r.source).join(', ')} sem estimativas numéricas fictícias.`,
        competitionLevel,
        competitionNotes:
          youtubeCount > 0
            ? `${youtubeCount} vídeo(s) encontrado(s) na busca do YouTube para o tema.`
            : 'Não foi possível verificar volume de concorrentes no YouTube.',
        editorialDifferentiator: `Conectar os fatos verificados em ${anchor.source} com contexto histórico/técnico, decupagem cinematográfica e humor contextual equilibrado.`,
        mediaAvailability:
          youtubeCount > 0
            ? `${youtubeCount} referência(s) em vídeo localizadas no YouTube; recomenda-se validar direitos/uso editorial ou complementar com B-roll licenciado.`
            : 'Poucos vídeos diretos encontrados; será necessário B-roll complementar ou diagramas editoriais.',
        suggestedDurationMin: config.targetDurationMin,
        narrativeTone: chosenFormat === 'news' ? 'Ágil e investigativo' : 'Cinematográfico e analítico',
        productionChallenges: [
          'Verificar direitos autorais e uso justo dos trechos de terceiros.',
          'Manter ritmo consistente ao longo da duração planejada.',
        ],
        directorNotes: {
          researchMedia: `Validado com ${relatedSources.length} fonte(s) real(is) verificável(is).`,
          narrative: `Estruturar em gancho forte a partir de "${cleanAnchorTitle}" e progressão factual.`,
          generalDirector: `Diferencial focado em profundidade e clareza para o formato ${formatLabelPt(chosenFormat)}.`,
          comedy: 'Inserir ironia leve apenas nas transições que não comprometam fatos sérios.',
          editCinema: `Alternar ritmo de montagem e planos para sustentar ${config.targetDurationMin} minutos.`,
          quality: 'Todas as afirmações devem citar apenas os fatos presentes nas fontes coletadas.',
        },
      });
    }
    return out;
  }

  generateBriefing(
    sessionId: string,
    ideaId: string,
    options?: { approachVariant?: number },
  ): CinematicBriefing {
    const sessions = this.loadSessions();
    const sessionIdx = sessions.findIndex((s) => s.sessionId === sessionId);
    if (sessionIdx < 0) throw new Error('not_found: sessão de pesquisa não encontrada.');
    const session = sessions[sessionIdx];
    const idea = session?.ideas.find((i) => i.ideaId === ideaId);
    if (!session || !idea) throw new Error('not_found: ideia não encontrada na sessão.');

    const variant = options?.approachVariant ?? 1;
    const approachLabel =
      variant === 1
        ? 'Abordagem Principal (Cinematográfica)'
        : variant === 2
          ? 'Abordagem Investigativa (Ritmo Ágil)'
          : `Abordagem Alternativa #${variant}`;

    const refs = idea.evidences.map((e) => `${e.title} (${e.source}, ${e.publishedAt}) - ${e.url}`);
    const genre = mapFormatToGenre(idea.format, idea.niche);
    const durationMin = idea.suggestedDurationMin;
    const humor = idea.format === 'news' ? 15 : 35;

    const briefing: CinematicBriefing = {
      briefingId: `brief_${randomUUID().slice(0, 8)}`,
      ideaId: idea.ideaId,
      approachLabel,
      objective: `Produzir um vídeo no formato ${formatLabelPt(idea.format)} sobre "${idea.title}", entregando análise aprofundada e verificável para o nicho ${idea.niche}.`,
      targetAudience: `Público interessado em ${idea.niche} (${session.config.country} / ${session.config.language}) que busca profundidade e contexto atual.`,
      openingHook:
        variant === 2
          ? `Começar com a evidência mais recente (${idea.evidences[0]?.source ?? 'fonte verificada'}) nos primeiros 10 segundos antes de abrir o contexto.`
          : `Abrir com pergunta central provocativa ligada a "${idea.title}" e contraste visual imediato.`,
      narrativeStructure: `Abertura e gancho (${Math.max(1, Math.round(durationMin * 0.15))} min) -> Desenvolvimento em capítulos (${Math.max(2, Math.round(durationMin * 0.65))} min) -> Clímax e conclusão (${Math.max(1, Math.round(durationMin * 0.2))} min).`,
      factsAndTopics: idea.evidences.map((e) => `• ${e.title} (${e.source})`).join('\n'),
      verifiableReferences: refs,
      sceneProposal: `${idea.mediaAvailability} Alternar trechos contextuais com planos médios/fechados e quadros de apoio.`,
      editingStyle: variant === 2 ? 'Cortes dinâmicos, J-cuts frequentes e ritmo crescente.' : 'Montagem cinematográfica equilibrada com respiros visuais.',
      narrationAndMusic: `Narração em ${session.config.language}, tom ${idea.narrativeTone.toLowerCase()}, trilha de fundo com ducking automático (-9 dB sob voz, -14 LUFS).`,
      sfxVfxMotion: 'Whooshes sutis nas transições de capítulo, tipografia limpa em safe-zone e color grading Rec.709.',
      contextualHumor:
        humor > 0
          ? `Humor pontual (${humor}%) em observações leves sem distorcer os fatos das fontes.`
          : 'Sem humor; foco estritamente factual.',
      durationAndFormat: `${durationMin} minutos · YouTube 16:9 · ${formatLabelPt(idea.format)}`,
      compiledPrompt: [
        `Crie um vídeo cinematográfico sobre "${idea.title}" (${idea.niche}), com duração de ${durationMin} minutos.`,
        `Objetivo: ${idea.summary}`,
        `Diferencial: ${idea.editorialDifferentiator}`,
        `Referências verificadas: ${idea.evidences.map((e) => `${e.title} (${e.source})`).join('; ')}`,
      ].join(' '),
      recommendedGenre: genre,
      recommendedFormat: 'youtube_16_9',
      recommendedDurationMin: durationMin,
      recommendedHumorIntensity: humor,
      updatedAt: new Date().toISOString(),
    };

    session.briefings[idea.ideaId] = briefing;
    session.selectedIdeaId = idea.ideaId;
    sessions[sessionIdx] = session;
    this.saveSessions(sessions);
    return briefing;
  }

  async refineBriefing(
    sessionId: string,
    ideaId: string,
    instruction: string,
    updatedFields?: Partial<CinematicBriefing>,
  ): Promise<CinematicBriefing> {
    const sessions = this.loadSessions();
    const sessionIdx = sessions.findIndex((s) => s.sessionId === sessionId);
    if (sessionIdx < 0) throw new Error('not_found: sessão de pesquisa não encontrada.');
    const session = sessions[sessionIdx];
    const idea = session?.ideas.find((i) => i.ideaId === ideaId);
    if (!session || !idea) throw new Error('not_found: ideia não encontrada.');

    const current = session.briefings[ideaId] ?? this.generateBriefing(sessionId, ideaId);
    let aiPatch: Partial<CinematicBriefing> | null = null;
    if (instruction.trim() && this.connectors.refineBriefingWithRF07) {
      try {
        aiPatch = await this.connectors.refineBriefingWithRF07({
          idea,
          briefing: current,
          instruction,
        });
      } catch {
        aiPatch = null;
      }
    }

    const next: CinematicBriefing = {
      ...current,
      ...updatedFields,
      ...aiPatch,
      ...(instruction.trim() && !aiPatch
        ? {
            narrativeStructure: `${current.narrativeStructure}\n[Refino]: ${instruction.trim()}`,
            compiledPrompt: `${current.compiledPrompt} Ajuste solicitado: ${instruction.trim()}`,
          }
        : {}),
      updatedAt: new Date().toISOString(),
    };

    session.briefings[ideaId] = next;
    sessions[sessionIdx] = session;
    this.saveSessions(sessions);
    return next;
  }
}

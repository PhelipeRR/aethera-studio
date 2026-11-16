// Pure Trend Radar types and helpers (no UI imports), shared by the panel, the ideas column and node tests.

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

export const FORMAT_LABELS: Record<TrendFormat, string> = {
  auto: 'Automático da IA',
  top_10: 'TOP 10',
  documentary: 'Documentário',
  analysis: 'Análise',
  news: 'Notícias',
  curiosities: 'Curiosidades',
};

export const PERIOD_LABELS: Record<TrendPeriod, string> = {
  '24h': '24 horas',
  '7d': '7 dias',
  '30d': '30 dias',
  '90d': '90 dias',
};

export type BriefingTextField =
  | 'objective'
  | 'targetAudience'
  | 'openingHook'
  | 'narrativeStructure'
  | 'editingStyle'
  | 'narrationAndMusic'
  | 'sfxVfxMotion'
  | 'contextualHumor'
  | 'durationAndFormat';

/** Shows raw ISO timestamps coming from the sources (e.g. in "Por que agora") as pt-BR dates. */
export function formatIsoDates(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('pt-BR');
  });
}

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

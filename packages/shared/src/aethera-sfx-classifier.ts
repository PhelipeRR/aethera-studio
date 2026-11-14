import type { TimelineDocument } from './aethera-timeline.js';
import type { SfxEvent } from './aethera-audio.js';

/**
 * Catálogo de SFX disponíveis na biblioteca MotionVelix.
 * Classificados por função sonora para seleção contextual.
 */
export const SFX_CATALOG = {
  // Transições rápidas (whoosh/swish) — entradas, saídas, cortes
  transition: ['whoosh.wav', 'whoosh_grave.wav', 'whoosh_rapido.wav', 'swish_suave.wav', 'swish_reverso.wav', 'deslize.wav', 'deslize_reverso.wav'],
  // Impactos e ênfases — revelações, momentos dramáticos
  impact: ['boom.wav', 'impacto.wav', 'drop.wav', 'tac.wav'],
  // Tensão e suspense — risers, batimentos
  tension: ['riser.wav', 'batimento.wav', 'tempo_parando.wav'],
  // Interface e feedback — cliques, blips, confirmações
  interface: ['click.wav', 'blip.wav', 'pop.wav', 'pop_agudo.wav', 'tap.wav', 'tic.wav', 'ding.wav', 'sucesso.wav'],
  // Glitch e tecnologia — erros, distorções, digital
  glitch: ['glitch.wav', 'obturador.wav', 'traco.wav'],
  // Ambiente e textura — chuva, papel, brilho
  ambient: ['chuva.wav', 'papel.wav', 'papel_pop.wav', 'brilho.wav', 'sino.wav', 'dinheiro.wav', 'catraca.wav', 'digitando.wav', 'asas.wav', 'bolha.wav'],
} as const;

export type SfxCategory = keyof typeof SFX_CATALOG;

/** Durações medidas dos SFX em milissegundos (48kHz stereo). */
export const SFX_DURATIONS_MS: Record<string, number> = {
  'asas.wav': 800, 'batimento.wav': 700, 'blip.wav': 90, 'bolha.wav': 120,
  'boom.wav': 2200, 'brilho.wav': 1600, 'catraca.wav': 900, 'chuva.wav': 6000,
  'click.wav': 40, 'deslize.wav': 200, 'deslize_reverso.wav': 200,
  'digitando.wav': 1200, 'ding.wav': 900, 'dinheiro.wav': 800, 'drop.wav': 1200,
  'glitch.wav': 350, 'impacto.wav': 1400, 'obturador.wav': 250, 'papel.wav': 450,
  'papel_pop.wav': 80, 'pop.wav': 120, 'pop_agudo.wav': 90, 'riser.wav': 1600,
  'sino.wav': 2200, 'sucesso.wav': 1000, 'swish_reverso.wav': 500,
  'swish_suave.wav': 300, 'tac.wav': 120, 'tap.wav': 60, 'tempo_parando.wav': 1200,
  'tic.wav': 120, 'traco.wav': 160, 'whoosh.wav': 380, 'whoosh_grave.wav': 500,
  'whoosh_rapido.wav': 220,
};

/** Intent reasons from the Smart Director timeline graphics. */
type GraphicsIntentReason = string;

/**
 * Regras contextuais: mapeia padrões de intent/label para categorias de SFX.
 * Silêncio intencional é representado por retorno null.
 */
interface ContextRule {
  /** Match function: returns true if this rule applies to the given context. */
  match: (ctx: SegmentContext) => boolean;
  /** Category of SFX to use, or null for intentional silence. */
  category: SfxCategory | null;
  /** Gain adjustment in dB relative to base SFX level. */
  gainDb?: number;
  /** Priority: higher wins when multiple rules match. */
  priority: number;
}

export interface SegmentContext {
  /** The intent reason from the director. */
  intentReason: GraphicsIntentReason;
  /** The label/text content of the segment. */
  label: string;
  /** Start time in ms. */
  startMs: number;
  /** Duration in ms. */
  durationMs: number;
  /** Index within the timeline. */
  index: number;
  /** Total number of segments. */
  totalSegments: number;
  /** Whether this is the first segment. */
  isFirst: boolean;
  /** Whether this is the last segment. */
  isLast: boolean;
  /** Previous segment's intent reason, if any. */
  prevIntentReason?: GraphicsIntentReason;
  /** Next segment's intent reason, if any. */
  nextIntentReason?: GraphicsIntentReason;
}

const CONTEXT_RULES: readonly ContextRule[] = [
  // Abertura: whoosh suave ou silêncio para estabelecer tom
  { match: (ctx) => ctx.isFirst, category: 'transition', gainDb: -3, priority: 10 },

  // Diagrama do diretor: impacto leve na entrada para enfatizar explicação visual
  { match: (ctx) => ctx.intentReason === 'diagrama do diretor', category: 'impact', gainDb: -6, priority: 8 },

  // Composição multi-painel: whoosh para transição entre painéis
  { match: (ctx) => ctx.intentReason.includes('composição multi-painel'), category: 'transition', gainDb: -4, priority: 8 },

  // Sem filmagem aceita (stock footage): silêncio ou whoosh muito sutil
  { match: (ctx) => ctx.intentReason.startsWith('sem filmagem aceita'), category: null, priority: 7 },

  // Texto do diretor: geralmente silêncio, exceto em transições importantes
  { match: (ctx) => ctx.intentReason === 'texto do diretor', category: null, priority: 5 },

  // Transição entre intents diferentes: whoosh ou swish
  {
    match: (ctx) => !!ctx.prevIntentReason && ctx.prevIntentReason !== ctx.intentReason,
    category: 'transition',
    gainDb: -5,
    priority: 6,
  },

  // Último segmento: sino ou brilho para fechamento
  { match: (ctx) => ctx.isLast, category: 'ambient', gainDb: -4, priority: 9 },

  // Labels com palavras-chave de impacto/tensão
  {
    match: (ctx) => /mistério|segredo|perigo|morte|caos|crise|colapso|abismo/i.test(ctx.label),
    category: 'tension',
    gainDb: -4,
    priority: 9,
  },

  // Labels com palavras-chave de tecnologia/digital
  {
    match: (ctx) => /cyberpunk|digital|código|algoritmo|dados|sistema|rede|pixel|glitch/i.test(ctx.label),
    category: 'glitch',
    gainDb: -6,
    priority: 8,
  },

  // Labels com palavras-chave de natureza/ambiente
  {
    match: (ctx) => /chuva|vento|mar|floresta|noite|céu|estrela|sol|lua|água/i.test(ctx.label),
    category: 'ambient',
    gainDb: -8,
    priority: 7,
  },

  // Labels com perguntas: blip sutil para chamar atenção
  {
    match: (ctx) => ctx.label.includes('?'),
    category: 'interface',
    gainDb: -8,
    priority: 6,
  },
];

/**
 * Seleciona um SFX específico dentro de uma categoria usando hash determinístico.
 * Evita repetição consecutiva do mesmo arquivo.
 */
function pickSfxFromCategory(
  category: SfxCategory,
  seed: string,
  previousSfxId?: string,
): string {
  const options: readonly string[] = SFX_CATALOG[category];
  if (options.length === 0) return '';

  // Hash simples para seleção determinística
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }

  let index = Math.abs(hash) % options.length;
  const picked = options[index];

  // Evita repetição consecutiva
  if (picked === previousSfxId && options.length > 1) {
    index = (index + 1) % options.length;
  }

  return options[index] ?? options[0] ?? '';
}

/**
 * Classifica e seleciona SFX para cada segmento da timeline baseado no contexto narrativo.
 * Retorna eventos SFX prontos para integração no AetheraAudioPlan.
 */
export function classifyAndSelectSfx(input: {
  timeline: TimelineDocument;
  sfxBasePath: string;
  baseGainDb?: number;
}): SfxEvent[] {
  const { timeline, sfxBasePath, baseGainDb = -6 } = input;
  const events: SfxEvent[] = [];

  // Extrair segmentos gráficos com contexto
  const graphicsTrack = timeline.tracks.find((t) => t.kind === 'graphics');
  if (!graphicsTrack || graphicsTrack.items.length === 0) return events;

  const items = graphicsTrack.items;
  let previousSfxId: string | undefined;
  let lastSfxEndMs = -1;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const intent = item.intent as { reason?: string } | undefined;
    const intentReason = intent?.reason ?? '';
    const label = item.label ?? '';
    const startMs = item.startMs;
    const durationMs = item.durationMs;

    const prevIntentReason = i > 0 ? (items[i - 1]?.intent as { reason?: string } | undefined)?.reason : undefined;
    const nextIntentReason = i < items.length - 1 ? (items[i + 1]?.intent as { reason?: string } | undefined)?.reason : undefined;
    const ctx: SegmentContext = {
      intentReason,
      label,
      startMs,
      durationMs,
      index: i,
      totalSegments: items.length,
      isFirst: i === 0,
      isLast: i === items.length - 1,
      ...(prevIntentReason !== undefined ? { prevIntentReason } : {}),
      ...(nextIntentReason !== undefined ? { nextIntentReason } : {}),
    };

    // Encontrar regra de maior prioridade que aplica
    const matchingRules = CONTEXT_RULES.filter((r) => r.match(ctx));
    if (matchingRules.length === 0) continue;

    const bestRule = matchingRules.reduce((a, b) => a.priority >= b.priority ? a : b);
    if (bestRule.category === null) continue; // Silêncio intencional

    // Selecionar SFX da categoria
    const sfxFile = pickSfxFromCategory(bestRule.category, `${timeline.id}-${i}`, previousSfxId);
    if (!sfxFile) continue;

    const sfxDurationMs = SFX_DURATIONS_MS[sfxFile] ?? 500;
    const gainDb = baseGainDb + (bestRule.gainDb ?? 0);

    // Posicionar SFX no início do segmento (entrada)
    const atMs = startMs;

    // Prevenir sobreposição excessiva: mínimo 200ms entre SFX
    if (atMs < lastSfxEndMs + 200) continue;

    const relativePath = `${sfxBasePath}/${sfxFile}`;
    const eventId = `sfx-${timeline.id}-${i}`;

    events.push({
      id: eventId,
      sfxId: sfxFile.replace('.wav', ''),
      relativePath,
      atMs,
      durationMs: sfxDurationMs,
      frame: Math.round((atMs * timeline.fps) / 1_000),
      gainDb,
      licenseEvidence: 'MotionVelix SFX library — royalty-free for NeuralBridge productions',
    });

    previousSfxId = sfxFile;
    lastSfxEndMs = atMs + sfxDurationMs;
  }

  return events;
}

/**
 * Valida que os eventos SFX não violam restrições de mixagem.
 */
export function validateSfxEvents(events: readonly SfxEvent[], timelineDurationMs: number): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const event of events) {
    if (event.atMs < 0) errors.push(`SFX ${event.id}: atMs negativo (${event.atMs})`);
    if (event.atMs >= timelineDurationMs) errors.push(`SFX ${event.id}: fora da timeline (${event.atMs} >= ${timelineDurationMs})`);
    if (event.gainDb > 0) errors.push(`SFX ${event.id}: gain positivo (${event.gainDb}dB) pode causar clipping`);
    if (event.durationMs <= 0) errors.push(`SFX ${event.id}: duração inválida (${event.durationMs})`);
  }

  // Verificar sobreposições excessivas
  const sorted = [...events].sort((a, b) => a.atMs - b.atMs);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!prev || !curr) continue;
    const gap = curr.atMs - (prev.atMs + prev.durationMs);
    if (gap < -100) {
      errors.push(`SFX sobreposição excessiva: ${prev.id} e ${curr.id} (gap=${gap}ms)`);
    }
  }

  return { valid: errors.length === 0, errors };
}
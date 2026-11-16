import {
  DEFAULT_HUMOR_PROFILE,
  fromFrames,
  rationalTime,
  type HumorProfile,
  type RationalTime,
  type SourceMediaRecord,
  type TimeRange,
} from '../ir/timeline-ir.js';
import { sanitizeUntrustedMediaText, type MediaIntelligenceReport } from '../analysis/media-intelligence.js';

export type CinemaGenre = 'trailer' | 'top_list' | 'documentary' | 'gameplay_essay';
export type DeliveryFormat = 'youtube_16_9' | 'shorts_9_16';

export function parseDurationFromPrompt(prompt: string): number | null {
  const minMatch = prompt.match(/(\d+(?:[.,]\d+)?)\s*(?:minuto|minutos|min)\b/i);
  if (minMatch?.[1]) {
    const mins = Number(minMatch[1].replace(',', '.'));
    if (Number.isFinite(mins) && mins > 0) return Math.round(mins * 60);
  }
  const secMatch = prompt.match(/(\d+)\s*(?:segundo|segundos|seg|s)\b/i);
  if (secMatch?.[1]) {
    const secs = Number(secMatch[1]);
    if (Number.isFinite(secs) && secs >= 5) return secs;
  }
  return null;
}

export interface CreativeBrief {
  briefId: string;
  prompt: string;
  genre: CinemaGenre;
  platform: 'youtube' | 'shorts';
  format: DeliveryFormat;
  targetDurationSec: number;
  tone: string;
  audience: string;
  pacing: 'fast' | 'balanced' | 'deliberate';
  maxEffectsPerMinute: number;
  syntheticTolerance: 'none' | 'diagrams_only' | 'full';
  humorProfile: HumorProfile;
  restrictions: string[];
  safeZones: { topPct: number; bottomPct: number; leftPct: number; rightPct: number };
}

export interface StyleBible {
  styleId: string;
  palette: { background: string; surface: string; primaryText: string; accent: string };
  typography: { displayFont: string; bodyFont: string; monoFont: string; minContrastRatio: number };
  allowedTransitions: Array<'cut' | 'dissolve' | 'j_cut' | 'l_cut' | 'match_cut' | 'wipe'>;
  maxVfxIntensity: number;
  soundIdentity: { targetLufs: number; truePeakDbtp: number; duckingDb: number };
  cameraBehavior: { allowUnmotivatedZoom: boolean; maxPanSpeedPctPerSec: number };
}

export interface NarrativeBeat {
  beatId: string;
  stage: 'hook' | 'promise' | 'progression' | 'tension' | 'climax' | 'resolution' | 'cta';
  summary: string;
  intensity: number;
  timeRange: TimeRange;
  sensitiveContext: boolean;
}

export interface ShotPlan {
  shotId: string;
  beatId: string;
  framing: 'wide' | 'medium' | 'closeup' | 'detail' | 'diagram';
  cameraMotion: 'static' | 'slow_push' | 'pan_reframe' | 'match_move';
  motionJustification: string;
  transitionIn: 'cut' | 'dissolve' | 'j_cut' | 'l_cut' | 'match_cut' | 'wipe';
  transitionReason: string;
  mediaId: string | null;
  timeRange: TimeRange;
  alternativePlanB: {
    framing: ShotPlan['framing'];
    transitionIn: ShotPlan['transitionIn'];
    reason: string;
  };
  mediaGap: boolean;
  gapReason?: string;
}

export interface CreativeDirectionPackage {
  brief: CreativeBrief;
  styleBible: StyleBible;
  treatment: string;
  narrativeBeats: NarrativeBeat[];
  shots: ShotPlan[];
  mediaGaps: Array<{ shotId: string; reason: string }>;
}

export interface ScriptValidationReport {
  valid: boolean;
  targetDurationSec: number;
  estimatedNarrationSec: number;
  narrationWordCount: number;
  beatCount: number;
  shotCount: number;
  coveredTimelineSec: number;
  coverageRatio: number;
  warnings: string[];
}

export function compileCreativeBrief(input: {
  prompt: string;
  genre?: CinemaGenre;
  format?: DeliveryFormat;
  targetDurationSec?: number;
  humorIntensity?: number;
  restrictions?: string[];
}): CreativeBrief {
  const { sanitized } = sanitizeUntrustedMediaText(input.prompt);
  const format = input.format ?? 'youtube_16_9';
  const genre: CinemaGenre =
    input.genre ??
    (/trailer/i.test(sanitized)
      ? 'trailer'
      : /top\s*\d+|ranking|melhores/i.test(sanitized)
        ? 'top_list'
        : /gameplay|jogo|boss|fase/i.test(sanitized)
          ? 'gameplay_essay'
          : 'documentary');

  const intensity =
    input.humorIntensity !== undefined
      ? Math.max(0, Math.min(100, input.humorIntensity))
      : DEFAULT_HUMOR_PROFILE.humorIntensity;

  const humorProfile: HumorProfile =
    intensity === 0
      ? {
          ...DEFAULT_HUMOR_PROFILE,
          profileId: 'disabled',
          label: 'Sem humor',
          humorIntensity: 0,
        }
      : {
          ...DEFAULT_HUMOR_PROFILE,
          humorIntensity: intensity,
        };

  return {
    briefId: `brief_${Date.now()}`,
    prompt: sanitized,
    genre,
    platform: format === 'shorts_9_16' ? 'shorts' : 'youtube',
    format,
    targetDurationSec: Math.max(15, input.targetDurationSec ?? (genre === 'trailer' ? 45 : 90)),
    tone: genre === 'documentary' ? 'analytical_cinematic' : 'high_impact_editorial',
    audience: 'youtube_general_ptbr',
    pacing: genre === 'trailer' || genre === 'top_list' ? 'fast' : 'balanced',
    maxEffectsPerMinute: 4,
    syntheticTolerance: 'diagrams_only',
    humorProfile,
    restrictions: input.restrictions ?? [],
    safeZones:
      format === 'shorts_9_16'
        ? { topPct: 12, bottomPct: 22, leftPct: 6, rightPct: 12 }
        : { topPct: 6, bottomPct: 12, leftPct: 5, rightPct: 5 },
  };
}

export function buildStyleBible(brief: CreativeBrief): StyleBible {
  return {
    styleId: `style_${brief.genre}_${brief.format}`,
    palette: {
      background: '#071012',
      surface: '#0D1B1E',
      primaryText: '#F4F1EA',
      accent: '#D4AF37',
    },
    typography: {
      displayFont: 'Inter',
      bodyFont: 'Inter',
      monoFont: 'IBM Plex Mono',
      minContrastRatio: 4.5,
    },
    allowedTransitions:
      brief.genre === 'trailer'
        ? ['cut', 'match_cut', 'wipe', 'j_cut']
        : ['cut', 'dissolve', 'j_cut', 'l_cut', 'match_cut'],
    maxVfxIntensity: brief.genre === 'trailer' ? 0.65 : 0.45,
    soundIdentity: {
      targetLufs: brief.format === 'shorts_9_16' ? -13 : -14,
      truePeakDbtp: -1.0,
      duckingDb: -9,
    },
    cameraBehavior: {
      allowUnmotivatedZoom: false,
      maxPanSpeedPctPerSec: 12,
    },
  };
}

function buildContextualBeatNarration(params: {
  prompt: string;
  stage: NarrativeBeat['stage'];
  beatIndex: number;
  totalBeats: number;
  durationSec: number;
  itemNumber?: number;
  itemTotal?: number;
  humorIntensity: number;
}): string {
  const cleanTopic = params.prompt
    .replace(/\b(t[ií]tulo|nicho|dura[çc][ãa]o(\s+alvo)?|tom|objetivo|formato|estilo)\s*:\s*/gi, ' ')
    .replace(/\b(nicho|dura[çc][ãa]o(\s+alvo)?|tom|objetivo)\s*:\s*[^|\n]+/gi, ' ')
    .replace(/^(?:crie|fa[çc]a|gere|produza|monte)\s+(?:um\s+)?(?:v[ií]deo(?:\s+cinematogr[áa]fico)?\s+(?:sobre|de)?\s*)/i, '')
    .replace(/,?\s*com\s+narrativa.*$/i, '')
    .split(/[|\n]+/)[0]
    ?.replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || params.prompt.trim().slice(0, 90);

  const humorLine =
    params.humorIntensity > 0
      ? ' E acredite: os bastidores dessa história são ainda mais curiosos do que parecem.'
      : '';

  const baseParagraphs: Record<NarrativeBeat['stage'], string> = {
    hook: `Você já parou para pensar no que realmente está por trás de ${cleanTopic}? Muita gente conhece só a superfície dessa história, mas os detalhes menos comentados mudam completamente a forma como enxergamos tudo isso.${humorLine}`,
    promise: `Hoje vamos mergulhar nos bastidores, nas decisões que definiram ${cleanTopic} e nos momentos que quase ninguém percebeu na época.`,
    progression: params.itemNumber
      ? `No ponto ${params.itemNumber} de ${params.itemTotal ?? params.totalBeats} sobre ${cleanTopic}, olhamos de perto para o que aconteceu nos bastidores, as escolhas que fizeram diferença e o impacto real no resultado.${humorLine}`
      : `Avançando na história de ${cleanTopic}, fica claro como cada escolha influenciou o caminho seguinte e por que esse detalhe se tornou tão marcante.${humorLine}`,
    tension: `É aqui que a situação aperta em ${cleanTopic}: o prazo curto, a pressão crescente e as decisões difíceis colocam tudo em risco.${humorLine}`,
    climax: `E chegamos ao momento decisivo de ${cleanTopic}, quando tudo o que foi construído até aqui converge para o desfecho que marcou o público.`,
    resolution: `Olhando para trás, ${cleanTopic} deixa uma lição clara sobre ambição, execução e o peso de cada escolha ao longo do caminho.`,
    cta: `Agora quero saber a sua opinião sobre ${cleanTopic}: o que mais chamou sua atenção nessa história? Deixe nos comentários.`,
  };

  let text = baseParagraphs[params.stage];
  const targetWords = Math.max(18, Math.round(params.durationSec * 2.1));
  const detailExtensions = [
    `Quando observamos os fatos em sequência, percebemos que pequenas decisões tomadas muito antes acabaram definindo todo o resultado.`,
    `Esse contraste entre o que era esperado e o que realmente aconteceu ajuda a entender por que o assunto continua rendendo tanta discussão.`,
    `Cada detalhe desse episódio mostra como o contexto da época pesou diretamente nas escolhas finais.`,
    `E é justamente essa combinação de fatores que torna essa história tão interessante de revisitar hoje.`,
  ];

  let extIdx = 0;
  while (text.split(/\s+/).filter(Boolean).length < targetWords && extIdx < 6) {
    text = `${text} ${detailExtensions[(params.beatIndex + extIdx) % detailExtensions.length]}`;
    extIdx += 1;
  }
  return text;
}

export function validateScriptAndBreakdown(
  direction: CreativeDirectionPackage,
  totalTimelineSec?: number,
): ScriptValidationReport {
  const warnings: string[] = [];
  const targetDurationSec = Math.max(1, direction.brief.targetDurationSec);
  const allText = [
    direction.treatment ?? '',
    ...direction.narrativeBeats.map((b) => b.summary ?? ''),
  ]
    .join(' ')
    .trim();
  const narrationWordCount = allText ? allText.split(/\s+/).filter(Boolean).length : 0;
  const estimatedNarrationSec = Math.round(narrationWordCount / 2.3);
  const coveredTimelineSec = Number(
    direction.shots
      .reduce((acc, s) => acc + s.timeRange.duration.value / Math.max(1, s.timeRange.duration.rate), 0)
      .toFixed(2),
  );
  const refSec = totalTimelineSec && totalTimelineSec > 0 ? totalTimelineSec : targetDurationSec;
  const coverageRatio = Number((coveredTimelineSec / Math.max(1, refSec)).toFixed(3));

  if (direction.narrativeBeats.length < 6) {
    warnings.push(`Quantidade insuficiente de beats narrativos (${direction.narrativeBeats.length} < 6).`);
  }
  if (coverageRatio < 0.9) {
    warnings.push(`Cobertura audiovisual abaixo de 90% da duração alvo (${coveredTimelineSec}s / ${refSec}s).`);
  }
  if (targetDurationSec >= 180) {
    const minExpectedBeats = Math.max(8, Math.floor(targetDurationSec / 60));
    if (direction.narrativeBeats.length < minExpectedBeats) {
      warnings.push(
        `Roteiro curto demais para ${targetDurationSec}s: ${direction.narrativeBeats.length} beats (mínimo recomendado: ${minExpectedBeats}).`,
      );
    }
    if (estimatedNarrationSec < targetDurationSec * 0.55) {
      warnings.push(
        `Narração estimada (${estimatedNarrationSec}s / ${narrationWordCount} palavras) insuficiente para vídeo de ${targetDurationSec}s.`,
      );
    }
  }

  return {
    valid: warnings.length === 0,
    targetDurationSec,
    estimatedNarrationSec,
    narrationWordCount,
    beatCount: direction.narrativeBeats.length,
    shotCount: direction.shots.length,
    coveredTimelineSec,
    coverageRatio,
    warnings,
  };
}

export function directNarrativeAndShots(input: {
  brief: CreativeBrief;
  styleBible: StyleBible;
  mediaCatalog: SourceMediaRecord[];
  intelligence?: MediaIntelligenceReport[];
  fps?: RationalTime;
  externalDirection?: {
    treatment?: string;
    beats?: Array<{ stage?: NarrativeBeat['stage']; summary: string }>;
  };
}): CreativeDirectionPackage {
  const fps = input.fps ?? rationalTime(30, 1);
  const totalFrames = Math.round(input.brief.targetDurationSec * (fps.value / fps.rate));
  const targetDurationSec = input.brief.targetDurationSec;

  const listMatch = input.brief.prompt.match(/\b(\d{1,2})\s+(?:chefes|bosses|itens|momentos|jogos|filmes|segredos|dicas|melhores|piores|curiosidades)\b/i)
    ?? input.brief.prompt.match(/\btop\s*(\d{1,2})\b/i);
  const requestedItemCount = listMatch?.[1] ? Math.min(20, Math.max(3, Number(listMatch[1]))) : 0;

  let stages: Array<{
    stage: NarrativeBeat['stage'];
    pct: number;
    intensity: number;
    sensitive: boolean;
    summary: string;
    itemNumber?: number;
    itemTotal?: number;
  }>;

  if (input.externalDirection?.beats && input.externalDirection.beats.length >= 6) {
    const extBeats = input.externalDirection.beats;
    // Each beat's slot follows its spoken text (the voice-over it must carry), not an equal share of the target:
    // equal slots left short narrations under long silent shots and starved long ones.
    const wordCounts = extBeats.map((b) => b.summary.split(/\s+/).filter(Boolean).length);
    const weighted = wordCounts.every((w) => w >= 6);
    const totalWords = wordCounts.reduce((a, w) => a + w, 0);
    stages = extBeats.map((b, idx) => ({
      stage: b.stage ?? (idx === 0 ? 'hook' : idx === extBeats.length - 1 ? 'resolution' : 'progression'),
      pct: weighted ? (wordCounts[idx] ?? 0) / Math.max(1, totalWords) : 1 / extBeats.length,
      intensity: idx === extBeats.length - 2 ? 0.92 : 0.72,
      sensitive: /luto|tragédia|sensível/i.test(input.brief.prompt),
      summary: b.summary,
    }));
  } else if (targetDurationSec > 90) {
    const desiredTotalBeats = Math.max(
      requestedItemCount > 0 ? requestedItemCount + 5 : 8,
      Math.min(32, Math.round(targetDurationSec / 36)),
    );
    const progressionCount = Math.max(3, desiredTotalBeats - 5);
    const introPct = 0.08;
    const promisePct = 0.08;
    const tensionPct = 0.12;
    const climaxPct = 0.1;
    const resolutionPct = 0.08;
    const progTotalPct = 1 - (introPct + promisePct + tensionPct + climaxPct + resolutionPct);
    const eachProgPct = progTotalPct / progressionCount;

    stages = [
      { stage: 'hook', pct: introPct, intensity: 0.85, sensitive: false, summary: '' },
      { stage: 'promise', pct: promisePct, intensity: 0.68, sensitive: false, summary: '' },
      ...Array.from({ length: progressionCount }, (_, idx) => ({
        stage: 'progression' as const,
        pct: eachProgPct,
        intensity: Number((0.68 + (idx / Math.max(1, progressionCount)) * 0.16).toFixed(2)),
        sensitive: false,
        summary: '',
        ...(requestedItemCount > 0
          ? { itemNumber: Math.min(requestedItemCount, idx + 1), itemTotal: requestedItemCount }
          : {}),
      })),
      {
        stage: 'tension',
        pct: tensionPct,
        intensity: 0.88,
        sensitive: /luto|tragédia|sensível/i.test(input.brief.prompt),
        summary: '',
      },
      { stage: 'climax', pct: climaxPct, intensity: 0.95, sensitive: true, summary: '' },
      { stage: 'resolution', pct: resolutionPct, intensity: 0.58, sensitive: false, summary: '' },
    ];
  } else {
    stages = [
      { stage: 'hook', pct: 0.12, intensity: 0.85, sensitive: false, summary: '' },
      { stage: 'promise', pct: 0.13, intensity: 0.65, sensitive: false, summary: '' },
      { stage: 'progression', pct: 0.3, intensity: 0.72, sensitive: false, summary: '' },
      { stage: 'tension', pct: 0.2, intensity: 0.88, sensitive: /luto|tragédia|sensível/i.test(input.brief.prompt), summary: '' },
      { stage: 'climax', pct: 0.15, intensity: 0.95, sensitive: true, summary: '' },
      { stage: 'resolution', pct: 0.1, intensity: 0.55, sensitive: false, summary: '' },
    ];
  }

  const narrativeBeats: NarrativeBeat[] = [];
  const shots: ShotPlan[] = [];
  const mediaGaps: Array<{ shotId: string; reason: string }> = [];

  let cursorFrames = 0;
  const verifiedMedia = input.mediaCatalog.filter((m) => m.kind === 'video' || m.kind === 'image');

  stages.forEach((s, idx) => {
    const isLast = idx === stages.length - 1;
    const durFrames = isLast
      ? Math.max(30, totalFrames - cursorFrames)
      : Math.max(30, Math.round(totalFrames * s.pct));
    const beatId = `nbeat_${idx + 1}_${s.stage}`;
    const beatRange: TimeRange = {
      start: fromFrames(cursorFrames, fps),
      duration: fromFrames(durFrames, fps),
    };
    const beatDurSec = durFrames / (fps.value / fps.rate);
    const summaryText =
      s.summary.trim().length > 0
        ? s.summary
        : buildContextualBeatNarration({
            prompt: input.brief.prompt,
            stage: s.stage,
            beatIndex: idx,
            totalBeats: stages.length,
            durationSec: beatDurSec,
            ...(s.itemNumber !== undefined ? { itemNumber: s.itemNumber } : {}),
            ...(s.itemTotal !== undefined ? { itemTotal: s.itemTotal } : {}),
            humorIntensity: input.brief.humorProfile.humorIntensity,
          });

    narrativeBeats.push({
      beatId,
      stage: s.stage,
      summary: summaryText,
      intensity: s.intensity,
      timeRange: beatRange,
      sensitiveContext: s.sensitive,
    });

    const chosenMedia = verifiedMedia.length > 0 ? verifiedMedia[idx % verifiedMedia.length] : undefined;
    const shotId = `shot_${idx + 1}`;
    const framing: ShotPlan['framing'] =
      idx === 0 ? 'wide' : s.stage === 'climax' ? 'detail' : idx % 2 === 0 ? 'medium' : 'closeup';

    const mediaGap = !chosenMedia || Boolean(chosenMedia.offline);
    if (mediaGap) {
      mediaGaps.push({
        shotId,
        reason: chosenMedia?.offline
          ? `Mídia ${chosenMedia.mediaId} offline no catálogo`
          : 'Nenhuma filmagem verificada disponível para este beat',
      });
    }

    const lastGapReason = mediaGaps[mediaGaps.length - 1]?.reason;
    shots.push({
      shotId,
      beatId,
      framing,
      cameraMotion: idx === 0 || s.stage === 'climax' ? 'slow_push' : 'static',
      motionJustification:
        idx === 0
          ? 'Aproximação gradual reforça o gancho de abertura'
          : s.stage === 'climax'
            ? 'Ênfase dramática controlada no clímax'
            : 'Plano estável para preservar legibilidade e respiração',
      transitionIn: idx === 0 ? 'cut' : idx === 2 ? 'j_cut' : 'cut',
      transitionReason:
        idx === 2
          ? 'J-cut antecipa a entrada sonora do desenvolvimento para fluidez narrativa'
          : 'Corte direto motivado por mudança de beat narrativo',
      mediaId: chosenMedia ? chosenMedia.mediaId : null,
      timeRange: beatRange,
      alternativePlanB: {
        framing: 'diagram',
        transitionIn: 'dissolve',
        reason: 'Fallback para diagrama editorial caso filmagem primária não seja aprovada',
      },
      mediaGap,
      ...(mediaGap && lastGapReason ? { gapReason: lastGapReason } : {}),
    });

    cursorFrames += durFrames;
  });

  return {
    brief: input.brief,
    styleBible: input.styleBible,
    treatment:
      input.externalDirection?.treatment?.trim() ||
      `Tratamento (${input.brief.genre}, ${input.brief.format}, ${targetDurationSec}s): ${input.brief.prompt} | Humor: ${input.brief.humorProfile.label} (${input.brief.humorProfile.humorIntensity}%)`,
    narrativeBeats,
    shots,
    mediaGaps,
  };
}

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

export function directNarrativeAndShots(input: {
  brief: CreativeBrief;
  styleBible: StyleBible;
  mediaCatalog: SourceMediaRecord[];
  intelligence?: MediaIntelligenceReport[];
  fps?: RationalTime;
}): CreativeDirectionPackage {
  const fps = input.fps ?? rationalTime(30, 1);
  const totalFrames = Math.round(input.brief.targetDurationSec * (fps.value / fps.rate));

  const stages: Array<{
    stage: NarrativeBeat['stage'];
    pct: number;
    intensity: number;
    sensitive: boolean;
    summary: string;
  }> = [
    { stage: 'hook', pct: 0.12, intensity: 0.85, sensitive: false, summary: 'Abertura de impacto com gancho visual' },
    { stage: 'promise', pct: 0.13, intensity: 0.65, sensitive: false, summary: 'Promessa clara do tema e conflito central' },
    { stage: 'progression', pct: 0.3, intensity: 0.72, sensitive: false, summary: 'Desenvolvimento com evidências e ritmo alternado' },
    { stage: 'tension', pct: 0.2, intensity: 0.88, sensitive: /luto|tragédia|sensível/i.test(input.brief.prompt), summary: 'Escalada dramática e contraste narrativo' },
    { stage: 'climax', pct: 0.15, intensity: 0.95, sensitive: true, summary: 'Clímax principal sem dispersão visual' },
    { stage: 'resolution', pct: 0.1, intensity: 0.55, sensitive: false, summary: 'Fechamento e síntese memorável' },
  ];

  const narrativeBeats: NarrativeBeat[] = [];
  const shots: ShotPlan[] = [];
  const mediaGaps: Array<{ shotId: string; reason: string }> = [];

  let cursorFrames = 0;
  const verifiedMedia = input.mediaCatalog.filter((m) => m.kind === 'video' || m.kind === 'image');

  stages.forEach((s, idx) => {
    const durFrames = Math.max(30, Math.round(totalFrames * s.pct));
    const beatId = `nbeat_${idx + 1}_${s.stage}`;
    const beatRange: TimeRange = {
      start: fromFrames(cursorFrames, fps),
      duration: fromFrames(durFrames, fps),
    };
    narrativeBeats.push({
      beatId,
      stage: s.stage,
      summary: s.summary,
      intensity: s.intensity,
      timeRange: beatRange,
      sensitiveContext: s.sensitive,
    });

    const chosenMedia = verifiedMedia.length > 0 ? verifiedMedia[idx % verifiedMedia.length] : undefined;
    const shotId = `shot_${idx + 1}`;
    const framing: ShotPlan['framing'] =
      idx === 0 ? 'wide' : idx === 4 ? 'detail' : idx % 2 === 0 ? 'medium' : 'closeup';

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
      cameraMotion: idx === 0 || idx === 4 ? 'slow_push' : 'static',
      motionJustification:
        idx === 0
          ? 'Aproximação gradual reforça o gancho de abertura'
          : idx === 4
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
    treatment: `Tratamento (${input.brief.genre}, ${input.brief.format}): ${input.brief.prompt} | Humor: ${input.brief.humorProfile.label} (${input.brief.humorProfile.humorIntensity}%)`,
    narrativeBeats,
    shots,
    mediaGaps,
  };
}

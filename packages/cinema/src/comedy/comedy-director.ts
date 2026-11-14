import {
  addRational,
  fromFrames,
  rationalToSeconds,
  type ComedyBeatPlan,
  type RationalTime,
} from '../ir/timeline-ir.js';
import type { CreativeBrief, NarrativeBeat, ShotPlan } from '../director/cinematography-director.js';
import type { MediaIntelligenceReport } from '../analysis/media-intelligence.js';

export interface ComedyPlannerInput {
  brief: CreativeBrief;
  narrativeBeats: NarrativeBeat[];
  shots: ShotPlan[];
  intelligence?: MediaIntelligenceReport[];
  transcriptLines?: Array<{ timeSec: number; text: string }>;
  sceneOverrides?: Record<string, number>;
  fps?: RationalTime;
  seed?: number;
}

/**
 * Deterministic contextual humor & entertainment director (CINEMA-10).
 * Default profile: cinematic_subtle_humor at 35% intensity.
 * Subordinate to CreativeBrief and NarrativeDirector; never fabricates events or overrides sensitive moments.
 */
export function planComedyBeats(input: ComedyPlannerInput): ComedyBeatPlan[] {
  const defaultIntensity = input.brief.humorProfile.humorIntensity;
  const hasExplicitBan = input.brief.restrictions.some((r) =>
    /sem\s*humor|no\s*humor|strict_serious/i.test(r),
  );
  if (hasExplicitBan || input.brief.humorProfile.profileId === 'disabled') {
    return [];
  }

  const fps = input.fps ?? { value: 30, rate: 1 };
  const totalMinutes = Math.max(0.25, input.brief.targetDurationSec / 60);
  const maxAllowedBeats = Math.max(
    1,
    Math.floor(
      totalMinutes *
        input.brief.humorProfile.maxBeatsPerMinute *
        (Math.max(defaultIntensity, 1) / 50),
    ),
  );

  const beats: ComedyBeatPlan[] = [];
  const seedOffset = Math.abs(input.seed ?? 0);

  for (let i = 0; i < input.narrativeBeats.length; i++) {
    const nBeat = input.narrativeBeats[i];
    if (!nBeat) continue;

    const effectiveIntensity =
      input.sceneOverrides?.[nBeat.beatId] ?? defaultIntensity;

    // 0% disables humor for this scene; sensitive/climax contexts block humor insertion
    if (effectiveIntensity <= 0 || nBeat.sensitiveContext || nBeat.stage === 'climax') {
      continue;
    }

    // At 35% intensity, target mostly progression & resolution beats (subtle, punctual)
    if (effectiveIntensity <= 40 && nBeat.stage !== 'progression' && nBeat.stage !== 'resolution') {
      continue;
    }

    if (beats.length >= maxAllowedBeats) break;

    const matchingShot = input.shots.find((s) => s.beatId === nBeat.beatId);
    const transcriptMatch = input.transcriptLines?.find((line) => {
      const startSec = rationalToSeconds(nBeat.timeRange.start);
      const endSec = startSec + rationalToSeconds(nBeat.timeRange.duration);
      return line.timeSec >= startSec && line.timeSec <= endSec;
    });

    const setupEvidence = transcriptMatch
      ? `Fala verificada em ${transcriptMatch.timeSec.toFixed(1)}s: "${transcriptMatch.text}"`
      : matchingShot && !matchingShot.mediaGap
        ? `Contraste visual verificado na tomada ${matchingShot.shotId} (${matchingShot.framing})`
        : `Beat narrativo ${nBeat.stage}: ${nBeat.summary}`;

    const pauseFrames = effectiveIntensity >= 60 ? 12 : 8;
    const beatStart = addRational(
      nBeat.timeRange.start,
      fromFrames(Math.min(30, 15 + ((seedOffset + i) % 10)), fps),
    );

    beats.push({
      beatId: `cbeat_${beats.length + 1}_${nBeat.beatId}`,
      timeRange: {
        start: beatStart,
        duration: fromFrames(45, fps),
      },
      setupEvidence,
      humorMechanism:
        i % 2 === 0 ? 'epic_mundane' : 'dry_irony',
      punchline:
        transcriptMatch
          ? `Reação seca / corte de contraste após "${transcriptMatch.text.slice(0, 48)}"`
          : `Corte seco de contraste editorial em ${nBeat.stage}`,
      pauseFrames,
      deliveryStyle: effectiveIntensity <= 45 ? 'deadpan' : 'timing_cut',
      editActions:
        effectiveIntensity <= 45
          ? ['hard_cut', 'intentional_silence']
          : ['hard_cut', 'punch_zoom', 'intentional_silence'],
      sfxCues: ['sfx_subtle_record_stop'],
      vfxCues: ['caption_emphasis_clean'],
      confidence: matchingShot?.mediaGap ? 0.62 : 0.84,
      contextRisk: nBeat.stage === 'tension' ? 'medium' : 'low',
      fallbackWithoutHumor: `Manter corte contínuo padrão do shot ${matchingShot?.shotId ?? nBeat.beatId} sem pausa cômica`,
      reviewStatus: 'proposed',
    });
  }

  return beats;
}

import type { ComedyBeat, TimelineClip } from '../ir/timeline-ir.js';

export interface SceneAudiovisualPlanItem {
  sceneId: string;
  objective: string;
  narrationText: string;
  startSec: number;
  endSec: number;
  primaryMediaId?: string;
  alternativeMediaIds: string[];
  cameraMotion: 'ken_burns_in' | 'ken_burns_out' | 'pan_left' | 'pan_right' | 'punch_zoom';
  transitionIn: TimelineClip['transitionIn'];
  transitionOut: 'cut' | 'dissolve';
  vfxEffects: Array<'title_overlay' | 'game_badge' | 'color_grade_rec709' | 'punch_zoom' | 'ken_burns'>;
  motionGraphicText?: string;
  sfxEventType: 'transition' | 'impact' | 'reveal' | 'ui_pop' | 'comic_sting' | 'whoosh';
  sfxAtMs: number;
  musicMood: string;
  musicDuckDb: number;
  humorBeatId?: string;
  semanticEvidenceSummary?: string;
}

export interface SceneAudiovisualPlan {
  version: 1;
  requestedDurationSec: number;
  scenes: SceneAudiovisualPlanItem[];
  vfxPlan: Array<{ sceneId: string; effect: string; startSec: number; durationSec: number }>;
  humorBeats: Array<{ beatId: string; sceneId: string; atSec: number; kind: string }>;
  missingRequiredResources: string[];
}

export function validateSceneAudiovisualPlan(plan: SceneAudiovisualPlan): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  if (plan.requestedDurationSec <= 0) {
    errors.push('requestedDurationSec inválido ou ausente no plano audiovisual.');
  }
  if (plan.scenes.length === 0) {
    errors.push('Plano audiovisual sem nenhuma cena.');
  }
  if (plan.vfxPlan.length === 0 && plan.scenes.length > 0) {
    errors.push('vfxPlan vazio: efeitos visuais e motion graphics não foram propagados.');
  }
  for (const scene of plan.scenes) {
    if (!scene.transitionIn) {
      errors.push(`Cena ${scene.sceneId} sem transitionIn definido.`);
    }
    if (!scene.narrationText.trim()) {
      errors.push(`Cena ${scene.sceneId} sem trecho de narração.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function buildSceneAudiovisualPlan(input: {
  requestedDurationSec: number;
  clips: readonly TimelineClip[];
  scenes: ReadonlyArray<{
    sceneId: string;
    subject: string;
    narrationText: string;
    expectedEvent?: string;
  }>;
  comedyBeats?: readonly ComedyBeat[];
  musicMood?: string;
}): SceneAudiovisualPlan {
  const v1Clips = input.clips
    .filter((c) => c.trackId === 'v1')
    .sort((a, b) => a.timelineRange.start.value / a.timelineRange.start.rate - b.timelineRange.start.value / b.timelineRange.start.rate);

  const cameraMotions: SceneAudiovisualPlanItem['cameraMotion'][] = [
    'ken_burns_in',
    'pan_right',
    'ken_burns_out',
    'pan_left',
  ];

  const planScenes: SceneAudiovisualPlanItem[] = [];
  const vfxPlan: SceneAudiovisualPlan['vfxPlan'] = [];
  const humorBeats: SceneAudiovisualPlan['humorBeats'] = [];
  const missingRequiredResources: string[] = [];

  for (let i = 0; i < v1Clips.length; i += 1) {
    const clip = v1Clips[i]!;
    const sceneMeta = input.scenes[Math.min(i, Math.max(0, input.scenes.length - 1))];
    const startSec = Number((clip.timelineRange.start.value / Math.max(1, clip.timelineRange.start.rate)).toFixed(2));
    const durSec = Number((clip.timelineRange.duration.value / Math.max(1, clip.timelineRange.duration.rate)).toFixed(2));
    const endSec = Number((startSec + durSec).toFixed(2));
    const sceneId = sceneMeta?.sceneId ?? clip.clipId;
    const isGraphicRecovery = clip.effects.some((e) => e.kind === 'graphic_recovery' && e.enabled);

    const matchingComedy = (input.comedyBeats ?? []).find((b) => {
      const timeRef = b.at ?? (b as { timeRange?: { start?: { value: number; rate: number } } }).timeRange?.start;
      if (!timeRef) return false;
      const bStart = timeRef.value / Math.max(1, timeRef.rate);
      return bStart >= startSec && bStart < endSec;
    });

    const motion: SceneAudiovisualPlanItem['cameraMotion'] = matchingComedy
      ? 'punch_zoom'
      : cameraMotions[i % cameraMotions.length]!;
    const transitionIn: TimelineClip['transitionIn'] =
      i === 0 ? 'dissolve' : i % 3 === 0 ? 'wipe' : i % 2 === 0 ? 'j_cut' : 'dissolve';

    const vfxEffects: SceneAudiovisualPlanItem['vfxEffects'] = [
      'color_grade_rec709',
      'ken_burns',
      ...(i === 0 ? (['title_overlay'] as const) : (['game_badge'] as const)),
      ...(matchingComedy ? (['punch_zoom'] as const) : []),
    ];

    if (matchingComedy) {
      const cTime = matchingComedy.at ?? (matchingComedy as { timeRange?: { start?: { value: number; rate: number } } }).timeRange?.start;
      humorBeats.push({
        beatId: matchingComedy.beatId,
        sceneId,
        atSec: cTime ? Number((cTime.value / Math.max(1, cTime.rate)).toFixed(2)) : startSec,
        kind: matchingComedy.kind,
      });
    }

    const labelText = sceneMeta?.subject || clip.label;
    vfxPlan.push({
      sceneId,
      effect: i === 0 ? 'title_overlay' : matchingComedy ? 'punch_zoom' : 'game_badge',
      startSec,
      durationSec: Math.min(3.5, Math.max(1.2, durSec * 0.45)),
    });

    if (isGraphicRecovery) {
      missingRequiredResources.push(`Cena ${sceneId} (${labelText}) sem mídia verificada.`);
    }

    planScenes.push({
      sceneId,
      objective: sceneMeta?.expectedEvent ?? labelText,
      narrationText: sceneMeta?.narrationText ?? labelText,
      startSec,
      endSec,
      ...(clip.mediaId ? { primaryMediaId: clip.mediaId } : {}),
      alternativeMediaIds: [],
      cameraMotion: motion,
      transitionIn,
      transitionOut: i === v1Clips.length - 1 ? 'dissolve' : 'cut',
      vfxEffects,
      motionGraphicText: labelText,
      sfxEventType: matchingComedy ? 'comic_sting' : i === 0 ? 'reveal' : i % 2 === 0 ? 'whoosh' : 'ui_pop',
      sfxAtMs: Math.max(200, Math.round(startSec * 1000)),
      musicMood: input.musicMood ?? 'cinematic_retro_electronic',
      musicDuckDb: -16,
      ...(matchingComedy ? { humorBeatId: matchingComedy.beatId } : {}),
      semanticEvidenceSummary: isGraphicRecovery ? 'graphic_recovery_needs_review' : 'verified_media_bound',
    });
  }

  return {
    version: 1,
    requestedDurationSec: input.requestedDurationSec,
    scenes: planScenes,
    vfxPlan,
    humorBeats,
    missingRequiredResources,
  };
}

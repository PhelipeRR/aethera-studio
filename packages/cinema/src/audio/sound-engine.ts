import {
  rationalToSeconds,
  type CanonicalTimeline,
  type ComedyBeatPlan,
} from '../ir/timeline-ir.js';

export type LoudnessPlatform = 'youtube' | 'tiktok_shorts' | 'podcast_longform' | 'cinema_web';

export interface LoudnessTargetProfile {
  platform: LoudnessPlatform;
  integratedLufs: number;
  truePeakDbtp: number;
  loudnessRangeLu: number;
}

export const LOUDNESS_PROFILES: Record<LoudnessPlatform, LoudnessTargetProfile> = {
  youtube: {
    platform: 'youtube',
    integratedLufs: -14.0,
    truePeakDbtp: -1.0,
    loudnessRangeLu: 8.0,
  },
  tiktok_shorts: {
    platform: 'tiktok_shorts',
    integratedLufs: -12.5,
    truePeakDbtp: -1.0,
    loudnessRangeLu: 6.0,
  },
  podcast_longform: {
    platform: 'podcast_longform',
    integratedLufs: -16.0,
    truePeakDbtp: -1.5,
    loudnessRangeLu: 7.0,
  },
  cinema_web: {
    platform: 'cinema_web',
    integratedLufs: -18.0,
    truePeakDbtp: -1.0,
    loudnessRangeLu: 10.0,
  },
};

export type AudioStemRole = 'voiceover' | 'music' | 'sfx' | 'ambience';

export interface AudioStemSpec {
  stemRole: AudioStemRole;
  targetGainDb: number;
  defaultGainDb?: number;
  muted?: boolean;
  highPassHz: number;
  duckingUnderVoiceDb: number;
  rightsVerified: boolean;
  licenseNote: string;
}

export interface SoundMixValidation {
  valid: boolean;
  peakRisk: boolean;
  estimatedPeakDbtp: number;
  estimatedIntegratedLufs: number;
  warnings: string[];
}

export interface SfxCueEvent {
  cueId: string;
  timeSeconds: number;
  sfxName: string;
  reason: string;
  gainDb: number;
  syncedToCutOrComedy: boolean;
}

export interface SoundDesignPlan {
  platformProfile: LoudnessTargetProfile;
  stems: AudioStemSpec[];
  sfxEvents: SfxCueEvent[];
  unlicensedSources: string[];
  ffmpegLoudnormFilter: string;
  ffmpegSidechainDuckingFilter: string;
}

export function buildSoundDesignPlan(
  timeline: CanonicalTimeline,
  options: {
    platform?: LoudnessPlatform;
    comedyBeats?: ComedyBeatPlan[];
    verifiedAudioLicenses?: string[];
  } = {},
): SoundDesignPlan {
  const platform = options.platform ?? 'youtube';
  const profile = LOUDNESS_PROFILES[platform];
  const verifiedSet = new Set(options.verifiedAudioLicenses ?? ['builtin_sfx', 'royalty_free_bed']);

  const stems: AudioStemSpec[] = [
    {
      stemRole: 'voiceover',
      targetGainDb: 0,
      defaultGainDb: 0,
      muted: false,
      highPassHz: 85,
      duckingUnderVoiceDb: 0,
      rightsVerified: true,
      licenseNote: 'Narrator / original dialogue stem',
    },
    {
      stemRole: 'music',
      targetGainDb: -16,
      defaultGainDb: -16,
      muted: false,
      highPassHz: 40,
      duckingUnderVoiceDb: -9,
      rightsVerified: verifiedSet.has('royalty_free_bed'),
      licenseNote: verifiedSet.has('royalty_free_bed')
        ? 'Verified royalty-free soundtrack'
        : 'Pending music license verification',
    },
    {
      stemRole: 'sfx',
      targetGainDb: -8,
      defaultGainDb: -8,
      muted: false,
      highPassHz: 60,
      duckingUnderVoiceDb: -3,
      rightsVerified: verifiedSet.has('builtin_sfx'),
      licenseNote: 'Built-in editorial SFX library',
    },
    {
      stemRole: 'ambience',
      targetGainDb: -22,
      defaultGainDb: -22,
      muted: false,
      highPassHz: 70,
      duckingUnderVoiceDb: -6,
      rightsVerified: true,
      licenseNote: 'Procedural room tone / bed',
    },
  ];

  const sfxEvents: SfxCueEvent[] = [];
  const clipsById = new Map(timeline.clips.map((c) => [c.clipId, c]));
  for (const transition of timeline.transitions) {
    const toClip = clipsById.get(transition.toClipId);
    const atSec = toClip ? rationalToSeconds(toClip.timelineRange.start) : 0;
    sfxEvents.push({
      cueId: `sfx_tr_${transition.transitionId}`,
      timeSeconds: Number(atSec.toFixed(3)),
      sfxName: transition.kind === 'wipe' ? 'whoosh_soft' : 'cut_breath',
      reason: `Transition ${transition.kind}`,
      gainDb: -12,
      syncedToCutOrComedy: true,
    });
  }

  for (const beat of options.comedyBeats ?? timeline.comedyBeats) {
    if (beat.reviewStatus === 'rejected') continue;
    for (let i = 0; i < beat.sfxCues.length; i += 1) {
      const sfxName = beat.sfxCues[i];
      if (!sfxName) continue;
      sfxEvents.push({
        cueId: `sfx_com_${beat.beatId}_${i}`,
        timeSeconds: Number(rationalToSeconds(beat.timeRange.start).toFixed(3)),
        sfxName,
        reason: `Comedy beat (${beat.humorMechanism}): ${beat.setupEvidence}`,
        gainDb: -9,
        syncedToCutOrComedy: true,
      });
    }
  }

  const unlicensedSources = stems
    .filter((s) => !s.rightsVerified)
    .map((s) => `${s.stemRole}: ${s.licenseNote}`);

  const ffmpegLoudnormFilter = `loudnorm=I=${profile.integratedLufs}:TP=${profile.truePeakDbtp}:LRA=${profile.loudnessRangeLu}`;
  const ffmpegSidechainDuckingFilter =
    '[1:a][0:a]sidechaincompress=threshold=0.03:ratio=4:attack=25:release=250[ducked_music]';

  return {
    platformProfile: profile,
    stems,
    sfxEvents,
    unlicensedSources,
    ffmpegLoudnormFilter,
    ffmpegSidechainDuckingFilter,
  };
}

export function clampGainDb(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Number(Math.max(-48, Math.min(12, db)).toFixed(1));
}

export function validateSoundMix(
  stems: AudioStemSpec[],
  targetProfile: LoudnessTargetProfile = LOUDNESS_PROFILES.youtube,
): SoundMixValidation {
  const warnings: string[] = [];
  const active = stems.filter((s) => !s.muted);
  if (active.length === 0) {
    return {
      valid: false,
      peakRisk: false,
      estimatedPeakDbtp: -60,
      estimatedIntegratedLufs: -60,
      warnings: ['Todos os buses de áudio estão mutados (silêncio total).'],
    };
  }

  let linearSum = 0;
  for (const s of active) {
    const effectiveDb = s.stemRole === 'voiceover' ? s.targetGainDb : s.targetGainDb + Math.min(0, s.duckingUnderVoiceDb * 0.5);
    linearSum += Math.pow(10, effectiveDb / 20);
    if (s.targetGainDb > 6) {
      warnings.push(`Bus ${s.stemRole} acima de +6 dB (${s.targetGainDb} dB) pode causar distorção.`);
    }
  }

  const voice = active.find((s) => s.stemRole === 'voiceover');
  const music = active.find((s) => s.stemRole === 'music');
  if (voice && music && music.targetGainDb > voice.targetGainDb - 6) {
    warnings.push(
      `Música (${music.targetGainDb} dB) muito próxima da narração (${voice.targetGainDb} dB); recomendado ao menos 6 dB abaixo.`,
    );
  }

  const estimatedPeakDbtp = Number((20 * Math.log10(Math.max(1e-4, linearSum)) - 1.5).toFixed(2));
  const peakRisk = estimatedPeakDbtp > targetProfile.truePeakDbtp;
  if (peakRisk) {
    warnings.push(
      `Risco de clipping: pico estimado em ${estimatedPeakDbtp} dBTP acima do limite (${targetProfile.truePeakDbtp} dBTP).`,
    );
  }

  const baseVoiceDb = voice ? voice.targetGainDb : Math.max(...active.map((s) => s.targetGainDb));
  const estimatedIntegratedLufs = Number((targetProfile.integratedLufs + baseVoiceDb * 0.65).toFixed(1));

  return {
    valid: !peakRisk,
    peakRisk,
    estimatedPeakDbtp,
    estimatedIntegratedLufs,
    warnings,
  };
}

export function applyAudioMixerUpdates(
  soundPlan: SoundDesignPlan,
  updates: Array<{
    stemRole: AudioStemRole;
    targetGainDb?: number;
    muted?: boolean;
    duckingUnderVoiceDb?: number;
  }>,
  targetLufs?: number,
): { soundPlan: SoundDesignPlan; validation: SoundMixValidation } {
  const byRole = new Map(updates.map((u) => [u.stemRole, u]));
  const nextStems = soundPlan.stems.map((stem) => {
    const upd = byRole.get(stem.stemRole);
    if (!upd) return stem;
    return {
      ...stem,
      defaultGainDb: stem.defaultGainDb ?? (stem.stemRole === 'voiceover' ? 0 : stem.stemRole === 'music' ? -16 : stem.stemRole === 'sfx' ? -8 : -22),
      ...(upd.targetGainDb !== undefined ? { targetGainDb: clampGainDb(upd.targetGainDb) } : {}),
      ...(upd.muted !== undefined ? { muted: upd.muted } : {}),
      ...(upd.duckingUnderVoiceDb !== undefined ? { duckingUnderVoiceDb: clampGainDb(upd.duckingUnderVoiceDb) } : {}),
    };
  });

  const nextProfile =
    targetLufs !== undefined && Number.isFinite(targetLufs)
      ? { ...soundPlan.platformProfile, integratedLufs: Number(Math.max(-24, Math.min(-8, targetLufs)).toFixed(1)) }
      : soundPlan.platformProfile;

  const nextPlan: SoundDesignPlan = {
    ...soundPlan,
    platformProfile: nextProfile,
    stems: nextStems,
    ffmpegLoudnormFilter: `loudnorm=I=${nextProfile.integratedLufs}:TP=${nextProfile.truePeakDbtp}:LRA=${nextProfile.loudnessRangeLu}`,
  };
  const validation = validateSoundMix(nextStems, nextProfile);
  return { soundPlan: nextPlan, validation };
}

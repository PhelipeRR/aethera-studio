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
  highPassHz: number;
  duckingUnderVoiceDb: number;
  rightsVerified: boolean;
  licenseNote: string;
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
      highPassHz: 85,
      duckingUnderVoiceDb: 0,
      rightsVerified: true,
      licenseNote: 'Narrator / original dialogue stem',
    },
    {
      stemRole: 'music',
      targetGainDb: -16,
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
      highPassHz: 60,
      duckingUnderVoiceDb: -3,
      rightsVerified: verifiedSet.has('builtin_sfx'),
      licenseNote: 'Built-in editorial SFX library',
    },
    {
      stemRole: 'ambience',
      targetGainDb: -22,
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

import type { CanonicalTimeline, SourceMediaRecord, TimelineClip } from '../ir/timeline-ir.js';

export type ColorSpaceTarget = 'rec709' | 'rec2020_hdr' | 'srgb_web';

export interface LutProvenance {
  lutId: string;
  name: string;
  sourcePath?: string;
  sha256?: string;
  license: 'builtin' | 'mit' | 'cc0' | 'commercial_licensed' | 'unknown';
  author?: string;
}

export interface ShotColorGrade {
  clipId: string;
  mediaId: string;
  detectedInputSpace: 'rec709' | 'log_srgb' | 'hdr_pq' | 'unknown';
  targetSpace: ColorSpaceTarget;
  exposureCompensationEv: number;
  contrastGain: number;
  saturation: number;
  temperatureKelvinDelta: number;
  legalRangeClamped: boolean;
  skinToneProtected: boolean;
  lut?: LutProvenance;
}

export interface ColorPipelinePlan {
  targetSpace: ColorSpaceTarget;
  referenceClipId: string | null;
  grades: ShotColorGrade[];
  lutsWithUnknownLicense: string[];
  ffmpegColorFilterChain: string;
}

const BUILTIN_LUTS: Record<string, LutProvenance> = {
  rec709_clean_cinematic: {
    lutId: 'rec709_clean_cinematic',
    name: 'Aethera Rec.709 Clean Cinematic',
    license: 'builtin',
    author: 'Aethera Cinema Engine',
  },
  rec709_vibrant_gaming: {
    lutId: 'rec709_vibrant_gaming',
    name: 'Aethera Rec.709 Vibrant Gaming',
    license: 'builtin',
    author: 'Aethera Cinema Engine',
  },
  rec709_neutral_doc: {
    lutId: 'rec709_neutral_doc',
    name: 'Aethera Rec.709 Neutral Documentary',
    license: 'builtin',
    author: 'Aethera Cinema Engine',
  },
};

export function resolveLutProvenance(
  lutId: string,
  customLut?: Partial<LutProvenance>,
): LutProvenance {
  const builtin = BUILTIN_LUTS[lutId];
  if (builtin) return builtin;
  return {
    lutId,
    name: customLut?.name ?? lutId,
    license: customLut?.license ?? 'unknown',
    ...(customLut?.sourcePath ? { sourcePath: customLut.sourcePath } : {}),
    ...(customLut?.sha256 ? { sha256: customLut.sha256 } : {}),
    ...(customLut?.author ? { author: customLut.author } : {}),
  };
}

function detectInputSpace(source?: SourceMediaRecord): ShotColorGrade['detectedInputSpace'] {
  if (!source) return 'unknown';
  const uri = source.uri.toLowerCase();
  if (uri.includes('hdr') || uri.includes('pq') || uri.includes('hlg')) return 'hdr_pq';
  if (uri.includes('log') || uri.includes('slog3') || uri.includes('clog')) return 'log_srgb';
  return 'rec709';
}

export function buildColorPipelinePlan(
  timeline: CanonicalTimeline,
  options: {
    targetSpace?: ColorSpaceTarget;
    lutId?: string;
    customLut?: Partial<LutProvenance>;
    protectSkinTones?: boolean;
  } = {},
): ColorPipelinePlan {
  const targetSpace = options.targetSpace ?? 'rec709';
  const lut = options.lutId
    ? resolveLutProvenance(options.lutId, options.customLut)
    : BUILTIN_LUTS.rec709_clean_cinematic;
  const protectSkinTones = options.protectSkinTones ?? true;

  const videoTrackIds = new Set(
    timeline.tracks.filter((t) => t.kind === 'video').map((t) => t.trackId),
  );
  const clips: TimelineClip[] = timeline.clips.filter((c) => videoTrackIds.has(c.trackId));

  const grades: ShotColorGrade[] = clips.map((clip, idx) => {
    const source = timeline.sourceMedia[clip.mediaId];
    const inputSpace = detectInputSpace(source);
    const exposureCompensationEv = inputSpace === 'log_srgb' ? 0.35 : inputSpace === 'hdr_pq' ? -0.4 : 0;
    const contrastGain = inputSpace === 'log_srgb' ? 1.12 : 1.04;
    const saturation = idx === 0 ? 1.05 : 1.03;

    return {
      clipId: clip.clipId,
      mediaId: clip.mediaId,
      detectedInputSpace: inputSpace,
      targetSpace,
      exposureCompensationEv,
      contrastGain,
      saturation,
      temperatureKelvinDelta: 0,
      legalRangeClamped: true,
      skinToneProtected: protectSkinTones,
      ...(lut ? { lut } : {}),
    };
  });

  const lutsWithUnknownLicense =
    lut && lut.license === 'unknown' ? [lut.lutId] : [];

  const ffmpegColorFilterChain =
    targetSpace === 'rec709'
      ? 'colorspace=all=bt709:iall=bt709:fast=1,eq=contrast=1.04:saturation=1.03,limiter=min=16:max=235'
      : targetSpace === 'srgb_web'
        ? 'colorspace=all=bt709:trc=iec61966-2-1,eq=contrast=1.03:saturation=1.02'
        : 'colorspace=all=bt2020:trc=smpte2084';

  return {
    targetSpace,
    referenceClipId: clips[0]?.clipId ?? null,
    grades,
    lutsWithUnknownLicense,
    ffmpegColorFilterChain,
  };
}

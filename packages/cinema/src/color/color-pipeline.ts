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

export function listBuiltinLuts(): LutProvenance[] {
  return Object.values(BUILTIN_LUTS);
}

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

export interface ColorGradingControls {
  targetSpace?: ColorSpaceTarget;
  exposureCompensationEv: number;
  contrastGain: number;
  saturation: number;
  temperatureKelvinDelta: number;
  curves?: {
    shadows: number;
    midtones: number;
    highlights: number;
  };
  lutId?: string;
}

export function compileColorGradingToFfmpegChain(controls: ColorGradingControls): string {
  const targetSpace = controls.targetSpace ?? 'rec709';
  const baseCs =
    targetSpace === 'rec709'
      ? 'colorspace=all=bt709:iall=bt709:fast=1'
      : targetSpace === 'srgb_web'
        ? 'colorspace=all=bt709:trc=iec61966-2-1'
        : 'colorspace=all=bt2020:trc=smpte2084';

  const ev = Math.max(-2, Math.min(2, controls.exposureCompensationEv || 0));
  const brightness = Number((ev * 0.08).toFixed(3));
  const lutBoost =
    controls.lutId === 'rec709_vibrant_gaming'
      ? { c: 0.06, s: 0.1 }
      : controls.lutId === 'rec709_neutral_doc'
        ? { c: -0.02, s: -0.03 }
        : { c: 0, s: 0 };
  const contrast = Number(Math.max(0.5, Math.min(1.8, (controls.contrastGain || 1) + lutBoost.c)).toFixed(2));
  const saturation = Number(Math.max(0, Math.min(2.0, (controls.saturation ?? 1) + lutBoost.s)).toFixed(2));
  const eqFilter = `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`;

  const filters: string[] = [baseCs, eqFilter];

  const tempDelta = Math.max(-1500, Math.min(1500, controls.temperatureKelvinDelta || 0));
  if (Math.abs(tempDelta) >= 25) {
    const warmth = Number((tempDelta / 4500).toFixed(3));
    filters.push(`colorbalance=rs=${warmth}:rm=${(warmth * 0.6).toFixed(3)}:bs=${(-warmth).toFixed(3)}:bm=${(-warmth * 0.6).toFixed(3)}`);
  }

  if (controls.curves) {
    const sh = Math.max(0.05, Math.min(0.45, 0.25 + controls.curves.shadows));
    const md = Math.max(0.25, Math.min(0.75, 0.5 + controls.curves.midtones));
    const hi = Math.max(0.55, Math.min(0.95, 0.75 + controls.curves.highlights));
    if (Math.abs(controls.curves.shadows) > 0.005 || Math.abs(controls.curves.midtones) > 0.005 || Math.abs(controls.curves.highlights) > 0.005) {
      filters.push(`curves=master='0/0 0.25/${sh.toFixed(3)} 0.5/${md.toFixed(3)} 0.75/${hi.toFixed(3)} 1/1'`);
    }
  }

  if (targetSpace === 'rec709') {
    filters.push('limiter=min=16:max=235');
  }
  return filters.join(',');
}

export function applyColorGradingControls(
  plan: ColorPipelinePlan,
  controls: ColorGradingControls,
  clipId?: string,
): ColorPipelinePlan {
  const targetSpace = controls.targetSpace ?? plan.targetSpace;
  const lut = controls.lutId ? resolveLutProvenance(controls.lutId) : plan.grades[0]?.lut;
  const ffmpegColorFilterChain = compileColorGradingToFfmpegChain({ ...controls, targetSpace });
  const grades = plan.grades.map((g) => {
    if (clipId && g.clipId !== clipId) return g;
    return {
      ...g,
      targetSpace,
      exposureCompensationEv: controls.exposureCompensationEv,
      contrastGain: controls.contrastGain,
      saturation: controls.saturation,
      temperatureKelvinDelta: controls.temperatureKelvinDelta,
      ...(lut ? { lut } : {}),
    };
  });
  return {
    ...plan,
    targetSpace,
    grades,
    ffmpegColorFilterChain,
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

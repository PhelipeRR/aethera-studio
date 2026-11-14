import { createHash } from 'node:crypto';
import type { CinemaProductionPackage } from '../index.js';
import {
  applyAudioMixerUpdates,
  type AudioStemRole,
  type SoundMixValidation,
} from '../audio/sound-engine.js';
import { planIncrementalSegmentRenders } from './editorial-engine.js';
import { recomputeTimelineFingerprints, type TimelineEffect } from '../ir/timeline-ir.js';

export interface PromptRevisionResult {
  pkg: CinemaProductionPackage;
  summary: string;
  affectedClipIds: string[];
  affectedBuses: AudioStemRole[];
  requiresVideoReRender: boolean;
  requiresAudioReRender: boolean;
  requiresMediaAcquisition: boolean;
  audioValidation?: SoundMixValidation;
}

const ORDINAL_MAP: Array<[RegExp, number]> = [
  [/\b(primeir[oa]|1º|1ª|cena\s*1|clipe\s*1)\b/i, 0],
  [/\b(segund[oa]|2º|2ª|cena\s*2|clipe\s*2)\b/i, 1],
  [/\b(terceir[oa]|3º|3ª|cena\s*3|clipe\s*3)\b/i, 2],
  [/\b(quart[oa]|4º|4ª|cena\s*4|clipe\s*4)\b/i, 3],
  [/\b(quint[oa]|5º|5ª|cena\s*5|clipe\s*5)\b/i, 4],
  [/\b(sext[oa]|6º|6ª|cena\s*6|clipe\s*6)\b/i, 5],
];

function makeEffect(
  effectId: string,
  kind: string,
  params: Record<string, number | string | boolean> = {},
): TimelineEffect {
  return {
    effectId,
    kind,
    params,
    enabled: true,
    estimatedCostMs: 8,
    fallbackMode: 'skip',
  };
}

function resolveTargetClipIndex(
  instruction: string,
  clipsLength: number,
  selectedClipId?: string,
  clips?: Array<{ clipId: string }>,
): number {
  for (const [pattern, idx] of ORDINAL_MAP) {
    if (pattern.test(instruction) && idx < clipsLength) {
      return idx;
    }
  }
  if (/\b([úu]ltim[oa]|final)\b/i.test(instruction) && clipsLength > 0) {
    return clipsLength - 1;
  }
  if (selectedClipId && clips) {
    const found = clips.findIndex((c) => c.clipId === selectedClipId);
    if (found >= 0) return found;
  }
  return 0;
}

export function applyPromptRevisionToPackage(
  pkg: CinemaProductionPackage,
  instruction: string,
  options?: { selectedClipId?: string },
): PromptRevisionResult {
  const normalized = instruction.trim();
  const lower = normalized.toLowerCase();

  let nextTimeline = {
    ...pkg.timeline,
    clips: pkg.timeline.clips.map((c) => ({ ...c, effects: [...c.effects] })),
  };
  let nextSoundPlan = pkg.soundPlan;
  let nextColorPlan = pkg.colorPlan;
  let audioValidation: SoundMixValidation | undefined;

  const affectedClipIds = new Set<string>();
  const affectedBuses = new Set<AudioStemRole>();
  const actions: string[] = [];
  let requiresVideoReRender = false;
  let requiresAudioReRender = false;
  let requiresMediaAcquisition = false;

  // 1. Audio / Ducking / Volume adjustments
  if (/(m[úu]sica|music|trilha|narra[çc][ãa]o|voz|voice|sfx|efeito|ambiente|ambience|volume|[áa]udio)/i.test(lower)) {
    const updates: Array<{
      stemRole: AudioStemRole;
      targetGainDb?: number;
      muted?: boolean;
      duckingUnderVoiceDb?: number;
    }> = [];
    const currentByRole = new Map(nextSoundPlan.stems.map((s) => [s.stemRole, s]));

    if (/(reduz|abaix|diminu|menor|menos|suaviz).*(m[úu]sica|trilha|music)|(m[úu]sica|trilha|music).*(baix|menor|reduz|suave)/i.test(lower)) {
      const music = currentByRole.get('music');
      const underSpeech = /(durante|na|sob|enquanto).*(narra[çc][ãa]o|voz|fala)/i.test(lower);
      updates.push({
        stemRole: 'music',
        targetGainDb: Math.max(-36, (music?.targetGainDb ?? -16) - (underSpeech ? 4 : 6)),
        duckingUnderVoiceDb: Math.max(-24, (music?.duckingUnderVoiceDb ?? -9) - 5),
      });
      affectedBuses.add('music');
      actions.push('redução de música/ducking sob narração');
      requiresAudioReRender = true;
    } else if (/(aument|sub|mais alto).*(m[úu]sica|trilha|music)/i.test(lower)) {
      const music = currentByRole.get('music');
      updates.push({ stemRole: 'music', targetGainDb: Math.min(-4, (music?.targetGainDb ?? -16) + 4) });
      affectedBuses.add('music');
      actions.push('aumento da trilha musical');
      requiresAudioReRender = true;
    }

    if (/(aument|sub|destac).*(narra[çc][ãa]o|voz|voice)/i.test(lower)) {
      const voice = currentByRole.get('voiceover');
      updates.push({ stemRole: 'voiceover', targetGainDb: Math.min(6, (voice?.targetGainDb ?? 0) + 2) });
      affectedBuses.add('voiceover');
      actions.push('reforço da narração');
      requiresAudioReRender = true;
    }

    if (/(sem|mut|remov|tir).*(sfx|efeito|ambiente|m[úu]sica)/i.test(lower)) {
      if (/sfx|efeito/i.test(lower)) {
        updates.push({ stemRole: 'sfx', muted: true });
        affectedBuses.add('sfx');
        actions.push('mute em SFX');
        requiresAudioReRender = true;
      }
      if (/ambiente|ambience/i.test(lower)) {
        updates.push({ stemRole: 'ambience', muted: true });
        affectedBuses.add('ambience');
        actions.push('mute em ambience');
        requiresAudioReRender = true;
      }
    }

    if (updates.length > 0) {
      const applied = applyAudioMixerUpdates(nextSoundPlan, updates);
      nextSoundPlan = applied.soundPlan;
      audioValidation = applied.validation;
    }
  }

  // 2. Title removal / typography adjustment
  if (/(remov|tir|ocult|sem|apag).*(t[íi]tulo|texto|card|legenda|overlay)/i.test(lower)) {
    const applyAll = /(todos|todas|os\s+t[íi]tulos|geral)/i.test(lower);
    if (applyAll) {
      nextTimeline.clips = nextTimeline.clips.map((c) => {
        affectedClipIds.add(c.clipId);
        const hasHide = c.effects.some((e) => e.kind === 'hide_title');
        return {
          ...c,
          effects: hasHide ? c.effects : [...c.effects, makeEffect(`hide_title_${c.clipId}`, 'hide_title')],
        };
      });
      actions.push('títulos removidos de todos os clipes');
    } else {
      const idx = resolveTargetClipIndex(lower, nextTimeline.clips.length, options?.selectedClipId, nextTimeline.clips);
      const target = nextTimeline.clips[idx];
      if (target) {
        affectedClipIds.add(target.clipId);
        if (!target.effects.some((e) => e.kind === 'hide_title')) {
          target.effects.push(makeEffect(`hide_title_${target.clipId}`, 'hide_title'));
        }
        actions.push(`título removido do clipe ${target.label}`);
      }
    }
    requiresVideoReRender = true;
  }

  // 3. Cinematic transitions
  if (/(transi[çc][ãa]o|transi[çc][õo]es|corte|xfade|dissolve|fade)/i.test(lower)) {
    const cinematic = /(cinematogr[áa]fic|suave|lenta|dissolve|org[âa]nic)/i.test(lower);
    const fast = /(r[áa]pid|seco|din[âa]mic|curt)/i.test(lower);
    const trKind = cinematic ? 'dissolve' : fast ? 'fade' : 'smoothleft';
    const trDur = cinematic ? 0.75 : fast ? 0.2 : 0.55;
    const targetIdx = resolveTargetClipIndex(lower, nextTimeline.clips.length, options?.selectedClipId, nextTimeline.clips);
    const applyAll = /(todas|transi[çc][õo]es|geral)/i.test(lower) || !/(essa|este|clipe|cena)/i.test(lower);
    nextTimeline.clips = nextTimeline.clips.map((c, idx) => {
      if (!applyAll && idx !== targetIdx) return c;
      affectedClipIds.add(c.clipId);
      const filtered = c.effects.filter((e) => e.kind !== 'transition');
      return {
        ...c,
        effects: [...filtered, makeEffect(`tr_${c.clipId}`, 'transition', { transitionKind: trKind, durationSec: trDur })],
      };
    });
    actions.push(`transição ajustada (${trKind} ${trDur}s)`);
    requiresVideoReRender = true;
  }

  // 4. Scene / Clip replacement
  if (/(troqu|substitu|mud|alter).*(cena|clipe|jogo|v[íi]deo|imagem)/i.test(lower)) {
    const idx = resolveTargetClipIndex(lower, nextTimeline.clips.length, options?.selectedClipId, nextTimeline.clips);
    const target = nextTimeline.clips[idx];
    if (target) {
      affectedClipIds.add(target.clipId);
      const filtered = target.effects.filter((e) => e.kind !== 'replace_requested');
      target.effects = [
        ...filtered,
        makeEffect(`replace_${target.clipId}`, 'replace_requested', { requestedAt: Date.now() }),
      ];
      target.label = `${target.label} (revisado)`;
      requiresVideoReRender = true;
      requiresMediaAcquisition = true;
      actions.push(`cena #${idx + 1} (${target.clipId}) marcada para substituição de mídia`);
    }
  }

  // 5. Color grading tweaks
  if (/(cor|contraste|satura[çc][ãa]o|quente|frio|rec709|cinema)/i.test(lower) && !/(transi[çc])/i.test(lower)) {
    let chain = nextColorPlan.ffmpegColorFilterChain;
    if (/mais contraste/i.test(lower)) {
      chain = chain.replace(/contrast=[\d.]+/, 'contrast=1.14');
      actions.push('contraste elevado para 1.14');
      requiresVideoReRender = true;
    }
    if (/mais satura/i.test(lower)) {
      chain = chain.replace(/saturation=[\d.]+/, 'saturation=1.18');
      actions.push('saturação elevada para 1.18');
      requiresVideoReRender = true;
    }
    if (chain !== nextColorPlan.ffmpegColorFilterChain) {
      nextColorPlan = { ...nextColorPlan, ffmpegColorFilterChain: chain };
    }
  }

  // Fallback if no specific keyword matched: record as targeted edit on selected clip
  if (actions.length === 0) {
    const idx = resolveTargetClipIndex(lower, nextTimeline.clips.length, options?.selectedClipId, nextTimeline.clips);
    const target = nextTimeline.clips[idx];
    if (target) {
      affectedClipIds.add(target.clipId);
      requiresVideoReRender = true;
      actions.push(`revisão aplicada ao clipe ${target.label}: "${normalized}"`);
    }
  }

  nextTimeline = recomputeTimelineFingerprints({
    ...nextTimeline,
    version: nextTimeline.version + 1,
  });

  const mixSalt = createHash('sha256')
    .update(JSON.stringify({ stems: nextSoundPlan.stems, color: nextColorPlan.ffmpegColorFilterChain }))
    .digest('hex')
    .slice(0, 8);
  nextTimeline.renderFingerprint = `${nextTimeline.renderFingerprint.slice(0, 8)}_${mixSalt}`;

  const segmentPlan = planIncrementalSegmentRenders({
    previous: pkg.timeline,
    next: nextTimeline,
    cachedFingerprints: new Set(),
    profile: pkg.renderProfile.profile,
  });

  const nextPkg: CinemaProductionPackage = {
    ...pkg,
    timeline: nextTimeline,
    soundPlan: nextSoundPlan,
    colorPlan: nextColorPlan,
    segmentPlan,
  };

  return {
    pkg: nextPkg,
    summary: actions.join('; '),
    affectedClipIds: [...affectedClipIds],
    affectedBuses: [...affectedBuses],
    requiresVideoReRender,
    requiresAudioReRender,
    requiresMediaAcquisition,
    ...(audioValidation ? { audioValidation } : {}),
  };
}

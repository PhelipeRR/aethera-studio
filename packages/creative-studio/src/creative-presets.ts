import type { CreativeArtType } from './schemas.js';

export type ProfessionalPresetId =
  | 'anime_premium_cinematic'
  | 'gaming_cinematic'
  | 'cyberpunk_neon'
  | 'youtube_thumbnail_1280x720'
  | 'banner_2560x1440';

export interface ProfessionalPreset {
  id: ProfessionalPresetId;
  label: string;
  artType: CreativeArtType;
  width: number;
  height: number;
  promptPrefix: string;
  negativePrompt: string;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  recommendedModelFamily: 'sdxl' | 'sdxl-turbo';
  textSafeZone: { x: number; y: number; width: number; height: number } | null;
}

const PRESETS: Record<ProfessionalPresetId, ProfessionalPreset> = {
  anime_premium_cinematic: {
    id: 'anime_premium_cinematic',
    label: 'Anime Premium / Cinematic',
    artType: 'thumbnail',
    width: 1280,
    height: 720,
    promptPrefix: 'premium anime cinematic key visual, polished cel shading, expressive faces, clean line art, filmic depth',
    negativePrompt: 'flat generic anime, chibi proportions, muddy colors, duplicate character, malformed hands',
    steps: 12,
    cfg: 5.5,
    samplerName: 'dpmpp_2m',
    scheduler: 'karras',
    recommendedModelFamily: 'sdxl',
    textSafeZone: { x: 0, y: 0, width: 704, height: 720 },
  },
  gaming_cinematic: {
    id: 'gaming_cinematic',
    label: 'Gaming Cinematic',
    artType: 'thumbnail',
    width: 1280,
    height: 720,
    promptPrefix: 'AAA gaming cinematic key art, high fidelity 3d characters, dramatic action pose, controlled depth, sharp silhouette',
    negativePrompt: 'generic stock render, UI overlay, logo, game screenshot, unreadable details, extra limbs',
    steps: 12,
    cfg: 5.8,
    samplerName: 'dpmpp_2m',
    scheduler: 'karras',
    recommendedModelFamily: 'sdxl',
    textSafeZone: { x: 0, y: 0, width: 704, height: 720 },
  },
  cyberpunk_neon: {
    id: 'cyberpunk_neon',
    label: 'Cyberpunk Neon',
    artType: 'thumbnail',
    width: 1280,
    height: 720,
    promptPrefix: 'cinematic cyberpunk neon key art, rain-slick futuristic city, magenta and cyan rim light, readable subject silhouette',
    negativePrompt: 'neon signage, gibberish letters, random text, flat gradient, overexposed bloom, duplicate limbs',
    steps: 12,
    cfg: 5.2,
    samplerName: 'dpmpp_2m',
    scheduler: 'karras',
    recommendedModelFamily: 'sdxl',
    textSafeZone: { x: 0, y: 0, width: 704, height: 720 },
  },
  youtube_thumbnail_1280x720: {
    id: 'youtube_thumbnail_1280x720',
    label: 'YouTube Thumbnail 1280×720',
    artType: 'thumbnail',
    width: 1280,
    height: 720,
    promptPrefix: 'professional YouTube thumbnail key art, one clear focal subject, high contrast, strong silhouette, clean negative space for editor text',
    negativePrompt: 'text, letters, watermark, logo, cluttered composition, weak contrast, blurry subject, extra limbs',
    steps: 10,
    cfg: 5,
    samplerName: 'euler',
    scheduler: 'normal',
    recommendedModelFamily: 'sdxl',
    textSafeZone: { x: 0, y: 0, width: 704, height: 720 },
  },
  banner_2560x1440: {
    id: 'banner_2560x1440',
    label: 'Banner 2560×1440',
    artType: 'banner',
    width: 2560,
    height: 1440,
    promptPrefix: 'professional cinematic channel banner, wide panoramic composition, balanced edge subjects, calm center safe area, layered depth',
    negativePrompt: 'text, letters, signage, logo, watermark, busy center, flat gradient, cropped subjects, malformed anatomy',
    steps: 12,
    cfg: 5.5,
    samplerName: 'dpmpp_2m',
    scheduler: 'karras',
    recommendedModelFamily: 'sdxl',
    textSafeZone: { x: 507, y: 508, width: 1546, height: 423 },
  },
};

export function listProfessionalPresets(): ProfessionalPreset[] {
  return Object.values(PRESETS);
}

export function getProfessionalPreset(id: ProfessionalPresetId): ProfessionalPreset {
  return PRESETS[id];
}

export function resolveProfessionalPreset(artType: CreativeArtType, prompt: string): ProfessionalPresetId {
  const lower = prompt.toLowerCase();
  if (artType === 'banner') return 'banner_2560x1440';
  if (/cyberpunk|neon|cyberpunk/i.test(lower)) return 'cyberpunk_neon';
  if (/anime|mang[aá]|otaku/i.test(lower)) return 'anime_premium_cinematic';
  if (/game|gaming|gamer|jogo|videogame/i.test(lower)) return 'gaming_cinematic';
  return 'youtube_thumbnail_1280x720';
}

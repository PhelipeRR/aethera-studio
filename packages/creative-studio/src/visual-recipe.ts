import { createHash } from 'node:crypto';
import { ART_SPECIFICATIONS, type BrandKit, type CreativeArtType } from './schemas.js';
import { getProfessionalPreset, resolveProfessionalPreset, type ProfessionalPresetId } from './creative-presets.js';
import { planMultiCharacterComposition, type CharacterRegion } from './multi-character-composition.js';
import { nearestSdxlBucket } from './checkpoint-profiles.js';

/**
 * CF-1 — Visual recipe: turns the user's brief (any language), the creative direction from the reasoning engines and
 * the Brand Kit into a structured English prompt for diffusion models.
 *
 * Why: SDXL's CLIP text encoders are English-trained and truncate at 77 tokens, so the raw pt-BR brief (with words
 * like "identidade visual profissional") produced weak, generic images. The recipe keeps the important visual nouns,
 * states the composition explicitly (where the title will live) and never puts the channel name / headline into the
 * image prompt: text is always rendered by the editor, never by the diffusion model.
 */

export type VisualPresetId =
  | 'anime_thumbnail'
  | 'game_thumbnail'
  | 'geek_banner'
  | 'cinematic_cover'
  | 'avatar'
  | 'logo_element';

/** Structured direction returned by a reasoning engine (all fields optional, English, untrusted). */
export interface CreativeDirectionNotes {
  headline?: string;
  subject?: string;
  setting?: string;
  effects?: string;
  lighting?: string;
  camera?: string;
  style?: string;
  /** One short description per character when the brief has a cast (multi-character scenes). */
  characters?: string[];
}

export interface TextSafeZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualRecipe {
  preset: VisualPresetId;
  professionalPreset: ProfessionalPresetId;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  /** Generation size requested from the image engine (aspect of the final art, max side 1024). */
  width: number;
  height: number;
  /** Where the editor will place text, in final-art pixels. The image must stay calm there. */
  textSafeZones: TextSafeZone[];
  source: 'deterministic' | 'reasoning_engine';
  /** Visual terms recognised in the brief (for traceability in the console / reports). */
  recognisedTerms: string[];
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  stylization: number;
  characterCount: number;
  /** Regions carry a solo prompt each; the engine binds it to the region with native area conditioning. */
  characterRegions: Array<CharacterRegion & { prompt?: string }>;
  /** Scene-only prompt (style, setting, lighting; no cast) for the area around the characters. */
  scenePrompt?: string;
  /** Where each per-character description came from: the brief, the creative direction, or generic traits. */
  characterSource?: 'explicit' | 'direction' | 'derived_from_subject' | 'generic_traits';
  /** Generation-pixel areas kept calm and free of characters (banner title safe area). */
  calmZones?: TextSafeZone[];
}

export interface VisualRecipeInput {
  artType: CreativeArtType;
  prompt: string;
  headline?: string;
  brandKit?: BrandKit | null;
  direction?: CreativeDirectionNotes | null;
  /** Explicit seed; otherwise derived from `seedKey` (or the prompt) so a recipe is reproducible. */
  seed?: number;
  seedKey?: string;
  /**
   * Max side of the generation size. When omitted, the recipe uses the nearest native SDXL bucket (e.g. 1344x768
   * for 16:9): generating below the training buckets letterboxed and shrank subjects on Animagine XL 3.1.
   */
  maxSide?: number;
  professionalPreset?: ProfessionalPresetId;
  characterCount?: number;
  /** 0 = restrained/content-faithful, 1 = strongly stylized; mapped to explicit prompt vocabulary. */
  stylization?: number;
  /** Explicit per-character descriptions (one per character); takes precedence over the creative direction. */
  characterDescriptions?: string[];
}

/** Ordered pt-BR/EN visual vocabulary → English phrase. Longer, more specific patterns first. */
const VISUAL_GLOSSARY: Array<[RegExp, string]> = [
  [/personage(?:m|ns)\s+origina(?:l|is)|original\s+characters?/i, 'original characters'],
  [/efeitos?\s+de\s+energia|energy\s+effects?/i, 'glowing energy effects'],
  [/cen[aá]rios?\s+futurist[ao]s?|futuristic\s+(?:city|scenery|setting)s?/i, 'futuristic skyline with glowing towers'],
  [/ilumina[cç][aã]o\s+dram[aá]tica|dramatic\s+lighting/i, 'dramatic rim lighting'],
  // "neon city/signs" makes guidance-free models (SDXL-Turbo) paint gibberish signage: keep it to light only.
  [/ilumina[cç][aã]o\s+neon|neon/i, 'neon glow lighting'],
  [/cyberpunk/i, 'cyberpunk'],
  [/animes?\b|mang[aá]s?\b/i, 'anime'],
  [/\b(?:games?|jogos?|videogames?|video\s*games?|gamer)\b/i, 'video game'],
  [/\bmecha\b|rob[oô]s?\b|robots?\b/i, 'giant mecha robots'],
  [/drag(?:[aã]o|[oõ]es)|dragons?/i, 'dragon'],
  [/espadas?|swords?/i, 'sword'],
  [/guerreir[oa]s?|warriors?/i, 'warrior'],
  [/samurai/i, 'samurai'],
  [/ninjas?/i, 'ninja'],
  [/her[oó]is?|heroes|hero\b/i, 'heroes'],
  [/vil[aã]o|vil[oõ]es|villains?/i, 'villain'],
  [/magia|m[aá]gic[ao]s?|magic/i, 'magic spells'],
  [/fogo|chamas?|fire|flames?/i, 'fire'],
  [/raios?\b|rel[aâ]mpagos?|lightning/i, 'lightning'],
  [/explos[aã]o|explos[oõ]es|explosions?/i, 'explosion'],
  [/batalhas?|lutas?|combate|battles?|fight/i, 'epic battle'],
  [/espa[cç]o\s+sideral|gal[aá]xias?|cosmos|outer\s+space|galax(?:y|ies)/i, 'outer space galaxy'],
  [/fantasia|fantasy/i, 'fantasy'],
  [/terror|horror/i, 'horror'],
  [/floresta|forest/i, 'forest'],
  [/castelos?|castles?/i, 'castle'],
  [/montanhas?|mountains?/i, 'mountains'],
  [/oceano|mar\b|ocean|sea\b/i, 'ocean'],
  [/chuva|rain/i, 'rain'],
  [/noite|noturn[oa]|night/i, 'night'],
  [/p[oô]r\s+do\s+sol|sunset/i, 'sunset'],
  [/cidade|city/i, 'city'],
  [/ru[ií]nas|ruins/i, 'ancient ruins'],
  [/tecnologia|tech(?:nology)?/i, 'high technology'],
  [/retr[oô]|pixel\s*art|8[- ]?bit/i, 'retro pixel art'],
];

const PRESET_STYLE: Record<VisualPresetId, string> = {
  anime_thumbnail: 'anime key visual, cel shading, vibrant saturated colors, clean line art',
  game_thumbnail: 'AAA video game cover art, highly detailed 3d render',
  geek_banner: 'epic cinematic key art, anime and video game inspired digital painting',
  cinematic_cover: 'cinematic movie poster, film still, anamorphic lens, color graded',
  avatar: 'character portrait illustration, clean shapes, strong silhouette',
  logo_element: 'flat vector emblem icon, bold simple shapes',
};

const COMPOSITION: Record<CreativeArtType, string> = {
  banner: 'ultra wide panoramic shot, heroes at far left and far right, calm dark empty center band, deep background',
  thumbnail: 'main subject on the right third, clean darker negative space on the left, strong silhouette, high contrast',
  avatar: 'single centered bust portrait, plain simple background',
  watermark: 'single centered emblem, plain flat background',
};

const DEFAULT_SUBJECT: Record<VisualPresetId, string> = {
  anime_thumbnail: 'expressive anime character',
  game_thumbnail: 'heroic video game character',
  geek_banner: 'original anime and video game heroes in dynamic poses',
  cinematic_cover: 'lone heroic figure',
  avatar: 'friendly original mascot character',
  logo_element: 'abstract geometric emblem',
};

const BASE_NEGATIVE =
  'text, letters, words, typography, title, caption, watermark, logo, signature, ' +
  'blurry, lowres, jpeg artifacts, deformed, bad anatomy, extra limbs, flat empty background, plain gradient';

/** Cap applied to the positive prompt: CLIP truncates at 77 tokens, so the most important parts go first. */
const MAX_PROMPT_WORDS = 62;

function sanitizeNote(value: unknown, maxChars = 160): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .split('')
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('')
    .replace(/["`<>{}[\]\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
  return cleaned.length >= 3 ? cleaned : undefined;
}

/**
 * Parses the creative-direction answer of a reasoning engine. Accepts a JSON object (preferred) and the legacy
 * `HEADLINE: ...` line. Everything is treated as untrusted data: unknown keys are dropped and values are sanitised.
 */
export function parseCreativeDirectionNotes(text: string): CreativeDirectionNotes | null {
  if (!text) return null;
  const notes: CreativeDirectionNotes = {};
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      for (const key of ['subject', 'setting', 'effects', 'lighting', 'camera', 'style'] as const) {
        const v = sanitizeNote(raw[key]);
        if (v) notes[key] = v;
      }
      const h = sanitizeNote(raw['headline'], 42);
      if (h) notes.headline = h;
      if (Array.isArray(raw['characters'])) {
        const characters = raw['characters'].slice(0, 8).map((value) => sanitizeNote(value, 120)).filter((value): value is string => Boolean(value));
        if (characters.length) notes.characters = characters;
      }
    } catch {
      // not JSON: fall through to the legacy line format
    }
  }
  if (!notes.headline) {
    const legacy = text.match(/HEADLINE:\s*([^\n\r]{3,42})/i);
    const h = sanitizeNote(legacy?.[1], 42);
    if (h) notes.headline = h;
  }
  return Object.keys(notes).length > 0 ? notes : null;
}

/** Deterministic 31-bit seed from a key (project id + variant label, or the prompt). */
export function deriveSeed(key: string): number {
  return createHash('sha256').update(key).digest().readUInt32BE(0) & 0x7fffffff;
}

export function detectVisualPreset(artType: CreativeArtType, prompt: string): VisualPresetId {
  if (artType === 'avatar') return 'avatar';
  if (artType === 'watermark') return 'logo_element';
  const lower = prompt.toLowerCase();
  const anime = /\banimes?\b|mang[aá]|otaku/.test(lower);
  const game = /\b(?:games?|jogos?|videogames?|gamer|gameplay)\b/.test(lower);
  const geek = /\bgeek|nerd|cultura\s+pop/.test(lower);
  if (artType === 'banner') return anime || game || geek ? 'geek_banner' : 'cinematic_cover';
  if (anime && !game) return 'anime_thumbnail';
  if (game) return 'game_thumbnail';
  return 'cinematic_cover';
}

/** Coarse English colour name for a hex value (used to steer the palette without exact hex codes). */
export function describeHexColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return 'neutral';
  const hexDigits = m[1];
  if (!hexDigits) return 'neutral';
  const n = Number.parseInt(hexDigits, 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 0.08) return l < 0.2 ? 'black' : l > 0.85 ? 'white' : 'grey';
  const hue = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const normalizedHue = (hue + 360) % 360;
  if (normalizedHue < 15 || normalizedHue >= 345) return 'red';
  if (normalizedHue < 40) return 'orange';
  if (normalizedHue < 65) return 'yellow';
  if (normalizedHue < 160) return 'green';
  if (normalizedHue < 200) return 'cyan';
  if (normalizedHue < 250) return 'blue';
  if (normalizedHue < 290) return 'purple';
  return 'magenta';
}

function textSafeZonesFor(artType: CreativeArtType): TextSafeZone[] {
  const spec = ART_SPECIFICATIONS[artType];
  if (artType === 'banner' && spec.safeArea) return [spec.safeArea];
  if (artType === 'thumbnail') {
    return [{ x: 0, y: 0, width: Math.round(spec.width * 0.55), height: spec.height }];
  }
  return [];
}

/**
 * Visual differentiators assigned per region when the brief does not describe each character. Without them every
 * region receives the same text and SDXL tends to clone one face across the group.
 */
const DISTINCT_TRAITS = [
  'spiky black hair, determined expression',
  'long silver hair, calm expression',
  'short red hair, fierce grin',
  'blonde ponytail, focused eyes',
  'dark blue hair, serious expression',
  'white hair with hood, confident smile',
  'green hair, shouting battle cry',
  'purple hair, cool smirk',
];

/**
 * Splits a cast description such as "Three heroes: left hooded hacker crouching, center armored brawler, right sniper"
 * into one description per character. Returns null when the split does not match the requested count, so a region
 * never receives the whole cast.
 */
export function splitCastDescription(subject: string, count: number): string[] | null {
  if (count < 2) return null;
  const body = subject.includes(':') ? subject.slice(subject.indexOf(':') + 1) : subject;
  const positional = /(?:^|[;,]\s*|\s+and\s+)(?=(?:the\s+)?(?:far\s+)?(?:left|right|center|centre|middle|front|back|first|second|third)\b)/i;
  let pieces = body.split(positional);
  if (pieces.length !== count) pieces = body.split(/;/);
  const cleaned = pieces
    .map((piece) => piece.trim().replace(/^(?:the\s+)?(?:far\s+)?(?:left|right|center|centre|middle|front|back|first|second|third)\b\s*(?:one|fighter|character|figure)?\s*(?:is|:|-)?\s*/i, '').replace(/[.;,\s]+$/g, '').trim())
    .filter((piece) => piece.split(/\s+/).length >= 2);
  return cleaned.length === count ? cleaned : null;
}

const COUNT_WORDS = /\b(?:two|three|four|five|six|seven|eight|nine|ten|dois|duas|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|\d+)\s+/gi;

/** Removes group/count wording so a per-region prompt describes one character instead of the whole cast. */
export function stripGroupWording(subject: string): string {
  return subject
    .replace(/\s*\b(?:arranged\s+)?in\s+(?:a\s+)?(?:readable\s+)?(?:two|three|\d+)-row group\b/gi, '')
    .replace(COUNT_WORDS, '')
    .replace(/\b(?:group of|grupo de|duo of|trio of|a pair of)\s+/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  return words.length <= maxWords ? text : words.slice(0, maxWords).join(' ').replace(/[,\s]+$/, '');
}

function stripBrandTokens(value: string, banned: string[]): string {
  let out = value;
  for (const token of banned) {
    if (token.length < 2) continue;
    out = out.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function buildVisualRecipe(input: VisualRecipeInput): VisualRecipe {
  const spec = ART_SPECIFICATIONS[input.artType];
  const characterCount = input.characterCount ?? 1;
  const preset = detectVisualPreset(input.artType, input.prompt);
  const professionalPresetId = input.professionalPreset ?? resolveProfessionalPreset(input.artType, input.prompt);
  const professionalPreset = getProfessionalPreset(professionalPresetId);
  const direction = input.direction ?? null;
  const stylization = Math.max(0, Math.min(1, input.stylization ?? 0.7));
  const recognised: string[] = [];
  for (const [pattern, phrase] of VISUAL_GLOSSARY) {
    if (pattern.test(input.prompt) && !recognised.includes(phrase)) recognised.push(phrase);
  }
  // "anime" and "video game" are already carried by the preset style for these presets
  const subjectTerms = recognised.filter(
    (t) => !(preset === 'geek_banner' && (t === 'anime' || t === 'video game' || t === 'original characters')),
  );

  // Never let the channel name or the headline reach the image prompt: diffusion would try to draw letters.
  const banned = [input.headline ?? '', input.brandKit?.channelName ?? '', direction?.headline ?? '']
    .flatMap((v) => v.split(/\s+/))
    .filter((w) => w.length >= 3);

  const palette = input.brandKit?.palette;
  const paletteText = palette
    ? `${Array.from(new Set([describeHexColor(palette.primary), describeHexColor(palette.secondary)])).join(' and ')} color palette`
    : '';

  const subject = direction?.subject ?? DEFAULT_SUBJECT[preset];
  const multi = characterCount > 1;
  // Multi-character scenes keep the cast out of the global prompt: the global conditioning covers the whole canvas,
  // so a cast description there re-rendered the group outside the regions (CS9 root cause). The cast lives only in
  // the per-region prompts, and the global prompt states the count plus the scene.
  const parts = [
    input.professionalPreset ? professionalPreset.promptPrefix : undefined,
    direction?.style ?? PRESET_STYLE[preset],
    stylization < 0.4 ? 'restrained stylization, grounded proportions, content-faithful details' : stylization > 0.8 ? 'highly stylized artistic treatment, bold visual exaggeration' : undefined,
    multi ? `${characterCount} characters, each clearly separated` : subject,
    multi ? undefined : COMPOSITION[input.artType],
    direction?.setting,
    direction?.effects,
    multi ? subjectTerms.filter((term) => !/warrior|heroes|villain|samurai|ninja|original characters/i.test(term)).join(', ') : subjectTerms.join(', '),
    direction?.lighting ?? (preset === 'logo_element' ? undefined : 'dramatic rim lighting, volumetric light'),
    direction?.camera,
    paletteText,
    preset === 'logo_element' || preset === 'avatar' ? undefined : 'highly detailed, depth of field',
  ]
    .map((p) => (p ? stripBrandTokens(p, banned) : ''))
    .filter((p) => p.length > 0);

  // Phrase-level de-duplication (glossary terms often repeat the preset defaults).
  const phrases: string[] = [];
  for (const phrase of parts.join(', ').split(/\s*,\s*/)) {
    const key = phrase.toLowerCase();
    if (phrase && !phrases.some((p) => p.toLowerCase() === key)) phrases.push(phrase);
  }
  const positivePrompt = capWords(phrases.join(', '), MAX_PROMPT_WORDS);
  const bucket = nearestSdxlBucket(spec.width, spec.height);
  const scale = input.maxSide !== undefined ? Math.min(1, input.maxSide / Math.max(spec.width, spec.height)) : 1;
  const width = input.maxSide !== undefined ? Math.max(256, Math.round((spec.width * scale) / 8) * 8) : bucket.width;
  const height = input.maxSide !== undefined ? Math.max(256, Math.round((spec.height * scale) / 8) * 8) : bucket.height;
  // Banner: the title safe area (in generation pixels) is a keep-out zone for characters and a calm zone for the scene.
  const calmZones = input.artType === 'banner' && spec.safeArea
    ? [{
        x: Math.round((spec.safeArea.x / spec.width) * width),
        y: Math.round((spec.safeArea.y / spec.height) * height),
        width: Math.round((spec.safeArea.width / spec.width) * width),
        height: Math.round((spec.safeArea.height / spec.height) * height),
      }]
    : undefined;
  const characterPlan = planMultiCharacterComposition({ width, height, characterCount, ...(calmZones?.[0] ? { keepOut: calmZones[0] } : {}) });
  const characterStyle = stripBrandTokens(direction?.style ?? PRESET_STYLE[preset], banned);
  const scenePrompt = capWords(
    [characterStyle, direction?.setting, direction?.effects, direction?.lighting ?? 'dramatic rim lighting'].filter(Boolean).map((v) => stripBrandTokens(v as string, banned)).join(', '),
    MAX_PROMPT_WORDS,
  );
  const explicit = input.characterDescriptions?.length === characterCount ? input.characterDescriptions : undefined;
  const fromDirection = direction?.characters?.length === characterCount ? direction.characters : undefined;
  const derived = multi ? splitCastDescription(subject, characterCount) : null;
  const castDescriptions = explicit ?? fromDirection ?? derived ?? undefined;
  const characterSource: VisualRecipe['characterSource'] = explicit ? 'explicit' : fromDirection ? 'direction' : derived ? 'derived_from_subject' : 'generic_traits';
  const genericRole = subjectTerms.filter((term) => !/epic battle|city|night|rain|fire|explosion|sunset|ruins/i.test(term)).join(', ') || DEFAULT_SUBJECT[preset];
  const characterRegions = multi
    ? characterPlan.regions.map((region) => ({
        ...region,
        prompt: capWords(
          [
            'solo, single character, full body',
            castDescriptions ? stripBrandTokens(stripGroupWording(castDescriptions[region.index] ?? ''), banned) : `${DISTINCT_TRAITS[region.index % DISTINCT_TRAITS.length]}, ${genericRole}`,
            scenePrompt,
          ].filter(Boolean).join(', '),
          MAX_PROMPT_WORDS,
        ),
      }))
    : characterPlan.regions;
  const seed = input.seed ?? deriveSeed(input.seedKey ?? `${input.artType}:${input.prompt}`);

  return {
    preset,
    professionalPreset: professionalPresetId,
    positivePrompt,
    negativePrompt: `${BASE_NEGATIVE}, ${professionalPreset.negativePrompt}`,
    seed,
    width,
    height,
    textSafeZones: textSafeZonesFor(input.artType),
    source: direction && (direction.subject || direction.setting || direction.style) ? 'reasoning_engine' : 'deterministic',
    recognisedTerms: recognised,
    steps: professionalPreset.steps,
    cfg: professionalPreset.cfg,
    samplerName: professionalPreset.samplerName,
    scheduler: professionalPreset.scheduler,
    stylization,
    characterCount,
    characterRegions,
    ...(multi ? { scenePrompt, characterSource } : {}),
    ...(calmZones ? { calmZones } : {}),
  };
}

/** Prompt sent to the creative-direction engine: asks for a structured English answer (parsed as untrusted data). */
export function buildCreativeDirectionPrompt(artType: CreativeArtType, safeBrief: string): string {
  return [
    `[Aethera Creative Studio :: creative_direction] ArtType=${artType}. UserBrief=${JSON.stringify(safeBrief)}.`,
    'You are the art director. Describe ONE strong image for a diffusion model, in English.',
    'Reply with a single JSON object and nothing else, keys: headline (max 3 words, for the editor overlay),',
    'subject (who/what, pose, action), setting (environment, depth layers), effects (vfx), lighting, camera (shot, lens, angle), style,',
    'characters (array with one short visual description per character, only when the brief has two or more characters).',
    'Each value under 25 words. Do not ask for any text, letters, logo or channel name inside the image.',
  ].join(' ');
}

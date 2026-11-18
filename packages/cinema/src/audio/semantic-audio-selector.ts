import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { RealAudioAssetRef, RealSfxAssetRef } from './real-audio-assets.js';

export interface LocalAudioLibraryEntry {
  id: string;
  path: string;
  bytes?: number;
}

export interface SemanticSfxQuery {
  id: string;
  eventType: 'transition' | 'impact' | 'reveal' | 'ui_pop' | 'comic_sting' | 'whoosh';
  atMs: number;
  gainDb?: number;
}

const EXCLUDED_VEHICLE_AND_NOISE_TERMS = [
  'suzuki',
  'corvette',
  'harley',
  'yamaha',
  'honda',
  'kawasaki',
  'motorcycle',
  'motorbike',
  'intruder',
  'atv',
  'arctic cat',
  'engine',
  'exhaust',
  'revving',
  'horn',
  'siren',
  'diesel',
  'tractor',
  'chainsaw',
  'bark',
  'toilet',
  'burp',
  'fart',
];

const EVENT_KEYWORDS: Record<SemanticSfxQuery['eventType'], string[]> = {
  transition: ['transition', 'whoosh', 'swish', 'riser', 'sweep', 'cinematic', 'ui'],
  whoosh: ['whoosh', 'swish', 'sweep', 'air', 'transition'],
  impact: ['impact', 'hit', 'boom', 'slam', 'thud', 'punch', 'explosion'],
  reveal: ['reveal', 'riser', 'dragon', 'stinger', 'chime', 'activation', 'power'],
  ui_pop: ['ui', 'interface', 'beep', 'click', 'glitch', 'data', 'qantum', 'futuristic', 'retro'],
  comic_sting: ['glitch', 'blip', 'boing', 'pop', 'anime', 'droid', 'retro', 'record'],
};

const MUSIC_KEYWORDS = ['music', 'bgm', 'soundtrack', 'score', 'instrumental', 'synthwave', 'lofi'];

/**
 * Scores a local audio file path against an editorial SFX event type and video domain.
 * Rejects clearly unrelated recordings (e.g., motorcycles/engines in a gaming essay).
 */
export function scoreSemanticSfxCandidate(
  filePath: string,
  eventType: SemanticSfxQuery['eventType'],
  domainText: string,
): number {
  const lowerPath = filePath.toLowerCase();
  const lowerDomain = domainText.toLowerCase();

  if (!/\.(wav|mp3|ogg|m4a|flac)$/i.test(lowerPath)) return -100;

  const domainMentionsVehicles = /\b(moto|motorcycle|car|carro|racing|corrida|ve[ií]culo|gta|motor)\b/i.test(lowerDomain);
  const isTransitionOrUi = eventType === 'transition' || eventType === 'whoosh' || eventType === 'ui_pop' || eventType === 'reveal' || eventType === 'comic_sting';

  for (const blocked of EXCLUDED_VEHICLE_AND_NOISE_TERMS) {
    if (lowerPath.includes(blocked) && (isTransitionOrUi || !domainMentionsVehicles)) {
      return -100;
    }
  }

  let score = 0;
  for (const kw of EVENT_KEYWORDS[eventType]) {
    if (lowerPath.includes(kw)) score += 12;
  }

  if (/\b(game|gaming|pixel|retro|mario|sonic|cyberpunk|anime)\b/i.test(lowerDomain)) {
    if (/(retro|ui|interface|anime|glitch|sci[-_ ]?fi|futuristic|cinematic|transition|activation|qantum)/i.test(lowerPath)) {
      score += 10;
    }
  }

  // Slight preference for concise SFX filenames over raw ambient textures when looking for transitions/hits
  if (isTransitionOrUi && /(texture|hum|ambience|room_tone)/i.test(lowerPath)) {
    score -= 6;
  }

  return score;
}

/**
 * Selects semantically compatible SFX files from a local library without ever picking unrelated
 * recordings (like motorcycles) just because they exist on disk.
 */
export function selectSemanticSfxFromLibrary(
  entries: readonly LocalAudioLibraryEntry[],
  queries: readonly SemanticSfxQuery[],
  domainText: string,
): RealSfxAssetRef[] {
  const usedPaths = new Set<string>();
  const selected: RealSfxAssetRef[] = [];

  for (const query of queries) {
    const scored = entries
      .filter((entry) => existsSync(entry.path))
      .map((entry) => ({
        entry,
        score: scoreSemanticSfxCandidate(entry.path, query.eventType, domainText),
      }))
      .filter((item) => item.score > 0 && !usedPaths.has(item.entry.path))
      .sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path));

    const best = scored[0];
    if (!best) continue;
    usedPaths.add(best.entry.path);
    selected.push({
      id: `${query.id}_${basename(best.entry.path, '.wav').slice(0, 24)}`,
      path: best.entry.path,
      license: 'local-library-authorized',
      origin: 'velix_local_assets',
      useConditions: 'uso autorizado na biblioteca local do usuário',
      sourceKind: 'library',
      atMs: query.atMs,
      gainDb: query.gainDb ?? -14,
    });
  }

  return selected;
}

/**
 * Picks compatible background music candidates from local library entries (excluding short SFX).
 */
export function selectMusicFromLibrary(
  entries: readonly LocalAudioLibraryEntry[],
  domainText: string,
): RealAudioAssetRef[] {
  const lowerDomain = domainText.toLowerCase();
  return entries
    .filter((entry) => {
      if (!existsSync(entry.path)) return false;
      const fileAndPack = `${basename(dirname(entry.path))} ${basename(entry.path)}`.toLowerCase();
      if (!/\.(wav|mp3|ogg|m4a|flac)$/i.test(fileAndPack)) return false;
      if (EXCLUDED_VEHICLE_AND_NOISE_TERMS.some((term) => fileAndPack.includes(term))) return false;
      if (/(roomtone|ambisonic|foley|sfx|sound\s*fx|ui|interface|explosion|riser|whoosh)/i.test(fileAndPack)) {
        return false;
      }
      if ((entry.bytes ?? 0) > 0 && (entry.bytes ?? 0) < 2_000_000) return false;
      return MUSIC_KEYWORDS.some((kw) => fileAndPack.includes(kw));
    })
    .sort((a, b) => {
      const aLabel = `${basename(dirname(a.path))} ${basename(a.path)}`.toLowerCase();
      const bLabel = `${basename(dirname(b.path))} ${basename(b.path)}`.toLowerCase();
      const aScore = MUSIC_KEYWORDS.filter((kw) => aLabel.includes(kw) && lowerDomain.includes(kw)).length;
      const bScore = MUSIC_KEYWORDS.filter((kw) => bLabel.includes(kw) && lowerDomain.includes(kw)).length;
      return bScore - aScore || (b.bytes ?? 0) - (a.bytes ?? 0);
    })
    .slice(0, 5)
    .map((entry) => ({
      path: entry.path,
      license: 'local-library-authorized',
      origin: 'velix_local_assets',
      useConditions: 'trilha musical da biblioteca local do usuário',
      sourceKind: 'library' as const,
    }));
}

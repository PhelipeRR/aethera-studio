import type { DuckEnvelope, MusicTrack, SfxEvent } from './aethera-audio.js';
import type { TimelineDocument } from './aethera-timeline.js';

export interface ContextualMusicPrompt {
  genre: string;
  emotion: string;
  intensity: 'low' | 'medium' | 'high';
  bpm: number;
  durationMs: number;
  mood: string[];
  prompt: string;
}

const KEYWORD_MOOD_MAP: Array<{ keywords: RegExp; genre: string; emotion: string; intensity: 'low' | 'medium' | 'high'; bpm: number }> = [
  { keywords: /\b(cyberpunk|tech|futur\w*|glitch|neon|ia|rede)\b/iu, genre: 'cinematic electronic', emotion: 'tensão tecnológica', intensity: 'high', bpm: 118 },
  { keywords: /\b(buraco|cosmos|universo|farol|mist[eé]rio|espa[cç]o)\b/iu, genre: 'ambient orchestral', emotion: 'mistério cósmico', intensity: 'medium', bpm: 84 },
  { keywords: /\b(fila|filas|dados|estat[ií]stica|diagrama|sistema|economia)\b/iu, genre: 'minimalist electronic', emotion: 'curiosidade analítica', intensity: 'low', bpm: 96 },
  { keywords: /\b(jogo|jogos|game|batalha|elden|silksong|a[cç][aã]o)\b/iu, genre: 'hybrid orchestral', emotion: 'aventura épica', intensity: 'high', bpm: 124 },
];

/** Builds a deterministic contextual music prompt (for ACE-Step or library search) from timeline intents/labels. */
export function buildContextualMusicPrompt(timeline: TimelineDocument): ContextualMusicPrompt {
  const graphics = timeline.tracks.find((t) => t.kind === 'graphics')?.items ?? [];
  const combinedText = graphics
    .map((item) => `${item.label ?? ''} ${(item.intent as { reason?: string } | undefined)?.reason ?? ''}`)
    .join(' ');

  const matched = KEYWORD_MOOD_MAP.find((entry) => entry.keywords.test(combinedText)) ?? {
    genre: 'cinematic documentary',
    emotion: 'foco narrativo',
    intensity: 'medium' as const,
    bpm: 98,
  };

  const durationMs = Math.min(480_000, Math.max(10_000, timeline.durationMs));
  const mood = [matched.genre, matched.emotion];
  const prompt = `Instrumental ${matched.genre}, ${matched.emotion}, intensity ${matched.intensity}, ${matched.bpm} BPM, clean documentary underscore, no vocals`;

  return {
    genre: matched.genre,
    emotion: matched.emotion,
    intensity: matched.intensity,
    bpm: matched.bpm,
    durationMs,
    mood,
    prompt,
  };
}

/** Scores and selects the best matching track from a local MusicTrack library. */
export function selectContextualMusicTrack(timeline: TimelineDocument, library: readonly MusicTrack[]): MusicTrack | null {
  if (!library.length) return null;
  const target = buildContextualMusicPrompt(timeline);
  const targetMoodTokens = target.mood.flatMap((m) => m.toLowerCase().split(/\s+/));

  let best: MusicTrack | null = null;
  let bestScore = -Infinity;

  for (const track of library) {
    const trackMoods = track.mood.map((m) => m.toLowerCase());
    const moodHits = targetMoodTokens.filter((token) => trackMoods.some((m) => m.includes(token))).length;
    const bpmDiff = track.bpm ? Math.abs(track.bpm - target.bpm) : 25;
    const durationDiffRatio = Math.abs(track.durationMs - timeline.durationMs) / Math.max(1, timeline.durationMs);
    const score = moodHits * 20 - bpmDiff * 0.25 - durationDiffRatio * 10;
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  }

  return best;
}

/**
 * Computes adaptive ducking envelopes combining narration word windows and SFX density clusters.
 * High SFX density (>= 2 events within 1500ms) adds extra attenuation so the mix stays clear without clipping.
 */
export function computeAdaptiveDucking(input: {
  timeline: TimelineDocument;
  sfxEvents: readonly SfxEvent[];
  wordDuckDb?: number;
  sfxExtraDuckDb?: number;
  densityWindowMs?: number;
}): DuckEnvelope[] {
  const { timeline, sfxEvents } = input;
  const wordDuckDb = Math.min(-10, input.wordDuckDb ?? timeline.audio.musicDuckDb);
  const sfxExtraDuckDb = input.sfxExtraDuckDb ?? -3;
  const densityWindowMs = input.densityWindowMs ?? 1_500;

  const words = timeline.tracks
    .filter((track) => track.kind === 'captions')
    .flatMap((track) =>
      track.items.flatMap((clip) =>
        clip.source.kind === 'text'
          ? (clip.source.words ?? []).map((word) => ({
              text: word.text,
              startMs: clip.startMs + word.startMs,
              endMs: Math.max(clip.startMs + word.startMs + 1, clip.startMs + word.endMs),
            }))
          : [],
      ),
    );

  const countNearbySfx = (atMs: number) =>
    sfxEvents.filter((event) => Math.abs(event.atMs - atMs) <= densityWindowMs).length;

  const envelopes: DuckEnvelope[] = words.map((word) => {
    const dense = countNearbySfx(word.startMs) >= 2;
    const gainDb = Math.max(-24, dense ? wordDuckDb + sfxExtraDuckDb : wordDuckDb);
    return {
      startMs: word.startMs,
      endMs: word.endMs,
      gainDb,
      attackMs: timeline.audio.duck.attackMs,
      releaseMs: timeline.audio.duck.releaseMs,
      sourceWord: word.text,
    };
  });

  // Also duck slightly during dense SFX clusters even between spoken words
  for (const event of sfxEvents) {
    if (countNearbySfx(event.atMs) < 2) continue;
    const overlapsWord = envelopes.some((env) => env.startMs <= event.atMs + event.durationMs && env.endMs >= event.atMs);
    if (overlapsWord) continue;
    envelopes.push({
      startMs: event.atMs,
      endMs: event.atMs + Math.max(100, event.durationMs),
      gainDb: Math.max(-24, wordDuckDb + sfxExtraDuckDb),
      attackMs: timeline.audio.duck.attackMs,
      releaseMs: timeline.audio.duck.releaseMs,
      sourceWord: `sfx:${event.sfxId}`,
    });
  }

  return envelopes.sort((a, b) => a.startMs - b.startMs);
}

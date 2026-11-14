import { z } from 'zod';

/**
 * The Aethera channel voice: an original synthetic voice designed by attributes and a seed in VoiceStudio (no reference
 * audio, no person cloned), saved as a preset of a video project; a persistent, revocable authorization to narrate with
 * it, tied to the licence the provider declares for the model; and per-scene direction (speed and pauses).
 * The project's default voice is never changed by any of this.
 */

const isoDate = z.string().min(1);

export const voicePresetSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1).max(80), projectId: z.string().min(1), name: z.string().trim().min(1).max(80),
  provider: z.literal('voicestudio'), modelId: z.string().min(1).max(80),
  /** Only designed voices: a preset never stands for a real person's voice. */
  origin: z.literal('synthetic_design'),
  design: z.strictObject({ instruct: z.string().trim().min(1).max(200), seed: z.number().int().nonnegative().max(2_147_483_647), numStep: z.number().int().min(8).max(64) }),
  speed: z.number().min(0.8).max(1.3), language: z.string().min(2).max(20),
  /** The approved sample this preset reproduces, kept for provenance. */
  sample: z.strictObject({ relativePath: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).nullable(),
  createdAt: isoDate,
});
export type VoicePreset = z.infer<typeof voicePresetSchema>;

/** What the provider declares about the model's licence now; any change invalidates an authorization. */
export const voiceLicenseFingerprintSchema = z.strictObject({
  registryDigest: z.string().min(1), license: z.string().min(1), reviewStatus: z.string().min(1), commercialInference: z.string().min(1), licenseCategory: z.string().min(1),
});
export type VoiceLicenseFingerprint = z.infer<typeof voiceLicenseFingerprintSchema>;

export const voiceAuthorizationSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), presetId: z.string().min(1), projectId: z.string().min(1), provider: z.literal('voicestudio'), modelId: z.string().min(1),
  license: voiceLicenseFingerprintSchema,
  /** The use the person authorized, matching the provider's terms (OmniVoice weights are non-commercial). */
  scope: z.enum(['noncommercial', 'commercial']),
  note: z.string().trim().min(1).max(500), grantedBy: z.string().min(1), grantedAt: isoDate, revokedAt: isoDate.nullable(),
}).refine((value) => value.scope !== 'commercial' || value.license.licenseCategory === 'commercial', { message: 'Uso comercial exige um modelo com licença comercial.', path: ['scope'] });
export type VoiceAuthorization = z.infer<typeof voiceAuthorizationSchema>;

export function voiceAuthorizationStatus(authorization: VoiceAuthorization | null, current: { presetId: string; projectId: string; modelId: string; license: VoiceLicenseFingerprint | null }): { valid: boolean; reason: string } {
  if (!authorization) return { valid: false, reason: 'Autorize o uso desta voz uma vez; a autorização vale para as próximas produções.' };
  if (authorization.revokedAt) return { valid: false, reason: 'A autorização desta voz foi revogada.' };
  if (authorization.presetId !== current.presetId || authorization.projectId !== current.projectId || authorization.modelId !== current.modelId) return { valid: false, reason: 'A autorização é de outra voz, projeto ou modelo.' };
  if (!current.license) return { valid: false, reason: 'O VoiceStudio não informou a licença atual do modelo; não dá para confirmar a autorização.' };
  const same = (Object.keys(authorization.license) as (keyof VoiceLicenseFingerprint)[]).every((key) => authorization.license[key] === current.license?.[key]);
  if (!same) return { valid: false, reason: 'A licença do modelo mudou no VoiceStudio desde a autorização; autorize de novo.' };
  return { valid: true, reason: authorization.scope === 'noncommercial' ? 'Autorizada para uso não comercial, conforme a licença do modelo.' : 'Autorizada para uso comercial.' };
}

/** Direction of one scene of the narration. Speed overrides the preset's; the pause is real silence after the scene. */
export const narrationDirectionSchema = z.strictObject({
  sceneId: z.string().min(1), speed: z.number().min(0.8).max(1.3).optional(), pauseAfterMs: z.number().int().min(0).max(2_000).optional(),
});
export type NarrationDirection = z.infer<typeof narrationDirectionSchema>;

/** What the narration screen shows about one channel voice. */
export const channelVoiceViewSchema = z.strictObject({
  preset: voicePresetSchema, useApproval: voiceAuthorizationSchema.nullable(), valid: z.boolean(), reason: z.string(), license: voiceLicenseFingerprintSchema.nullable(),
});
export type ChannelVoiceView = z.infer<typeof channelVoiceViewSchema>;

export interface DirectedSegment { sceneIds: string[]; speed: number; pauseAfterMs: number }

/**
 * Consecutive scenes spoken together: a segment ends where the next scene has another speed or where a pause is asked
 * after a scene. Without directions the whole narration is one segment (the legacy behaviour).
 */
export function planDirectedSegments(scenes: readonly { id: string }[], directions: readonly NarrationDirection[], defaultSpeed: number): DirectedSegment[] {
  const byScene = new Map(directions.map((direction) => [direction.sceneId, direction]));
  const segments: DirectedSegment[] = [];
  let current: DirectedSegment | null = null;
  for (const scene of scenes) {
    const direction = byScene.get(scene.id);
    const speed = direction?.speed ?? defaultSpeed;
    if (!current || current.speed !== speed) { current = { sceneIds: [], speed, pauseAfterMs: 0 }; segments.push(current); }
    current.sceneIds.push(scene.id);
    const pause = direction?.pauseAfterMs ?? 0;
    if (pause > 0) { current.pauseAfterMs = pause; current = null; }
  }
  return segments;
}

// ---------------------------------------------------------------- narration pacing (AP-04 etapa 2, E2)

export const narrationPacingSchema = z.strictObject({
  style: z.enum(['documentary', 'conversational', 'energetic']),
  sentencePauseMs: z.number().int().min(0).max(2_000),
  scenePauseMs: z.number().int().min(0).max(5_000),
  sectionPauseMs: z.number().int().min(0).max(10_000),
  targetWpm: z.strictObject({ min: z.number().int().min(80).max(300), max: z.number().int().min(80).max(300), block: z.number().int().min(80).max(300) }),
});
export type NarrationPacing = z.infer<typeof narrationPacingSchema>;

export const NARRATION_PACING_STYLES = {
  documentary: { style: 'documentary', sentencePauseMs: 280, scenePauseMs: 600, sectionPauseMs: 900, targetWpm: { min: 145, max: 170, block: 185 } },
  conversational: { style: 'conversational', sentencePauseMs: 200, scenePauseMs: 450, sectionPauseMs: 700, targetWpm: { min: 155, max: 185, block: 200 } },
  energetic: { style: 'energetic', sentencePauseMs: 150, scenePauseMs: 300, sectionPauseMs: 500, targetWpm: { min: 170, max: 200, block: 215 } },
} as const satisfies Record<string, NarrationPacing>;

/** A scene that opens with a short heading before a colon ("Segundo eixo: o combate.") starts a new section. */
export function startsSection(narration: string): boolean {
  const colon = narration.indexOf(':');
  if (colon < 0) return false;
  const heading = narration.slice(0, colon).trim();
  return heading.length > 0 && !/[,.;!?]/u.test(heading) && heading.split(/\s+/u).length <= 4;
}

/** Sentences of a narration text, in order. A dot between digits (1.5) does not end a sentence. */
export function sentenceTexts(text: string): string[] {
  return text.match(/(?:\d[.,]\d|[^.!?…])+(?:[.!?…]+["”»)]*|$)/gu)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

/**
 * Scene directions from a pacing style: a pause after every scene, a longer one before a new section, none after the last
 * scene. A direction the person set for a scene wins over the style (per-production adjustments are preserved).
 */
export function pacingDirections(scenes: readonly { id: string; narration: string }[], pacing: NarrationPacing, manual: readonly NarrationDirection[] = []): NarrationDirection[] {
  const byScene = new Map(manual.map((direction) => [direction.sceneId, direction]));
  return scenes.flatMap((scene, index) => {
    const own = byScene.get(scene.id);
    const next = scenes[index + 1];
    if (!next) return own ? [own] : [];
    const pauseAfterMs = own?.pauseAfterMs ?? (startsSection(next.narration) ? pacing.sectionPauseMs : pacing.scenePauseMs);
    return [{ sceneId: scene.id, ...(own?.speed === undefined ? {} : { speed: own.speed }), pauseAfterMs }];
  });
}


export interface AudioGap { startMs: number; durationMs: number }

/** Where speech starts and ends inside a block, leaving out the silence the voice adds before and after. */
export function speechSpan(durationMs: number, gaps: readonly AudioGap[]): { startMs: number; endMs: number } {
  const leading = gaps.find((gap) => gap.startMs <= 20);
  const trailing = [...gaps].reverse().find((gap) => gap.startMs + gap.durationMs >= durationMs - 20);
  const startMs = leading ? leading.startMs + leading.durationMs : 0;
  const endMs = trailing && trailing !== leading ? trailing.startMs : durationMs;
  return { startMs, endMs: Math.max(startMs + 1, endMs) };
}

/** Words per minute of a spoken block, over its speech only. */
export function speechWpm(text: string, durationMs: number, gaps: readonly AudioGap[]): number {
  const span = speechSpan(durationMs, gaps);
  return (text.split(/\s+/u).filter(Boolean).length * 60_000) / (span.endMs - span.startMs);
}

/**
 * Slowest speed the pacing correction may choose on its own (E1 review). Measured on Voz C (OmniVoice), two takes of the
 * 206 ppm scene: 0.9 → 181–184 ppm with the pitch range kept (10.3–10.4 semitones); 0.85 → 172–173 ppm but a flatter
 * delivery in both takes (7.2 semitones). A person may still direct a slower speed for a scene.
 */
export const NARRATION_MIN_AUTO_SPEED = 0.9;

/**
 * The speed that brings a block measured too fast back to the middle of the style's range, assuming the rate scales with
 * the speed (true for OmniVoice within 0.8–1.2, measured). Null when the block is within range or already at the floor.
 */
export function paceCorrectionSpeed(wpm: number, speed: number, pacing: NarrationPacing): number | null {
  if (wpm <= pacing.targetWpm.max || speed <= NARRATION_MIN_AUTO_SPEED) return null;
  const target = (pacing.targetWpm.min + pacing.targetWpm.max) / 2;
  return Math.max(NARRATION_MIN_AUTO_SPEED, Math.round(((speed * target) / wpm) * 100) / 100);
}
export interface SentencePausePlan {
  /**
   * Silence to add inside the block (ms of the block's own audio), only where the gap found is shorter than the target.
   * `fill` is the quiet stretch whose own room tone fills the pause, so it never drops to digital silence.
   */
  insertions: Array<{ atMs: number; durationMs: number; fill?: { fromMs: number; toMs: number } }>;
  boundaries: number;
  /** Boundaries matched to a quiet gap of the audio; the rest are left as the voice said them. */
  matched: number;
  alreadyLong: number;
}

/**
 * E2: where the sentence ends of a TTS block are in its audio, and how much silence each one needs. Speaking each
 * sentence apart breaks the intonation and the level of the voice (measured on Voz C: jumps of 2–10 semitones and 6.9 dB
 * between sentences), so the block is spoken whole and only its pauses grow. A boundary is expected at the share of
 * characters already said and matched to the strongest quiet gap near it (sentence ends pause longer than commas). A
 * boundary with no gap nearby is left untouched: cutting inside a word is worse than a short pause.
 */
export function planSentencePauses(text: string, block: { durationMs: number; gaps: readonly AudioGap[] }, targetMs: number): SentencePausePlan {
  const sentences = sentenceTexts(text);
  const boundaries = Math.max(0, sentences.length - 1);
  const plan: SentencePausePlan = { insertions: [], boundaries, matched: 0, alreadyLong: 0 };
  if (!boundaries || targetMs <= 0 || block.durationMs <= 0) return plan;
  const { startMs: speechStart, endMs: speechEnd } = speechSpan(block.durationMs, block.gaps);
  const speechMs = Math.max(1, speechEnd - speechStart);
  const inner = block.gaps.filter((gap) => gap.startMs > speechStart && gap.startMs + gap.durationMs < speechEnd);
  // Every inner punctuation mark may own a gap (the voice also pauses at ":" and ","); marks are matched in order, each to
  // the nearest free gap, so a colon keeps its own gap and never lends it to the sentence end that follows.
  const spoken = sentences.join(' ');
  const marks = [...spoken.matchAll(/[.!?…]+["”»)]*(?=\s)|[,;:](?=\s)/gu)].map((match) => ({ at: (match.index ?? 0) + match[0].length, sentenceEnd: /[.!?…]/u.test(match[0]) }));
  const expectedOf = (at: number) => speechStart + (at / spoken.length) * speechMs;
  const middle = (gap: AudioGap) => gap.startMs + gap.durationMs / 2;
  const sentenceWindow = Math.max(700, speechMs * 0.15);
  let after = speechStart;
  marks.forEach((mark, index) => {
    const expected = expectedOf(mark.at);
    const nextEnd = marks.slice(index + 1).find((item) => item.sentenceEnd);
    const window = mark.sentenceEnd ? sentenceWindow : 400;
    const candidates = inner.filter((gap) => gap.startMs >= after && Math.abs(middle(gap) - expected) <= window
      && (mark.sentenceEnd || !nextEnd || Math.abs(middle(gap) - expected) < Math.abs(middle(gap) - expectedOf(nextEnd.at))));
    const best = candidates.sort((a, b) => Math.abs(middle(a) - expected) - Math.abs(middle(b) - expected))[0];
    if (!best) return;
    after = best.startMs + best.durationMs;
    if (!mark.sentenceEnd) return;
    plan.matched++;
    if (best.durationMs >= targetMs) { plan.alreadyLong++; return; }
    // The middle of the gap, away from the word edges, is the room tone that fills the added pause.
    const margin = Math.min(20, Math.floor(best.durationMs / 4));
    plan.insertions.push({ atMs: Math.round(middle(best)), durationMs: targetMs - best.durationMs, fill: { fromMs: best.startMs + margin, toMs: best.startMs + best.durationMs - margin } });
  });
  return plan;
}

/** The shortest silences the measured audio must show for a pacing style (rounded down to 50 ms: recognizers stretch word ends). */
export function pacingPauseThresholds(pacing: NarrationPacing): { sentenceMs: number; sceneMs: number } {
  return { sentenceMs: Math.floor((pacing.sentencePauseMs * 0.9) / 50) * 50, sceneMs: pacing.scenePauseMs };
}

export interface PacingPauseMeasure { sentenceGaps: number; shortSentenceGaps: number; sceneGaps: number; shortSceneGaps: number; minSentenceMs: number | null; minSceneMs: number | null }

/**
 * Silences measured on the aligned words: between two scenes, and inside a scene after a word that ends a sentence. A pair
 * with a word the recognizer did not time is skipped, never guessed.
 */
export function measurePacingPauses(words: readonly { sceneId: string; word: string; startMs: number | null; endMs: number | null }[], thresholds: { sentenceMs: number; sceneMs: number }): PacingPauseMeasure {
  const result: PacingPauseMeasure = { sentenceGaps: 0, shortSentenceGaps: 0, sceneGaps: 0, shortSceneGaps: 0, minSentenceMs: null, minSceneMs: null };
  for (let index = 0; index + 1 < words.length; index++) {
    const current = words[index];
    const next = words[index + 1];
    if (!current || !next || current.endMs === null || next.startMs === null) continue;
    const gap = Math.max(0, next.startMs - current.endMs);
    if (current.sceneId !== next.sceneId) {
      result.sceneGaps++;
      if (gap < thresholds.sceneMs) result.shortSceneGaps++;
      result.minSceneMs = result.minSceneMs === null ? gap : Math.min(result.minSceneMs, gap);
    } else if (/[.!?…]["”»)]*$/u.test(current.word)) {
      result.sentenceGaps++;
      if (gap < thresholds.sentenceMs) result.shortSentenceGaps++;
      result.minSentenceMs = result.minSentenceMs === null ? gap : Math.min(result.minSentenceMs, gap);
    }
  }
  return result;
}

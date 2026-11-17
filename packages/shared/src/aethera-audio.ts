import { z } from 'zod';
import type { TimelineDocument } from './aethera-timeline.js';

export const musicLicenseSchema = z.strictObject({ name: z.string().min(1), source: z.string().url(), evidence: z.string().min(1), scope: z.string().min(1), expiresAt: z.string().datetime().nullable() });
export type MusicLicense = z.infer<typeof musicLicenseSchema>;
export const musicGenerationSchema = z.strictObject({
  providerId: z.string().min(1), softwareVersion: z.string().min(1), modelId: z.string().min(1), modelRevision: z.string().min(1),
  lmModelId: z.string().min(1).nullable(), lmBackend: z.enum(['pt', 'vllm', 'mlx']), promptHash: z.string().regex(/^[0-9a-f]{64}$/iu), seed: z.number().int(),
  durationMs: z.number().int().positive(), bpm: z.number().positive().nullable(), inferenceSteps: z.number().int().positive(), guidanceScale: z.number().positive(),
  taskType: z.literal('text2music'), outputSha256: z.string().regex(/^[0-9a-f]{64}$/iu), format: z.enum(['wav', 'flac']), origin: z.literal('local-only'),
  timelineId: z.string().min(1), sceneIds: z.array(z.string().min(1)), createdAt: z.string().datetime(),
  licenseEvidence: z.strictObject({
    software: z.strictObject({ name: z.string().min(1), license: z.string().min(1), source: z.string().url() }),
    ditWeights: z.strictObject({ model: z.string().min(1), license: z.string().min(1), source: z.string().url() }),
    lmWeights: z.strictObject({ model: z.string().min(1), license: z.string().min(1), source: z.string().url() }).nullable(),
    outputStatement: z.string().min(1), evidence: z.string().min(1),
  }),
});
export type MusicGeneration = z.infer<typeof musicGenerationSchema>;
const musicTrackFields = { id: z.string().min(1), relativePath: z.string().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/iu), durationMs: z.number().int().positive(), bpm: z.number().positive().nullable(), mood: z.array(z.string().min(1)).max(24), license: musicLicenseSchema, importedAt: z.string().datetime() };
export const musicLibraryTrackSchema = z.strictObject(musicTrackFields);
export type MusicLibraryTrack = z.infer<typeof musicLibraryTrackSchema>;
export const generatedMusicTrackSchema = z.strictObject({ ...musicTrackFields, generation: musicGenerationSchema });
export type GeneratedMusicTrack = z.infer<typeof generatedMusicTrackSchema>;
export const musicTrackSchema = z.union([musicLibraryTrackSchema, generatedMusicTrackSchema]);
export type MusicTrack = z.infer<typeof musicTrackSchema>;
export const aceStepMusicGenerationInputSchema = z.strictObject({
  runId: z.string().uuid(), sceneIds: z.array(z.string().min(1)).min(1).max(60), genre: z.string().trim().min(1).max(120), emotion: z.string().trim().min(1).max(120),
  intensity: z.enum(['low', 'medium', 'high']), durationMs: z.number().int().positive().min(10_000).max(480_000), seed: z.number().int().min(-1).optional(), mood: z.array(z.string().min(1)).max(24).default([]),
});
export type AceStepMusicGenerationInput = z.input<typeof aceStepMusicGenerationInputSchema>;
export const aceStepMusicGenerationResultSchema = z.strictObject({ track: generatedMusicTrackSchema, cacheHit: z.boolean(), manifestRelativePath: z.string().min(1), timelineVersion: z.number().int().positive() });
export type AceStepMusicGenerationResult = z.infer<typeof aceStepMusicGenerationResultSchema>;
export const generatedMusicSourceSchema = z.strictObject({ kind: z.literal('generated'), trackId: z.string().min(1).optional(), providerId: z.string().min(1), model: z.string().min(1), promptHash: z.string().min(1), seed: z.number().int(), outputSha256: z.string().regex(/^[0-9a-f]{64}$/iu).optional(), generation: musicGenerationSchema.optional(), license: musicLicenseSchema });
export const musicSourceSchema = z.union([z.strictObject({ kind: z.literal('library'), trackId: z.string().min(1), license: musicLicenseSchema }), generatedMusicSourceSchema]);

export const sfxEventSchema = z.strictObject({ id: z.string().min(1), sfxId: z.string().min(1), relativePath: z.string().min(1), atMs: z.number().int().nonnegative(), durationMs: z.number().int().positive(), frame: z.number().int().nonnegative(), gainDb: z.number(), licenseEvidence: z.string().min(1) });
export type SfxEvent = z.infer<typeof sfxEventSchema>;
export const duckEnvelopeSchema = z.strictObject({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), gainDb: z.number(), attackMs: z.number().int().nonnegative(), releaseMs: z.number().int().nonnegative(), sourceWord: z.string().min(1) });
export type DuckEnvelope = z.infer<typeof duckEnvelopeSchema>;
export const aetheraAudioPlanSchema = z.strictObject({ schemaVersion: z.literal(1), timelineId: z.string().min(1), targetLufs: z.number(), truePeakDb: z.number(), narrationGainDb: z.number(), music: musicSourceSchema.nullable(), musicGainDb: z.number(), ducking: z.array(duckEnvelopeSchema), sfx: z.array(sfxEventSchema), rationale: z.string().min(1) });
export type AetheraAudioPlan = z.infer<typeof aetheraAudioPlanSchema>;

const licensedMusic = (track: MusicTrack | null): MusicSource | null => track && 'generation' in track
  ? { kind: 'generated', trackId: track.id, providerId: track.generation.providerId, model: track.generation.modelId, promptHash: track.generation.promptHash, seed: track.generation.seed, outputSha256: track.generation.outputSha256, generation: track.generation, license: track.license }
  : track ? { kind: 'library', trackId: track.id, license: track.license } : null;
export type MusicSource = z.infer<typeof musicSourceSchema>;

/** Designs the audio lanes deterministically from the timeline; unlicensed music is never silently substituted. */
export function designAetheraAudio(input: { timeline: TimelineDocument; music?: MusicTrack | null; sfx?: readonly SfxEvent[] }): AetheraAudioPlan {
  const timeline = input.timeline;
  const words = timeline.tracks.filter((track) => track.kind === 'captions').flatMap((track) => track.items.flatMap((clip) => clip.source.kind === 'text' ? (clip.source.words ?? []).map((word) => ({ ...word, atMs: clip.startMs + word.startMs })) : []));
  const music = licensedMusic(input.music ?? null);
  const ducking = music ? words.map((word) => duckEnvelopeSchema.parse({ startMs: word.atMs, endMs: Math.max(word.atMs + 1, clipWordEnd(word.atMs, word.endMs - word.startMs)), gainDb: timeline.audio.musicDuckDb, attackMs: timeline.audio.duck.attackMs, releaseMs: timeline.audio.duck.releaseMs, sourceWord: word.text })) : [];
  const sfx = (input.sfx ?? []).map((event) => sfxEventSchema.parse({ ...event, frame: Math.round((event.atMs * timeline.fps) / 1_000) }));
  return aetheraAudioPlanSchema.parse({ schemaVersion: 1, timelineId: timeline.id, targetLufs: timeline.audio.targetLufs, truePeakDb: timeline.audio.truePeakDb, narrationGainDb: timeline.audio.stems.narration, music, musicGainDb: timeline.audio.stems.music, ducking, sfx, rationale: music ? 'Narração como foco; música licenciada com ducking por palavra e SFX alinhados ao frame.' : 'Narração como foco; nenhuma música entrou porque não há faixa licenciada registrada.' });
}

const clipWordEnd = (atMs: number, durationMs: number) => atMs + Math.max(1, durationMs);

export function validateAetheraAudioPlan(plan: AetheraAudioPlan): AetheraAudioPlan {
  const parsed = aetheraAudioPlanSchema.parse(plan);
  if (parsed.truePeakDb > -1) throw new Error('invalid: true peak da mixagem deve ser ≤ -1 dBTP.');
  if (parsed.music?.kind === 'generated') {
    if (!parsed.music.trackId || !parsed.music.outputSha256 || !parsed.music.generation) throw new Error('invalid: música gerada sem manifesto de origem, hash e evidência de licença.');
    if (parsed.music.generation.providerId !== parsed.music.providerId || parsed.music.generation.outputSha256 !== parsed.music.outputSha256) throw new Error('invalid: manifesto da música gerada não confere com a fonte da timeline.');
    const scope = parsed.music.license.scope.toLocaleLowerCase('pt-BR');
    if (!scope.includes('não comercial') && !scope.includes('noncommercial')) throw new Error('forbidden: música gerada sem escopo não comercial registrado.');
  }
  if (parsed.music && parsed.ducking.some((envelope) => envelope.gainDb > -10)) throw new Error('invalid: música precisa ficar ao menos 10 dB abaixo da fala nas janelas de palavra.');
  return parsed;
}

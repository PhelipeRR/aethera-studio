import { z } from 'zod';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

export const NEURA_TEXT_MAX = 4_000;
export const confidenceSchema = z.number().min(0).max(1);
/** BCP 47 shaped, with `und` for "undetermined". The value reaches prompts, so free text is refused here. 32 is what NeuraRegistry stores. */
export const languageTagSchema = z.string().max(32).regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

export const VOICE_STATES = ['idle', 'listening', 'transcribing', 'speaking', 'paused', 'stopped', 'failed'] as const;
export type VoiceState = (typeof VOICE_STATES)[number];

export const voiceStartInputSchema = z.strictObject({
  /** Listening is opt-in: a session cannot be requested without it. */
  consent: z.literal(true),
  preferredLanguage: languageTagSchema,
});
export type VoiceStartInput = z.infer<typeof voiceStartInputSchema>;

export const voiceStopInputSchema = z.strictObject({ sessionId: id });
export type VoiceStopInput = z.infer<typeof voiceStopInputSchema>;

export const voiceSessionSchema = z.strictObject({
  sessionId: id,
  state: z.enum(VOICE_STATES),
  provider: z.string().trim().min(1).max(100),
  startedAt: timestamp,
});
export type VoiceSession = z.infer<typeof voiceSessionSchema>;

export const voiceTranscriptSchema = z.strictObject({
  transcriptId: id,
  sessionId: id,
  text: z.string().trim().min(1).max(NEURA_TEXT_MAX),
  language: languageTagSchema,
  confidence: confidenceSchema,
  final: z.boolean(),
  occurredAt: timestamp,
});
export type VoiceTranscript = z.infer<typeof voiceTranscriptSchema>;

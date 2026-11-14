import { z } from 'zod';
import { meetingSessionSchema, suggestionSchema } from './meeting.js';
import { spotifyCommandSchema } from './spotify.js';
import { confidenceSchema, languageTagSchema, NEURA_TEXT_MAX, voiceSessionSchema } from './voice.js';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

export const NEURA_SESSION_KINDS = ['voice', 'meeting', 'general'] as const;
export type NeuraSessionKind = (typeof NEURA_SESSION_KINDS)[number];
export const NEURA_SESSION_STATUSES = ['idle', 'listening', 'processing', 'paused', 'completed', 'failed'] as const;
export type NeuraSessionStatus = (typeof NEURA_SESSION_STATUSES)[number];

export const neuraSessionSchema = z.strictObject({
  sessionId: id,
  kind: z.enum(NEURA_SESSION_KINDS),
  status: z.enum(NEURA_SESSION_STATUSES),
  consent: z.boolean(),
  meetingLanguage: languageTagSchema.nullable(),
  userPreferredLanguage: languageTagSchema.nullable(),
  startedAt: timestamp,
  updatedAt: timestamp,
  endedAt: timestamp.nullable(),
});
export type NeuraSession = z.infer<typeof neuraSessionSchema>;

const intentBase = {
  correlationId: id,
  sessionId: id,
  confidence: confidenceSchema,
  /** What was heard. It is data for the model and the audit, never a command. */
  sourceText: z.string().trim().min(1).max(NEURA_TEXT_MAX),
};

export const neuraIntentSchema = z.discriminatedUnion('target', [
  z.strictObject({ ...intentBase, target: z.literal('spotify'), command: spotifyCommandSchema }),
  z.strictObject({ ...intentBase, target: z.literal('meeting_suggestion') }),
  z.strictObject({ ...intentBase, target: z.literal('computer_action'), actionType: z.string().trim().min(1).max(200) }),
  z.strictObject({ ...intentBase, target: z.literal('conversation') }),
  z.strictObject({ ...intentBase, target: z.literal('pause_all') }),
]);
export type NeuraIntent = z.infer<typeof neuraIntentSchema>;

export const neuraPauseResultSchema = z.strictObject({
  paused: z.boolean(),
  voiceSessions: z.number().int().nonnegative(),
  meetingSessions: z.number().int().nonnegative(),
  pausedAt: timestamp,
});
export type NeuraPauseResult = z.infer<typeof neuraPauseResultSchema>;

export const neuraSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  voiceConsent: z.boolean(),
  /** Meeting text goes to the chosen agent, so this consent is separate from listening to the user. */
  meetingConsent: z.boolean(),
  /** Hearing a call is a step beyond text the user chose to paste, so it is asked for on its own. */
  meetingAudioConsent: z.boolean().default(false),
  /** Screen capture is a separate consent because it can include private content. */
  screenConsent: z.boolean().default(false),
  /** Weather location is requested only when the user asks for weather. */
  locationConsent: z.boolean().default(false),
  /** Optional city used only when Windows location is unavailable or denied. */
  weatherLocation: z.string().trim().max(200).nullable().default(null),
  preferredLanguage: languageTagSchema,
  translationEnabled: z.boolean(),
  projectId: z.string().trim().min(1).max(200).nullable(),
  agent: z.enum(['claude', 'codex']),
  retainSuggestions: z.boolean(),
  /** Pauses global memories in conversation without touching them or the suggestion history. Absent in older preferences. */
  globalMemoryEnabled: z.boolean().default(true),
  /** Spoken requests are answered in a bubble instead of aloud. Absent in older preferences. */
  silentReplies: z.boolean().default(false),
  /** Primary spoken wake word. Existing preference files receive Void through the additive default. */
  wakeWord: z.string().trim().min(2).max(40).default('Void'),
  /** Compatibility aliases; Neura remains configurable and is not removed automatically. */
  wakeWordAliases: z.array(z.string().trim().min(2).max(40)).max(4).default(['Neura']),
});
export type NeuraSettings = z.infer<typeof neuraSettingsSchema>;
export const DEFAULT_NEURA_SETTINGS: NeuraSettings = { enabled: false, voiceConsent: false, meetingConsent: false, meetingAudioConsent: false, screenConsent: false, locationConsent: false, weatherLocation: null, preferredLanguage: 'pt-BR', translationEnabled: false, projectId: null, agent: 'claude', retainSuggestions: false, globalMemoryEnabled: true, silentReplies: false, wakeWord: 'Void', wakeWordAliases: ['Neura'] };
// Do not derive patches directly from fields with defaults: Zod applies those
// defaults even when a key is omitted, turning an unrelated patch into an
// instruction to reset another consent to false.
const neuraSettingsPatchBaseSchema = neuraSettingsSchema.extend({
  meetingAudioConsent: z.boolean(),
  screenConsent: z.boolean(),
  locationConsent: z.boolean(),
  globalMemoryEnabled: z.boolean(),
  silentReplies: z.boolean(),
  wakeWord: z.string().trim().min(2).max(40),
  wakeWordAliases: z.array(z.string().trim().min(2).max(40)).max(4),
  weatherLocation: z.string().trim().max(200).nullable(),
});
export const neuraSettingsPatchSchema = neuraSettingsPatchBaseSchema.partial();
export type NeuraSettingsPatch = z.infer<typeof neuraSettingsPatchSchema>;

export const neuraInputSchema = z.strictObject({ text: z.string().trim().min(1).max(NEURA_TEXT_MAX) });
export type NeuraInput = z.infer<typeof neuraInputSchema>;

export const neuraSpeechInputSchema = z.strictObject({
  text: z.string().trim().min(1).max(NEURA_TEXT_MAX),
  language: languageTagSchema,
});
export type NeuraSpeechInput = z.infer<typeof neuraSpeechInputSchema>;

/** Audio is generated in the main process so the renderer never calls a local service directly. */
export const neuraSpeechResultSchema = z.strictObject({
  provider: z.literal('voicestudio'),
  modelId: z.string().trim().min(1).max(200),
  voiceId: z.string().trim().min(1).max(200),
  // VoiceStudio caps the binary response at 32 MiB; base64 adds roughly one third.
  audio: z.string().regex(/^data:audio\/[A-Za-z0-9.+-]+;base64,/u).max(48 * 1024 * 1024),
});
export type NeuraSpeechResult = z.infer<typeof neuraSpeechResultSchema>;

/** A continuous PCM frame for streaming transcription, a WAV segment for the fallback, or the reason there will be none. */
export const neuraVoiceAudioSchema = z.union([
  z.strictObject({ pcmBase64: z.string().min(1).max(44_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
  z.strictObject({ wavBase64: z.string().min(1).max(520_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
  z.strictObject({ diagnostic: z.strictObject({ deviceLabel: z.string().trim().max(200), peak: z.number().min(0).max(1), lastFrameAt: z.number().int().nonnegative() }) }),
  z.strictObject({ failure: z.literal('microphone') }),
]);
export type NeuraVoiceAudio = z.infer<typeof neuraVoiceAudioSchema>;

/** A slice of call audio, 16 kHz mono PCM, or the reason there will be no more. */
export const neuraMeetingAudioSchema = z.union([
  z.strictObject({ pcmBase64: z.string().min(1).max(44_000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
  z.strictObject({ failure: z.literal('capture') }),
]);
export type NeuraMeetingAudio = z.infer<typeof neuraMeetingAudioSchema>;

export const neuraActionDecisionSchema = z.strictObject({ actionId: id, decision: z.enum(['allow', 'deny']) });
export type NeuraActionDecision = z.infer<typeof neuraActionDecisionSchema>;

export const neuraPendingActionSchema = z.strictObject({ actionId: id, summary: z.string().min(1).max(500), expiresAt: timestamp });
export type NeuraPendingAction = z.infer<typeof neuraPendingActionSchema>;

export const neuraResponseSchema = z.strictObject({
  correlationId: id,
  outcome: z.enum(['done', 'needs_confirmation', 'failed', 'blocked']),
  message: z.string().trim().min(1).max(NEURA_TEXT_MAX),
  /** Whether the HUD should also say it aloud: true only for a request that came by voice. */
  speak: z.boolean(),
  /** Measured on real conversation runs, so "fast" is a number and not a claim. */
  timing: z.strictObject({ firstTextMs: z.number().int().nonnegative().optional(), totalMs: z.number().int().nonnegative() }).optional(),
  at: timestamp,
});
export type NeuraResponse = z.infer<typeof neuraResponseSchema>;

const providerStatusSchema = z.strictObject({ available: z.boolean(), detail: z.string().max(300) });

export const neuraStateSchema = z.strictObject({
  enabled: z.boolean(),
  paused: z.boolean(),
  voice: voiceSessionSchema.nullable(),
  meeting: meetingSessionSchema.nullable(),
  /** Set while a draft is being written, so the HUD can show that meeting text is with the model. */
  drafting: z.boolean(),
  /** Set while a general answer or screen operation is waiting on a provider. */
  processing: z.boolean(),
  suggestions: z.array(suggestionSchema).max(5),
  pendingActions: z.array(neuraPendingActionSchema).max(10),
  lastResponse: neuraResponseSchema.nullable(),
  providers: z.strictObject({ voice: providerStatusSchema, model: providerStatusSchema, worker: providerStatusSchema }),
});
export type NeuraState = z.infer<typeof neuraStateSchema>;

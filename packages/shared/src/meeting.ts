import { z } from 'zod';
import { confidenceSchema, languageTagSchema, NEURA_TEXT_MAX } from './voice.js';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });

export const MEETING_EXCERPT_MAX = 500;
export const MEETING_WINDOW_SEGMENTS_MAX = 500;
const utteranceText = z.string().trim().min(1).max(NEURA_TEXT_MAX);

export const MEETING_PLATFORMS = ['teams', 'generic'] as const;
export type MeetingPlatform = (typeof MEETING_PLATFORMS)[number];
/** What the computer plays during a call. Allowed by its own consent, because it listens where pasted text does not. */
export const SYSTEM_AUDIO_SOURCE_ID = 'system-audio';
export const MEETING_STATUSES = ['active', 'degraded', 'stopped'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export const MEETING_DEGRADATIONS = ['transcript_unavailable', 'audio_unavailable', 'diarization_unavailable', 'native_integration_unavailable'] as const;
export type MeetingDegradation = (typeof MEETING_DEGRADATIONS)[number];

export const meetingCapabilitiesSchema = z.strictObject({
  transcript: z.boolean(),
  audio: z.boolean(),
  diarization: z.boolean(),
  /** True only for a real integration with the platform; a generic source never sets it. */
  nativeIntegration: z.boolean(),
});
export type MeetingCapabilities = z.infer<typeof meetingCapabilitiesSchema>;

export const meetingStartInputSchema = z.strictObject({
  sourceId: z.string().trim().min(1).max(100),
  platform: z.enum(MEETING_PLATFORMS),
  consent: z.literal(true),
  userPreferredLanguage: languageTagSchema,
  translationEnabled: z.boolean(),
});
export type MeetingStartInput = z.infer<typeof meetingStartInputSchema>;

export const meetingStopInputSchema = z.strictObject({ sessionId: id });
export type MeetingStopInput = z.infer<typeof meetingStopInputSchema>;

export const meetingTranscriptInputSchema = z.strictObject({
  sessionId: id,
  speaker: z.string().trim().min(1).max(200).nullable(),
  text: z.string().trim().min(1).max(20_000),
});
export type MeetingTranscriptInput = z.infer<typeof meetingTranscriptInputSchema>;

export const meetingSessionSchema = z.strictObject({
  sessionId: id,
  sourceId: z.string().trim().min(1).max(100),
  /** The platform actually in use, which is `generic` when no native integration backs the request. */
  platform: z.enum(MEETING_PLATFORMS),
  status: z.enum(MEETING_STATUSES),
  consent: z.literal(true),
  capabilities: meetingCapabilitiesSchema,
  degradations: z.array(z.enum(MEETING_DEGRADATIONS)).max(MEETING_DEGRADATIONS.length),
  meetingLanguage: languageTagSchema.nullable(),
  meetingConfidence: confidenceSchema,
  userPreferredLanguage: languageTagSchema,
  translationEnabled: z.boolean(),
  startedAt: timestamp,
  stoppedAt: timestamp.nullable(),
});
export type MeetingSession = z.infer<typeof meetingSessionSchema>;

/** Text only. Strict on purpose: a source that attaches audio is refused rather than stored. */
export const meetingUtteranceSchema = z.strictObject({
  utteranceId: id,
  sessionId: id,
  speaker: z.string().trim().min(1).max(200).nullable(),
  text: utteranceText,
  language: languageTagSchema.nullable(),
  languageConfidence: confidenceSchema,
  startedAt: timestamp,
  endedAt: timestamp,
  final: z.boolean(),
});
export type MeetingUtterance = z.infer<typeof meetingUtteranceSchema>;

export const LANGUAGE_DECISION_REASONS = ['utterance', 'meeting', 'user_preference', 'model'] as const;
export type LanguageDecisionReason = (typeof LANGUAGE_DECISION_REASONS)[number];

export const languageDecisionSchema = z.strictObject({
  meetingLanguage: languageTagSchema.nullable(),
  meetingConfidence: confidenceSchema,
  utteranceLanguage: languageTagSchema.nullable(),
  utteranceConfidence: confidenceSchema,
  userPreferredLanguage: languageTagSchema,
  responseLanguage: languageTagSchema,
  reason: z.enum(LANGUAGE_DECISION_REASONS),
  /** Confidence of the source that won; 0 when only the user's preference was left. */
  confidence: confidenceSchema,
  /** Language of the optional translation, null when none is wanted. */
  translationLanguage: languageTagSchema.nullable(),
});
export type LanguageDecision = z.infer<typeof languageDecisionSchema>;

/** `send` is left out on purpose: the first release never delivers a suggestion to the meeting. */
export const SUGGESTION_ACTIONS = ['accept', 'edit', 'copy', 'speak'] as const;
export type SuggestionAction = (typeof SUGGESTION_ACTIONS)[number];
export const SUGGESTION_STATUSES = ['pending', 'accepted', 'edited', 'copied', 'spoken', 'dismissed', 'expired'] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const suggestionSchema = z.strictObject({
  suggestionId: id,
  correlationId: id,
  sessionId: id,
  utteranceId: id,
  text: utteranceText,
  translation: utteranceText.nullable(),
  sourceExcerpt: z.string().trim().min(1).max(MEETING_EXCERPT_MAX),
  decision: languageDecisionSchema,
  confidence: confidenceSchema,
  status: z.enum(SUGGESTION_STATUSES),
  actions: z.array(z.enum(SUGGESTION_ACTIONS)).min(1).max(SUGGESTION_ACTIONS.length),
  delivery: z.literal('manual'),
  /** Whether the local worker prepared the context or the model got the bounded transcript instead. */
  preprocessing: z.enum(['local-worker', 'fallback']),
  createdAt: timestamp,
});
export type Suggestion = z.infer<typeof suggestionSchema>;

export const suggestionDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({ suggestionId: id, decision: z.enum(['accept', 'copy', 'speak', 'reject']) }),
  z.strictObject({ suggestionId: id, decision: z.literal('edit'), text: utteranceText }),
]);
export type SuggestionDecision = z.infer<typeof suggestionDecisionSchema>;

// Local worker results. They mirror packages/local-worker/src/neura_worker/protocol.py.
export const LOCAL_WORKER_PROTOCOL_VERSION = 1;

export const languageDetectionInputSchema = z.strictObject({ text: utteranceText });
export type LanguageDetectionInput = z.infer<typeof languageDetectionInputSchema>;

export const languageDetectionSchema = z.strictObject({
  language: languageTagSchema,
  confidence: confidenceSchema,
  mixed: z.boolean(),
  /** The heuristics could not settle it: ambiguity is the model's to resolve. */
  needsModel: z.boolean(),
  scores: z.array(z.strictObject({ language: languageTagSchema, score: confidenceSchema })).max(10),
});
export type LanguageDetection = z.infer<typeof languageDetectionSchema>;

export const transcriptSegmentSchema = z.strictObject({
  id: z.string().trim().min(1).max(64),
  speaker: z.string().trim().min(1).max(200).nullable(),
  text: z.string().max(NEURA_TEXT_MAX),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptWindowInputSchema = z.strictObject({
  segments: z.array(transcriptSegmentSchema).max(MEETING_WINDOW_SEGMENTS_MAX),
  maxChars: z.number().int().min(100).max(100_000),
  windowMs: z.number().int().min(1_000).max(4 * 60 * 60_000),
});
export type TranscriptWindowInput = z.infer<typeof transcriptWindowInputSchema>;

export const transcriptWindowSchema = z.strictObject({
  segments: z.array(transcriptSegmentSchema).max(MEETING_WINDOW_SEGMENTS_MAX),
  dropped: z.strictObject({ silence: z.number().int().nonnegative(), duplicate: z.number().int().nonnegative(), overflow: z.number().int().nonnegative() }),
  inputChars: z.number().int().nonnegative(),
  outputChars: z.number().int().nonnegative(),
});
export type TranscriptWindow = z.infer<typeof transcriptWindowSchema>;

export const meetingContextInputSchema = z.strictObject({
  segments: z.array(transcriptSegmentSchema).max(MEETING_WINDOW_SEGMENTS_MAX),
  maxRecent: z.number().int().min(1).max(40),
});
export type MeetingContextInput = z.infer<typeof meetingContextInputSchema>;

/** An extractive window for the model to read. Picking what is being asked of the user stays with the model. */
export const meetingContextSchema = z.strictObject({
  meetingLanguage: languageTagSchema.nullable(),
  languageConfidence: confidenceSchema,
  speakers: z.array(z.string().max(200)).max(20),
  questions: z.array(z.string().max(NEURA_TEXT_MAX)).max(10),
  recent: z.array(z.string().max(NEURA_TEXT_MAX + 202)).max(40),
  inputChars: z.number().int().nonnegative(),
  outputChars: z.number().int().nonnegative(),
});
export type MeetingContext = z.infer<typeof meetingContextSchema>;

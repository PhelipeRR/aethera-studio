import { describe, expect, it } from 'vitest';
import {
  languageDecisionSchema,
  languageDetectionSchema,
  meetingContextSchema,
  meetingSessionSchema,
  meetingStartInputSchema,
  meetingUtteranceSchema,
  suggestionDecisionSchema,
  suggestionSchema,
  transcriptWindowSchema,
} from '../src/index.js';

const ids = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  utteranceId: '00000000-0000-4000-8000-000000000002',
  suggestionId: '00000000-0000-4000-8000-000000000003',
  correlationId: '00000000-0000-4000-8000-000000000004',
};
const at = '2026-11-02T12:00:00.000Z';

const utterance = { utteranceId: ids.utteranceId, sessionId: ids.sessionId, speaker: 'Dana', text: 'Could you share the timeline?', language: 'en', languageConfidence: 0.93, startedAt: at, endedAt: at, final: true };
const decision = { meetingLanguage: 'en', meetingConfidence: 0.91, utteranceLanguage: 'en', utteranceConfidence: 0.93, userPreferredLanguage: 'pt-BR', responseLanguage: 'en', reason: 'utterance', confidence: 0.93, translationLanguage: null };
const suggestion = { suggestionId: ids.suggestionId, correlationId: ids.correlationId, sessionId: ids.sessionId, utteranceId: ids.utteranceId, text: 'We expect to ship by Friday.', translation: null, sourceExcerpt: 'Could you share the timeline?', decision, confidence: 0.8, status: 'pending', actions: ['accept', 'edit', 'copy', 'speak'], delivery: 'manual', preprocessing: 'local-worker', createdAt: at };
const session = { sessionId: ids.sessionId, sourceId: 'generic-transcript', platform: 'generic', status: 'active', consent: true, capabilities: { transcript: true, audio: false, diarization: false, nativeIntegration: false }, degradations: [], meetingLanguage: null, meetingConfidence: 0, userPreferredLanguage: 'pt-BR', translationEnabled: false, startedAt: at, stoppedAt: null };

describe('Meeting contracts', () => {
  it('accepts Portuguese and English suggestions', () => {
    expect(suggestionSchema.parse(suggestion).decision.responseLanguage).toBe('en');
    const portuguese = { ...suggestion, text: 'Devemos entregar até sexta.', decision: { ...decision, utteranceLanguage: 'pt', responseLanguage: 'pt' } };
    expect(suggestionSchema.parse(portuguese).decision.responseLanguage).toBe('pt');
  });

  it('keeps meeting, utterance and preferred language plus confidences as separate values', () => {
    const mixed = languageDecisionSchema.parse({ ...decision, utteranceLanguage: 'und', utteranceConfidence: 0.31, reason: 'meeting', confidence: 0.91 });
    expect(mixed).toMatchObject({ meetingLanguage: 'en', utteranceLanguage: 'und', userPreferredLanguage: 'pt-BR', utteranceConfidence: 0.31 });
  });

  it('bounds language tags to what the registry stores', () => {
    expect(languageDecisionSchema.safeParse({ ...decision, responseLanguage: `en-${'a'.repeat(8)}-${'b'.repeat(8)}-${'c'.repeat(8)}-ddd` }).success).toBe(false);
  });

  it('enforces confidence bounds', () => {
    expect(languageDecisionSchema.safeParse({ ...decision, confidence: 1.01 }).success).toBe(false);
    expect(meetingUtteranceSchema.safeParse({ ...utterance, languageConfidence: -0.01 }).success).toBe(false);
    expect(suggestionSchema.safeParse({ ...suggestion, confidence: 2 }).success).toBe(false);
  });

  it('never offers an automatic send', () => {
    expect(suggestionSchema.safeParse({ ...suggestion, actions: ['accept', 'send'] }).success).toBe(false);
    expect(suggestionSchema.safeParse({ ...suggestion, delivery: 'automatic' }).success).toBe(false);
    expect(suggestionDecisionSchema.safeParse({ suggestionId: ids.suggestionId, decision: 'send' }).success).toBe(false);
  });

  it('rejects raw audio and oversized or untrusted payloads', () => {
    expect(meetingUtteranceSchema.safeParse({ ...utterance, audio: 'UklGRg==' }).success).toBe(false);
    expect(suggestionSchema.safeParse({ ...suggestion, rawAudio: 'UklGRg==' }).success).toBe(false);
    expect(meetingUtteranceSchema.safeParse({ ...utterance, text: 'x'.repeat(4_001) }).success).toBe(false);
    expect(meetingUtteranceSchema.safeParse({ ...utterance, text: '   ' }).success).toBe(false);
    expect(suggestionSchema.safeParse({ ...suggestion, sourceExcerpt: 'x'.repeat(501) }).success).toBe(false);
    expect(suggestionSchema.safeParse({ ...suggestion, text: 'x'.repeat(4_001) }).success).toBe(false);
  });

  it('requires opt-in and refuses a session that claims consent was not given', () => {
    const start = { sourceId: 'generic-transcript', platform: 'teams', consent: true, userPreferredLanguage: 'pt-BR', translationEnabled: false };
    expect(meetingStartInputSchema.safeParse(start).success).toBe(true);
    expect(meetingStartInputSchema.safeParse({ ...start, consent: false }).success).toBe(false);
    expect(meetingSessionSchema.parse(session)).toEqual(session);
    expect(meetingSessionSchema.safeParse({ ...session, consent: false }).success).toBe(false);
  });

  it('describes degraded sources without claiming a native integration', () => {
    const degraded = { ...session, status: 'degraded', capabilities: { transcript: false, audio: true, diarization: false, nativeIntegration: false }, degradations: ['transcript_unavailable', 'native_integration_unavailable'] };
    expect(meetingSessionSchema.parse(degraded).degradations).toContain('transcript_unavailable');
    expect(meetingSessionSchema.safeParse({ ...session, degradations: ['nope'] }).success).toBe(false);
  });

  it('validates worker results', () => {
    const detection = languageDetectionSchema.parse({ language: 'und', confidence: 0.2, mixed: true, needsModel: true, scores: [{ language: 'pt', score: 0.5 }] });
    expect(detection.needsModel).toBe(true);
    const window = { segments: [{ id: 's1', speaker: null, text: 'Olá', startMs: 0, endMs: 10 }], dropped: { silence: 1, duplicate: 2, overflow: 0 }, inputChars: 30, outputChars: 3 };
    expect(transcriptWindowSchema.parse(window).dropped.duplicate).toBe(2);
    const context = { meetingLanguage: 'en', languageConfidence: 0.9, speakers: ['Dana'], questions: ['Any update?'], recent: ['Dana: Any update?'], inputChars: 40, outputChars: 20 };
    expect(meetingContextSchema.parse(context).questions).toHaveLength(1);
    expect(meetingContextSchema.safeParse({ ...context, recent: Array.from({ length: 41 }, () => 'x') }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEURA_SETTINGS,
  IpcChannel,
  neuraSettingsPatchSchema,
  neuraSettingsSchema,
  neuraIntentSchema,
  neuraPauseResultSchema,
  neuraSessionSchema,
  parseIpcInput,
  voiceSessionSchema,
  voiceStartInputSchema,
  voiceTranscriptSchema,
} from '../src/index.js';

const ids = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  correlationId: '00000000-0000-4000-8000-000000000002',
  transcriptId: '00000000-0000-4000-8000-000000000003',
};
const at = '2026-11-02T12:00:00.000Z';

const session = { sessionId: ids.sessionId, kind: 'voice', status: 'listening', consent: true, meetingLanguage: null, userPreferredLanguage: 'pt-BR', startedAt: at, updatedAt: at, endedAt: null };

describe('Neura contracts', () => {
  it('accepts a session whose values line up with the registry vocabulary', () => {
    expect(neuraSessionSchema.parse(session)).toEqual(session);
    for (const kind of ['voice', 'meeting', 'general']) expect(neuraSessionSchema.safeParse({ ...session, kind }).success).toBe(true);
    for (const status of ['idle', 'listening', 'processing', 'paused', 'completed', 'failed']) expect(neuraSessionSchema.safeParse({ ...session, status }).success).toBe(true);
  });

  it('rejects unknown fields and malformed language tags', () => {
    expect(neuraSessionSchema.safeParse({ ...session, secret: 'x' }).success).toBe(false);
    expect(neuraSessionSchema.safeParse({ ...session, userPreferredLanguage: 'portuguese; drop table' }).success).toBe(false);
  });

  it('models intents as typed targets, never as an executable string', () => {
    const base = { correlationId: ids.correlationId, sessionId: ids.sessionId, confidence: 0.9, sourceText: 'Neura, pausa a música' };
    expect(neuraIntentSchema.parse({ ...base, target: 'spotify', command: { action: 'pause' } })).toMatchObject({ target: 'spotify' });
    expect(neuraIntentSchema.safeParse({ ...base, target: 'shell', command: 'rm -rf /' }).success).toBe(false);
    expect(neuraIntentSchema.safeParse({ ...base, target: 'conversation', command: 'rm -rf /' }).success).toBe(false);
    expect(neuraIntentSchema.safeParse({ ...base, target: 'conversation', confidence: 1.2 }).success).toBe(false);
    expect(neuraIntentSchema.safeParse({ ...base, target: 'conversation', sourceText: 'x'.repeat(4_001) }).success).toBe(false);
  });

  it('reports what global pause stopped', () => {
    expect(neuraPauseResultSchema.parse({ paused: true, voiceSessions: 1, meetingSessions: 0, pausedAt: at })).toMatchObject({ paused: true });
  });
});

describe('Voice contracts', () => {
  it('requires opt-in before a voice session can start', () => {
    expect(voiceStartInputSchema.safeParse({ consent: true, preferredLanguage: 'pt-BR' }).success).toBe(true);
    expect(voiceStartInputSchema.safeParse({ consent: false, preferredLanguage: 'pt-BR' }).success).toBe(false);
  });

  it('keeps sessions and transcripts bounded and free of raw audio', () => {
    expect(voiceSessionSchema.parse({ sessionId: ids.sessionId, state: 'listening', provider: 'fake', startedAt: at })).toMatchObject({ state: 'listening' });
    const transcript = { transcriptId: ids.transcriptId, sessionId: ids.sessionId, text: 'Neura, próxima música', language: 'pt-BR', confidence: 0.82, final: true, occurredAt: at };
    expect(voiceTranscriptSchema.parse(transcript)).toEqual(transcript);
    expect(voiceTranscriptSchema.safeParse({ ...transcript, audio: 'UklGRg==' }).success).toBe(false);
    expect(voiceTranscriptSchema.safeParse({ ...transcript, text: 'x'.repeat(4_001) }).success).toBe(false);
    expect(voiceTranscriptSchema.safeParse({ ...transcript, confidence: -0.1 }).success).toBe(false);
  });
});

describe('Neura IPC', () => {
  it('validates voice, meeting, suggestion and pause inputs', () => {
    expect(parseIpcInput(IpcChannel.neuraVoiceStart, { consent: true, preferredLanguage: 'pt-BR' })).toMatchObject({ consent: true });
    expect(() => parseIpcInput(IpcChannel.neuraVoiceStart, { consent: false, preferredLanguage: 'pt-BR' })).toThrow();
    expect(parseIpcInput(IpcChannel.neuraVoiceStop, { sessionId: ids.sessionId })).toEqual({ sessionId: ids.sessionId });
    expect(parseIpcInput(IpcChannel.neuraMeetingStart, { sourceId: 'generic-transcript', platform: 'teams', consent: true, userPreferredLanguage: 'pt-BR', translationEnabled: false })).toMatchObject({ platform: 'teams' });
    expect(() => parseIpcInput(IpcChannel.neuraMeetingStart, { sourceId: 'generic-transcript', platform: 'teams', consent: false, userPreferredLanguage: 'pt-BR', translationEnabled: false })).toThrow();
    expect(parseIpcInput(IpcChannel.neuraMeetingStop, { sessionId: ids.sessionId })).toEqual({ sessionId: ids.sessionId });
    expect(parseIpcInput(IpcChannel.neuraSuggestionDecide, { suggestionId: ids.transcriptId, decision: 'accept' })).toMatchObject({ decision: 'accept' });
    expect(parseIpcInput(IpcChannel.neuraSuggestionDecide, { suggestionId: ids.transcriptId, decision: 'reject' })).toMatchObject({ decision: 'reject' });
    expect(() => parseIpcInput(IpcChannel.neuraSuggestionDecide, { suggestionId: ids.transcriptId, decision: 'send' })).toThrow();
    expect(parseIpcInput(IpcChannel.neuraSpotifyCommand, { action: 'search', query: 'Djavan', types: ['track'], limit: 5 })).toMatchObject({ action: 'search' });
    expect(parseIpcInput(IpcChannel.neuraPauseAll, undefined)).toBeUndefined();
  });
});

describe('neuraSettingsPatchSchema', () => {
  it('does not turn global memory back on when another setting changes', () => {
    expect(neuraSettingsPatchSchema.parse({ agent: 'codex' })).toEqual({ agent: 'codex' });
  });

  it('keeps older preferences valid, with global memory on', () => {
    const older: Partial<typeof DEFAULT_NEURA_SETTINGS> = { ...DEFAULT_NEURA_SETTINGS };
    delete older.globalMemoryEnabled;
    expect(neuraSettingsSchema.parse(older).globalMemoryEnabled).toBe(true);
  });
});


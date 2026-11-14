import { describe, expect, it } from 'vitest';
import type { NeuraState, Suggestion } from '@neuralbridge/shared';
import { languageBadge, neuraActivity, neuraBadge, neuraError, neuraMascot, neuraWaitLabel, pendingSuggestions, replyBubbleMs } from '../src/renderer/src/features/neura/neura-state';

const at = '2026-11-02T12:00:00.000Z';
const id = '00000000-0000-4000-8000-000000000001';
const provider = { available: true, detail: 'ok' };
const base: NeuraState = { enabled: true, paused: false, voice: null, meeting: null, drafting: false, processing: false, suggestions: [], pendingActions: [], lastResponse: null, providers: { voice: provider, model: provider, worker: provider } };
const voice = { sessionId: id, state: 'listening' as const, provider: 'fake', startedAt: at };
const meeting = { sessionId: id, capabilities: { audio: false } } as NeuraState['meeting'];
const suggestion = { status: 'pending', decision: { responseLanguage: 'en', reason: 'meeting' } } as Suggestion;

describe('Neura HUD state', () => {
  it('stays out of the way while off or idle', () => {
    expect(neuraActivity({ ...base, enabled: false })).toBe('off');
    expect(neuraBadge(base)).toBeNull();
    expect(neuraMascot(base)).toBeNull();
    expect(neuraMascot({ ...base, enabled: false, suggestions: [suggestion] })).toBeNull();
  });

  it('always shows what is observing the user', () => {
    expect(neuraBadge({ ...base, voice })).toBe('Ouvindo');
    expect(neuraBadge({ ...base, meeting })).toBe('Reunião');
    expect(neuraBadge({ ...base, meeting: { ...meeting, capabilities: { audio: true } } as NeuraState['meeting'] })).toBe('Ouvindo a call');
    expect(neuraMascot({ ...base, voice })).toBeNull();
    expect(neuraMascot({ ...base, voice }, true)).toBe('voiceListening');
    expect(neuraActivity({ ...base, meeting, voice })).toBe('meeting');
  });

  it('asks for attention when something waits for the user', () => {
    expect(neuraBadge({ ...base, meeting, suggestions: [suggestion] })).toBe('Sugestão pronta');
    expect(neuraMascot({ ...base, meeting, suggestions: [suggestion] })).toBe('waiting');
    expect(neuraBadge({ ...base, pendingActions: [{ actionId: id, summary: 'x', expiresAt: at }] })).toBe('Confirmar ação');
    expect(neuraMascot({ ...base, meeting, drafting: true })).toBe('thinking');
    expect(neuraMascot({ ...base, processing: true })).toBe('thinking');
  });

  it('says when it is paused and gives the mascot back', () => {
    expect(neuraBadge({ ...base, paused: true })).toBe('Void pausado');
    expect(neuraMascot({ ...base, paused: true })).toBeNull();
  });

  it('labels the language with why it was chosen', () => {
    expect(languageBadge(suggestion)).toBe('EN • idioma da reunião');
  });

  it('maps IPC failures to plain messages', () => {
    expect(neuraError(new Error("Error invoking remote method 'x': NeuraError: neura_consent_required"))).toContain('Autorize');
    expect(neuraError(new Error('boom'))).toBe('Não foi possível concluir.');
  });

  it('offers the newest suggestion still waiting for a decision', () => {
    const suggestion = (suggestionId: string, status: string) => ({ suggestionId, status, createdAt: suggestionId }) as unknown as Suggestion;
    const suggestions = [suggestion('2026-11-02T10:00:00Z', 'pending'), suggestion('2026-11-02T10:05:00Z', 'pending'), suggestion('2026-11-02T10:09:00Z', 'dismissed')];
    expect(pendingSuggestions({ ...base, suggestions }).map((item) => item.suggestionId)).toEqual(['2026-11-02T10:05:00Z', '2026-11-02T10:00:00Z']);
    expect(pendingSuggestions({ ...base, suggestions: [] })).toEqual([]);
  });

  it('says how to bring back a model VoiceStudio turned off', () => {
    expect(neuraError(new Error('meeting_input_source_failed'))).toContain('volte ao Parakeet');
  });
});

describe('neuraWaitLabel', () => {
  const state = (processing: boolean) => ({ processing }) as Parameters<typeof neuraWaitLabel>[0];
  it('covers the whole wait, from the question until the voice can be heard', () => {
    expect(neuraWaitLabel(state(true), false)).toBe('Pensando');
    expect(neuraWaitLabel(state(false), true)).toBe('Preparando a voz');
    expect(neuraWaitLabel(state(false), false)).toBeNull();
    expect(neuraWaitLabel(null, false)).toBeNull();
  });
});

describe('replyBubbleMs', () => {
  it('grows with the text and never lingers past 25 seconds', () => {
    expect(replyBubbleMs('Ok.')).toBeGreaterThanOrEqual(5_000);
    expect(replyBubbleMs('a'.repeat(200))).toBeGreaterThan(replyBubbleMs('Ok.'));
    expect(replyBubbleMs('a'.repeat(4_000))).toBe(25_000);
  });
});


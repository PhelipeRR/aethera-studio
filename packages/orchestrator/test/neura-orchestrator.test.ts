import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { neuraActionAudits, neuraSessions, neuraSuggestions, openDatabase, type DatabaseHandle } from '@neuralbridge/database';
import { DEFAULT_NEURA_SETTINGS, type ComputerActionRequest, type NeuraSettings, type SpotifyCommand, type Suggestion } from '@neuralbridge/shared';
import { ComputerActionBroker } from '../src/computer-action-broker.js';
import { AllowedApplicationExecutor } from '../src/computer-executors.js';
import { SpotifyAdapterError } from '../src/integrations/spotify-adapter.js';
import { ManualTranscriptSource } from '../src/meeting/manual-transcript-source.js';
import { MeetingInput } from '../src/meeting/meeting-input.js';
import { SuggestionEngine, type SuggestionModel, type SuggestionModelRequest } from '../src/meeting/suggestion-engine.js';
import { hasWakeWord, parseNeuraIntent } from '../src/neura-intents.js';
import { NeuraError, NeuraOrchestrator, type NeuraConversation, type NeuraScreenCapture } from '../src/neura-orchestrator.js';
import { NeuraRegistry } from '../src/neura-registry.js';
import { VoiceGateway, VoiceGatewayError, type VoiceProvider, type VoiceProviderHandle } from '../src/neura-voice-gateway.js';

const migrationsFolder = resolve(import.meta.dirname, '../../database/migrations');

class FakeVoice implements VoiceProvider {
  readonly id = 'fake';
  handle: VoiceProviderHandle | null = null;
  available = true;
  availability() { return Promise.resolve({ available: this.available, detail: 'fake' }); }
  start(handle: VoiceProviderHandle) { this.handle = handle; return Promise.resolve(); }
  stop() { this.handle = null; return Promise.resolve(); }
  hear(text: string) { this.handle?.onHeard({ text, language: 'pt-BR', confidence: 0.9 }); }
  partial(text: string) { this.handle?.onPartial?.(text); }
}

describe('parseNeuraIntent', () => {
  it.each([
    ['Neura, pausa a música', { target: 'spotify', command: { action: 'pause' } }],
    ['Neura, dá play', { target: 'spotify', command: { action: 'play' } }],
    ['Neura, dá pausa', { target: 'spotify', command: { action: 'pause' } }],
    ['Neura, muda de música', { target: 'spotify', command: { action: 'next' } }],
    ['Neura, troca de faixa', { target: 'spotify', command: { action: 'next' } }],
    ['Neura, que horas são?', { target: 'time' }],
    ['Neura, que dia é hoje?', { target: 'date' }],
    ['Neura, como está o tempo?', { target: 'weather' }],
    ['Neura, what is the weather?', { target: 'weather' }],
    ['Neura, quais são minhas playlists?', { target: 'spotify_playlists' }],
    ['Neura, list my playlists', { target: 'spotify_playlists' }],
    ['Neura, quais são minhas músicas salvas?', { target: 'spotify_saved_tracks' }],
    ['Neura, what are my liked songs?', { target: 'spotify_saved_tracks' }],
    ['Neura, quais são os dispositivos do Spotify?', { target: 'spotify_devices' }],
    ['Neura, what is playing?', { target: 'spotify_current' }],
    ['Neura, mude o Spotify para a sala', { target: 'spotify_transfer', deviceName: 'sala' }],
    ['Neura, switch Spotify to Kitchen Speaker', { target: 'spotify_transfer', deviceName: 'kitchen speaker' }],
    ['ei neura próxima música', { target: 'spotify', command: { action: 'next' } }],
    ['next track', { target: 'spotify', command: { action: 'next' } }],
    ['play', { target: 'spotify', command: { action: 'play' } }],
    ['play Spotify', { target: 'spotify', command: { action: 'play' } }],
    ['pause Spotify', { target: 'spotify', command: { action: 'pause' } }],
    ['skip', { target: 'spotify', command: { action: 'next' } }],
    ['change song', { target: 'spotify', command: { action: 'next' } }],
    ['previous track', { target: 'spotify', command: { action: 'previous' } }],
    ['Neura, volume 40', { target: 'spotify', command: { action: 'volume', volume: 40 } }],
    ['coloca o volume em 15%', { target: 'spotify', command: { action: 'volume', volume: 15 } }],
    ['Neura, pausa tudo.', { target: 'pause_all' }],
    ['Neura, toca Oceano do Djavan', { target: 'spotify_play_search', query: 'Oceano do Djavan' }],
    ['Neura, toca o álbum Acústico', { target: 'spotify_play_search', query: 'Acústico', types: ['album'] }],
    ['Neura, play the playlist Focus', { target: 'spotify_play_search', query: 'Focus', types: ['playlist'] }],
    ['Neura, toca a artista Björk', { target: 'spotify_play_search', query: 'Björk', types: ['artist'] }],
    ['abre o Teams', { target: 'open_app', application: 'teams' }],
    ['abra as configurações', { target: 'open_app', application: 'settings' }],
    ['Neura, abre o bloco de notas', { target: 'open_app', application: 'notepad' }],
    ['Neura, open calculator', { target: 'open_app', application: 'calculator' }],
    ['Neura, o que está aparecendo na minha tela?', { target: 'screen' }],
    ['Neura, what is on my screen?', { target: 'screen' }],
    ['Neura, responda este chat', { target: 'reply_chat', instruction: '' }],
    ['Neura, reply to this message saying thanks', { target: 'reply_chat', instruction: 'thanks' }],
    ['abre o cmd', { target: 'unsupported_app', name: 'cmd' }],
    ['Neura, ativar modo silencioso', { target: 'silent_mode', enabled: true }],
    ['Neura, desliga o modo silencioso.', { target: 'silent_mode', enabled: false }],
    ['Neura, turn on silent mode', { target: 'silent_mode', enabled: true }],
    ['Neura, usa o Codex', { target: 'agent', agent: 'codex' }],
    ['Neura, switch to Claude', { target: 'agent', agent: 'claude' }],
    ['Neura, abre o painel', { target: 'panel', open: true }],
    ['Neura, fecha o painel', { target: 'panel', open: false }],
    ['Neura, o que você pode fazer?', { target: 'help' }],
    ['Neura, qual é a capital da França?', { target: 'conversation', text: 'qual é a capital da França?' }],
  ])('maps %s', (text, intent) => { expect(parseNeuraIntent(text)).toEqual(intent); });

  it('never lets a volume outside the range through as a command', () => {
    expect(parseNeuraIntent('volume 500').target).toBe('conversation');
  });

  it('recognizes the wake word only at the start', () => {
    expect(hasWakeWord('Void, oi')).toBe(true);
    expect(hasWakeWord('Neura, oi')).toBe(true);
    // Parakeet punctuates after a greeting, and hears a spoken "Ei" as "Em".
    expect(hasWakeWord('Ei, Neura')).toBe(true);
    expect(hasWakeWord('Oi, Neura, abre o Teams.')).toBe(true);
    expect(hasWakeWord('Em Neura, que horas são?')).toBe(true);
    expect(hasWakeWord('Olá, Neura.')).toBe(true);
    // Heard from a real voice on a real microphone.
    expect(hasWakeWord('Neora.')).toBe(true);
    expect(hasWakeWord('Hello Neora.')).toBe(true);
    expect(parseNeuraIntent('Neora, próxima música.').target).toBe('spotify');
    expect(hasWakeWord('Neura?')).toBe(true);
    expect(hasWakeWord('Neure.')).toBe(true);
    expect(hasWakeWord('Не ура.')).toBe(true);
    expect(parseNeuraIntent('Не ура, que horas são?').target).toBe('time');
    expect(hasWakeWord('Neuro, abre o Teams')).toBe(false);
    expect(parseNeuraIntent('Oi, Neura, próxima música.').target).toBe('spotify');
    expect(hasWakeWord('ei neura')).toBe(true);
    expect(hasWakeWord('a neura disse')).toBe(false);
    expect(hasWakeWord('neurology')).toBe(false);
  });

  it('uses Void as primary while allowing a configurable alias', () => {
    expect(hasWakeWord('Neura, abra o painel', { primary: 'Void', aliases: ['Neura'] })).toBe(true);
    expect(hasWakeWord('Neura, abra o painel', { primary: 'Void', aliases: [] })).toBe(false);
    expect(parseNeuraIntent('Void, abra o painel', { primary: 'Void', aliases: ['Neura'] })).toEqual({ target: 'panel', open: true });
  });
});

describe('VoiceGateway', () => {
  it('emits a wake event before forwarding the command transcript', async () => {
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider);
    const events: string[] = [];
    gateway.subscribe({ wakeDetected: () => events.push('wake'), transcript: () => events.push('transcript') });
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });

    provider.hear('Neura, próxima música');

    expect(events).toEqual(['wake', 'transcript']);
  });

  it('passes only what follows the wake word, then a short follow-up', async () => {
    let now = 1_000;
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider, { now: () => now });
    const heard: string[] = [];
    gateway.subscribe({ transcript: (item) => heard.push(item.text) });
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });
    provider.hear('conversa da sala');
    provider.hear('Neura, próxima música');
    gateway.setSpeaking(true);
    gateway.setSpeaking(false);
    provider.hear('e mais uma');
    provider.hear('já sem janela');
    now += 9_000;
    provider.hear('muito depois');
    expect(heard).toEqual(['Neura, próxima música', 'e mais uma']);
  });

  it('lets noise neither start nor replace a follow-up, but still takes one-word commands', async () => {
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider);
    const heard: string[] = [];
    gateway.subscribe({ transcript: (item) => heard.push(item.text) });
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });
    provider.hear('Neura');
    provider.hear('Thank you.');
    provider.hear('Yeah.');
    provider.hear('Pausa.');
    expect(heard).toEqual(['Neura', 'Pausa.']);
  });

  it('hears the wake word in a partial when the final drops it, and beeps once', async () => {
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider);
    const heard: string[] = [];
    const wake = vi.fn();
    gateway.subscribe({ transcript: (item) => heard.push(item.text), wakeDetected: wake });
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });
    provider.partial('Neura');
    provider.partial('Neura, que horas');
    provider.hear('Que horas são?');
    provider.partial('Neura');
    provider.hear('Neura, próxima música');
    expect(heard).toEqual(['Que horas são?', 'Neura, próxima música']);
    expect(wake).toHaveBeenCalledTimes(2);
  });

  it('is interrupted by a wake word heard in a partial while speaking', async () => {
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider);
    const interrupted = vi.fn();
    gateway.subscribe({ interrupted });
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });
    gateway.setSpeaking(true);
    provider.hear('o resto da resposta dela');
    expect(interrupted).not.toHaveBeenCalled();
    provider.partial('Neura');
    expect(interrupted).toHaveBeenCalledOnce();
    expect(gateway.current?.state).toBe('listening');
  });

  it('reopens the gate on its own when the end of speech never arrives', async () => {
    vi.useFakeTimers();
    try {
      const provider = new FakeVoice();
      const gateway = new VoiceGateway(provider, { speakingMaxMs: 1_000 });
      await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });
      gateway.setSpeaking(true);
      expect(gateway.current?.state).toBe('speaking');
      vi.advanceTimersByTime(1_000);
      expect(gateway.current?.state).toBe('listening');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the post-beep command window open while the user starts speaking', async () => {
    let now = 1_000;
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider, { now: () => now });
    const heard: string[] = [];
    gateway.subscribe({ transcript: (item) => heard.push(item.text) });
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });

    provider.hear('Neura');
    now += 10_000;
    provider.hear('que horas são?');

    expect(heard).toEqual(['Neura', 'que horas são?']);
  });

  it('refuses without consent, when unavailable and when already running', async () => {
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider);
    await expect(gateway.start({ consent: false, preferredLanguage: 'pt-BR' } as never)).rejects.toThrow();
    provider.available = false;
    await expect(gateway.start({ consent: true, preferredLanguage: 'pt-BR' })).rejects.toBeInstanceOf(VoiceGatewayError);
    provider.available = true;
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });
    await expect(gateway.start({ consent: true, preferredLanguage: 'pt-BR' })).rejects.toMatchObject({ code: 'already_running' });
  });

  it('is interrupted only by the wake word while speaking', async () => {
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider);
    const interrupted = vi.fn();
    gateway.subscribe({ interrupted });
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });
    gateway.setSpeaking(true);
    provider.hear('o que ela mesma disse');
    expect(interrupted).not.toHaveBeenCalled();
    provider.hear('Neura, para');
    expect(interrupted).toHaveBeenCalledOnce();
  });

  it('drops oversized transcripts and ends when the engine fails', async () => {
    const provider = new FakeVoice();
    const gateway = new VoiceGateway(provider);
    const heard = vi.fn();
    const ended = vi.fn();
    gateway.subscribe({ transcript: heard, ended });
    await gateway.start({ consent: true, preferredLanguage: 'pt-BR' });
    provider.hear(`Neura ${'x'.repeat(4_001)}`);
    expect(heard).not.toHaveBeenCalled();
    provider.handle?.onFailure('microfone sumiu');
    expect(ended).toHaveBeenCalledWith('microfone sumiu');
    expect(gateway.current).toBeNull();
  });
});

describe('NeuraOrchestrator', () => {
  let dir: string;
  let handle: DatabaseHandle;
  let settings: NeuraSettings;
  let voice: FakeVoice;
  let spotifyCalls: SpotifyCommand[];
  let spotifyError: Error | null;
  const startTask = vi.fn(() => Promise.resolve('task'));
  const app = { update: vi.fn<(changes: { silentReplies?: boolean; agent?: 'claude' | 'codex' }) => Promise<void>>(() => Promise.resolve()), setPanelOpen: vi.fn() };
  let launched: string[];
  let generate: ReturnType<typeof vi.fn<SuggestionModel['generate']>>;
  let conversation: ReturnType<typeof vi.fn<NeuraConversation['reply']>>;
  let screenCapture: () => Promise<NeuraScreenCapture>;
  let neura: NeuraOrchestrator;
  let meeting: MeetingInput;
  const start = { sourceId: 'manual-transcript', platform: 'teams' as const, consent: true as const, userPreferredLanguage: 'pt-BR', translationEnabled: false };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'neura-'));
    handle = openDatabase(join(dir, 'neura.db'), { migrationsFolder });
    settings = { ...DEFAULT_NEURA_SETTINGS, enabled: true, voiceConsent: true, meetingConsent: true, projectId: 'p1', retainSuggestions: true };
    voice = new FakeVoice();
    spotifyCalls = [];
    spotifyError = null;
    launched = [];
    generate = vi.fn<SuggestionModel['generate']>((request) => Promise.resolve({ text: `Reply in ${request.responseLanguage}`, translation: null, confidence: 0.8 }));
    conversation = vi.fn<NeuraConversation['reply']>(() => Promise.resolve('Paris.'));
    screenCapture = vi.fn<() => Promise<NeuraScreenCapture>>().mockResolvedValue({ path: 'C:/Temp/screen.png', name: 'screen.png', mime: 'image/png', size: 128 });
    const transcripts = new ManualTranscriptSource();
    meeting = new MeetingInput([transcripts]);
    neura = new NeuraOrchestrator({
      app,
      settings: () => settings,
      voice: new VoiceGateway(voice),
      meeting,
      transcripts,
      suggestions: new SuggestionEngine({ worker: null, model: { generate } }),
      spotify: { execute: (command) => { spotifyCalls.push(command); if (spotifyError) return Promise.reject(spotifyError); return Promise.resolve(command.action === 'search' ? { items: [{ uri: 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6', type: 'track', name: 'Oceano', subtitle: 'Djavan' }] } : { playback: null, refreshed: true }); } },
      actions: new ComputerActionBroker(handle, { executor: new AllowedApplicationExecutor({ launch: (application) => { launched.push(application); return Promise.resolve(); } }, { start: startTask }) }),
      conversation: { reply: conversation },
      screen: { capture: screenCapture },
      registry: new NeuraRegistry(handle),
      providers: { model: () => ({ available: true, detail: 'ok' }), worker: () => ({ available: false, detail: 'fallback' }) },
    });
  });
  afterEach(() => {
    neura.dispose();
    meeting.dispose();
    handle.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const settled = async () => { await vi.waitFor(() => { expect(neura.state().drafting).toBe(false); }); };
  const ask = (text: string) => neura.handleTranscript({ text, voice: false });

  it('stays off until enabled and refuses without consent', async () => {
    settings = { ...settings, enabled: false };
    await expect(ask('próxima música')).rejects.toMatchObject({ code: 'disabled' });
    settings = { ...settings, enabled: true, voiceConsent: false, meetingConsent: false };
    await expect(neura.startVoice({ consent: true, preferredLanguage: 'pt-BR' })).rejects.toMatchObject({ code: 'consent_required' });
    await expect(neura.startMeeting(start)).rejects.toMatchObject({ code: 'consent_required' });
  });

  it('starts voice automatically when the user has enabled microphone consent', async () => {
    await neura.applySettings();

    expect(voice.handle).not.toBeNull();
    expect(neura.state().voice).toMatchObject({ state: 'listening' });
  });

  it('keeps a manual stop off until the user starts listening again', async () => {
    await neura.applySettings();
    const sessionId = neura.state().voice?.sessionId;
    await neura.stopVoice(sessionId ?? '00000000-0000-4000-8000-000000000001');
    await neura.refreshProviders();

    expect(voice.handle).toBeNull();
    expect(neura.state().voice).toBeNull();
  });

  it('reopens the microphone after the provider drops it unexpectedly', async () => {
    vi.useFakeTimers();
    try {
      await neura.applySettings();
      const firstSession = neura.state().voice?.sessionId;
      voice.handle?.onFailure('microfone sumiu');
      expect(neura.state().voice).toBeNull();

      await vi.advanceTimersByTimeAsync(1_500);

      expect(neura.state().voice?.sessionId).not.toBe(firstSession);
      expect(voice.handle).not.toBeNull();
      expect(neura.state().providers.voice).toMatchObject({ available: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes bounded microphone telemetry in the provider status', async () => {
    await neura.applySettings();
    neura.reportVoiceSignal({ deviceLabel: 'fifine SC3', peak: 0.42, lastFrameAt: Date.now() });

    expect(neura.state().providers.voice).toMatchObject({ available: true });
    expect(neura.state().providers.voice.detail).toContain('fifine SC3');
    expect(neura.state().providers.voice.detail).toContain('pico 0.42');
  });

  it('routes voice to Spotify and marks the answer for speech', async () => {
    await neura.startVoice({ consent: true, preferredLanguage: 'pt-BR' });
    voice.hear('Neura, volume 30');
    await vi.waitFor(() => { expect(neura.state().lastResponse?.message).toBe('Volume em 30%.'); });
    expect(spotifyCalls).toEqual([{ action: 'volume', volume: 30 }]);
    expect(neura.state().lastResponse?.speak).toBe(true);
    expect(neura.state().voice?.state).toBe('speaking');
    neura.finishedSpeaking();
    expect(neura.state().voice?.state).toBe('listening');
  });

  it('forwards the wake event to HUD listeners before handling the command', async () => {
    const wake = vi.fn();
    neura.onWake(wake);
    await neura.startVoice({ consent: true, preferredLanguage: 'pt-BR' });

    voice.hear('Neura, próxima música');

    await vi.waitFor(() => { expect(neura.state().lastResponse?.message).toBe('Próxima faixa.'); });
    expect(wake).toHaveBeenCalledOnce();
  });

  it('uses the beep as the wake-only acknowledgement and accepts the next command', async () => {
    await neura.startVoice({ consent: true, preferredLanguage: 'pt-BR' });

    voice.hear('Neura');

    await vi.waitFor(() => {
      expect(neura.state().lastResponse?.message).toBe('Estou ouvindo.');
      expect(neura.state().lastResponse?.speak).toBe(false);
      expect(neura.state().voice?.state).toBe('listening');
    });

    voice.hear('próxima música');

    await vi.waitFor(() => { expect(neura.state().lastResponse?.message).toBe('Próxima faixa.'); });
    expect(spotifyCalls).toEqual([{ action: 'next' }]);
  });

  it('searches, then plays the result and never the spoken words', async () => {
    await ask('toca Oceano');
    expect(spotifyCalls.map((command) => command.action)).toEqual(['search', 'play']);
    expect(spotifyCalls[1]).toEqual({ action: 'play', uri: 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6' });
  });

  it('turns no device into an actionable message with no other path', async () => {
    spotifyError = new SpotifyAdapterError('no_device');
    expect(await ask('próxima música')).toMatchObject({ outcome: 'failed', message: expect.stringContaining('Nenhum dispositivo') as string });
    expect(launched).toEqual([]);
  });

  it('opens a safe application at once and audits it', async () => {
    expect((await ask('abre o Spotify')).outcome).toBe('done');
    expect(launched).toEqual(['spotify']);
    expect(handle.db.select().from(neuraActionAudits).all()[0]).toMatchObject({ actionType: 'computer.open_app:spotify', status: 'completed' });
  });

  it('flips its own switches by voice, and answers in the language asked', async () => {
    app.update.mockClear();
    await expect(ask('Neura, ativar modo silencioso')).resolves.toMatchObject({ outcome: 'done', message: 'Modo silencioso ativado.' });
    expect(app.update).toHaveBeenCalledWith({ silentReplies: true });
    await expect(ask('Neura, switch to Claude')).resolves.toMatchObject({ message: 'I will use Claude.' });
    expect(app.update).toHaveBeenCalledWith({ agent: 'claude' });
    await ask('Neura, abre o painel');
    expect(app.setPanelOpen).toHaveBeenCalledWith(true);
    expect(conversation).not.toHaveBeenCalled();
  });

  it('only proposes a project edit, and starts it from the panel on the proposed project', async () => {
    startTask.mockClear();
    await expect(ask('Neura, corrija o arquivo src/app.ts')).resolves.toMatchObject({ outcome: 'needs_confirmation' });
    expect(conversation).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
    const [action] = neura.state().pendingActions;
    expect(action?.summary).toContain('src/app.ts');
    settings = { ...settings, projectId: 'p2' };
    await expect(neura.decideAction({ actionId: action?.actionId ?? '', decision: 'allow' })).resolves.toMatchObject({ outcome: 'done', message: 'Tarefa iniciada no projeto.' });
    expect(startTask).toHaveBeenCalledTimes(1);
    expect(startTask.mock.calls[0]).toEqual([{ projectId: 'p1', prompt: expect.stringContaining('Não faça commit, push, checkout ou merge'), externalRef: { system: 'void', id: expect.stringMatching(/^action\//u), revision: 1 } }]);
    expect(startTask.mock.calls[0]).toEqual([expect.objectContaining({ prompt: expect.stringContaining('corrija o arquivo src/app.ts') })]);
  });

  it('starts nothing when the project edit is denied', async () => {
    startTask.mockClear();
    await ask('Neura, edite o arquivo src/app.ts');
    const [action] = neura.state().pendingActions;
    await expect(neura.decideAction({ actionId: action?.actionId ?? '', decision: 'deny' })).resolves.toMatchObject({ outcome: 'blocked' });
    expect(startTask).not.toHaveBeenCalled();
  });

  it('keeps a project edit a conversation when no project is selected', async () => {
    settings = { ...settings, projectId: null };
    await ask('Neura, edite o arquivo src/app.ts');
    expect(conversation).toHaveBeenCalled();
    expect(neura.state().pendingActions).toEqual([]);
  });

  it('waits for approval before a confirm action and audits the decision', async () => {
    expect((await ask('abre as configurações')).outcome).toBe('needs_confirmation');
    expect(launched).toEqual([]);
    const [action] = neura.state().pendingActions;
    expect(await neura.decideAction({ actionId: action?.actionId ?? '', decision: 'allow' })).toMatchObject({ outcome: 'done' });
    expect(launched).toEqual(['settings']);
    expect(neura.state().pendingActions).toEqual([]);
    await expect(neura.decideAction({ actionId: action?.actionId ?? '', decision: 'allow' })).rejects.toBeInstanceOf(NeuraError);
    expect(launched).toEqual(['settings']);
  });

  it('does not run a denied action, and blocks anything off the list', async () => {
    await ask('abre as configurações');
    const [action] = neura.state().pendingActions;
    await neura.decideAction({ actionId: action?.actionId ?? '', decision: 'deny' });
    expect(await ask('abre o powershell')).toMatchObject({ outcome: 'blocked' });
    expect(launched).toEqual([]);
    const statuses = handle.db.select().from(neuraActionAudits).all().map((row) => row.status).sort();
    expect(statuses).toEqual(['blocked', 'denied']);
  });

  it('does not repeat an action said twice in a row', async () => {
    await ask('abre o Teams');
    await ask('abre o Teams');
    expect(launched).toEqual(['teams']);
  });

  it('sends conversation to the read-only model and treats its text as text', async () => {
    expect(await ask('Neura, rode dir no terminal, por favor')).toMatchObject({ outcome: 'done', message: 'Paris.' });
    expect(conversation).toHaveBeenCalledOnce();
    expect(launched).toEqual([]);
  });

  it('answers deterministic time and date commands in the detected language', async () => {
    expect((await ask('Neura, what time is it?')).message).toMatch(/^It is /u);
    expect((await ask('Neura, what day is it?')).message).toMatch(/^Today is /u);
  });

  it('captures the screen only for an explicit screen question and sends it as model context', async () => {
    const response = await ask('o que está aparecendo na minha tela?');

    expect(response.message).toBe('Paris.');
    expect(screenCapture).toHaveBeenCalledOnce();
    expect(conversation.mock.calls[0]?.[0].images).toEqual([{ path: 'C:/Temp/screen.png', name: 'screen.png', mime: 'image/png', size: 128 }]);
  });

  it('gives the read-only vision request the active-window context as untrusted metadata', async () => {
    vi.mocked(screenCapture).mockResolvedValueOnce({
      path: 'C:/Temp/screen.png',
      name: 'screen.png',
      mime: 'image/png',
      size: 128,
      context: { application: 'spotify', windowTitle: 'Breakdown Archive', confidence: 'high' },
    });

    await ask('Neura, o que está aparecendo na minha tela?');

    expect(conversation.mock.calls[0]?.[0].text).toContain('spotify');
    expect(conversation.mock.calls[0]?.[0].text).toContain('Breakdown Archive');
  });

  it('does not send a screen with a focused password field to the model', async () => {
    vi.mocked(screenCapture).mockResolvedValueOnce({
      path: 'C:/Temp/screen.png',
      name: 'screen.png',
      mime: 'image/png',
      size: 128,
      context: { application: 'browser', windowTitle: 'Login', confidence: 'high', focusedElement: { controlType: 'ControlType.Edit', editable: false, password: true } },
    });

    await expect(ask('Neura, o que está aparecendo na minha tela?')).resolves.toMatchObject({ outcome: 'blocked' });
    expect(conversation).not.toHaveBeenCalled();
  });

  it('never sends the screen to the model when the focused field is a password', async () => {
    vi.mocked(screenCapture).mockResolvedValueOnce({
      path: 'C:/Temp/screen.png',
      name: 'screen.png',
      mime: 'image/png',
      size: 128,
      context: { application: 'browser', windowTitle: 'Login', confidence: 'high', focusedElement: { controlType: 'ControlType.Edit', editable: false, password: true } },
    });

    await expect(ask('Neura, responda este chat')).resolves.toMatchObject({ outcome: 'failed' });
    expect(conversation).not.toHaveBeenCalled();
  });

  it('measures a conversation, and an agent that fails is measured too', async () => {
    conversation.mockImplementationOnce(async (input: { onProgress?: (text: string) => void }) => { input.onProgress?.('Primeiro'); return 'Pronto.'; });
    await expect(ask('Neura, explique isto')).resolves.toMatchObject({ outcome: 'done', message: 'Pronto.', timing: { firstTextMs: expect.any(Number), totalMs: expect.any(Number) } });
    conversation.mockRejectedValueOnce(new Error('unavailable'));
    const failed = await ask('Neura, explique isto');
    expect(failed).toMatchObject({ outcome: 'failed', timing: { totalMs: expect.any(Number) } });
    expect(failed.timing?.firstTextMs).toBeUndefined();
  });

  it('turns a meeting line into a pending manual suggestion in English', async () => {
    const session = await neura.startMeeting(start);
    expect(session).toMatchObject({ platform: 'generic', status: 'degraded' });
    neura.addMeetingTranscript({ sessionId: session.sessionId, speaker: 'Dana', text: 'Could you share the timeline with the team?' });
    await vi.waitFor(() => { expect(generate).toHaveBeenCalled(); });
    await settled();
    expect(neura.state().suggestions[0]).toMatchObject({ delivery: 'manual', status: 'pending' });
    expect(handle.db.select().from(neuraSuggestions).all()).toHaveLength(1);
  });

  it('drafts once for a pasted block, on the newest line', async () => {
    const session = await neura.startMeeting(start);
    neura.addMeetingTranscript({ sessionId: session.sessionId, speaker: null, text: 'one\ntwo\nthree' });
    await vi.waitFor(() => { expect(generate).toHaveBeenCalled(); });
    await settled();
    expect(generate).toHaveBeenCalledOnce();
    expect((generate.mock.calls[0]?.[0] as SuggestionModelRequest).question).toBe('three');
  });

  it('keeps nothing in the database unless retention is on', async () => {
    settings = { ...settings, retainSuggestions: false };
    const session = await neura.startMeeting(start);
    neura.addMeetingTranscript({ sessionId: session.sessionId, speaker: null, text: 'Any update?' });
    await vi.waitFor(() => { expect(neura.state().suggestions).toHaveLength(1); });
    expect(handle.db.select().from(neuraSuggestions).all()).toEqual([]);
    const suggestion = neura.state().suggestions[0] as Suggestion;
    expect(neura.decideSuggestion({ suggestionId: suggestion.suggestionId, decision: 'copy' }).status).toBe('copied');
  });

  it('records decisions, removes accepted drafts and clears history', async () => {
    const session = await neura.startMeeting(start);
    neura.addMeetingTranscript({ sessionId: session.sessionId, speaker: null, text: 'Any update?' });
    await vi.waitFor(() => { expect(neura.state().suggestions).toHaveLength(1); });
    const suggestion = neura.state().suggestions[0] as Suggestion;
    neura.decideSuggestion({ suggestionId: suggestion.suggestionId, decision: 'edit', text: 'Friday.' });
    expect(neura.state().suggestions[0]).toMatchObject({ text: 'Friday.', status: 'edited' });
    neura.decideSuggestion({ suggestionId: suggestion.suggestionId, decision: 'accept' });
    expect(neura.state().suggestions).toEqual([]);
    expect(handle.db.select().from(neuraSuggestions).where(eq(neuraSuggestions.id, suggestion.suggestionId)).get()?.status).toBe('accepted');
    expect(neura.clearHistory()).toEqual({ removed: 1 });
    expect(handle.db.select().from(neuraSuggestions).all()).toEqual([]);
  });

  it('failing to draft reports it without inventing text', async () => {
    generate.mockRejectedValueOnce(new Error('down'));
    const session = await neura.startMeeting(start);
    neura.addMeetingTranscript({ sessionId: session.sessionId, speaker: null, text: 'Any update?' });
    await vi.waitFor(() => { expect(neura.state().lastResponse?.outcome).toBe('failed'); });
    expect(neura.state().suggestions).toEqual([]);
  });

  it('pause stops listening and meetings, refuses work and resumes on request', async () => {
    await neura.startVoice({ consent: true, preferredLanguage: 'pt-BR' });
    const session = await neura.startMeeting(start);
    expect(await neura.pauseAll()).toMatchObject({ voiceSessions: 1, meetingSessions: 1 });
    expect(neura.state()).toMatchObject({ paused: true, voice: null, meeting: null });
    expect(voice.handle).toBeNull();
    expect(handle.db.select().from(neuraSessions).where(eq(neuraSessions.id, session.sessionId)).get()?.status).toBe('completed');
    await expect(ask('próxima música')).rejects.toMatchObject({ code: 'paused' });
    await expect(neura.startVoice({ consent: true, preferredLanguage: 'pt-BR' })).rejects.toMatchObject({ code: 'paused' });
    neura.resume();
    await ask('próxima música');
    expect(spotifyCalls).toHaveLength(1);
  });

  it('ends what a withdrawn consent covered', async () => {
    await neura.startVoice({ consent: true, preferredLanguage: 'pt-BR' });
    await neura.startMeeting(start);
    settings = { ...settings, voiceConsent: false, meetingConsent: false };
    await neura.applySettings();
    expect(neura.state()).toMatchObject({ voice: null, meeting: null, paused: false });
    expect(voice.handle).toBeNull();
  });

  it('pauses by voice', async () => {
    await neura.startVoice({ consent: true, preferredLanguage: 'pt-BR' });
    voice.hear('Neura, pausa tudo');
    await vi.waitFor(() => { expect(neura.state().paused).toBe(true); });
    expect(neura.state().voice).toBeNull();
  });

  it('notifies subscribers with a valid state', async () => {
    const states: unknown[] = [];
    neura.onState((state) => states.push(state));
    await ask('próxima música');
    expect(states.length).toBeGreaterThan(0);
  });
});

describe('NeuraOrchestrator system audio', () => {
  const start = { sourceId: 'system-audio', platform: 'generic', consent: true, userPreferredLanguage: 'pt-BR', translationEnabled: false } as const;
  const build = (over: Partial<NeuraSettings>, slow = false) => {
    let open: () => void = () => undefined;
    const reply = vi.fn(() => Promise.reject(new Error('unused')));
    let settings: NeuraSettings = { ...DEFAULT_NEURA_SETTINGS, enabled: true, meetingConsent: true, ...over };
    const stop = vi.fn(() => Promise.resolve());
    const source = { id: 'system-audio', platform: 'generic' as const, capabilities: () => ({ transcript: true, audio: true, diarization: false, nativeIntegration: false }), start: () => (slow ? new Promise<void>((done) => { open = done; }) : Promise.resolve()), stop };
    const meeting = new MeetingInput([source]);
    const neura = new NeuraOrchestrator({
      settings: () => settings,
      voice: new VoiceGateway({ id: 'fake', availability: () => Promise.resolve({ available: false, detail: '' }), start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      meeting,
      transcripts: new ManualTranscriptSource(),
      suggestions: { suggest: () => Promise.reject(new Error('unused')) },
      spotify: { command: () => Promise.reject(new Error('unused')) },
      actions: null,
      conversation: { reply },
      registry: null,
      providers: { model: () => ({ available: true, detail: '' }), worker: () => ({ available: true, detail: '' }) },
    } as unknown as ConstructorParameters<typeof NeuraOrchestrator>[0]);
    return { neura, stop, reply, open: () => open(), withdraw: () => { settings = { ...settings, meetingAudioConsent: false }; } };
  };

  it('needs its own consent, apart from the one for pasted text', async () => {
    await expect(build({ meetingAudioConsent: false }).neura.startMeeting(start)).rejects.toThrow('consent');
    await expect(build({ meetingAudioConsent: true }).neura.startMeeting(start)).resolves.toMatchObject({ sourceId: 'system-audio' });
  });

  it('stops listening as soon as that consent is withdrawn', async () => {
    const { neura, stop, withdraw } = build({ meetingAudioConsent: true });
    await neura.startMeeting(start);
    withdraw();
    await neura.applySettings();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(neura.state().meeting).toBeNull();
  });

  it('does not show the meeting as listening before the audio is really open', async () => {
    const { neura, open } = build({ meetingAudioConsent: true }, true);
    const started = neura.startMeeting(start);
    await Promise.resolve();
    expect(neura.state().meeting).toBeNull();
    open();
    await started;
    expect(neura.state().meeting?.sourceId).toBe('system-audio');
  });

  it('takes no voice commands during a call, because the microphone hears the speakers', async () => {
    const { neura, reply } = build({ meetingAudioConsent: true });
    await neura.startMeeting(start);
    await neura['onVoiceTranscript']({ text: 'Neura, abre o Teams', language: 'pt-BR', confidence: .9, final: true } as never);
    expect(reply).not.toHaveBeenCalled();
  });

  it('stops hearing when the HUD can no longer show that it hears', async () => {
    const { neura } = build({ meetingAudioConsent: true });
    await neura.startMeeting(start);
    await neura.stopHearing('o Companion foi fechado.');
    expect(neura.state().meeting).toBeNull();
    expect(neura.state().lastResponse?.message).toContain('o Companion foi fechado.');
  });

  it('ends the meeting and says why when the audio is lost', async () => {
    const { neura } = build({ meetingAudioConsent: true });
    const session = await neura.startMeeting(start);
    await neura.reportMeetingLost(session.sessionId, 'o VoiceStudio parou de responder.');
    expect(neura.state().meeting).toBeNull();
    expect(neura.state().lastResponse?.message).toContain('o VoiceStudio parou de responder.');
  });
});

describe('ComputerActionBroker.run', () => {
  it('never runs a confirm action directly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'broker-'));
    const handle = openDatabase(join(dir, 'b.db'), { migrationsFolder });
    const execute = vi.fn(() => Promise.resolve('ok'));
    const broker = new ComputerActionBroker(handle, { executor: { execute } });
    const request: ComputerActionRequest = { actionId: '00000000-0000-4000-8000-000000000001', sessionId: null, actionType: 'computer.open_app:settings', risk: 'confirm', summary: 'x', fingerprint: 'f', createdAt: '2026-11-02T12:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' };
    expect((await broker.run(request)).status).toBe('requested');
    expect(execute).not.toHaveBeenCalled();
    handle.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
});

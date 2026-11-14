import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NEURA_SETTINGS, IpcChannel, type NeuraSettings } from '@neuralbridge/shared';
import type { NeuraOrchestrator } from '@neuralbridge/orchestrator';
import { registerNeuraIpc } from '../src/main/neura-ipc.js';
import { WindowsSpeechProvider } from '../src/main/windows-speech-provider.js';

type Listener = (event: { senderFrame: { url: string } | null }, payload: unknown) => Promise<unknown>;
const trusted = { senderFrame: { url: 'app://trusted' } };

function setup() {
  const handlers = new Map<string, Listener>();
  let settings: NeuraSettings = DEFAULT_NEURA_SETTINGS;
  const neura = { applySettings: vi.fn(() => Promise.resolve()), handleTranscript: vi.fn(() => Promise.resolve({ correlationId: '00000000-0000-4000-8000-000000000001', outcome: 'done', message: 'ok', speak: false, at: '2026-11-02T12:00:00.000Z' })) };
  const speech = { speak: vi.fn(() => Promise.resolve({ provider: 'voicestudio' as const, modelId: 'model', voiceId: 'voice', audio: 'data:audio/wav;base64,d2F2' })) };
  registerNeuraIpc({ handle: (channel, listener) => { handlers.set(channel, listener); } }, neura as unknown as NeuraOrchestrator, { read: () => settings, write: (next) => { settings = next; } }, (url) => url === 'app://trusted', speech);
  return { handlers, neura, speech, settings: () => settings };
}

describe('Neura IPC', () => {
  it('registers every Neura channel except the Spotify one, which already has its handler', () => {
    const { handlers } = setup();
    const expected = Object.values(IpcChannel).filter((channel) => channel.startsWith('neura:') && channel !== IpcChannel.neuraSpotifyCommand);
    expect([...handlers.keys()].sort()).toEqual([...expected].sort());
  });

  it('rejects untrusted senders and malformed payloads before reaching Neura', async () => {
    const { handlers, neura } = setup();
    const input = handlers.get(IpcChannel.neuraInput);
    await expect(input?.({ senderFrame: { url: 'https://evil.example' } }, { text: 'abre o teams' })).rejects.toThrow('Untrusted');
    await expect(input?.({ senderFrame: null }, { text: 'abre o teams' })).rejects.toThrow('Untrusted');
    await expect(input?.(trusted, { text: 'x', command: 'calc.exe' })).rejects.toThrow('Invalid');
    expect(neura.handleTranscript).not.toHaveBeenCalled();
    await input?.(trusted, { text: 'próxima música' });
    expect(neura.handleTranscript).toHaveBeenCalledWith({ text: 'próxima música', voice: false });
  });

  it('applies a settings change at once, so withdrawing consent ends the session', async () => {
    const { handlers, neura, settings } = setup();
    await handlers.get(IpcChannel.neuraSettingsUpdate)?.(trusted, { enabled: true, voiceConsent: false });
    expect(settings().enabled).toBe(true);
    expect(neura.applySettings).toHaveBeenCalledOnce();
    await expect(handlers.get(IpcChannel.neuraSettingsUpdate)?.(trusted, { preferredLanguage: 'drop table' })).rejects.toThrow('Invalid');
  });

  it('merges simultaneous settings patches instead of losing a consent', async () => {
    const handlers = new Map<string, Listener>();
    let settings: NeuraSettings = DEFAULT_NEURA_SETTINGS;
    const writes: NeuraSettings[] = [];
    let release: (() => void) | undefined;
    const firstApply = new Promise<void>((resolve) => { release = resolve; });
    let applies = 0;
    const neura = { applySettings: vi.fn(() => { applies += 1; return applies === 1 ? firstApply : Promise.resolve(); }) };
    registerNeuraIpc({ handle: (channel, listener) => { handlers.set(channel, listener); } }, neura as unknown as NeuraOrchestrator, { read: () => settings, write: (next) => { settings = next; writes.push(next); } }, (url) => url === 'app://trusted');
    const update = handlers.get(IpcChannel.neuraSettingsUpdate);
    const first = update?.(trusted, { meetingAudioConsent: true });
    const second = update?.(trusted, { screenConsent: true });
    await Promise.resolve();
    expect(settings.meetingAudioConsent).toBe(true);
    expect(settings.screenConsent).toBe(false);
    release?.();
    await Promise.all([first, second]);
    expect(writes.map((item) => ({ meetingAudioConsent: item.meetingAudioConsent, screenConsent: item.screenConsent }))).toEqual([{ meetingAudioConsent: true, screenConsent: false }, { meetingAudioConsent: true, screenConsent: true }]);
    expect(settings).toMatchObject({ meetingAudioConsent: true, screenConsent: true });
  });

  it('keeps VoiceStudio behind the trusted, typed IPC boundary', async () => {
    const { handlers, speech } = setup();
    await expect(handlers.get(IpcChannel.neuraSpeak)?.(trusted, { text: 'Hello', language: 'en-US' })).resolves.toMatchObject({ provider: 'voicestudio' });
    expect(speech.speak).toHaveBeenCalledWith({ text: 'Hello', language: 'en-US' });
    await expect(handlers.get(IpcChannel.neuraSpeak)?.(trusted, { text: '', language: 'en-US' })).rejects.toThrow('Invalid');
  });

  it('forwards streaming microphone PCM to the active voice provider', async () => {
    const handlers = new Map<string, Listener>();
    const capture = { acceptPcm: vi.fn(), captureFailed: vi.fn() };
    registerNeuraIpc({ handle: (channel, listener) => { handlers.set(channel, listener); } }, {} as NeuraOrchestrator, { read: () => DEFAULT_NEURA_SETTINGS, write: () => undefined }, (url) => url === 'app://trusted', undefined, capture);
    const channel = handlers.get(IpcChannel.neuraVoiceAudio);
    await channel?.(trusted, { pcmBase64: Buffer.from([1, 2, 3, 4]).toString('base64') });
    expect(capture.acceptPcm).toHaveBeenCalledWith(Buffer.from([1, 2, 3, 4]));
    await channel?.(trusted, { failure: 'microphone' });
    expect(capture.captureFailed).toHaveBeenCalledOnce();
  });
});

describe('WindowsSpeechProvider', () => {
  const node = (script: string) => ({ executable: process.execPath, args: ['-e', script] });

  it('says what is missing when no recognizer is installed', async () => {
    const provider = new WindowsSpeechProvider({ platform: 'win32', probe: () => Promise.resolve([]) });
    expect(await provider.availability()).toMatchObject({ available: false, detail: expect.stringContaining('reconhecedor') as string });
    await expect(provider.start({ language: 'pt-BR', onHeard: () => undefined, onFailure: () => undefined })).rejects.toThrow();
    expect((await new WindowsSpeechProvider({ platform: 'linux' }).availability()).available).toBe(false);
  });

  it('reports the recognizers it found', async () => {
    expect(await new WindowsSpeechProvider({ platform: 'win32', probe: () => Promise.resolve(['pt-BR']) }).availability()).toMatchObject({ available: true });
  });

  it('turns valid lines into text and ignores the rest', async () => {
    const provider = new WindowsSpeechProvider({ listenCommand: node(`console.log('garbage'); console.log(JSON.stringify({ text: 5 })); console.log(JSON.stringify({ text: 'Neura, oi', confidence: 0.8 })); setTimeout(() => {}, 5000);`) });
    const heard: string[] = [];
    await provider.start({ language: 'pt-BR', onHeard: (item) => heard.push(item.text), onFailure: () => undefined });
    await vi.waitFor(() => { expect(heard).toEqual(['Neura, oi']); });
    await provider.stop();
  });

  it('reports an engine that dies, and stays quiet on a deliberate stop', async () => {
    const dying = new WindowsSpeechProvider({ listenCommand: node('process.exit(1)') });
    const onFailure = vi.fn();
    await dying.start({ language: 'pt-BR', onHeard: () => undefined, onFailure });
    await vi.waitFor(() => { expect(onFailure).toHaveBeenCalledOnce(); });
    const stopped = new WindowsSpeechProvider({ listenCommand: node('setTimeout(() => {}, 5000)') });
    const quiet = vi.fn();
    await stopped.start({ language: 'pt-BR', onHeard: () => undefined, onFailure: quiet });
    await stopped.stop();
    await new Promise((done) => { setTimeout(done, 100); });
    expect(quiet).not.toHaveBeenCalled();
  });

  it('copies a suggestion from the main process, because the HUD never has focus during a call', async () => {
    const handlers = new Map<string, Listener>();
    const suggestionId = '00000000-0000-4000-8000-000000000009';
    const decided = { suggestionId, text: 'Podemos fechar na sexta.', status: 'copied' };
    const neura = { state: () => ({ suggestions: [{ suggestionId, text: 'Podemos fechar na sexta.', status: 'pending' }] }), decideSuggestion: vi.fn(() => Promise.resolve(decided)) };
    const copyText = vi.fn();
    registerNeuraIpc({ handle: (channel, listener) => { handlers.set(channel, listener); } }, neura as unknown as NeuraOrchestrator, { read: () => DEFAULT_NEURA_SETTINGS, write: () => undefined }, (url) => url === 'app://trusted', undefined, undefined, copyText);
    await handlers.get(IpcChannel.neuraSuggestionCopy)?.(trusted, { suggestionId }).catch(() => undefined);
    expect(copyText).toHaveBeenCalledWith('Podemos fechar na sexta.');
    expect(neura.decideSuggestion).toHaveBeenCalledWith({ suggestionId, decision: 'copy' });
    await expect(handlers.get(IpcChannel.neuraSuggestionCopy)?.(trusted, { suggestionId: '00000000-0000-4000-8000-000000000010' })).rejects.toThrow('neura_not_found');
    expect(copyText).toHaveBeenCalledTimes(1);
  });

  it('hands meeting audio to the source and rejects a frame out of bounds', async () => {
    const handlers = new Map<string, Listener>();
    const audio = { accept: vi.fn(), captureFailed: vi.fn() };
    registerNeuraIpc({ handle: (channel, listener) => { handlers.set(channel, listener); } }, {} as NeuraOrchestrator, { read: () => DEFAULT_NEURA_SETTINGS, write: () => undefined }, (url) => url === 'app://trusted', undefined, undefined, undefined, audio);
    const channel = handlers.get(IpcChannel.neuraMeetingAudio);
    await channel?.(trusted, { pcmBase64: Buffer.from([1, 2, 3, 4]).toString('base64') });
    expect(audio.accept).toHaveBeenCalledWith(Buffer.from([1, 2, 3, 4]));
    await channel?.(trusted, { failure: 'capture' });
    expect(audio.captureFailed).toHaveBeenCalledTimes(1);
    await expect(channel?.(trusted, { pcmBase64: 'A'.repeat(50_000) })).rejects.toThrow('Invalid');
  });
});

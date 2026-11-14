import { describe, expect, it, vi } from 'vitest';
import type { VoiceProviderHandle } from '@neuralbridge/orchestrator';
import { VoiceStudioStreamingProvider, type VoiceStreamSocket } from '../src/main/voicestudio-streaming-provider.js';

class FakeSocket implements VoiceStreamSocket {
  readyState = 1;
  sent: Uint8Array[] = [];
  closed = false;
  onmessage: VoiceStreamSocket['onmessage'] = null;
  onclose: VoiceStreamSocket['onclose'] = null;
  onerror: VoiceStreamSocket['onerror'] = null;
  send(data: Uint8Array): void { this.sent.push(data); }
  close(): void { this.closed = true; this.readyState = 3; this.onclose?.(); }
  say(event: object): void { this.onmessage?.({ data: JSON.stringify(event) }); }
}

describe('VoiceStudioStreamingProvider', () => {
  it('forwards PCM continuously and emits final utterances without batch transcription', async () => {
    const socket = new FakeSocket();
    const heard: string[] = [];
    const handle: VoiceProviderHandle = { language: 'pt-BR', onHeard: ({ text }) => heard.push(text), onFailure: vi.fn() };
    const provider = new VoiceStudioStreamingProvider({ baseUrl: 'http://localhost:3900', connect: () => socket });

    const started = provider.start(handle);
    socket.say({ type: 'session.started' });
    await started;
    provider.acceptPcm(Buffer.from([1, 2, 3, 4]));
    socket.say({ type: 'partial', text: 'Neura, próxima' });
    socket.say({ type: 'final', final_kind: 'utterance', text: 'Neura, próxima música', language: 'pt' });

    expect(socket.sent).toHaveLength(1);
    expect(heard).toEqual(['Neura, próxima música']);
  });

  it('keeps the session language when VoiceStudio answers "auto", which is not a language', async () => {
    const socket = new FakeSocket();
    const languages: string[] = [];
    const handle: VoiceProviderHandle = { language: 'pt-BR', onHeard: ({ language }) => languages.push(language), onFailure: vi.fn() };
    const provider = new VoiceStudioStreamingProvider({ baseUrl: 'http://localhost:3900', connect: () => socket });
    const started = provider.start(handle);
    socket.say({ type: 'session.started' });
    await started;
    socket.say({ type: 'final', final_kind: 'utterance', text: 'Neura', language: 'auto' });
    socket.say({ type: 'final', final_kind: 'utterance', text: 'Neura', language: 'en' });
    expect(languages).toEqual(['pt-BR', 'en']);
  });

  it('chooses the installed fast Portuguese-capable model', async () => {
    const provider = new VoiceStudioStreamingProvider({
      baseUrl: 'http://localhost:3900',
      fetch: vi.fn(async () => new Response(JSON.stringify({ models: [{ id: 'sherpa-parakeet-tdt-v3', installed: true }] }))) as typeof fetch,
    });

    await expect(provider.availability()).resolves.toMatchObject({ available: true });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { MeetingSourceHandle } from '@neuralbridge/orchestrator';
import { SystemAudioSource, type TranscriptSocket } from '../src/main/system-audio-source.js';

class FakeSocket implements TranscriptSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: unknown[] = [];
  closed = false;
  onmessage: TranscriptSocket['onmessage'] = null;
  onclose: TranscriptSocket['onclose'] = null;
  onerror: TranscriptSocket['onerror'] = null;
  send(data: Uint8Array): void { this.sent.push(data); }
  close(): void { this.closed = true; this.readyState = 3; this.onclose?.(); }
  say(event: object): void { this.onmessage?.({ data: JSON.stringify(event) }); }
}

function setup() {
  const socket = new FakeSocket();
  const urls: string[] = [];
  const armed: boolean[] = [];
  const onLost = vi.fn();
  const source = new SystemAudioSource({ baseUrl: 'http://localhost:3900', connect: (url) => { urls.push(url); return socket; }, onArmed: (on) => armed.push(on) });
  source.onLost = onLost;
  const emit = vi.fn();
  const handle: MeetingSourceHandle = { sessionId: 'meeting-1', emit };
  return { source, socket, urls, armed, onLost, emit, handle };
}

const ready = async ({ source, socket, handle }: ReturnType<typeof setup>) => {
  const started = source.start(handle);
  socket.say({ type: 'session.started' });
  socket.say({ type: 'status', stage: 'ready' });
  await started;
};

describe('SystemAudioSource', () => {
  it('states what it really offers', () => {
    expect(setup().source.capabilities()).toEqual({ transcript: true, audio: true, diarization: false, nativeIntegration: false });
  });

  it('opens the local Parakeet stream without fixing a language', async () => {
    const context = setup();
    await ready(context);
    expect(context.urls).toEqual(['ws://localhost:3900/v1/audio/transcriptions/stream?sr=16000&pcm=1&model=sherpa-parakeet-tdt-v3']);
  });

  it('allows the capture only from ready until it stops', async () => {
    const context = setup();
    await ready(context);
    expect(context.armed).toEqual([true]);
    await context.source.stop('meeting-1');
    expect(context.armed).toEqual([true, false]);
    expect(context.socket.closed).toBe(true);
    expect(context.onLost).not.toHaveBeenCalled();
  });

  it('turns a finished sentence into an utterance and leaves partials and the summary out', async () => {
    const context = setup();
    await ready(context);
    context.socket.say({ type: 'partial', text: 'Você consegue' });
    context.socket.say({ type: 'final', final_kind: 'utterance', text: ' Você consegue revisar hoje? ' });
    context.socket.say({ type: 'final', final_kind: 'summary', text: 'Tudo junto' });
    expect(context.emit).toHaveBeenCalledTimes(1);
    expect(context.emit.mock.calls[0]?.[0]).toMatchObject({ speaker: null, text: 'Você consegue revisar hoje?', language: null, final: true });
  });

  it('refuses to start when VoiceStudio refuses the model', async () => {
    const context = setup();
    const started = context.source.start(context.handle);
    context.socket.say({ type: 'error', kind: 'model_licence_required', message: 'Licence not accepted' });
    await expect(started).rejects.toThrow('Licence not accepted');
    expect(context.armed).not.toContain(true);
    expect(context.socket.closed).toBe(true);
  });

  it('forwards audio only while listening', async () => {
    const context = setup();
    context.source.accept(Buffer.from([1, 2]));
    await ready(context);
    context.source.accept(Buffer.from([3, 4]));
    await context.source.stop('meeting-1');
    context.source.accept(Buffer.from([5, 6]));
    expect(context.socket.sent).toHaveLength(1);
  });

  it('reports a stream that dies in the middle of the meeting', async () => {
    const context = setup();
    await ready(context);
    context.socket.close();
    expect(context.onLost).toHaveBeenCalledWith('meeting-1', expect.stringContaining('VoiceStudio'));
    expect(context.armed).toEqual([true, false]);
  });

  it('reports a capture that fails in the HUD', async () => {
    const context = setup();
    await ready(context);
    context.source.captureFailed();
    expect(context.onLost).toHaveBeenCalledWith('meeting-1', expect.stringContaining('áudio'));
    expect(context.socket.closed).toBe(true);
  });

  it('refuses a second start, while the first is opening or live', async () => {
    const context = setup();
    const first = context.source.start(context.handle);
    await expect(context.source.start({ ...context.handle, sessionId: 'meeting-2' })).rejects.toThrow('já');
    context.socket.say({ type: 'status', stage: 'ready' });
    await first;
    await expect(context.source.start({ ...context.handle, sessionId: 'meeting-2' })).rejects.toThrow('já');
    expect(context.urls).toHaveLength(1);
  });

  it('gives up rather than pile audio on a stream that stopped reading', async () => {
    const context = setup();
    await ready(context);
    context.socket.bufferedAmount = 2_000_000;
    context.source.accept(Buffer.from([1, 2]));
    expect(context.socket.sent).toHaveLength(0);
    expect(context.onLost).toHaveBeenCalledWith('meeting-1', expect.stringContaining('VoiceStudio'));
  });

  it('ends a meeting that stops receiving audio, so it never sits there looking like it listens', async () => {
    vi.useFakeTimers();
    const context = setup();
    await ready(context);
    await vi.advanceTimersByTimeAsync(9_000);
    context.source.accept(Buffer.from([1, 2]));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(context.onLost).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(11_000);
    expect(context.onLost).toHaveBeenCalledWith('meeting-1', expect.stringContaining('áudio'));
    vi.useRealTimers();
  });

  const loud = Buffer.from(new Int16Array(2_048).fill(8_000).buffer);
  const quiet = Buffer.alloc(4_096);
  const seconds = (source: SystemAudioSource, frame: Buffer, count: number) => { for (let index = 0; index < count * 8; index += 1) source.accept(frame); };

  it('gives up when speech goes in and no text comes back, which is how a demoted model behaves', async () => {
    const context = setup();
    await ready(context);
    seconds(context.source, loud, 14);
    expect(context.onLost).not.toHaveBeenCalled();
    seconds(context.source, loud, 3);
    expect(context.onLost).toHaveBeenCalledWith('meeting-1', expect.stringContaining('Parakeet'));
  });

  it('does not count silence, and any text proves the stream is working', async () => {
    const context = setup();
    await ready(context);
    seconds(context.source, quiet, 60);
    seconds(context.source, loud, 10);
    context.socket.say({ type: 'partial', text: 'Bom dia' });
    seconds(context.source, loud, 10);
    expect(context.onLost).not.toHaveBeenCalled();
  });
});

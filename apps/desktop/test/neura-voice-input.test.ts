import { describe, expect, it, vi } from 'vitest';
import type { VoiceProvider, VoiceProviderHandle } from '@neuralbridge/orchestrator';
import { isAllowedPermission } from '../src/main/security/navigation.js';
import { FirstAvailableVoiceProvider, VOICE_SEGMENT_MAX_BYTES, VoiceStudioWhisperProvider } from '../src/main/voicestudio-whisper-provider.js';
import { encodeWav, toBase64, VOICE_SAMPLE_RATE, VoiceSegmenter } from '../src/renderer/src/features/neura/voice-segmenter';

const FRAME = 1_600; // 100 ms
const quiet = () => new Float32Array(FRAME);
const loud = () => new Float32Array(FRAME).fill(0.2);
const wav = Buffer.from(encodeWav(new Float32Array(160).fill(0.1)));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function feed(segmenter: VoiceSegmenter, frames: Float32Array[]): Float32Array[] {
  return frames.flatMap((frame) => { const done = segmenter.push(frame); return done ? [done] : []; });
}
const repeat = (make: () => Float32Array, count: number) => Array.from({ length: count }, make);

function provider(respond: (url: string) => Response | Promise<Response>) {
  const calls: { url: string; body: unknown }[] = [];
  const instance = new VoiceStudioWhisperProvider({ baseUrl: 'http://localhost:3900', fetch: ((url: URL, init?: RequestInit) => { calls.push({ url: url.pathname, body: init?.body }); return Promise.resolve(respond(url.pathname)); }) as typeof fetch });
  const heard: string[] = [];
  const onFailure = vi.fn();
  const handle: VoiceProviderHandle = { language: 'pt-BR', onHeard: (item) => heard.push(item.text), onFailure };
  return { instance, calls, heard, onFailure, handle };
}

describe('VoiceSegmenter', () => {
  it('sends nothing for silence', () => {
    expect(feed(new VoiceSegmenter(), repeat(quiet, 100))).toEqual([]);
  });

  it('cuts one segment at the pause, keeping the start of the word', () => {
    const [segment, ...rest] = feed(new VoiceSegmenter(), [...repeat(quiet, 10), ...repeat(loud, 10), ...repeat(quiet, 10)]);
    expect(rest).toEqual([]);
    expect(segment?.length).toBe((3 + 10 + 7) * FRAME);
  });

  it('ignores a click too short to be speech', () => {
    expect(feed(new VoiceSegmenter(), [loud(), ...repeat(quiet, 10)])).toEqual([]);
  });

  it('bounds a segment that never pauses', () => {
    const segments = feed(new VoiceSegmenter(), repeat(loud, 120));
    expect(segments).toHaveLength(1);
    expect(segments[0]?.length).toBe(10 * VOICE_SAMPLE_RATE);
  });
});

describe('WAV encoding', () => {
  it('writes the mono 16 kHz header and clamps samples', () => {
    const bytes = encodeWav(new Float32Array([2, -2]));
    const view = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBe(32_767);
    expect(view.getInt16(46, true)).toBe(-32_767);
    expect(Buffer.from(toBase64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('VoiceStudioWhisperProvider', () => {
  it('is available when VoiceStudio offers Whisper, and says what to do when it does not', async () => {
    expect((await provider(() => json({ data: [{ id: 'whisper-1' }] })).instance.availability()).available).toBe(true);
    expect(await provider(() => json({ data: [{ id: 'tts-1' }] })).instance.availability()).toMatchObject({ available: false, detail: expect.stringContaining('VoiceStudio') as string });
    expect((await provider(() => { throw new Error('closed'); }).instance.availability()).available).toBe(false);
  });

  it('never sends audio outside a session', async () => {
    const { instance, calls, handle } = provider(() => json({ text: 'x' }));
    instance.accept(wav);
    await instance.start(handle);
    await instance.stop();
    instance.accept(wav);
    expect(calls).toEqual([]);
  });

  it('refuses what is not a bounded WAV', async () => {
    const { instance, calls, handle } = provider(() => json({ text: 'x' }));
    await instance.start(handle);
    instance.accept(Buffer.from('not audio'));
    instance.accept(Buffer.concat([wav, Buffer.alloc(VOICE_SEGMENT_MAX_BYTES)]));
    expect(calls).toEqual([]);
  });

  it('turns a segment into heard text through loopback', async () => {
    const { instance, calls, heard, handle } = provider(() => json({ text: ' Neura, próxima música. ' }));
    await instance.start(handle);
    instance.accept(wav);
    await vi.waitFor(() => { expect(heard).toEqual(['Neura, próxima música.']); });
    expect(calls[0]?.url).toBe('/v1/audio/transcriptions');
    expect((calls[0]?.body as FormData).get('model')).toBe('whisper-1');
  });

  it('skips stale speech while one segment is being transcribed', async () => {
    let finish: (response: Response) => void = () => undefined;
    const { instance, calls, heard, handle } = provider(() => (calls.length === 1 ? new Promise<Response>((done) => { finish = done; }) : json({ text: 'c' })));
    await instance.start(handle);
    instance.accept(wav);
    instance.accept(wav);
    instance.accept(wav);
    finish(json({ text: 'a' }));
    await vi.waitFor(() => { expect(heard).toEqual(['a', 'c']); });
    expect(calls).toHaveLength(2);
  });

  it('ends the session after repeated failures, and a stop discards late text', async () => {
    const failing = provider(() => json({}, 500));
    await failing.instance.start(failing.handle);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      failing.instance.accept(wav);
      await new Promise((done) => { setTimeout(done, 10); });
    }
    expect(failing.onFailure).toHaveBeenCalledOnce();

    let finish: (response: Response) => void = () => undefined;
    const late = provider(() => new Promise<Response>((done) => { finish = done; }));
    await late.instance.start(late.handle);
    late.instance.accept(wav);
    await late.instance.stop();
    finish(json({ text: 'tarde demais' }));
    await new Promise((done) => { setTimeout(done, 10); });
    expect(late.heard).toEqual([]);
  });

  it('reports a microphone failure once', async () => {
    const { instance, onFailure, handle } = provider(() => json({}));
    await instance.start(handle);
    instance.captureFailed('sem microfone');
    instance.captureFailed('sem microfone');
    expect(onFailure).toHaveBeenCalledOnce();
  });
});

describe('FirstAvailableVoiceProvider', () => {
  const fake = (id: string, available: boolean): VoiceProvider => ({ id, availability: () => Promise.resolve({ available, detail: id }), start: () => Promise.resolve(), stop: () => Promise.resolve() });

  it('prefers the first engine that works and keeps its id', async () => {
    const auto = new FirstAvailableVoiceProvider([fake('whisper', false), fake('windows', true)]);
    expect(await auto.availability()).toMatchObject({ available: true, detail: 'windows' });
    expect(auto.id).toBe('windows');
  });

  it('explains through the preferred engine when none works', async () => {
    expect((await new FirstAvailableVoiceProvider([fake('whisper', false), fake('windows', false)]).availability()).detail).toBe('whisper');
  });
});

describe('microphone permission', () => {
  const app = { devServerUrl: undefined, indexFile: 'C:/app/out/renderer/index.html' };
  const page = 'file:///C:/app/out/renderer/index.html?companion=hud';

  it('allows audio to the app and nothing else', () => {
    expect(isAllowedPermission('media', page, app, ['audio'])).toBe(true);
    expect(isAllowedPermission('media', page, app, ['audio', 'video'])).toBe(false);
    expect(isAllowedPermission('media', page, app, ['video'])).toBe(false);
    expect(isAllowedPermission('media', page, app)).toBe(false);
    expect(isAllowedPermission('media', 'https://evil.example/', app, ['audio'])).toBe(false);
  });
});

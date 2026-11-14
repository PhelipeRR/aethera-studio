import { z } from 'zod';
import type { VoiceAvailability, VoiceProvider, VoiceProviderHandle } from '@neuralbridge/orchestrator';

const PROBE_TIMEOUT_MS = 8_000;
const TRANSCRIBE_TIMEOUT_MS = 60_000;
const MAX_FAILURES = 3;
/** Whisper reports no confidence. The wake word is what gates this text, and this only has to clear that path. */
const ASSUMED_CONFIDENCE = 0.8;
const UNAVAILABLE = 'Abra o VoiceStudio para usar a voz. O reconhecimento roda nele, neste computador.';

export const VOICE_SEGMENT_MAX_BYTES = 16_000 * 2 * 12 + 44;

const modelsSchema = z.object({ data: z.array(z.object({ id: z.string() })) });
const transcriptSchema = z.object({ text: z.string() });

export interface VoiceStudioWhisperOptions { baseUrl: string; fetch?: typeof fetch; }

/**
 * Local dictation through VoiceStudio's Whisper. The HUD captures the microphone and hands over one WAV per spoken
 * segment, which goes to loopback and is dropped: nothing here keeps audio.
 */
export class VoiceStudioWhisperProvider implements VoiceProvider {
  readonly id = 'voicestudio-whisper';
  private handle: VoiceProviderHandle | null = null;
  private running = false;
  private waiting: Buffer | null = null;
  private failures = 0;
  private readonly send: typeof fetch;

  constructor(private readonly options: VoiceStudioWhisperOptions) {
    this.send = options.fetch ?? fetch;
  }

  async availability(): Promise<VoiceAvailability> {
    try {
      const response = await this.send(new URL('/v1/models', this.options.baseUrl), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const models = modelsSchema.safeParse(await response.json());
      if (response.ok && models.data?.data.some((model) => model.id === 'whisper-1')) return { available: true, detail: 'Reconhecimento local pelo Whisper do VoiceStudio.' };
    } catch { /* VoiceStudio closed is the ordinary case, and the detail says what to do. */ }
    return { available: false, detail: UNAVAILABLE };
  }

  start(handle: VoiceProviderHandle): Promise<void> {
    this.handle = handle;
    this.failures = 0;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.handle = null;
    this.waiting = null;
    return Promise.resolve();
  }

  /** Ignored outside a session, so audio cannot reach VoiceStudio without the consent that opened one. */
  accept(wav: Buffer): void {
    if (!this.handle || wav.length > VOICE_SEGMENT_MAX_BYTES || wav.subarray(0, 4).toString('latin1') !== 'RIFF') return;
    // Transcribing takes seconds. Older speech is dropped so a command is never answered long after it was said.
    this.waiting = wav;
    if (!this.running) void this.drain();
  }

  captureFailed(detail: string): void {
    const handle = this.handle;
    this.handle = null;
    handle?.onFailure(detail);
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (this.waiting && this.handle) {
      const wav = this.waiting;
      this.waiting = null;
      await this.transcribe(wav);
    }
    this.running = false;
  }

  private async transcribe(wav: Buffer): Promise<void> {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav');
    form.set('model', 'whisper-1');
    form.set('response_format', 'json');
    form.set('prompt', 'Neura');
    try {
      const response = await this.send(new URL('/v1/audio/transcriptions', this.options.baseUrl), { method: 'POST', body: form, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) });
      if (!response.ok) throw new Error('transcription refused');
      const text = transcriptSchema.parse(await response.json()).text.trim();
      this.failures = 0;
      const handle = this.handle;
      if (text && handle) handle.onHeard({ text, language: handle.language, confidence: ASSUMED_CONFIDENCE });
    } catch {
      this.failures += 1;
      if (this.failures >= MAX_FAILURES) this.captureFailed('o VoiceStudio parou de responder.');
    }
  }
}

/** The first engine that can work on this machine. It decides at `availability`, which the gateway always calls first. */
export class FirstAvailableVoiceProvider implements VoiceProvider {
  private chosen: VoiceProvider;

  constructor(private readonly providers: readonly [VoiceProvider, ...VoiceProvider[]]) {
    this.chosen = providers[0];
  }

  get id(): string { return this.chosen.id; }

  async availability(): Promise<VoiceAvailability> {
    let first: VoiceAvailability | null = null;
    for (const provider of this.providers) {
      const result = await provider.availability();
      first ??= result;
      if (result.available) { this.chosen = provider; return result; }
    }
    return first ?? { available: false, detail: UNAVAILABLE };
  }

  start(handle: VoiceProviderHandle): Promise<void> { return this.chosen.start(handle); }
  stop(): Promise<void> { return this.chosen.stop(); }
}

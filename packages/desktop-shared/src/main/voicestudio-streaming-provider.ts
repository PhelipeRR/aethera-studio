import { z } from 'zod';
import type { VoiceAvailability, VoiceProvider, VoiceProviderHandle } from '@neuralbridge/orchestrator';

const PROBE_TIMEOUT_MS = 8_000;
const READY_TIMEOUT_MS = 20_000;
const MAX_LINE = 4_000;
const OPEN = 1;
const FAST_MODEL = 'sherpa-parakeet-tdt-v3';
const UNAVAILABLE = 'Instale um modelo de ditado rápido no VoiceStudio para usar a voz.';
const ASSUMED_CONFIDENCE = 0.8;

const modelsSchema = z.object({ models: z.array(z.object({ id: z.string(), installed: z.boolean() })) });

/** The small part of WebSocket needed by the provider, so tests never need a real socket. */
export interface VoiceStreamSocket {
  readyState: number;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}

export interface VoiceStudioStreamingOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  connect?: (url: string) => VoiceStreamSocket;
}

interface Live { socket: VoiceStreamSocket; handle: VoiceProviderHandle; }

/** Local low-latency dictation through VoiceStudio's PCM WebSocket. */
export class VoiceStudioStreamingProvider implements VoiceProvider {
  readonly id = 'voicestudio-streaming';
  private readonly send: typeof fetch;
  private model = FAST_MODEL;
  private live: Live | null = null;

  constructor(private readonly options: VoiceStudioStreamingOptions) {
    this.send = options.fetch ?? fetch;
  }

  async availability(): Promise<VoiceAvailability> {
    try {
      const response = await this.send(new URL('/dictation/models', this.options.baseUrl), { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const models = modelsSchema.safeParse(await response.json());
      if (!response.ok || !models.success) return { available: false, detail: UNAVAILABLE };
      const installed = models.data.models.find((item) => item.id === FAST_MODEL && item.installed);
      if (!installed) return { available: false, detail: UNAVAILABLE };
      this.model = installed.id;
      return { available: true, detail: `Reconhecimento contínuo local pelo VoiceStudio (${installed.id}).` };
    } catch {
      return { available: false, detail: 'VoiceStudio indisponível para reconhecimento contínuo.' };
    }
  }

  start(handle: VoiceProviderHandle): Promise<void> {
    const url = new URL('/v1/audio/transcriptions/stream', this.options.baseUrl);
    url.protocol = 'ws:';
    url.search = `sr=16000&pcm=1&language=${encodeURIComponent(handle.language.split('-')[0] ?? handle.language)}&model=${encodeURIComponent(this.model)}`;
    const socket = this.options.connect ? this.options.connect(url.toString()) : new WebSocket(url.toString()) as unknown as VoiceStreamSocket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const refuse = (detail: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.onclose = null;
        socket.close();
        reject(new Error(detail));
      };
      const timer = setTimeout(() => refuse('VoiceStudio não abriu a transcrição contínua a tempo.'), READY_TIMEOUT_MS);
      socket.onerror = () => {
        if (!settled) refuse('VoiceStudio não respondeu.');
        else this.fail(socket, handle, 'o VoiceStudio parou de responder.');
      };
      socket.onclose = () => {
        if (!settled) { refuse('VoiceStudio não respondeu.'); return; }
        this.fail(socket, handle, 'o VoiceStudio parou de responder.');
      };
      socket.onmessage = ({ data }) => {
        const event = parse(data);
        if (event.type === 'error') {
          const message = typeof event.message === 'string' ? event.message : 'VoiceStudio recusou a transcrição contínua.';
          if (!settled) refuse(message); else this.fail(socket, handle, message);
          return;
        }
        // Some VoiceStudio engines emit only session.started; do not wait for a model-specific ready event.
        if (!settled && event.type === 'session.started') {
          settled = true;
          clearTimeout(timer);
          this.live = { socket, handle };
          resolve();
          return;
        }
        if (settled && event.type === 'partial' && typeof event.text === 'string') {
          handle.onPartial?.(event.text.trim().slice(0, MAX_LINE));
          return;
        }
        if (settled && event.type === 'final' && event.final_kind === 'utterance' && typeof event.text === 'string') {
          const text = event.text.trim().slice(0, MAX_LINE);
          if (text) handle.onHeard({ text, language: typeof event.language === 'string' && event.language !== 'auto' ? event.language : handle.language, confidence: ASSUMED_CONFIDENCE });
        }
      };
    });
  }

  stop(): Promise<void> {
    const live = this.live;
    if (live) { this.live = null; live.socket.onclose = null; live.socket.close(); }
    return Promise.resolve();
  }

  acceptPcm(pcm: Buffer): void {
    if (this.live?.socket.readyState === OPEN) this.live.socket.send(pcm);
  }

  captureFailed(detail: string): void {
    const live = this.live;
    if (!live) return;
    this.live = null;
    live.socket.onclose = null;
    live.socket.close();
    live.handle.onFailure(detail);
  }

  private fail(socket: VoiceStreamSocket, handle: VoiceProviderHandle, detail: string): void {
    if (this.live?.socket !== socket) return;
    this.live = null;
    socket.onclose = null;
    socket.close();
    handle.onFailure(detail);
  }
}

function parse(data: unknown): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(typeof data === 'string' ? data : '');
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

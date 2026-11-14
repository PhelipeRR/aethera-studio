import type { MeetingSource, MeetingSourceHandle } from '@neuralbridge/orchestrator';
import { SYSTEM_AUDIO_SOURCE_ID, type MeetingCapabilities } from '@neuralbridge/shared';

const MODEL = 'sherpa-parakeet-tdt-v3';
const READY_TIMEOUT_MS = 20_000;
const MAX_LINE = 4_000;
const OPEN = 1;
/** The HUD sends a frame about every 130 ms, silence included, so a gap this long means it stopped capturing. */
const STALL_MS = 10_000;
/** About 30 s of audio queued: past this VoiceStudio is not keeping up, and the transcript would arrive too late to help. */
const MAX_BUFFERED = 1_000_000;
/** VoiceStudio's own floor for speech, and how much of it may go unanswered. Past this it has swapped models without saying so. */
const SPEECH_RMS = .01;
const MAX_UNANSWERED_SPEECH_MS = 15_000;
const BYTES_PER_MS = 32;

/** The part of WebSocket used here, so a test can stand in for VoiceStudio. */
export interface TranscriptSocket {
  readyState: number;
  bufferedAmount: number;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: Uint8Array): void;
  close(): void;
}

export interface SystemAudioSourceOptions {
  baseUrl: string;
  /** Whether the HUD may capture. It opens with a live stream and closes with it, so no audio is taken for nothing. */
  onArmed(armed: boolean): void;
  connect?(url: string): TranscriptSocket;
}

interface Live { sessionId: string; socket: TranscriptSocket; handle: MeetingSourceHandle; }

/**
 * What the computer plays during a call, which is the other people and not the user's microphone. The audio goes to
 * VoiceStudio on loopback and is dropped there: only the finished sentences come back, and nothing here keeps sound.
 */
export class SystemAudioSource implements MeetingSource {
  readonly id = SYSTEM_AUDIO_SOURCE_ID;
  readonly platform = 'generic' as const;
  onLost: (sessionId: string, detail: string) => void = () => undefined;
  private live: Live | null = null;
  private starting = false;
  private lastFrame = 0;
  private unansweredMs = 0;
  private watchdog: NodeJS.Timeout | undefined;

  constructor(private readonly options: SystemAudioSourceOptions) {}

  capabilities(): MeetingCapabilities { return { transcript: true, audio: true, diarization: false, nativeIntegration: false }; }

  start(handle: MeetingSourceHandle): Promise<void> {
    if (this.live || this.starting) return Promise.reject(new Error('A call já está sendo ouvida.'));
    this.starting = true;
    const url = new URL('/v1/audio/transcriptions/stream', this.options.baseUrl);
    url.protocol = 'ws:';
    url.search = `sr=16000&pcm=1&model=${MODEL}`;
    const socket = this.options.connect ? this.options.connect(url.toString()) : new WebSocket(url.toString()) as unknown as TranscriptSocket;
    return new Promise((resolve, reject) => {
      let settled = false;
      const refuse = (detail: string) => {
        if (settled) return;
        settled = true;
        this.starting = false;
        clearTimeout(timer);
        socket.onclose = null;
        socket.close();
        reject(new Error(detail));
      };
      const timer = setTimeout(() => refuse('VoiceStudio não abriu a transcrição a tempo.'), READY_TIMEOUT_MS);
      socket.onerror = () => refuse('VoiceStudio não respondeu.');
      socket.onclose = () => {
        if (!settled) { refuse('VoiceStudio não respondeu.'); return; }
        this.lose(socket, 'o VoiceStudio parou de responder.');
      };
      socket.onmessage = ({ data }) => {
        const event = parse(data);
        if (event.type === 'partial' || event.type === 'final') this.unansweredMs = 0;
        if (event.type === 'error') {
          if (settled) this.lose(socket, 'o VoiceStudio parou de transcrever.'); else refuse(typeof event.message === 'string' ? event.message : 'VoiceStudio recusou a transcrição.');
          return;
        }
        if (!settled && event.type === 'status' && event.stage === 'ready') {
          settled = true;
          this.starting = false;
          clearTimeout(timer);
          this.live = { sessionId: handle.sessionId, socket, handle };
          this.lastFrame = Date.now();
          this.unansweredMs = 0;
          this.watchdog = setInterval(() => { if (Date.now() - this.lastFrame > STALL_MS) this.lose(socket, 'o áudio do computador deixou de chegar.'); }, 1_000);
          this.watchdog.unref();
          this.options.onArmed(true);
          resolve();
          return;
        }
        if (event.type === 'final' && event.final_kind === 'utterance' && typeof event.text === 'string') this.heard(handle, event.text);
      };
    });
  }

  stop(sessionId: string): Promise<void> {
    const live = this.live;
    if (live?.sessionId === sessionId) { this.release(live); live.socket.close(); }
    return Promise.resolve();
  }

  /** Ignored outside a session, so audio cannot reach VoiceStudio without the meeting that consented to it. */
  accept(pcm: Buffer): void {
    const socket = this.live?.socket;
    if (socket?.readyState !== OPEN) return;
    if (socket.bufferedAmount > MAX_BUFFERED) { this.lose(socket, 'o VoiceStudio não acompanhou o áudio.'); return; }
    this.lastFrame = Date.now();
    if (rms(pcm) >= SPEECH_RMS) this.unansweredMs += pcm.length / BYTES_PER_MS;
    if (this.unansweredMs > MAX_UNANSWERED_SPEECH_MS) { this.lose(socket, 'o VoiceStudio deixou de usar o Parakeet. Troque o ditado para outro modelo e volte a ele.'); return; }
    socket.send(pcm);
  }

  captureFailed(): void {
    if (this.live) this.lose(this.live.socket, 'não consegui capturar o áudio do computador.');
  }

  private heard(handle: MeetingSourceHandle, raw: string): void {
    const text = raw.trim().slice(0, MAX_LINE);
    if (!text) return;
    const at = new Date().toISOString();
    // No language: a call can change it at any sentence, and the app's setting says nothing about what was said.
    handle.emit({ speaker: null, text, language: null, languageConfidence: 0, startedAt: at, endedAt: at, final: true });
  }

  private lose(socket: TranscriptSocket, detail: string): void {
    const live = this.live;
    if (live?.socket !== socket) return;
    this.release(live);
    socket.close();
    this.onLost(live.sessionId, detail);
  }

  private release(live: Live): void {
    live.socket.onclose = null;
    this.live = null;
    clearInterval(this.watchdog);
    this.options.onArmed(false);
  }
}

function rms(pcm: Buffer): number {
  const count = Math.floor(pcm.length / 2);
  if (!count) return 0;
  let sum = 0;
  for (let index = 0; index < count; index += 1) sum += (pcm.readInt16LE(index * 2) / 32_768) ** 2;
  return Math.sqrt(sum / count);
}

function parse(data: unknown): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(typeof data === 'string' ? data : '');
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

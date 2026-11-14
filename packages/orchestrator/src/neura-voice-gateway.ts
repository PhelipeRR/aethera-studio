import { randomUUID } from 'node:crypto';
import { NEURA_TEXT_MAX, voiceSessionSchema, voiceStartInputSchema, voiceTranscriptSchema, type VoiceSession, type VoiceStartInput, type VoiceTranscript } from '@neuralbridge/shared';
import { hasWakeWord, isWakeOnly, parseNeuraIntent, type WakeWordOptions } from './neura-intents.js';

// The user needs time to hear the acknowledgement beep and start the command. The
// timer starts when the recognizer emits the final wake-word segment, not when the
// user says it, so a short window drops valid follow-ups on slower machines.
const FOLLOW_UP_MS = 15_000;
/**
 * The microphone is off while Neura talks and comes back when the HUD says the speech ended. A voice that never reports
 * its end must not leave her deaf, so the gate reopens on its own after this long.
 */
const SPEAKING_MAX_MS = 45_000;

/**
 * Room noise comes back from the recognizer as "Thank you." or "Yeah.". Without the wake word, a single word only counts
 * when it is a command, and the usual noise phrases never count: otherwise noise used up the window the user needed.
 */
/** What the recognizer makes of noise, seen in the field: never a request on its own. */
const NOISE = new Set(['thank you', 'thanks', 'yeah', 'yes', 'no', 'okay', 'ok', 'uh', 'um', 'hmm', 'what', 'you', 'bye', 'obrigado', 'obrigada', 'tchau', 'ah', 'eh']);

function worthAFollowUp(text: string, wakeWords: WakeWordOptions): boolean {
  if (parseNeuraIntent(text, wakeWords).target !== 'conversation') return true;
  const words = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/u).filter(Boolean);
  return words.length >= 2 && !NOISE.has(words.join(' '));
}

export interface VoiceAvailability { available: boolean; detail: string; }
export interface VoiceHeard { text: string; language: string; confidence: number; }
/**
 * `onPartial` is the recognizer's running guess for the utterance in progress. The final text can drop its first word, which
 * is exactly where "Neura" sits, so the wake word is looked for in the partials too.
 */
export interface VoiceProviderHandle { language: string; onHeard(heard: VoiceHeard): void; onPartial?(text: string): void; onFailure(detail: string): void; }

/** Everything specific to a speech engine stays behind this seam. Providers deliver text only, never audio. */
export interface VoiceProvider {
  readonly id: string;
  availability(): Promise<VoiceAvailability>;
  start(handle: VoiceProviderHandle): Promise<void>;
  stop(): Promise<void>;
}

export class VoiceGatewayError extends Error {
  constructor(readonly code: 'unavailable' | 'already_running') { super(`voice_${code}`); this.name = 'VoiceGatewayError'; }
}

export interface VoiceGatewayEvents {
  /** The wake word was recognized and the HUD should acknowledge it immediately. */
  wakeDetected(): void;
  transcript(transcript: VoiceTranscript): void;
  /** The user spoke over the assistant: whoever is talking must stop. */
  interrupted(): void;
  /** The engine died; the session is already over. */
  ended(detail: string): void;
}

/** One listening session at a time, opened by the wake word: nothing said before it leaves this class. */
export class VoiceGateway {
  private session: VoiceSession | null = null;
  private followUpUntil = 0;
  private speakingTimer: ReturnType<typeof setTimeout> | undefined;
  /** A partial of the current utterance already announced the wake word, so its final must not announce it again. */
  private partialWoke = false;
  private readonly observers = new Set<Partial<VoiceGatewayEvents>>();
  private readonly now: () => number;

  private readonly speakingMaxMs: number;
  private readonly wakeWords: () => WakeWordOptions;

  constructor(private readonly provider: VoiceProvider, options: { now?: () => number; speakingMaxMs?: number; wakeWords?: () => WakeWordOptions } = {}) {
    this.now = options.now ?? Date.now;
    this.speakingMaxMs = options.speakingMaxMs ?? SPEAKING_MAX_MS;
    this.wakeWords = options.wakeWords ?? (() => ({}));
  }

  get current(): VoiceSession | null { return this.session ? { ...this.session } : null; }
  availability(): Promise<VoiceAvailability> { return this.provider.availability(); }

  subscribe(observer: Partial<VoiceGatewayEvents>): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  async start(input: VoiceStartInput): Promise<VoiceSession> {
    const { preferredLanguage } = voiceStartInputSchema.parse(input);
    if (this.session) throw new VoiceGatewayError('already_running');
    const { available } = await this.provider.availability();
    if (!available) throw new VoiceGatewayError('unavailable');
    const session = voiceSessionSchema.parse({ sessionId: randomUUID(), state: 'listening', provider: this.provider.id, startedAt: new Date(this.now()).toISOString() });
    this.session = session;
    try {
      await this.provider.start({ language: preferredLanguage, onHeard: (heard) => this.receive(session.sessionId, heard), onPartial: (text) => this.receivePartial(session.sessionId, text), onFailure: (detail) => this.fail(session.sessionId, detail) });
    } catch {
      this.session = null;
      throw new VoiceGatewayError('unavailable');
    }
    return { ...session };
  }

  async stop(sessionId: string): Promise<void> {
    if (this.session?.sessionId !== sessionId) return;
    clearTimeout(this.speakingTimer);
    this.session = null;
    this.followUpUntil = 0;
    await Promise.resolve().then(() => this.provider.stop()).catch(() => undefined);
  }

  setSpeaking(speaking: boolean): void {
    clearTimeout(this.speakingTimer);
    this.speakingTimer = undefined;
    if (!this.session) return;
    if (speaking) {
      const { sessionId } = this.session;
      this.speakingTimer = setTimeout(() => { if (this.session?.sessionId === sessionId && this.session.state === 'speaking') this.setSpeaking(false); }, this.speakingMaxMs);
      this.speakingTimer.unref?.();
    }
    this.session = { ...this.session, state: speaking ? 'speaking' : 'listening' };
    // Answering opens a short window, so a follow-up does not need the wake word again.
    if (!speaking) this.followUpUntil = this.now() + FOLLOW_UP_MS;
  }

  /** The configured primary word and aliases are always heard, also while Void talks. */
  private wake(): void {
    if (!this.session) return;
    for (const observer of [...this.observers]) observer.wakeDetected?.();
    this.followUpUntil = this.now() + FOLLOW_UP_MS;
    if (this.session.state === 'speaking') {
      clearTimeout(this.speakingTimer);
      this.session = { ...this.session, state: 'listening' };
      this.emit('interrupted');
    }
  }

  private receivePartial(sessionId: string, text: string): void {
    if (this.session?.sessionId !== sessionId || this.partialWoke || text.length > NEURA_TEXT_MAX || !hasWakeWord(text, this.wakeWords())) return;
    this.partialWoke = true;
    this.wake();
  }

  private receive(sessionId: string, heard: VoiceHeard): void {
    if (this.session?.sessionId !== sessionId || !heard.text.trim() || heard.text.length > NEURA_TEXT_MAX) return;
    const wakeWords = this.wakeWords();
    const woken = hasWakeWord(heard.text, wakeWords);
    const announced = this.partialWoke;
    this.partialWoke = false;
    if (woken && !announced) this.wake();
    // While she talks, only the wake word gets through, and it has already put her back to listening.
    if (this.session.state === 'speaking') return;
    if (!woken && (this.now() > this.followUpUntil || !worthAFollowUp(heard.text, wakeWords))) return;
    const transcript = voiceTranscriptSchema.safeParse({ transcriptId: randomUUID(), sessionId, text: heard.text, language: heard.language, confidence: heard.confidence, final: true, occurredAt: new Date(this.now()).toISOString() });
    if (!transcript.success) return;
    if (!isWakeOnly(heard.text, wakeWords)) this.followUpUntil = 0;
    for (const observer of [...this.observers]) observer.transcript?.(transcript.data);
  }

  private fail(sessionId: string, detail: string): void {
    if (this.session?.sessionId !== sessionId) return;
    this.session = null;
    for (const observer of [...this.observers]) observer.ended?.(detail);
  }

  private emit(event: 'interrupted'): void {
    for (const observer of [...this.observers]) observer[event]?.();
  }
}

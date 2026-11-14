interface WakeOscillator {
  type: string;
  frequency: { value: number };
  onended: (() => void) | null;
  connect(destination: WakeAudioNode): void;
  start(when: number): void;
  stop(when: number): void;
}

interface WakeGain extends WakeAudioNode {
  gain: { setValueAtTime(value: number, startTime: number): void; exponentialRampToValueAtTime(value: number, endTime: number): void };
}

interface WakeAudioNode { connect(destination: WakeAudioNode | unknown): void; }

interface WakeAudioContext {
  currentTime: number;
  destination: unknown;
  createOscillator(): WakeOscillator;
  createGain(): WakeGain;
  resume?: () => Promise<void>;
  close(): Promise<void>;
}

interface WakeWindow { AudioContext?: new () => WakeAudioContext; }

/** Loud and long enough to hear over music: it is the signal that Neura is listening. */
const WAKE_VOLUME = .5;
const WAKE_NOTE_SECONDS = .16;
/** Rising, so it reads as "go ahead" and cannot be mistaken for a notification. */
const WAKE_NOTES = [660, 990] as const;

/** A short local acknowledgement played as soon as the wake word is accepted. */
export function playWakeBeep(): void {
  const browserWindow = (globalThis as typeof globalThis & { window?: WakeWindow }).window;
  const AudioContextConstructor = browserWindow?.AudioContext;
  if (!AudioContextConstructor) return;
  try {
    const context = new AudioContextConstructor();
    // Chromium can create this context suspended after the first microphone
    // capture. Resuming it is best-effort, but must happen before the cue is
    // scheduled or the user gets no acknowledgement at all.
    void context.resume?.().catch(() => undefined);
    WAKE_NOTES.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + index * WAKE_NOTE_SECONDS;
      const end = start + WAKE_NOTE_SECONDS;
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(WAKE_VOLUME, start);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(context.destination);
      if (index === WAKE_NOTES.length - 1) oscillator.onended = () => { void context.close(); };
      oscillator.start(start);
      oscillator.stop(end);
    });
  } catch {
    // Audio acknowledgement is best-effort; it must never prevent the command from running.
  }
}

const TICK_VOLUME = .3;
const TICK_SECONDS = .05;

/** A short "toc" as a bubble appears, so a silent answer is not missed. */
export function playBubbleTick(): void {
  const browserWindow = (globalThis as typeof globalThis & { window?: WakeWindow }).window;
  const AudioContextConstructor = browserWindow?.AudioContext;
  if (!AudioContextConstructor) return;
  try {
    const context = new AudioContextConstructor();
    void context.resume?.().catch(() => undefined);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.value = 1_400;
    gain.gain.setValueAtTime(TICK_VOLUME, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + TICK_SECONDS);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => { void context.close(); };
    oscillator.start(start);
    oscillator.stop(start + TICK_SECONDS);
  } catch {
    // Best-effort, like the wake cue.
  }
}


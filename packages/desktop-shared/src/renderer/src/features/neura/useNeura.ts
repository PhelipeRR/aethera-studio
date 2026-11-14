import * as React from 'react';
import type { NeuraState } from '@neuralbridge/shared/neura-state';
import { speechLevel } from '../companion/companion-motion';

/** Pushed by the main process, which owns every decision; the HUD only draws it. */
export function useNeura(): NeuraState | null {
  const [state, setState] = React.useState<NeuraState | null>(null);
  React.useEffect(() => {
    let disposed = false;
    const stop = window.neuralbridge.neura.onChange(setState);
    void window.neuralbridge.neura.state().then((value) => { if (!disposed) setState(value); }).catch(() => undefined);
    return () => { disposed = true; stop(); };
  }, []);
  return state;
}

let activeAudio: HTMLAudioElement | null = null;
let speechSequence = 0;
let stopMeter: () => void = () => undefined;
const liveUtterances = new Set<SpeechSynthesisUtterance>();
/** Whoever waits for silence: a voice cut off by another hands its wait to that one, so nobody is told too early or never. */
let waitingForEnd: Array<() => void> = [];
let voiceWatchdog: ReturnType<typeof setTimeout> | undefined;
let speaking = false;
const speechListeners = new Set<(level: number | null) => void>();

const WORD_LEVEL = .8;
const WORD_DECAY_MS = 180;
const ANALYSER_SIZE = 256;
const VOICE_GRACE_MS = 15_000;
const VOICE_MS_PER_CHARACTER = 150;

function endMeter(): void { stopMeter(); stopMeter = () => undefined; }

function emitSpeech(level: number | null): void {
  speaking = level !== null;
  for (const listener of speechListeners) listener(level);
}

/** The level of the voice, from 0 to 1, while there is one; null when it stops. */
export function subscribeSpeech(listener: (level: number | null) => void): () => void {
  speechListeners.add(listener);
  return () => { speechListeners.delete(listener); };
}

export function useSpeaking(): boolean {
  return React.useSyncExternalStore((change) => subscribeSpeech(change), () => speaking);
}

/** Reads the real audio. A meter that cannot start leaves the voice playing and the mouth still. */
function meterAudio(audio: HTMLAudioElement): () => void {
  emitSpeech(0);
  try {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = ANALYSER_SIZE;
    context.createMediaElementSource(audio).connect(analyser);
    analyser.connect(context.destination);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const read = () => { analyser.getByteTimeDomainData(samples); emitSpeech(speechLevel(samples)); frame = requestAnimationFrame(read); };
    frame = requestAnimationFrame(read);
    return () => { cancelAnimationFrame(frame); void context.close(); };
  } catch { return () => undefined; }
}

/** The browser voice exposes no audio, only word boundaries: each word opens the mouth, and it falls back on its own. */
function wordBeat(): () => void {
  let frame = 0;
  const started = performance.now();
  const fall = (now: number) => { emitSpeech(Math.max(0, WORD_LEVEL * (1 - (now - started) / WORD_DECAY_MS))); if (now - started < WORD_DECAY_MS) frame = requestAnimationFrame(fall); };
  emitSpeech(WORD_LEVEL);
  frame = requestAnimationFrame(fall);
  return () => cancelAnimationFrame(frame);
}

/** Silences Neura at once: a new call outranks whatever she was saying. */
export function stopSpeech(): void {
  speechSequence += 1;
  activeAudio?.pause();
  activeAudio = null;
  window.speechSynthesis.cancel();
  endMeter();
  clearTimeout(voiceWatchdog);
  liveUtterances.clear();
  if (speaking) emitSpeech(null);
  const waiting = waitingForEnd;
  waitingForEnd = [];
  for (const notify of waiting) notify();
}

/** Prefer VoiceStudio TTS in the main process; keep the local browser voice as a resilient fallback. */
export async function speak(text: string, language: string, onEnd?: () => void, onFirstAudio?: () => void): Promise<void> {
  const sequence = ++speechSequence;
  if (onEnd) waitingForEnd.push(onEnd);
  activeAudio?.pause();
  activeAudio = null;
  window.speechSynthesis.cancel();
  endMeter();
  clearTimeout(voiceWatchdog);
  if (speaking) emitSpeech(null);
  let finished = false;
  const finish = () => {
    if (finished || sequence !== speechSequence) return;
    finished = true;
    endMeter();
    clearTimeout(voiceWatchdog);
    liveUtterances.clear();
    emitSpeech(null);
    const waiting = waitingForEnd;
    waitingForEnd = [];
    for (const notify of waiting) notify();
  };
  let fellBack = false;
  const fallback = () => {
    if (sequence !== speechSequence) return finish();
    if (fellBack) return;
    fellBack = true;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language;
    utterance.onstart = () => onFirstAudio?.();
    utterance.onend = finish;
    utterance.onerror = finish;
    utterance.onboundary = () => { if (finished) return; endMeter(); stopMeter = wordBeat(); };
    endMeter();
    emitSpeech(0);
    // Chromium can drop a utterance without an end event, and a mouth left open would hide what the mascot has to say next.
    // The reference keeps it from being collected, which is one way that happens.
    liveUtterances.add(utterance);
    voiceWatchdog = setTimeout(finish, VOICE_GRACE_MS + text.length * VOICE_MS_PER_CHARACTER);
    window.speechSynthesis.speak(utterance);
  };

  try {
    const result = await window.neuralbridge.neura.speak({ text, language });
    if (sequence !== speechSequence) return finish();
    const audio = new Audio(result.audio);
    activeAudio = audio;
    audio.onended = finish;
    audio.onerror = fallback;
    stopMeter = meterAudio(audio);
    await audio.play();
    onFirstAudio?.();
  } catch {
    fallback();
  }
}

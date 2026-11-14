export const VOICE_SAMPLE_RATE = 16_000;

const SPEECH_RMS = 0.012;
const PRE_ROLL_MS = 300;
const END_SILENCE_MS = 700;
const MIN_SPEECH_MS = 300;
const MAX_SEGMENT_MS = 10_000;

const samples = (ms: number): number => (VOICE_SAMPLE_RATE * ms) / 1000;

function rms(frame: Float32Array): number {
  let sum = 0;
  for (const value of frame) sum += value * value;
  return Math.sqrt(sum / frame.length);
}

/** Cuts the microphone into spoken segments, so silence never reaches the recognizer. */
export class VoiceSegmenter {
  private preRoll: Float32Array[] = [];
  private preRollLength = 0;
  private segment: Float32Array[] = [];
  private length = 0;
  private speech = 0;
  private silence = 0;

  /** Returns a finished segment, if this frame closed one. */
  push(frame: Float32Array): Float32Array | null {
    const loud = rms(frame) >= SPEECH_RMS;
    if (!this.segment.length) {
      if (!loud) { this.remember(frame); return null; }
      this.segment = this.preRoll;
      this.length = this.preRollLength;
      this.preRoll = [];
      this.preRollLength = 0;
    }
    this.segment.push(frame);
    this.length += frame.length;
    this.speech += loud ? frame.length : 0;
    this.silence = loud ? 0 : this.silence + frame.length;
    if (this.silence < samples(END_SILENCE_MS) && this.length < samples(MAX_SEGMENT_MS)) return null;
    return this.finish();
  }

  private remember(frame: Float32Array): void {
    this.preRoll.push(frame);
    this.preRollLength += frame.length;
    while (this.preRollLength - (this.preRoll[0]?.length ?? 0) >= samples(PRE_ROLL_MS)) this.preRollLength -= this.preRoll.shift()?.length ?? 0;
  }

  private finish(): Float32Array | null {
    const merged = new Float32Array(this.length);
    let offset = 0;
    for (const frame of this.segment) { merged.set(frame, offset); offset += frame.length; }
    const enough = this.speech >= samples(MIN_SPEECH_MS);
    this.segment = [];
    this.length = 0;
    this.speech = 0;
    this.silence = 0;
    return enough ? merged : null;
  }
}

/** 16-bit mono PCM in a WAV container. */
export function encodeWav(pcm: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, text: string): void => { for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index)); };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, VOICE_SAMPLE_RATE, true);
  view.setUint32(28, VOICE_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  pcm.forEach((value, index) => { view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, value)) * 0x7fff, true); });
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(binary);
}

import { describe, expect, it, vi } from 'vitest';
import { playBubbleTick, playWakeBeep } from '../src/renderer/src/features/neura/wake-beep';

class FakeOscillator {
  type = '';
  frequency = { value: 0 };
  onended: (() => void) | null = null;
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn(() => this.onended?.());
}

class FakeGain {
  gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  connect = vi.fn();
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  currentTime = 0;
  destination = {};
  oscillators: FakeOscillator[] = [];
  gain = new FakeGain();
  resume = vi.fn(() => Promise.resolve());
  close = vi.fn(() => Promise.resolve());
  constructor() { FakeAudioContext.last = this; }
  createOscillator() { const oscillator = new FakeOscillator(); this.oscillators.push(oscillator); return oscillator; }
  createGain() { return this.gain; }
}

describe('Neura wake acknowledgement', () => {
  it('plays a rising two-note cue locally, without sending audio anywhere', () => {
    const globalWithWindow = globalThis as typeof globalThis & { window?: unknown };
    const previousWindow = globalWithWindow.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: FakeAudioContext } });
    try {
      playWakeBeep();
      const context = FakeAudioContext.last;
      expect(context?.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([660, 990]);
      expect(context?.oscillators.every((oscillator) => oscillator.start.mock.calls.length === 1 && oscillator.stop.mock.calls.length === 1)).toBe(true);
      expect(context?.resume).toHaveBeenCalledOnce();
      expect(context?.close).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });
  it('plays a single short tick for a bubble', () => {
    const globalWithWindow = globalThis as typeof globalThis & { window?: unknown };
    const previousWindow = globalWithWindow.window;
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: FakeAudioContext } });
    try {
      playBubbleTick();
      const context = FakeAudioContext.last;
      expect(context?.oscillators).toHaveLength(1);
      expect(context?.close).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
    }
  });
});

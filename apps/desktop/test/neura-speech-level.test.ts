import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { speak, subscribeSpeech } from '../src/renderer/src/features/neura/useNeura';

class Utterance { lang = ''; onend?: () => void; onerror?: () => void; onboundary?: () => void; onstart?: () => void; constructor(public text: string) {} }

describe('Speech signal', () => {
  let spoken: Utterance[];
  beforeEach(() => {
    spoken = [];
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('window', { speechSynthesis: { cancel: () => undefined, speak: (item: Utterance) => spoken.push(item) }, neuralbridge: { neura: { speak: () => Promise.reject(new Error('no VoiceStudio')) } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('follows the words on the browser voice and ends with the speech', async () => {
    const levels: Array<number | null> = [];
    const stop = subscribeSpeech((level) => levels.push(level));
    await speak('oi', 'pt-BR');
    spoken[0]?.onboundary?.();
    expect(levels.at(-1)).toBe(.8);
    spoken[0]?.onend?.();
    expect(levels.at(-1)).toBeNull();
    stop();
  });

  it('reports an end after a voice error too', async () => {
    const levels: Array<number | null> = [];
    const stop = subscribeSpeech((level) => levels.push(level));
    await speak('oi', 'pt-BR');
    spoken[0]?.onerror?.();
    expect(levels.at(-1)).toBeNull();
    stop();
  });

  it('lets go of the mouth when the browser voice never reports an end', async () => {
    vi.useFakeTimers();
    const levels: Array<number | null> = [];
    const stop = subscribeSpeech((level) => levels.push(level));
    await speak('oi', 'pt-BR');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(levels.at(-1)).toBeNull();
    stop();
    vi.useRealTimers();
  });

  it('speaks once when the audio both errors and refuses to play', async () => {
    class BrokenAudio { onended?: () => void; onerror?: () => void; pause() { return undefined; } play() { this.onerror?.(); return Promise.reject(new Error('undecodable')); } }
    vi.stubGlobal('Audio', BrokenAudio);
    (window as unknown as { neuralbridge: { neura: { speak: () => Promise<{ audio: string }> } } }).neuralbridge.neura.speak = () => Promise.resolve({ audio: 'data:audio/wav;base64,AA==' });
    vi.stubGlobal('AudioContext', vi.fn(() => { throw new Error('no audio here'); }));
    await speak('oi', 'pt-BR');
    expect(spoken).toHaveLength(1);
    spoken[0]?.onend?.();
  });

  it('reports the end of a replaced voice only when the speech really ends', async () => {
    let ended = 0;
    await speak('primeira', 'pt-BR', () => { ended += 1; });
    await speak('segunda', 'pt-BR');
    spoken[0]?.onend?.();
    expect(ended).toBe(0);
    spoken[1]?.onend?.();
    expect(ended).toBe(1);
  });

  it('ignores a word that arrives after the end', async () => {
    const levels: Array<number | null> = [];
    const stop = subscribeSpeech((level) => levels.push(level));
    await speak('oi', 'pt-BR');
    spoken[0]?.onend?.();
    spoken[0]?.onboundary?.();
    expect(levels.at(-1)).toBeNull();
    stop();
  });

  it('is silent for a listener that left', async () => {
    const levels: Array<number | null> = [];
    subscribeSpeech((level) => levels.push(level))();
    await speak('oi', 'pt-BR');
    spoken[0]?.onend?.();
    expect(levels).toEqual([]);
  });
});

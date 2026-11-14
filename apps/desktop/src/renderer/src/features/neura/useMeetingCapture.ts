import * as React from 'react';
import { toBase64, VOICE_SAMPLE_RATE } from './voice-segmenter';

const FRAME_SAMPLES = 2_048;

/**
 * Takes what the computer plays while `active`, which the main process derives from a meeting the user started. The screen
 * video is required by the API and stopped unseen. It stays quiet while Neura talks, so she cannot answer herself.
 */
export function useMeetingCapture(active: boolean, speaking: boolean): void {
  const quiet = React.useRef(speaking);
  React.useEffect(() => { quiet.current = speaking; }, [speaking]);
  React.useEffect(() => {
    if (!active) return undefined;
    let disposed = false;
    let release: () => void = () => undefined;
    const { neura } = window.neuralbridge;
    const fail = () => { if (!disposed) void neura.meetingAudio({ failure: 'capture' }).catch(() => undefined); };
    void (async () => {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      for (const track of stream.getVideoTracks()) track.stop();
      release = () => stream.getTracks().forEach((track) => track.stop());
      const [audio] = stream.getAudioTracks();
      if (!audio) throw new Error('no system audio');
      const context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
      release = () => { stream.getTracks().forEach((track) => track.stop()); void context.close(); };
      if (disposed) { release(); return; }
      audio.onended = fail;
      await context.resume();
      const source = context.createMediaStreamSource(new MediaStream([audio]));
      // ScriptProcessor because an AudioWorklet module would need a script source the app's CSP does not allow.
      const processor = context.createScriptProcessor(FRAME_SAMPLES, 1, 1);
      processor.onaudioprocess = (event) => {
        const samples = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(samples.length);
        // Silence while Neura talks, not nothing: the frames are how the main process knows the capture is alive.
        if (!quiet.current) for (let index = 0; index < samples.length; index += 1) pcm[index] = Math.max(-1, Math.min(1, samples[index] ?? 0)) * 32_767;
        void neura.meetingAudio({ pcmBase64: toBase64(new Uint8Array(pcm.buffer)) }).catch(() => undefined);
      };
      source.connect(processor);
      processor.connect(context.destination);
    })().catch(fail);
    return () => { disposed = true; release(); };
  }, [active]);
}

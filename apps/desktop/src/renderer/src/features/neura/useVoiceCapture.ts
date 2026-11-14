import * as React from 'react';
import { encodeWav, toBase64, VOICE_SAMPLE_RATE, VoiceSegmenter } from './voice-segmenter';

const FRAME_SAMPLES = 2_048;
const CAPTURE_STALL_MS = 5_000;

/**
 * Holds the microphone only while `active`, which the main process derives from a consented session. It stays on while
 * Neura talks, so "Neura" can interrupt her; the gateway lets nothing else through then. The HUD mounts this because the
 * panel can close during a session.
 */
export function useVoiceCapture(active: boolean, streaming = false): void {
  React.useEffect(() => {
    if (!active) return undefined;
    let disposed = false;
    let release: () => void = () => undefined;
    let lastFrameAt = Date.now();
    let peak = 0;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let diagnostics: ReturnType<typeof setInterval> | undefined;
    const failCapture = () => { if (!disposed) void neura.voiceAudio({ failure: 'microphone' }).catch(() => undefined); };
    const { neura } = window.neuralbridge;
    void (async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const context = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
      release = () => { stream.getTracks().forEach((track) => track.stop()); void context.close(); };
      if (disposed) { release(); return; }
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      // ScriptProcessor because an AudioWorklet module would need a script source the app's CSP does not allow.
      const processor = context.createScriptProcessor(FRAME_SAMPLES, 1, 1);
      const segmenter = streaming ? null : new VoiceSegmenter();
      processor.onaudioprocess = (event) => {
        lastFrameAt = Date.now();
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        if (streaming) {
          const pcm = new Int16Array(samples.length);
          for (let index = 0; index < samples.length; index += 1) pcm[index] = Math.max(-1, Math.min(1, samples[index] ?? 0)) * 32_767;
          void neura.voiceAudio({ pcmBase64: toBase64(new Uint8Array(pcm.buffer)) }).catch(() => undefined);
          return;
        }
        const segment = segmenter?.push(samples);
        if (segment) void neura.voiceAudio({ wavBase64: toBase64(encodeWav(segment)) }).catch(() => undefined);
      };
      source.connect(processor);
      processor.connect(context.destination);
      watchdog = setInterval(() => {
        if (context.state === 'suspended' || Date.now() - lastFrameAt > CAPTURE_STALL_MS) failCapture();
      }, 1_000);
      const track = stream.getAudioTracks()[0];
      const deviceLabel = track?.label?.trim() ?? '';
      diagnostics = setInterval(() => {
        void neura.voiceAudio({ diagnostic: { deviceLabel, peak: Math.min(1, peak), lastFrameAt } }).catch(() => undefined);
        peak = 0;
      }, 1_000);
    })().catch(() => { void neura.voiceAudio({ failure: 'microphone' }).catch(() => undefined); });
    return () => { disposed = true; if (watchdog) clearInterval(watchdog); if (diagnostics) clearInterval(diagnostics); release(); };
  }, [active, streaming]);
}

import { execFileSync } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { alignVelixMotionVoice, renderMotionProject } from '@neuralbridge/workspace';
import { describe, expect, it } from 'vitest';

// Real speech from the Windows pt-BR voice, transcribed by the installed Velix kit (NB_REAL_SPEECH=1). Downloads a Whisper model on first use.
const lines = ['A atmosfera espalha a luz azul do sol.', 'Por isso o céu parece azul durante o dia.', 'No fim da tarde o céu fica alaranjado.'];

function speak(file: string): void {
  const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('Microsoft Maria Desktop'); $s.SetOutputToWaveFile('${file}'); $s.Speak('${lines.join(' ')}'); $s.Dispose()`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
}

describe.skipIf(process.env['NB_REAL_SPEECH'] !== '1')('Motion captions aligned to real speech', () => {
  it('moves wrongly timed captions onto the spoken words', { timeout: 540_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-motion-align-'));
    speak(join(root, 'voz.wav'));
    expect(statSync(join(root, 'voz.wav')).size).toBeGreaterThan(10_000);
    // Deliberately wrong timing: all three start far from the voice.
    const captions = lines.map((text, index) => ({ text, startMs: 20_000 + index * 1000, endMs: 20_900 + index * 1000, timestampMs: null, confidence: null }));
    const result = await alignVelixMotionVoice(root, 'voz.wav', captions);
    console.log(`align real: missed=${result.missed} ${JSON.stringify(result.captions.map(({ startMs, endMs }) => [startMs, endMs]))}`);
    expect(result.missed).toBe(0);
    expect(result.captions.at(-1)?.endMs).toBeLessThan(20_000);
    result.captions.forEach((caption, index) => {
      expect(caption.endMs).toBeGreaterThan(caption.startMs);
      expect(caption.startMs).toBeGreaterThanOrEqual(result.captions[index - 1]?.endMs ?? 0);
    });
    if (process.env['NB_MOTION'] !== '1') return;
    const desktop = resolve(import.meta.dirname, '../../apps/desktop');
    const browserExecutable = join(desktop, '../../node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
    const rendered = await renderMotionProject({
      root, outputRelativePath: 'renders/motion.mp4', audioRelativePath: 'voz.wav', bundlePath: join(desktop, 'motion-bundle'), workerPath: join(desktop, 'motion/render-worker.mjs'), browserExecutable,
      runtime: createRequire(join(desktop, 'package.json'))('electron') as unknown as string,
      project: { schemaVersion: 1, templateId: 'velix-base', templateVersion: 1, width: 640, height: 360, fps: 15, captions: result.captions, scenes: [{ id: 't', kind: 'title', text: 'Por que o céu é azul', durationInFrames: 180, transition: 'fade' }] },
    });
    console.log(`align render real: ${JSON.stringify(rendered)}`);
    expect(rendered).toMatchObject({ hasVideo: true, hasAudio: true });
  });
});

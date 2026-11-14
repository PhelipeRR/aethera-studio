import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKE_AGENTS, launchApp } from './app';

// The real capture path and the real Whisper: Chromium plays a spoken file as the microphone, and everything after that
// is production code. It needs VoiceStudio open, and says nothing about a physical microphone.

const voiceStudioUp = async (): Promise<boolean> => {
  try { return (await fetch('http://localhost:3900/health', { signal: AbortSignal.timeout(2_000) })).ok; } catch { return false; }
};

function spokenFile(phrase: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'nb-voice-'));
  const wav = join(dir, 'phrase.wav');
  const script = join(dir, 'speak.ps1');
  // UTF-8 with a BOM: without it Windows PowerShell reads accents as ANSI and the voice spells them out.
  writeFileSync(script, `\uFEFFAdd-Type -AssemblyName System.Speech
$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo 48000, ([System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen), ([System.Speech.AudioFormat.AudioChannel]::Mono)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile('${wav}', $f)
$s.Speak('${phrase}')
$s.Dispose()`);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script]);
  return wav;
}

test('hears the wake word from the microphone and acts on the transcription', async () => {
  test.skip(process.platform !== 'win32' || process.env['NB_E2E_REAL_VOICE'] !== '1' || !(await voiceStudioUp()), 'set NB_E2E_REAL_VOICE=1 with VoiceStudio running on Windows.');
  test.setTimeout(120_000);
  const wav = spokenFile('Neura, próxima música');
  const { app, page } = await launchApp(undefined, { env: FAKE_AGENTS, chromiumArgs: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  await page.evaluate(async () => {
    await window.neuralbridge.neura.updateSettings({ enabled: true, voiceConsent: true });
    await window.neuralbridge.companion.openHudPanel();
  });
  await expect.poll(() => app.windows().some((item) => item.url().includes('companion=hud'))).toBe(true);
  const hud = app.windows().find((item) => item.url().includes('companion=hud'));
  if (!hud) throw new Error('HUD window not found');
  await hud.getByRole('button', { name: 'Neura', exact: true }).click();
  const listen = hud.getByRole('button', { name: 'Ouvir', exact: true });
  await expect(listen).toBeEnabled({ timeout: 70_000 });
  await listen.click();
  await expect(hud.getByTestId('neura-activity')).toHaveText('Ouvindo “Neura”');
  await expect(hud.getByTestId('neura-response')).toContainText('não está conectado', { timeout: 60_000 });
  await app.close();
});

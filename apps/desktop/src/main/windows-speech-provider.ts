import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { VoiceAvailability, VoiceProvider, VoiceProviderHandle } from '@neuralbridge/orchestrator';

const MAX_LINE = 8_000;
const PROBE_TIMEOUT_MS = 15_000;
const NO_RECOGNIZER = 'Nenhum reconhecedor de fala instalado. Adicione o recurso de fala do idioma nas configurações do Windows.';

const PROBE = `Add-Type -AssemblyName System.Speech; @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | ForEach-Object { $_.Culture.Name }) -join ','`;

/** A fixed script: the only value in it is a culture name that came from the recognizer list, never from speech. */
function listenScript(culture: string): string {
  return `$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$engine=New-Object System.Speech.Recognition.SpeechRecognitionEngine([Globalization.CultureInfo]::new('${culture}'))
$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$engine.SetInputToDefaultAudioDevice()
while($true){$result=$engine.Recognize([TimeSpan]::FromSeconds(30));if($result){@{text=$result.Text;confidence=$result.Confidence}|ConvertTo-Json -Compress}}`;
}

const heardSchema = z.object({ text: z.string().min(1), confidence: z.number().min(0).max(1) });

export interface SpeechCommand { executable: string; args: readonly string[]; }
export interface WindowsSpeechOptions {
  platform?: NodeJS.Platform;
  /** Stands in for PowerShell in tests: a process that prints the same JSON lines. */
  listenCommand?: SpeechCommand | null;
  systemRoot?: string;
  probe?: () => Promise<string[]>;
}

const encoded = (script: string): string => Buffer.from(script, 'utf16le').toString('base64');

/** Offline dictation from Windows. It needs a speech language pack, and it reports that instead of failing at start. */
export class WindowsSpeechProvider implements VoiceProvider {
  readonly id = 'windows-speech';
  private child: ChildProcessWithoutNullStreams | null = null;
  private cultures: Promise<string[]> | null = null;

  constructor(private readonly options: WindowsSpeechOptions = {}) {}

  private get powershell(): string { return join(this.options.systemRoot ?? process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }

  private installed(): Promise<string[]> {
    if (this.options.probe) return this.options.probe();
    this.cultures ??= new Promise((resolve) => {
      execFile(this.powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(PROBE)], { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout) => {
        resolve(error ? [] : stdout.trim().split(',').map((name) => name.trim()).filter(Boolean));
      });
    });
    return this.cultures;
  }

  async availability(): Promise<VoiceAvailability> {
    if (this.options.listenCommand) return { available: true, detail: 'Provedor de teste.' };
    if ((this.options.platform ?? process.platform) !== 'win32') return { available: false, detail: 'Voz disponível só no Windows nesta versão.' };
    const cultures = await this.installed();
    return cultures.length ? { available: true, detail: `Reconhecimento local: ${cultures.join(', ')}.` } : { available: false, detail: NO_RECOGNIZER };
  }

  private async commandFor(language: string): Promise<SpeechCommand> {
    if (this.options.listenCommand) return this.options.listenCommand;
    const cultures = await this.installed();
    const base = language.split('-')[0]?.toLowerCase();
    const culture = cultures.find((name) => name.toLowerCase() === language.toLowerCase()) ?? cultures.find((name) => name.split('-')[0]?.toLowerCase() === base);
    if (!culture) throw new Error('no recognizer for the language');
    return { executable: this.powershell, args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded(listenScript(culture))] };
  }

  async start(handle: VoiceProviderHandle): Promise<void> {
    const command = await this.commandFor(handle.language);
    const child = spawn(command.executable, [...command.args], { shell: false, windowsHide: true, stdio: 'pipe' });
    this.child = child;
    child.stderr.resume();
    child.stdin.on('error', () => undefined);
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.length > MAX_LINE) return;
      let value: unknown;
      try { value = JSON.parse(line); } catch { return; }
      const heard = heardSchema.safeParse(value);
      if (heard.success) handle.onHeard({ ...heard.data, language: handle.language });
    });
    const ended = (): void => {
      if (this.child !== child) return;
      this.child = null;
      handle.onFailure('o reconhecimento de fala parou.');
    };
    child.on('error', ended);
    child.on('exit', ended);
  }

  stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    child?.kill();
    return Promise.resolve();
  }
}

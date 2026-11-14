import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const VOICE_STUDIO_PROCESS = 'VoiceStudio';
const VOICE_STUDIO_BINARY = 'VoiceStudio.exe';

export interface VoiceStudioPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
}

export interface VoiceStudioLaunchPlan {
  executable: string;
  hideWindow: true;
}

export interface VoiceStudioLaunchOptions extends VoiceStudioPathOptions {
  hide?: boolean;
}

export function resolveVoiceStudioExecutable(options: VoiceStudioPathOptions = {}): string | null {
  if ((options.platform ?? process.platform) !== 'win32') return null;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const candidates = [
    env['NB_VOICESTUDIO_EXE'],
    env['LOCALAPPDATA'] ? join(env['LOCALAPPDATA'], 'Programs', 'VoiceStudio', VOICE_STUDIO_BINARY) : null,
    env['ProgramFiles'] ? join(env['ProgramFiles'], 'VoiceStudio', VOICE_STUDIO_BINARY) : null,
    env['ProgramFiles(x86)'] ? join(env['ProgramFiles(x86)'], 'VoiceStudio', VOICE_STUDIO_BINARY) : null,
  ].filter((path): path is string => Boolean(path));
  return candidates.find((path) => exists(path)) ?? null;
}

export function voiceStudioLaunchPlan(executable: string): VoiceStudioLaunchPlan {
  return { executable, hideWindow: true };
}

function powershellPath(env: NodeJS.ProcessEnv): string {
  return join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function setVoiceStudioWindowsVisible(visible: boolean, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const showState = visible ? 5 : 0;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class NeuralBridgeVoiceStudioWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
Get-Process -Name '${VOICE_STUDIO_PROCESS}' | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  [NeuralBridgeVoiceStudioWindow]::ShowWindow($_.MainWindowHandle, ${showState}) | Out-Null
  if (${visible ? '$true' : '$false'}) { [NeuralBridgeVoiceStudioWindow]::SetForegroundWindow($_.MainWindowHandle) | Out-Null }
}
`;
  return new Promise((resolve) => {
    execFile(powershellPath(env), ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShell(script)], { windowsHide: true }, () => resolve());
  });
}

function voiceStudioRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('tasklist.exe', ['/FI', 'IMAGENAME eq VoiceStudio.exe', '/NH'], { windowsHide: true }, (error, stdout) => resolve(!error && /VoiceStudio\.exe/iu.test(stdout)));
  });
}

function startProcess(executable: string): ChildProcess {
  const child = spawn(executable, [], { detached: true, windowsHide: true, shell: false, stdio: 'ignore' });
  child.unref();
  return child;
}

/** Starts the external VoiceStudio installation without bundling or installing it. */
export async function ensureVoiceStudioRunning(options: VoiceStudioLaunchOptions = {}): Promise<{ status: 'started' | 'already-running' | 'unavailable' | 'unsupported'; executable: string | null }> {
  if ((options.platform ?? process.platform) !== 'win32') return { status: 'unsupported', executable: null };
  const env = options.env ?? process.env;
  const executable = resolveVoiceStudioExecutable(options);
  if (!executable) return { status: 'unavailable', executable: null };
  const running = await voiceStudioRunning();
  if (!running) {
    try { startProcess(executable); } catch { return { status: 'unavailable', executable }; }
  }
  const hide = options.hide ?? true;
  if (hide) {
    void setVoiceStudioWindowsVisible(false, env);
    const timer = setTimeout(() => { void setVoiceStudioWindowsVisible(false, env); }, 2_000);
    timer.unref();
  } else {
    void setVoiceStudioWindowsVisible(true, env);
  }
  return { status: running ? 'already-running' : 'started', executable };
}

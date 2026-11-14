import { maskSecrets } from '@neuralbridge/brain';
import { execFile } from 'node:child_process';
import { mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { NeuraScreen, NeuraScreenCapture, NeuraScreenContext } from '@neuralbridge/orchestrator';

const execFileAsync = promisify(execFile);

export interface DesktopScreenObserverOptions {
  consent: () => boolean;
  outputDir: string;
  capture?: (outputPath: string) => Promise<Buffer | undefined>;
  write?: (path: string, data: Buffer) => void;
  now?: () => number;
  context?: () => Promise<NeuraScreenContext | null>;
}

const POWERSHELL_CAPTURE = [
  '$ErrorActionPreference = "Stop"',
  'Add-Type -AssemblyName System.Drawing',
  'Add-Type -AssemblyName System.Windows.Forms',
  '$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen',
  '$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)',
  '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
  '$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)',
  '$bitmap.Save($env:NB_SCREEN_OUTPUT, [System.Drawing.Imaging.ImageFormat]::Png)',
  '$graphics.Dispose(); $bitmap.Dispose()',
].join('; ');

const POWERSHELL_FOREGROUND_CONTEXT = [
  '$ErrorActionPreference = "Stop"',
  "Add-Type @'\nusing System;\nusing System.Text;\nusing System.Runtime.InteropServices;\npublic static class NeuraForegroundWindow {\n  [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();\n  [DllImport(\"user32.dll\", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);\n  [DllImport(\"user32.dll\")] public static extern int GetWindowTextLength(IntPtr hWnd);\n  [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);\n}\n'@",
  '$window = [NeuraForegroundWindow]::GetForegroundWindow()',
  'if ($window -eq [IntPtr]::Zero) { exit 0 }',
  '$length = [NeuraForegroundWindow]::GetWindowTextLength($window)',
  '$titleBuffer = New-Object System.Text.StringBuilder([Math]::Max(1, $length + 1))',
  '[NeuraForegroundWindow]::GetWindowText($window, $titleBuffer, $titleBuffer.Capacity) | Out-Null',
  '[uint32]$processId = 0',
  '[NeuraForegroundWindow]::GetWindowThreadProcessId($window, [ref]$processId) | Out-Null',
  '$processName = ""',
  'try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch { }',
  '$title = $titleBuffer.ToString()',
  'if ($title.Length -gt 200) { $title = $title.Substring(0, 200) }',
  'if ($processName.Length -gt 120) { $processName = $processName.Substring(0, 120) }',
  '$handle = $window.ToInt64().ToString()',
  '$focusedElement = $null',
  'try { Add-Type -AssemblyName UIAutomationClient; $focused = [System.Windows.Automation.AutomationElement]::FocusedElement; if ($null -ne $focused) { $current = $focused.Current; $automationId = [string]$current.AutomationId; $name = [string]$current.Name; $controlType = [string]$current.ControlType.ProgrammaticName; if ($automationId.Length -gt 200) { $automationId = $automationId.Substring(0, 200) }; if ($name.Length -gt 500) { $name = $name.Substring(0, 500) }; if ($controlType.Length -gt 200) { $controlType = $controlType.Substring(0, 200) }; $editable = (($controlType -match "Edit|Document") -and $current.IsKeyboardFocusable -and -not $current.IsPassword); $focusedElement = [pscustomobject]@{ automationId = $automationId; name = $name; controlType = $controlType; editable = $editable; password = [bool]$current.IsPassword } } } catch { $focusedElement = $null }',
  '[pscustomobject]@{ application = $processName; windowTitle = $title; windowHandle = $handle; focusedElement = $focusedElement } | ConvertTo-Json -Compress -Depth 5',
].join('; ');

async function captureWindowsDesktop(outputPath: string): Promise<undefined> {
  await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_CAPTURE], {
    windowsHide: true,
    env: { ...process.env, NB_SCREEN_OUTPUT: outputPath },
    timeout: 10_000,
    maxBuffer: 2_000_000,
  });
  return undefined;
}

async function foregroundWindowContext(): Promise<NeuraScreenContext | null> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_FOREGROUND_CONTEXT], {
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: 100_000,
    });
    const parsed = JSON.parse(stdout.trim()) as { application?: unknown; windowTitle?: unknown; windowHandle?: unknown; focusedElement?: unknown };
    const application = typeof parsed.application === 'string' ? parsed.application.trim() : '';
    const windowTitle = typeof parsed.windowTitle === 'string' ? parsed.windowTitle.trim() : '';
    const windowHandle = typeof parsed.windowHandle === 'string' && /^\d{1,20}$/u.test(parsed.windowHandle) ? parsed.windowHandle : undefined;
    const rawFocused = typeof parsed.focusedElement === 'object' && parsed.focusedElement !== null ? parsed.focusedElement as Record<string, unknown> : null;
    const clip = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
    const focusedElement = rawFocused ? { ...(clip(rawFocused.automationId, 200) ? { automationId: clip(rawFocused.automationId, 200) } : {}), ...(clip(rawFocused.name, 500) ? { name: clip(rawFocused.name, 500) } : {}), ...(clip(rawFocused.controlType, 200) ? { controlType: clip(rawFocused.controlType, 200) } : {}), editable: rawFocused.editable === true, password: rawFocused.password === true } : undefined;
    if (!application && !windowTitle) return null;
    return { application: application || 'Aplicativo desconhecido', windowTitle: windowTitle || 'Janela sem título', confidence: application && windowTitle && windowHandle ? 'high' : 'low', ...(windowHandle ? { windowHandle } : {}), ...(focusedElement ? { focusedElement } : {}) };
  } catch {
    return null;
  }
}

/** Well above a 4K PNG: anything larger is not a screenshot worth sending to an agent. */
const MAX_SCREEN_BYTES = 20_000_000;

/** Window titles and field names can hold a token, and they travel to the agent as text. */
function redacted(context: NeuraScreenContext | null): NeuraScreenContext | null {
  if (!context) return null;
  const name = context.focusedElement?.name;
  return { ...context, windowTitle: maskSecrets(context.windowTitle), ...(context.focusedElement ? { focusedElement: { ...context.focusedElement, ...(name ? { name: maskSecrets(name) } : {}) } } : {}) };
}

/** Consent-gated screen capture seam. It returns a bounded local file for a vision-capable agent. */
export class DesktopScreenObserver implements NeuraScreen {
  private readonly captureBackend: (outputPath: string) => Promise<Buffer | undefined>;
  private readonly writeFile: (path: string, data: Buffer) => void;
  private readonly now: () => number;
  private readonly contextProvider: () => Promise<NeuraScreenContext | null>;

  constructor(private readonly options: DesktopScreenObserverOptions) {
    this.captureBackend = options.capture ?? captureWindowsDesktop;
    this.writeFile = options.write ?? ((path, data) => writeFileSync(path, data, { mode: 0o600 }));
    this.now = options.now ?? Date.now;
    this.contextProvider = options.context ?? foregroundWindowContext;
  }

  async capture(): Promise<NeuraScreenCapture> {
    if (!this.options.consent()) throw new Error('screen_consent_required');
    const context = redacted(await this.contextProvider().catch(() => null));
    mkdirSync(this.options.outputDir, { recursive: true });
    const path = join(this.options.outputDir, `neura-screen-${this.now()}.png`);
    const captured = await this.captureBackend(path);
    if (captured) this.writeFile(path, captured);
    const size = captured?.byteLength ?? statSync(path).size;
    if (size > MAX_SCREEN_BYTES) {
      try { unlinkSync(path); } catch { /* already removed */ }
      throw new Error('screen_capture_too_large');
    }
    // A single capture is disposable context, not a user-visible recording.
    const cleanup = setTimeout(() => { try { unlinkSync(path); } catch { /* already removed */ } }, 60_000);
    cleanup.unref();
    return { path, name: path.split(/[\\/]/u).pop() ?? 'screen.png', mime: 'image/png', size, ...(context ? { context } : {}) };
  }
}

export function createDesktopScreenObserver(options: Omit<DesktopScreenObserverOptions, 'capture' | 'write'>): DesktopScreenObserver {
  return new DesktopScreenObserver(options);
}

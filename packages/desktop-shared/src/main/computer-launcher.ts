import { spawn } from 'node:child_process';

export interface DesktopShell { openExternal(url: string): Promise<void>; typeText?(text: string, options?: { targetWindow?: string; targetElement?: { automationId?: string | undefined; name?: string | undefined; controlType?: string | undefined } }): Promise<void>; }

const APPLICATION_URLS = {
  spotify: 'spotify:',
  teams: 'msteams:',
  settings: 'ms-settings:',
  notepad: 'notepad:',
  calculator: 'calculator:',
} as const;

export type AllowedDesktopApplication = keyof typeof APPLICATION_URLS;

/** Sends only Ctrl+V; the text itself stays in Electron's clipboard and never enters a shell command. */
export function sendCtrlV(options: { restorePreviousWindow?: boolean; targetWindow?: string; targetElement?: { automationId?: string | undefined; name?: string | undefined; controlType?: string | undefined } } = {}): Promise<void> {
  if (process.platform !== 'win32') return Promise.reject(new Error('blocked: text input is supported on Windows only'));
  if (options.targetWindow !== undefined && (!/^\d{1,20}$/u.test(options.targetWindow) || BigInt(options.targetWindow) > 9_223_372_036_854_775_807n)) return Promise.reject(new Error('blocked: invalid target window'));
  const restore = options.restorePreviousWindow === true;
  const targetWindow = options.targetWindow;
  const targetElement = options.targetElement && (options.targetElement.automationId || options.targetElement.name) ? options.targetElement : undefined;
  if (targetElement && targetWindow === undefined) return Promise.reject(new Error('blocked: target window required for UI Automation field'));
  const encodedElement = targetElement ? Buffer.from(JSON.stringify(targetElement), 'utf8').toString('base64') : null;
  const elementFocus = encodedElement ? `; Add-Type -AssemblyName UIAutomationClient; $targetSpec = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedElement}')) | ConvertFrom-Json; $root = [System.Windows.Automation.AutomationElement]::FromHandle($target); $automationId = [string]$targetSpec.automationId; $name = [string]$targetSpec.name; $condition = $null; if($automationId){$condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$automationId)} elseif($name){$condition=[System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty,$name)} else {throw 'target text field has no identifier'}; $matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$condition); $element = $null; foreach($candidate in $matches){if((-not $targetSpec.controlType) -or $candidate.Current.ControlType.ProgrammaticName -eq [string]$targetSpec.controlType){$element=$candidate;break}}; if($null -eq $element){throw 'target text field is no longer available'}; if($element.Current.IsPassword -or -not $element.Current.IsKeyboardFocusable -or $element.Current.ControlType.ProgrammaticName -notmatch 'Edit|Document'){throw 'target is not an editable chat field'}; $element.SetFocus(); Start-Sleep -Milliseconds 80` : '';
  const script = targetWindow !== undefined
    ? `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'; $target=[IntPtr]::new([long]::Parse('${targetWindow}')); if(-not [W]::IsWindow($target)){throw 'target window is no longer available'}; if(-not [W]::SetForegroundWindow($target)){throw 'target window could not be focused'}; Start-Sleep -Milliseconds 120; if([W]::GetForegroundWindow() -ne $target){throw 'target window focus was not confirmed'}${elementFocus}; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')`
    : restore
    ? "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class W { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); }'; $current=[W]::GetForegroundWindow(); $target=[W]::GetWindow($current,2); if($target -ne [IntPtr]::Zero){[W]::SetForegroundWindow($target); Start-Sleep -Milliseconds 120}; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
    : "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')";
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('text input timed out')); }, 3_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`text input failed: ${code ?? 'unknown'}`)); });
  });
}

/** Native launcher for the broker's fixed application allowlist; it never accepts a URL from the model. */
export function createDesktopApplicationLauncher(shell: DesktopShell): { launch(application: AllowedDesktopApplication): Promise<void>; typeText?(text: string, options?: { targetWindow?: string; targetElement?: { automationId?: string | undefined; name?: string | undefined; controlType?: string | undefined } }): Promise<void> } {
  return { launch: async (application) => shell.openExternal(APPLICATION_URLS[application]), ...(shell.typeText ? { typeText: shell.typeText.bind(shell) } : {}) };
}

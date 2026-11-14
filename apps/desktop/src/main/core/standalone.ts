import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * CORE-08: the Singularity Core independent of the window (ADR CORE-01 §2.1, mode "independente"). Opt-in.
 * - A logon task of the current user (never a Windows service, never elevated) runs the app executable with
 *   `--singularity-core`; that launcher starts the Core as plain Node (ELECTRON_RUN_AS_NODE=1, detached, hidden) only if
 *   no live Core owns the data folder, and exits. The task repeats every 5 minutes, so a crashed Core comes back.
 * - The desktop attaches to it (token file below) and no longer stops it on quit.
 */

export const STANDALONE_FLAG = '--singularity-core';
export const DEFAULT_TASK_NAME = 'Singularity Core';
export const TOKEN_FILE = 'core-desktop.token';
const SETTINGS_FILE = 'core-standalone.json';

export interface StandaloneSettings { enabled: boolean }

export function readStandalone(dataDir: string): StandaloneSettings {
  try { return { enabled: (JSON.parse(readFileSync(join(dataDir, SETTINGS_FILE), 'utf8')) as { enabled?: unknown }).enabled === true }; } catch { return { enabled: false }; }
}
export function writeStandalone(dataDir: string, settings: StandaloneSettings): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, SETTINGS_FILE), JSON.stringify(settings));
}

function liveCore(dataDir: string): boolean {
  try {
    const lock = JSON.parse(readFileSync(join(dataDir, 'core.lock'), 'utf8')) as { pid?: number };
    if (!lock.pid) return false;
    process.kill(lock.pid, 0);
    return true;
  } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Starts a standalone Core unless one is alive. `waitPid`: an embedded Core still shutting down, to hand over to. */
export function launchStandaloneCore(options: { execPath: string; script: string; dataDir: string; version: string; waitPid?: number }): boolean {
  if (options.waitPid === undefined && liveCore(options.dataDir)) return false;
  const child = spawn(options.execPath, [options.script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: options.dataDir, NB_CORE_MODE: 'standalone', NB_CORE_ALLOW_STANDALONE: '1', NB_CORE_VERSION: options.version, ...(options.waitPid ? { NB_CORE_WAIT_PID: String(options.waitPid) } : {}) },
  });
  child.unref();
  return true;
}

export function readDesktopToken(dataDir: string): string | null {
  try {
    const token = readFileSync(join(dataDir, TOKEN_FILE), 'utf8').trim();
    return /^[0-9a-f]{64}$/.test(token) ? token : null;
  } catch { return null; }
}

// ── Logon task (Task Scheduler, current user, least privilege) ─────────────────────────────────────────────────
const xmlEscape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function logonTaskXml(options: { userId: string; command: string; args: readonly string[] }): string {
  const args = options.args.map((arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)).join(' ');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Mantém o Singularity Core ativo com a janela fechada (opcional, desligável em Configurações).</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xmlEscape(options.userId)}</UserId>
      <Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>${xmlEscape(options.userId)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
    <Hidden>true</Hidden>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xmlEscape(options.command)}</Command><Arguments>${xmlEscape(args)}</Arguments></Exec></Actions>
</Task>
`;
}

export type SchtasksExec = (args: readonly string[]) => Promise<{ code: number; stdout: string }>;

/** schtasks.exe by absolute path under System32 (never through PATH). */
export function defaultSchtasks(env: NodeJS.ProcessEnv = process.env): SchtasksExec {
  const binary = join(env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'schtasks.exe');
  return (args) => new Promise((resolve) => {
    execFile(binary, [...args], { windowsHide: true, timeout: 20_000 }, (error, stdout) => resolve({ code: error ? 1 : 0, stdout: String(stdout) }));
  });
}

export class LogonTask {
  constructor(private readonly exec: SchtasksExec, readonly name: string, private readonly tempDir: string) {}

  async registered(): Promise<boolean> {
    return (await this.exec(['/Query', '/TN', this.name])).code === 0;
  }

  async register(options: { userId: string; command: string; args: readonly string[] }): Promise<void> {
    mkdirSync(this.tempDir, { recursive: true });
    const file = join(this.tempDir, `core-task-${process.pid}.xml`);
    // Task Scheduler expects UTF-16 LE with BOM for an XML declared as UTF-16.
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(logonTaskXml(options), 'utf16le')]));
    try {
      const result = await this.exec(['/Create', '/TN', this.name, '/XML', file, '/F']);
      if (result.code !== 0) throw new Error('failed: O Agendador de Tarefas recusou registrar o Core.');
    } finally { rmSync(file, { force: true }); }
  }

  async unregister(): Promise<void> {
    if (await this.registered()) await this.exec(['/Delete', '/TN', this.name, '/F']);
  }

  async run(): Promise<boolean> {
    return (await this.exec(['/Run', '/TN', this.name])).code === 0;
  }
}

export function currentUserId(env: NodeJS.ProcessEnv = process.env): string {
  const user = env['USERNAME'] ?? '';
  const domain = env['USERDOMAIN'];
  return domain ? `${domain}\\${user}` : user;
}


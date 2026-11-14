import { accessSync, constants, openSync, closeSync, unlinkSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

export type ShellAvailability = { powershell: boolean; cmd: boolean; bash: boolean };
export type WorkspacePreflight = { ok: boolean; cwd: string; writable: boolean; shells: ShellAvailability; reason: string | null };

function canRun(command: string): boolean {
  try { accessSync(command, constants.F_OK); return true; } catch { return false; }
}

function shellAvailability(): ShellAvailability {
  const path = process.env['PATH'] ?? '';
  const entries = path.split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  const found = (names: string[]) => names.some((name) => entries.some((entry) => canRun(join(entry, name))));
  return {
    powershell: process.platform === 'win32' && found(['powershell.exe', 'pwsh.exe']),
    cmd: process.platform === 'win32' && found(['cmd.exe']),
    bash: found(process.platform === 'win32' ? ['bash.exe', 'bash'] : ['bash']),
  };
}

/** Checks only the selected workspace and removes its uniquely named probe immediately. */
export function checkWorkspacePreflight(cwd: string): WorkspacePreflight {
  const resolved = resolve(cwd);
  const shells = shellAvailability();
  try {
    if (!statSync(resolved).isDirectory()) return { ok: false, cwd: resolved, writable: false, shells, reason: 'O workspace selecionado não é uma pasta.' };
    accessSync(resolved, constants.R_OK | constants.W_OK | constants.X_OK);
    const probe = join(resolved, `.neuralbridge-write-check-${randomUUID()}`);
    const fd = openSync(probe, 'wx');
    closeSync(fd);
    unlinkSync(probe);
    return { ok: true, cwd: resolved, writable: true, shells, reason: null };
  } catch (error) {
    return { ok: false, cwd: resolved, writable: false, shells, reason: `O workspace não permite escrita pelo processo atual: ${error instanceof Error ? error.message : String(error)}` };
  }
}

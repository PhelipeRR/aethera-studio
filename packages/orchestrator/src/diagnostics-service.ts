import { access, statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export type DiagnosticHealth = 'ok' | 'warning' | 'error' | 'unknown';
export interface DiagnosticCheck { id: string; label: string; health: DiagnosticHealth; summary: string; remediation: string | null; details?: Record<string, unknown>; }
export interface DiagnosticsSnapshot { schemaVersion: 1; generatedAt: string; checks: DiagnosticCheck[]; telemetry: 'disabled'; }
export interface DiagnosticsOptions {
  database: { ok: boolean; detail?: string; remediation?: string };
  migrations: { applied: number; latest: string | null; expected: number; failed?: string | null };
  dataPath: string;
  cliCommands?: Record<string, string>;
  /** Agent CLIs as detected by the app's own adapters (they know the Windows shims and auth checks). */
  agents?: ReadonlyArray<{ id: string; label: string; installed: boolean; authenticated: boolean | null }>;
  credentials?: Record<string, boolean>;
  ffmpeg?: string;
  voicestudio?: { ok: boolean; detail?: string };
  diskMinimumBytes?: number;
}

async function commandCheck(id: string, label: string, command: string): Promise<DiagnosticCheck> {
  try {
    const result = await exec(command, ['-version'], { windowsHide: true, timeout: 8_000, maxBuffer: 64 * 1024 });
    return { id, label, health: 'ok', summary: (result.stdout || result.stderr).split(/\r?\n/u)[0] ?? 'disponível', remediation: null };
  } catch (error) {
    return { id, label, health: 'warning', summary: 'indisponível', remediation: `Instale ou configure ${label} antes de usar este recurso.`, details: { error: error instanceof Error ? error.name : 'unavailable' } };
  }
}

export async function collectDiagnostics(options: DiagnosticsOptions): Promise<DiagnosticsSnapshot> {
  const checks: DiagnosticCheck[] = [];
  checks.push(options.database.ok
    ? { id: 'database', label: 'Banco SQLite', health: 'ok', summary: options.database.detail ?? 'disponível', remediation: null }
    : { id: 'database', label: 'Banco SQLite', health: 'error', summary: options.database.detail ?? 'indisponível', remediation: options.database.remediation ?? 'Restaure um backup ou exporte os diagnósticos.' });
  const migrationHealth = options.migrations.failed ? 'error' : options.migrations.applied < options.migrations.expected ? 'warning' : 'ok';
  checks.push({ id: 'migrations', label: 'Migrações', health: migrationHealth, summary: options.migrations.failed ?? `${options.migrations.applied}/${options.migrations.expected} aplicadas`, remediation: migrationHealth === 'ok' ? null : 'Feche outras instâncias, faça backup e reabra o aplicativo; não apague o banco.' });
  try {
    const disk = await statfs(options.dataPath);
    const free = Number(disk.bavail) * Number(disk.bsize);
    const low = free < (options.diskMinimumBytes ?? 512 * 1024 * 1024);
    checks.push({ id: 'disk', label: 'Espaço em disco', health: low ? 'warning' : 'ok', summary: `${free} bytes livres`, remediation: low ? 'Libere espaço antes de executar renderizações ou migrações.' : null, details: { freeBytes: free } });
  } catch { checks.push({ id: 'disk', label: 'Espaço em disco', health: 'unknown', summary: 'não foi possível consultar', remediation: 'Verifique manualmente o espaço disponível.' }); }
  for (const [id, command] of Object.entries(options.cliCommands ?? {})) checks.push(await commandCheck(id, id, command));
  for (const agent of options.agents ?? []) {
    checks.push(!agent.installed
      ? { id: `agent:${agent.id}`, label: agent.label, health: 'error', summary: 'CLI não encontrada', remediation: `Instale a CLI do ${agent.label}, reabra o NeuralBridge e confira em Agentes. Tarefas com outro agente continuam funcionando.` }
      : agent.authenticated === false
        ? { id: `agent:${agent.id}`, label: agent.label, health: 'warning', summary: 'CLI instalada, sem login', remediation: `Faça login na CLI do ${agent.label} no terminal e atualize o status em Agentes.` }
        : { id: `agent:${agent.id}`, label: agent.label, health: 'ok', summary: agent.authenticated === null ? 'instalada (login não verificado)' : 'instalada e autenticada', remediation: null });
  }
  for (const [id, configured] of Object.entries(options.credentials ?? {})) checks.push({ id: `credential:${id}`, label: `Credencial ${id}`, health: configured ? 'ok' : 'warning', summary: configured ? 'configurada' : 'não configurada', remediation: configured ? null : `Configure ${id} em Configurações; o valor não é incluído no diagnóstico.` });
  if (options.ffmpeg) checks.push(await commandCheck('ffmpeg', 'FFmpeg', options.ffmpeg));
  if (options.voicestudio) checks.push({ id: 'voicestudio', label: 'VoiceStudio', health: options.voicestudio.ok ? 'ok' : 'warning', summary: options.voicestudio.detail ?? (options.voicestudio.ok ? 'disponível' : 'indisponível'), remediation: options.voicestudio.ok ? null : 'Inicie o VoiceStudio local ou selecione outro provider.' });
  await access(options.dataPath).catch(() => checks.push({ id: 'data-path', label: 'Diretório de dados', health: 'error', summary: 'não acessível', remediation: 'Verifique permissões do diretório de dados.' }));
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), checks, telemetry: 'disabled' };
}

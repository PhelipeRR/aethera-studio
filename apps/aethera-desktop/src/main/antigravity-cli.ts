import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ANTIGRAVITY_TESTED_VERSION = '1.5.8';

export interface AntigravityEngineStatus {
  id: 'antigravity';
  label: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  testedVersion: string;
  authenticated: boolean | null;
  authMethod: string | null;
  features: string[];
  warnings: string[];
  problems: string[];
  checkedAt: string;
}

export function findAntigravityCli(env: Record<string, string | undefined> = process.env): string | null {
  const override = env['NB_ANTIGRAVITY_CLI']?.trim();
  if (override && isAbsolute(override) && existsSync(override)) {
    return override;
  }

  const exeName = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const pathValue = env['PATH'] ?? env['Path'] ?? '';
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, exeName);
    if (existsSync(candidate)) return candidate;
  }

  const fallbacks =
    process.platform === 'win32'
      ? [
          join(env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe'),
          join(homedir(), 'AppData', 'Local', 'Programs', 'Antigravity', 'bin', 'agy.exe'),
        ]
      : [join(homedir(), '.local', 'bin', 'agy'), '/usr/local/bin/agy'];

  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

let cachedStatus: { at: number; status: AntigravityEngineStatus } | null = null;

export async function detectAntigravityCli(options: {
  refresh?: boolean;
  env?: Record<string, string | undefined>;
} = {}): Promise<AntigravityEngineStatus> {
  if (!options.refresh && cachedStatus && Date.now() - cachedStatus.at < 60_000) {
    return cachedStatus.status;
  }

  const env = options.env ?? process.env;
  const cliPath = findAntigravityCli(env);
  const checkedAt = new Date().toISOString();

  if (!cliPath) {
    const status: AntigravityEngineStatus = {
      id: 'antigravity',
      label: 'Antigravity CLI (agy)',
      installed: false,
      path: null,
      version: null,
      testedVersion: ANTIGRAVITY_TESTED_VERSION,
      authenticated: null,
      authMethod: null,
      features: [],
      warnings: [],
      problems: ['Antigravity CLI (agy) não encontrado no PATH ou em %LOCALAPPDATA%\\agy\\bin.'],
      checkedAt,
    };
    cachedStatus = { at: Date.now(), status };
    return status;
  }

  try {
    const winCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cliPath);
    const [versionOut, helpOut] = await Promise.all([
      execFileAsync(cliPath, ['--version'], { timeout: 10_000, windowsHide: true, shell: winCmd, env }),
      execFileAsync(cliPath, ['--help'], { timeout: 10_000, windowsHide: true, shell: winCmd, env }),
    ]);

    const version = /(\d+\.\d+\.\d+)/.exec(versionOut.stdout)?.[1] ?? null;
    const helpText = `${helpOut.stdout}\n${helpOut.stderr}`;
    const features: string[] = [];
    if (helpText.includes('--print')) features.push('print');
    if (helpText.includes('--output-format')) features.push('json');
    if (helpText.includes('--mode')) features.push('mode');
    if (helpText.includes('--model')) features.push('model');

    const status: AntigravityEngineStatus = {
      id: 'antigravity',
      label: 'Antigravity CLI (agy)',
      installed: true,
      path: cliPath,
      version,
      testedVersion: ANTIGRAVITY_TESTED_VERSION,
      authenticated: true,
      authMethod: 'cli',
      features,
      warnings: [],
      problems: [],
      checkedAt,
    };
    cachedStatus = { at: Date.now(), status };
    return status;
  } catch (error) {
    const status: AntigravityEngineStatus = {
      id: 'antigravity',
      label: 'Antigravity CLI (agy)',
      installed: true,
      path: cliPath,
      version: null,
      testedVersion: ANTIGRAVITY_TESTED_VERSION,
      authenticated: null,
      authMethod: null,
      features: [],
      warnings: [],
      problems: [
        `Falha ao inspecionar Antigravity CLI: ${error instanceof Error ? error.message : String(error)}`,
      ],
      checkedAt,
    };
    cachedStatus = { at: Date.now(), status };
    return status;
  }
}

export async function runAntigravityPrompt(options: {
  prompt: string;
  cwd?: string;
  mode?: 'read-only' | 'edit';
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
}): Promise<{ ok: boolean; output: string; error?: string; model?: string }> {
  const env = options.env ?? process.env;
  const cliPath = findAntigravityCli(env);
  if (!cliPath) {
    return { ok: false, output: '', error: 'Antigravity CLI (agy) não encontrado.' };
  }

  const args = [
    '--output-format',
    'json',
    '--mode',
    options.mode === 'edit' ? 'accept-edits' : 'plan',
  ];
  if (options.model) {
    args.push('--model', options.model);
  }
  args.push('--print', options.prompt);

  try {
    const winCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cliPath);
    const { stdout, stderr } = await execFileAsync(cliPath, args, {
      cwd: options.cwd ?? process.cwd(),
      timeout: options.timeoutMs ?? 90_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      shell: winCmd,
      ...(options.signal ? { signal: options.signal } : {}),
      env,
    });
    const raw = stdout.trim();
    if (!raw) {
      return { ok: false, output: '', error: stderr.trim() || 'Antigravity CLI retornou saída vazia.' };
    }
    try {
      const parsed = JSON.parse(raw) as { status?: string; response?: string; error?: string; model?: string };
      if (parsed.status && parsed.status !== 'SUCCESS') {
        return { ok: false, output: parsed.response ?? '', error: parsed.error ?? `Status ${parsed.status}` };
      }
      return {
        ok: true,
        output: (parsed.response ?? raw).trim(),
        ...(parsed.model ? { model: parsed.model } : {}),
      };
    } catch {
      return { ok: true, output: raw };
    }
  } catch (error) {
    return {
      ok: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

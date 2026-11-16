import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_EDITORIAL_EXECUTION_POLICY, type AgentExecutionPolicy } from './production-agent-providers.js';

/**
 * User-facing settings of long agent runs (Configurações → Agentes e IA). Stored in minutes, which is how people
 * think about them; converted to an `AgentExecutionPolicy` for the runner.
 */
export interface AgentExecutionSettings {
  /** Window without real progress that confirms a hang. Default 10. */
  inactivityTimeoutMinutes: number;
  /** Optional ceiling for editorial runs (research, script, planning). `null` = disabled (default). */
  editorialMaxDurationMinutes: number | null;
}

export const AGENT_EXECUTION_LIMITS = {
  inactivityMinutes: { min: 1, max: 180 },
  maxDurationMinutes: { min: 5, max: 24 * 60 },
} as const;

export const DEFAULT_AGENT_EXECUTION_SETTINGS: AgentExecutionSettings = {
  inactivityTimeoutMinutes: DEFAULT_EDITORIAL_EXECUTION_POLICY.inactivityTimeoutMs / 60_000,
  editorialMaxDurationMinutes: null,
};

export const AGENT_EXECUTION_IPC = {
  get: 'agent-execution:get-settings',
  save: 'agent-execution:save-settings',
  listRuns: 'agent-execution:list-runs',
  stopRun: 'agent-execution:stop-run',
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Validates untrusted input (from the renderer or a hand-edited file). Throws on values that make no sense. */
export function normalizeAgentExecutionSettings(
  input: unknown,
  base: AgentExecutionSettings = DEFAULT_AGENT_EXECUTION_SETTINGS,
): AgentExecutionSettings {
  if (!input || typeof input !== 'object') return { ...base };
  const raw = input as Record<string, unknown>;
  const next: AgentExecutionSettings = { ...base };
  if ('inactivityTimeoutMinutes' in raw) {
    const value = Number(raw['inactivityTimeoutMinutes']);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Timeout de inatividade deve ser um número positivo de minutos.');
    const { min, max } = AGENT_EXECUTION_LIMITS.inactivityMinutes;
    next.inactivityTimeoutMinutes = clamp(value, min, max);
  }
  if ('editorialMaxDurationMinutes' in raw) {
    const value = raw['editorialMaxDurationMinutes'];
    if (value === null || value === '' || value === 0 || value === undefined) {
      next.editorialMaxDurationMinutes = null;
    } else {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) throw new Error('Limite máximo deve ser vazio (desativado) ou um número de minutos.');
      const { min, max } = AGENT_EXECUTION_LIMITS.maxDurationMinutes;
      next.editorialMaxDurationMinutes = clamp(numeric, min, max);
    }
  }
  return next;
}

export function toExecutionPolicy(settings: AgentExecutionSettings): AgentExecutionPolicy {
  return {
    ...DEFAULT_EDITORIAL_EXECUTION_POLICY,
    inactivityTimeoutMs: Math.round(settings.inactivityTimeoutMinutes * 60_000),
    maxDurationMs:
      settings.editorialMaxDurationMinutes === null ? null : Math.round(settings.editorialMaxDurationMinutes * 60_000),
  };
}

export class AgentExecutionSettingsStore {
  private cached: AgentExecutionSettings | null = null;

  constructor(private readonly file: string) {}

  load(): AgentExecutionSettings {
    if (this.cached) return { ...this.cached };
    let settings = { ...DEFAULT_AGENT_EXECUTION_SETTINGS };
    if (existsSync(this.file)) {
      try {
        settings = normalizeAgentExecutionSettings(JSON.parse(readFileSync(this.file, 'utf8')));
      } catch {
        // corrupted file: defaults until the user saves again
      }
    }
    this.cached = settings;
    return { ...settings };
  }

  save(input: unknown): AgentExecutionSettings {
    const next = normalizeAgentExecutionSettings(input, this.load());
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2), 'utf8');
    this.cached = next;
    return { ...next };
  }

  policy(): AgentExecutionPolicy {
    return toExecutionPolicy(this.load());
  }
}

import type { AgentAdapter } from '@neuralbridge/agents';
import type { AgentLimitWindow } from '@neuralbridge/shared';

const TIMEOUT_MS = 45_000;
export const VIDEO_LIMIT_PERCENT = 95;

export type VideoLimitStatus = {
  /** False when Claude Code cannot run at all. */
  available: boolean;
  blocked: boolean;
  reason: string | null;
  windows: Array<{ id: string; percent: number; resetsAt: string | null }>;
};

export type LimitAgent = 'claude' | 'codex';
const AGENT = { claude: { cli: 'Claude Code', short: 'Claude' }, codex: { cli: 'Codex CLI', short: 'Codex' } } as const;

export function assessVideoLimits(available: boolean, windows: readonly AgentLimitWindow[] | null, agent: LimitAgent = 'claude'): VideoLimitStatus {
  const shown = (windows ?? []).map(({ id, utilization, resetsAt }) => ({ id, percent: Math.round(utilization * 100), resetsAt }));
  if (!available) return { available, blocked: true, reason: `O Aethera usa o ${AGENT[agent].cli}. Confira a instalação e o login em Agentes.`, windows: [] };
  const full = (windows ?? []).find((item) => item.status === 'rejected' || item.utilization * 100 >= VIDEO_LIMIT_PERCENT);
  if (!full) return { available, blocked: false, reason: null, windows: shown };
  const label = full.id === 'seven_day' ? 'semanal' : 'da sessão';
  return { available, blocked: true, reason: `O limite ${label} do ${AGENT[agent].short} está em ${Math.round(full.utilization * 100)}%. Espere reiniciar para começar.`, windows: shown };
}

/**
 * Each CLI reports usage with a reply (Claude in its stream, Codex in its session record, read by the adapter), so a
 * minimal run stops as soon as the numbers arrive. Claude runs on its smallest model; Codex keeps the user's default.
 */
export async function readVideoLimits(adapter: AgentAdapter, cwd: string): Promise<VideoLimitStatus> {
  const agent: LimitAgent = adapter.id === 'codex' ? 'codex' : 'claude';
  const status = await adapter.detect();
  if (!status.installed || status.authenticated === false || status.problems.length > 0) return assessVideoLimits(false, null, agent);
  const controller = new AbortController();
  let windows: AgentLimitWindow[] | null = null;
  const tuning = agent === 'claude' ? { model: 'haiku', allowedTools: ['Read'] } : {};
  try {
    for await (const event of adapter.run({ prompt: '<limite> Responda só: ok', cwd, mode: 'read-only', timeoutMs: TIMEOUT_MS, ...tuning }, controller.signal)) {
      if (event.kind === 'limits') {
        windows = event.windows;
        controller.abort();
      }
    }
  } catch {
    // Without numbers the page says so: an unknown limit is not a reason to block.
  }
  return assessVideoLimits(true, windows, agent);
}

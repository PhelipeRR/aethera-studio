import type { AgentRunRequest } from '@neuralbridge/agents';
import type { AgentEvent, AgentStatus } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { assessVideoLimits, readVideoLimits } from '../src/video-limits.js';
import { FakeAdapter } from './fake-adapter.js';

const window = (id: string, utilization: number, status = 'allowed') => ({ id, utilization, resetsAt: '2026-10-31T03:40:00.000Z', status });
const limits: AgentEvent = { kind: 'limits', windows: [window('five_hour', 0.9), window('seven_day', 0.93)] };

class Ready extends FakeAdapter {
  constructor(events: AgentEvent[], private readonly status: Partial<AgentStatus> = {}, id: 'claude' | 'codex' = 'claude') {
    super(id, [{ events }]);
  }

  override async detect(): Promise<AgentStatus> {
    return { installed: true, authenticated: true, problems: [], ...this.status } as AgentStatus;
  }
}

describe('assessVideoLimits', () => {
  it('lets a run start below the limit and shows the percentages', () => {
    expect(assessVideoLimits(true, [window('five_hour', 0.9)])).toMatchObject({ blocked: false, windows: [{ id: 'five_hour', percent: 90 }] });
  });

  it('blocks at 95%, or when the CLI says it was rejected', () => {
    expect(assessVideoLimits(true, [window('seven_day', 0.95)])).toMatchObject({ blocked: true, reason: expect.stringContaining('semanal') as string });
    expect(assessVideoLimits(true, [window('five_hour', 0.4, 'rejected')])).toMatchObject({ blocked: true, reason: expect.stringContaining('sessão') as string });
  });

  it('blocks when Claude cannot run, but not when the numbers are unknown', () => {
    expect(assessVideoLimits(false, null)).toMatchObject({ available: false, blocked: true });
    expect(assessVideoLimits(true, null)).toMatchObject({ available: true, blocked: false, windows: [] });
  });
});

describe('readVideoLimits', () => {
  it('asks with the smallest run and stops when the numbers arrive', async () => {
    const claude = new Ready([limits]);
    await expect(readVideoLimits(claude, 'C:\\Temp')).resolves.toMatchObject({ blocked: false, windows: [{ percent: 90 }, { percent: 93 }] });
    expect(claude.requests[0] as AgentRunRequest).toMatchObject({ model: 'haiku', mode: 'read-only' });
    expect(claude.signals[0]?.aborted).toBe(true);
  });

  it('reads Codex with its own default model and names Codex in the reasons', async () => {
    const codex = new Ready([{ kind: 'limits', windows: [window('five_hour', 0.97)] }], {}, 'codex');
    await expect(readVideoLimits(codex, 'C:\\Temp')).resolves.toMatchObject({ blocked: true, reason: 'O limite da sessão do Codex está em 97%. Espere reiniciar para começar.' });
    expect(codex.requests[0]).not.toHaveProperty('model');
    expect(codex.requests[0]).not.toHaveProperty('allowedTools');
    const loggedOut = new Ready([], { authenticated: false }, 'codex');
    await expect(readVideoLimits(loggedOut, 'C:\\Temp')).resolves.toMatchObject({ reason: 'O Aethera usa o Codex CLI. Confira a instalação e o login em Agentes.' });
  });

  it('never runs when Claude is logged out', async () => {
    const claude = new Ready([limits], { authenticated: false });
    await expect(readVideoLimits(claude, 'C:\\Temp')).resolves.toMatchObject({ blocked: true });
    expect(claude.requests).toHaveLength(0);
  });
});

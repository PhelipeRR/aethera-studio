import { describe, expect, it } from 'vitest';
import {
  AetheraAgentOrchestrator,
  createAntigravityUnavailableProvider,
  type AetheraProviderId,
  type AetheraProviderTask,
  type AetheraTaskCapability,
  type IAetheraAgentProvider,
} from '../src/aethera/agent-orchestrator.js';
import { buildAutonomousPipelineDag, interpretPromptToBrief } from '../src/aethera/prompt-to-production.js';

function fakeProvider(
  id: AetheraProviderId,
  capabilities: AetheraTaskCapability[],
  opts: { available?: boolean; failOn?: Set<string> } = {},
): IAetheraAgentProvider {
  const results = new Map<string, Awaited<ReturnType<IAetheraAgentProvider['executeTask']>>>();
  return {
    id,
    getCapabilities: () => capabilities,
    getAvailability: async () => ({ available: opts.available ?? true }),
    executeTask: async (task: AetheraProviderTask) => {
      const failed = opts.failOn?.has(task.id) ?? false;
      const res = {
        taskId: task.id,
        providerId: id,
        status: (failed ? 'failed' : 'completed') as 'failed' | 'completed',
        output: failed ? '' : `${id}:${task.id}:ok`,
        costUsd: task.estimatedCostUsd ?? 0.1,
        durationMs: 5,
        ...(failed ? { error: 'simulated failure' } : {}),
      };
      results.set(task.id, res);
      return res;
    },
    getTaskStatus: (taskId) => results.get(taskId)?.status ?? 'idle',
    cancelTask: () => false,
    getResult: (taskId) => results.get(taskId) ?? null,
  };
}

describe('AETHERA-AUTO-01 orchestrator & prompt-to-production', () => {
  it('routes tasks between Claude and Codex in parallel and skips unavailable Antigravity', async () => {
    const orch = new AetheraAgentOrchestrator();
    orch.register(fakeProvider('claude', ['creative_direction', 'script', 'narrative_review', 'validation']));
    orch.register(fakeProvider('codex', ['remotion_composition', 'automation', 'technical_fix', 'execution']));
    orch.register(createAntigravityUnavailableProvider());

    const brief = interpretPromptToBrief('Crie um vídeo cinematográfico de 12 minutos sobre os 10 chefes mais difíceis de Elden Ring');
    expect(brief.targetDurationSeconds).toBe(720);
    expect(brief.productionType).toBe('top_list');
    expect(brief.format.id).toBe('youtube-long');

    const dag = buildAutonomousPipelineDag(brief, 'c:/dev/neuralbridge-studio');
    const summary = await orch.runDag(dag);

    expect(summary.status).toBe('completed');
    expect(summary.results['script']?.providerId).toBe('claude');
    expect(summary.results['render']?.providerId).toBe('codex');
    expect(Object.keys(summary.results)).toHaveLength(12);
  });

  it('falls back to secondary provider when preferred provider fails', async () => {
    const orch = new AetheraAgentOrchestrator();
    orch.register(fakeProvider('claude', ['script'], { failOn: new Set(['t1']) }));
    orch.register(fakeProvider('codex', ['script', 'automation']));

    const summary = await orch.runDag([
      { id: 't1', capability: 'script', preferredProvider: 'claude', prompt: 'teste', cwd: '.', mode: 'read-only' },
    ]);

    expect(summary.status).toBe('completed');
    expect(summary.results['t1']?.providerId).toBe('codex');
  });

  it('stops when budget limit is exceeded', async () => {
    const orch = new AetheraAgentOrchestrator();
    orch.register(fakeProvider('claude', ['script']));

    const summary = await orch.runDag(
      [{ id: 't1', capability: 'script', prompt: 'caro', cwd: '.', mode: 'read-only', estimatedCostUsd: 50 }],
      { budgetLimitUsd: 5 },
    );

    expect(summary.status).toBe('budget_exceeded');
  });

  it('RF-07: completes full 12-stage DAG with only Claude, only Codex, or only Antigravity', async () => {
    const brief = interpretPromptToBrief('Crie um vídeo de 5 minutos sobre jogos indie');
    const dag = buildAutonomousPipelineDag(brief, 'c:/dev/neuralbridge-studio');

    for (const soloId of ['claude', 'codex', 'antigravity'] as const) {
      const orch = new AetheraAgentOrchestrator();
      orch.register(fakeProvider(soloId, ['execution']));
      const summary = await orch.runDag(dag);
      expect(summary.status).toBe('completed');
      expect(Object.keys(summary.results)).toHaveLength(12);
      expect(Object.values(summary.results).every((r) => r.providerId === soloId)).toBe(true);
    }
  });

  it('RF-07: transfers mid-production on agent failure without losing completed artifacts', async () => {
    const orch = new AetheraAgentOrchestrator();
    orch.register(fakeProvider('claude', ['creative_direction', 'script'], { failOn: new Set(['storyboard']) }));
    orch.register(fakeProvider('codex', ['execution', 'automation', 'remotion_composition']));

    const brief = interpretPromptToBrief('Crie um vídeo de 3 minutos sobre RPGs');
    const dag = buildAutonomousPipelineDag(brief, 'c:/dev/neuralbridge-studio');
    const transfers: string[] = [];

    const summary = await orch.runDag(dag, {
      onAgentTransfer: (ev) => transfers.push(`${ev.taskId}:${ev.fromProvider}->${ev.toProvider}`),
    });

    expect(summary.status).toBe('completed');
    expect(summary.results['interpretation']?.providerId).toBe('claude');
    expect(summary.results['storyboard']?.providerId).toBe('codex');
    expect(transfers).toContain('storyboard:claude->codex');
  });

  it('RF-07: pauses with checkpoint when 0 agents are available and resumes cleanly', async () => {
    let claudeAvailable = false;
    const orch = new AetheraAgentOrchestrator();
    orch.register({
      ...fakeProvider('claude', ['creative_direction', 'script']),
      getAvailability: async () => ({ available: claudeAvailable }),
    });

    const brief = interpretPromptToBrief('Crie um vídeo de 3 minutos');
    const dag = buildAutonomousPipelineDag(brief, 'c:/dev/neuralbridge-studio').slice(0, 3);

    const paused = await orch.runDag(dag, {
      initialResults: {
        interpretation: {
          taskId: 'interpretation',
          providerId: 'codex',
          status: 'completed',
          output: 'checkpointed',
          costUsd: 0.05,
          durationMs: 2,
        },
      },
    });
    expect(paused.status).toBe('paused_no_provider');
    expect(paused.results['interpretation']?.output).toBe('checkpointed');
    expect(paused.pendingTaskIds).toEqual(['research', 'script']);

    claudeAvailable = true;
    const resumed = await orch.runDag(dag, { initialResults: paused.results });
    expect(resumed.status).toBe('completed');
    expect(resumed.results['interpretation']?.output).toBe('checkpointed');
    expect(resumed.results['research']?.providerId).toBe('claude');
    expect(resumed.results['script']?.providerId).toBe('claude');
  });
});

import type { TaskStatus } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { createSwarmService } from '../src/application/swarm-service.js';
import type { TaskPort } from '../src/application/ports.js';

function fakeTasks(statusFor: (prompt: string) => TaskStatus = () => 'completed', files: (prompt: string) => string[] = () => []) {
  const started: Array<{ id: string; prompt: string; mode: string }> = [];
  const port: TaskPort = {
    start: async ({ prompt, mode }) => { const id = `t${started.length + 1}`; started.push({ id, prompt, mode }); return { id }; },
    idle: async () => undefined,
    get: (id) => {
      const prompt = started.find((task) => task.id === id)?.prompt ?? '';
      return { status: statusFor(prompt), summary: 'ok', error: null, steps: [{ filesChanged: files(prompt) }] as never };
    },
  };
  return { port, started };
}

describe('swarm application service', () => {
  it('refuses a plan that needs human approval until it is approved', async () => {
    const { port, started } = fakeTasks();
    const swarm = createSwarmService(port);
    await expect(swarm.run({ prompt: 'implementar fluxo com segurança e credenciais', projectId: 'api', approved: false, tokenBudget: 200_000 })).rejects.toThrow(/approval_required/);
    expect(started).toHaveLength(0);
  });

  it('runs layers in dependency order as TaskEngine tasks and reports file conflicts', async () => {
    const { port, started } = fakeTasks(() => 'completed', (prompt) => (prompt.includes('developer') || prompt.includes('reviewer') ? ['src/shared.ts'] : []));
    const result = await createSwarmService(port).run({ prompt: 'Refatore o módulo de cálculo', projectId: 'api', approved: true });
    expect(result.roles).toEqual(['developer', 'reviewer']);
    expect(started.map((task) => task.mode)).toEqual(['codex', 'claude']);
    expect(result.taskIds).toEqual(['t1', 't2']);
    expect(result.conflicts).toEqual(['src/shared.ts']);
  });

  it('stops at the first specialist that does not complete', async () => {
    const { port, started } = fakeTasks((prompt) => (prompt.includes('developer') ? 'failed' : 'completed'));
    await expect(createSwarmService(port).run({ prompt: 'Refatore o módulo de cálculo', projectId: 'api', approved: true })).rejects.toThrow(/developer terminou com status failed/);
    expect(started).toHaveLength(1);
  });
});

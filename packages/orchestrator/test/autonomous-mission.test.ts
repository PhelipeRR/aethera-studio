import { describe, expect, it } from 'vitest';
import { createAutonomousMissionMode, type MissionState } from '../src/autonomous-mission.js';
describe('autonomous mission mode', () => {
  it('starts the next executable task and only completes after acceptance', async () => {
    const state: MissionState = { id: 'm1', status: 'running', tasks: [{ id: 'a', prompt: 'a', dependsOn: [], status: 'pending', attempts: 0 }, { id: 'b', prompt: 'b', dependsOn: ['a'], status: 'pending', attempts: 0 }], maxAttempts: 2, maxDurationMs: 10_000, maxCostUsd: 10, startedAt: 0, costUsd: 0 };
    const started: string[] = [];
    const mode = createAutonomousMissionMode({ load: async () => state, save: async () => undefined, startTask: async (task) => { started.push(task.id); return `task-${task.id}`; }, now: () => 1, validateAcceptance: async () => true });
    await mode.recover('m1');
    expect(started).toEqual(['a']);
    await mode.onTask({ taskId: 'task-a', status: 'completed', costUsd: 1 });
    expect(started).toEqual(['a', 'b']);
    await mode.onTask({ taskId: 'task-b', status: 'completed', costUsd: 1 });
    expect(state.status).toBe('completed');
  });
  it('marks a mission blocked when acceptance fails instead of looping', async () => {
    const state: MissionState = { id: 'm2', status: 'running', tasks: [{ id: 'a', prompt: 'a', dependsOn: [], status: 'pending', attempts: 0 }], maxAttempts: 1, maxDurationMs: 10_000, maxCostUsd: 10, startedAt: 0, costUsd: 0 };
    const mode = createAutonomousMissionMode({ load: async () => state, save: async () => undefined, startTask: async () => 'task-a', now: () => 1, validateAcceptance: async () => false });
    await mode.recover('m2'); await mode.onTask({ taskId: 'task-a', status: 'completed', costUsd: 1 });
    expect(state.status).toBe('blocked');
  });
});

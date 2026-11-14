import { describe, expect, it, vi } from 'vitest';
import { createTaskApplicationService } from '../src/application/task-application-service.js';

describe('TaskApplicationService', () => {
  it('delegates lifecycle commands without owning execution state', async () => {
    const engine = { start: vi.fn(async () => 'task-1'), resume: vi.fn(async () => 'task-2'), approve: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resumePaused: vi.fn(), retryCapacity: vi.fn(), setCapacityAutoResume: vi.fn(), idle: vi.fn(async () => undefined) };
    const service = createTaskApplicationService(engine);
    await expect(service.start({ prompt: 'x', projectId: null, mode: 'claude' })).resolves.toBe('task-1');
    service.approve('task-1'); service.cancel('task-1'); service.pause('task-1'); service.resumePaused('task-1');
    expect(engine.approve).toHaveBeenCalledWith('task-1');
    expect(engine.cancel).toHaveBeenCalledWith('task-1');
  });
});

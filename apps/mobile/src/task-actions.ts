import type { CreateTaskRequest } from '@neuralbridge/shared/core-api';
import type { TaskStatus } from '@neuralbridge/shared/domain';

const TERMINAL_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminalTask(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function remoteTaskInput(prompt: string): CreateTaskRequest {
  return { prompt: prompt.trim(), projectId: null, mode: 'auto', access: 'read-only' };
}

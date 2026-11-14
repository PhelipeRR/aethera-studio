import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<string>();

/**
 * Runs `fn` with a correlation id that follows every async continuation it starts: the IPC request
 * that started a task, the task's background run, its evidence and its integration calls share it.
 */
export function withCorrelation<T>(correlationId: string, fn: () => T): T {
  return storage.run(correlationId, fn);
}

/** The correlation id of the current async context, if any. */
export function currentCorrelationId(): string | undefined {
  return storage.getStore();
}

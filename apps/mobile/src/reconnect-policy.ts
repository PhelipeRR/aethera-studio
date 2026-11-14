export type ConnectivityState = 'online' | 'offline' | 'revoked';

/** Read operations may retry after connectivity returns; commands are never queued offline. */
export function retryDelayMs(attempt: number): number {
  const bounded = Math.max(0, Math.min(attempt, 5));
  return Math.min(30_000, 500 * 2 ** bounded);
}

export function canQueueCommand(state: ConnectivityState): false {
  void state;
  return false;
}

export function shouldClearSession(state: ConnectivityState): boolean {
  return state === 'revoked';
}

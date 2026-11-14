import type { SupervisorState } from './supervisor.js';

/*
 * Boot recovery (interrupted workflow steps, running missions) restarts work. The hybrid adapter sends work to the
 * Core when it is connected and falls back to the desktop otherwise, which is right for availability, but at boot the
 * Core is still starting: recovering right away would put every recovered task on the desktop. This waits for the Core
 * first, and never longer than its own ready timeout: a disabled, failed or stopped Core (or one that never answers)
 * releases the wait at once or at the timeout, and the work runs on the desktop exactly as before.
 */

const GIVEN_UP: readonly SupervisorState[] = ['disabled', 'failed', 'stopped', 'stopping'];

export interface WaitForCoreDeps {
  state: () => SupervisorState;
  connected: () => boolean;
  onConnection: (listener: (connection: unknown) => void) => () => void;
  timeoutMs: number;
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
}

export function waitForCore(deps: WaitForCoreDeps): Promise<'core' | 'desktop'> {
  if (deps.connected()) return Promise.resolve('core');
  if (GIVEN_UP.includes(deps.state())) return Promise.resolve('desktop');
  const setTimer = deps.setTimer ?? ((fn, ms) => { const handle = setTimeout(fn, ms); return { cancel: () => clearTimeout(handle) }; });
  return new Promise((resolve) => {
    let done = false;
    const finish = (where: 'core' | 'desktop') => {
      if (done) return;
      done = true;
      timer.cancel();
      unsubscribe();
      resolve(where);
    };
    const unsubscribe = deps.onConnection((connection) => {
      if (connection) finish('core');
      else if (GIVEN_UP.includes(deps.state())) finish('desktop');
    });
    const timer = setTimer(() => finish('desktop'), deps.timeoutMs);
  });
}

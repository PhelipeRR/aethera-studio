import { matchGitTrigger, type GitEvent, type GitTrigger } from './git-triggers.js';

export type GitRefSnapshot = { ref: string; hash: string };
export type GitAutomation = { id: string; projectId: string; workflowId: string; trigger: GitTrigger; enabled: boolean; concurrencyLimit: number; hourlyLimit: number; failureBreaker: number };
export type GitAutomationEvent = GitEvent & { status: string; runId?: string | null; reason?: string | null };
type Ports = {
  list: () => Promise<GitAutomation[]>;
  refs: (projectId: string) => Promise<GitRefSnapshot[]>;
  /** Files changed between two commits; a failure counts as unknown, not as "no file". */
  paths: (projectId: string, from: string, to: string) => Promise<string[]>;
  cursor: (automationId: string, ref: string) => Promise<string | null>;
  saveCursor: (automationId: string, ref: string, hash: string) => Promise<void>;
  known: (event: GitEvent) => Promise<boolean>;
  saveEvent: (event: GitAutomationEvent) => Promise<void>;
  activeRuns: (automationId: string) => Promise<number>;
  dispatchedSince: (automationId: string, since: string) => Promise<number>;
  /** Runs of this automation that failed in a row, newest first. */
  failedInARow: (automationId: string) => Promise<number>;
  dispatch: (automation: GitAutomation, event: GitEvent) => Promise<string | null>;
  now?: () => number;
};

const HOUR = 3_600_000;

/** Compares refs with the last cursor. Never writes to the repository, and one bad automation does not stop the others. */
export function createGitAutomationMonitor(ports: Ports) {
  let running = false;
  const now = ports.now ?? Date.now;

  const pollRef = async (automation: GitAutomation, ref: GitRefSnapshot) => {
    const cursor = await ports.cursor(automation.id, ref.ref);
    if (cursor === ref.hash) return;
    // The first sight of a ref is the starting line, not a new commit.
    if (cursor === null) { await ports.saveCursor(automation.id, ref.ref, ref.hash); return; }
    if ((await ports.activeRuns(automation.id)) >= automation.concurrencyLimit) return;
    const event: GitEvent = { automationId: automation.id, projectId: automation.projectId, ref: ref.ref, commitHash: ref.hash, base: cursor, kind: 'ref-updated' };
    if (automation.trigger.pathGlobs?.length) event.paths = await ports.paths(automation.projectId, cursor, ref.hash).catch(() => []);
    if (!matchGitTrigger(event, automation.trigger) || (await ports.known(event))) {
      await ports.saveCursor(automation.id, ref.ref, ref.hash);
      return;
    }
    if ((await ports.dispatchedSince(automation.id, new Date(now() - HOUR).toISOString())) >= automation.hourlyLimit) {
      await ports.saveEvent({ ...event, status: 'discarded', reason: 'Limite por hora atingido.' });
      await ports.saveCursor(automation.id, ref.ref, ref.hash);
      return;
    }
    try {
      const runId = await ports.dispatch(automation, event);
      await ports.saveEvent({ ...event, status: runId ? 'dispatched' : 'discarded', runId });
    } catch (error) {
      await ports.saveEvent({ ...event, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
    }
    await ports.saveCursor(automation.id, ref.ref, ref.hash);
  };

  return {
    async poll() {
      if (running) return;
      running = true;
      try {
        for (const automation of await ports.list()) {
          if (!automation.enabled) continue;
          try {
            if ((await ports.failedInARow(automation.id)) >= automation.failureBreaker) continue;
            for (const ref of await ports.refs(automation.projectId)) await pollRef(automation, ref);
          } catch (error) {
            console.error(`[git-automation] ${automation.id}`, error);
          }
        }
      } finally {
        running = false;
      }
    },
  };
}

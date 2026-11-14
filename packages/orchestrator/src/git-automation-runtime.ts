import { dedupeGitEvent, matchGitTrigger, type GitTrigger } from './git-triggers.js';
type RefSnapshot = { ref: string; hash: string; paths?: string[] };
type RuntimePorts = { read: () => Promise<RefSnapshot[]>; dispatch: (event: { automationId: string; ref: string; commitHash: string; paths?: string[] }) => Promise<void> };
export function createGitAutomationRuntime(ports: RuntimePorts) {
  let polling = false;
  const seen = new Set<string>();
  return {
    isPolling: () => polling,
    async poll(trigger: GitTrigger & { automationId: string; ref: string }) {
      if (polling) return;
      polling = true;
      try { for (const snapshot of await ports.read()) { const event = { automationId: trigger.automationId, ref: snapshot.ref, commitHash: snapshot.hash, ...(snapshot.paths ? { paths: snapshot.paths } : {}) }; if (snapshot.ref !== trigger.ref || !matchGitTrigger(event, trigger) || !dedupeGitEvent(event, seen)) continue; await ports.dispatch(event); } } finally { polling = false; }
    },
  };
}

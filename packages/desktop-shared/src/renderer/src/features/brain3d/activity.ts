import type { BrainActivityEntry } from '@neuralbridge/shared/brain3d';
import type { TaskDetail } from '@neuralbridge/shared/tasks';

/** A real retrieval of a memory: from a task's RAG context or an agent's MCP call. Never generated. */
export interface Activation {
  key: string;
  memoryId: string;
  source: 'task' | 'mcp';
  /** Who retrieved it, as shown to the user. */
  client: string;
  action: string;
  at: string;
}

const MEMORY_REF = 'memory://';

/** Memories a task's RAG context sent to the agent (event `rag_context`, references `memory://<id>`). */
export function activationsFromTasks(tasks: readonly TaskDetail[]): Activation[] {
  const found: Activation[] = [];
  for (const task of tasks) {
    for (const event of task.events) {
      if (event.kind !== 'rag_context' || !Array.isArray(event.data['references'])) continue;
      for (const reference of event.data['references']) {
        if (typeof reference !== 'string' || !reference.startsWith(MEMORY_REF)) continue;
        const memoryId = reference.slice(MEMORY_REF.length);
        found.push({ key: `task:${task.id}:${event.id}:${memoryId}`, memoryId, source: 'task', client: `tarefa ${task.id.slice(0, 8)}`, action: 'context', at: event.at });
      }
    }
  }
  return found;
}

function clientLabel(client: string): string {
  const name = client.slice('mcp:'.length);
  if (/claude/i.test(name)) return 'Claude Code';
  if (/codex/i.test(name)) return 'Codex';
  return name || 'cliente MCP';
}

/**
 * Retrievals by agents through MCP, from the access log. The app's own rows (`electron`: the user's
 * searches and the task context, already covered by `rag_context`) are left out.
 */
export function activationsFromAccess(entries: readonly BrainActivityEntry[]): Activation[] {
  return entries
    .filter((entry) => entry.client.startsWith('mcp:'))
    .map((entry) => ({ key: `access:${entry.id}`, memoryId: entry.memoryId, source: 'mcp' as const, client: clientLabel(entry.client), action: entry.action, at: entry.at }));
}

const RECENT = 50;

/** Remembers what was already shown, so each retrieval lights the brain once. */
export class ActivityTracker {
  readonly recent: Activation[] = [];
  private readonly seen = new Set<string>();

  ingest(activations: readonly Activation[]): Activation[] {
    const fresh = activations.filter((activation) => !this.seen.has(activation.key));
    for (const activation of fresh) this.seen.add(activation.key);
    this.recent.unshift(...[...fresh].sort((a, b) => b.at.localeCompare(a.at)));
    this.recent.splice(RECENT);
    return fresh;
  }
}

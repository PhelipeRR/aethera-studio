import { useEffect, useRef, useState } from 'react';
import { ActivityTracker, activationsFromAccess, activationsFromTasks, type Activation } from './activity';

const HISTORY_MINUTES = 30;
const POLL_MS = 2_000;

/**
 * Real retrievals of memories, from two sources: the `rag_context` of tasks run by the app (pushed through
 * tasks:changed) and the access log, the only trace of agents using the MCP server outside the app
 * (polled while the page is visible, since that server is another process). The last half hour is listed
 * as history; only what arrives while the page is open lights the brain.
 */
export function useRealActivity(onFresh: (activations: Activation[]) => void): { recent: Activation[]; lastAt: number | null } {
  const [recent, setRecent] = useState<Activation[]>([]);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const callback = useRef(onFresh);
  useEffect(() => {
    callback.current = onFresh;
  }, [onFresh]);

  useEffect(() => {
    const tracker = new ActivityTracker();
    let cancelled = false;
    let cursor = new Date(Date.now() - HISTORY_MINUTES * 60_000).toISOString();
    const advance = (activations: Activation[]) => {
      for (const activation of activations) if (activation.at > cursor) cursor = activation.at;
    };
    const publish = (fresh: Activation[], live: boolean) => {
      if (cancelled) return;
      setRecent([...tracker.recent]);
      if (live && fresh.length) {
        setLastAt(Date.now());
        callback.current(fresh);
      }
    };

    const history = async () => {
      const since = cursor;
      const [entries, tasks] = await Promise.all([window.neuralbridge.brain.activity(since), window.neuralbridge.tasks.list({ limit: 20 })]);
      const details = await Promise.all(tasks.filter((task) => task.createdAt >= since).map((task) => window.neuralbridge.tasks.get(task.id)));
      const found = [...activationsFromAccess(entries), ...activationsFromTasks(details)];
      advance(found);
      publish(tracker.ingest(found), false);
    };

    const poll = async () => {
      if (document.hidden) return;
      const found = activationsFromAccess(await window.neuralbridge.brain.activity(cursor));
      advance(found);
      publish(tracker.ingest(found), true);
    };

    const pending = new Map<string, ReturnType<typeof setTimeout>>();
    const unsubscribe = window.neuralbridge.tasks.onChanged(({ taskId }) => {
      if (pending.has(taskId)) return;
      pending.set(
        taskId,
        setTimeout(() => {
          pending.delete(taskId);
          void window.neuralbridge.tasks.get(taskId).then(
            (task) => publish(tracker.ingest(activationsFromTasks([task])), true),
            () => undefined,
          );
        }, 250),
      );
    });

    let timer: ReturnType<typeof setInterval> | null = null;
    void history()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) timer = setInterval(() => void poll().catch(() => undefined), POLL_MS);
      });

    return () => {
      cancelled = true;
      unsubscribe();
      if (timer) clearInterval(timer);
      for (const handle of pending.values()) clearTimeout(handle);
    };
  }, []);

  return { recent, lastAt };
}

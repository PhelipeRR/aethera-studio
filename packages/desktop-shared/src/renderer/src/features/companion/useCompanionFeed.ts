import * as React from 'react';
import type { CompanionEvent, CompanionSession, CompanionSessionStatus } from '@neuralbridge/shared/companion';
import { detectReaction, REACTION_MS, taskTitle, type MascotReaction } from './companion-state';

const SESSION_WINDOW = 100;
const EVENT_WINDOW = 40;
/** Streamed text can emit many events a second; the registry is re-read at most this often. */
const REFRESH_THROTTLE_MS = 250;

export interface CompanionFeed {
  sessions: CompanionSession[];
  events: CompanionEvent[];
  /** False when the registry cannot be read, which the HUD shows as a real disconnection. */
  available: boolean;
  reaction: MascotReaction | null;
  loadEvents(sessionId: string): void;
}

/** Everything the HUD knows comes from here: push-driven reads of the Companion registry over IPC, with no polling. */
export function useCompanionFeed(): CompanionFeed {
  const [sessions, setSessions] = React.useState<CompanionSession[]>([]);
  const [events, setEvents] = React.useState<CompanionEvent[]>([]);
  const [available, setAvailable] = React.useState(true);
  const [reaction, setReaction] = React.useState<MascotReaction | null>(null);
  const seen = React.useRef<Map<string, CompanionSessionStatus> | null>(null);

  React.useEffect(() => {
    let disposed = false;
    let throttle: number | undefined;
    let reactionTimer: number | undefined;
    let subscription: { cancel(): Promise<void> } | undefined;
    const refresh = async () => {
      try {
        const page = await window.neuralbridge.companion.listSessions({ newestFirst: true, limit: SESSION_WINDOW });
        if (disposed) return;
        setAvailable(true);
        setSessions(page.items);
        const next = detectReaction(seen.current, page.items);
        seen.current = new Map(page.items.map((session) => [session.sessionId, session.status]));
        if (next) {
          setReaction(next);
          window.clearTimeout(reactionTimer);
          reactionTimer = window.setTimeout(() => setReaction(null), REACTION_MS);
        }
      } catch {
        if (!disposed) setAvailable(false);
      }
    };
    const scheduleRefresh = () => {
      if (throttle !== undefined) return;
      throttle = window.setTimeout(() => { throttle = undefined; void refresh(); }, REFRESH_THROTTLE_MS);
    };
    void window.neuralbridge.companion.subscribe({}, (event) => {
      if (disposed) return;
      setEvents((current) => [event, ...current.filter((item) => item.eventId !== event.eventId)].slice(0, EVENT_WINDOW));
      scheduleRefresh();
    }).then((value) => { if (disposed) void value.cancel(); else subscription = value; }).catch(() => { if (!disposed) setAvailable(false); }).finally(() => { if (!disposed) void refresh(); });
    return () => {
      disposed = true;
      window.clearTimeout(throttle);
      window.clearTimeout(reactionTimer);
      void subscription?.cancel();
    };
  }, []);

  const loadEvents = React.useCallback((sessionId: string) => {
    void window.neuralbridge.companion.getEvents({ sessionId, newestFirst: true, limit: EVENT_WINDOW }).then((page) => {
      setEvents((current) => [...page.items, ...current.filter((event) => event.sessionId !== sessionId)]);
    }).catch(() => undefined);
  }, []);

  return { sessions, events, available, reaction, loadEvents };
}

export interface TaskFacts { title: string; project: string | null; }

/** Task text and project name for the sessions on screen, read once each. The registry only holds their ids. */
export function useTaskFacts(sessions: readonly CompanionSession[]): Record<string, TaskFacts> {
  const [facts, setFacts] = React.useState<Record<string, TaskFacts>>({});
  const requested = React.useRef(new Set<string>());
  React.useEffect(() => {
    for (const { taskId } of sessions) {
      if (requested.current.has(taskId)) continue;
      requested.current.add(taskId);
      void window.neuralbridge.tasks.get(taskId).then((task) => {
        setFacts((current) => ({ ...current, [taskId]: { title: taskTitle(task.threadTitle ?? task.prompt), project: task.projectName } }));
      }).catch(() => undefined);
    }
  }, [sessions]);
  return facts;
}

/** A clock that only ticks while something on screen needs it. */
export function useNow(running: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  return now;
}

export function usePageVisible(): boolean {
  const [visible, setVisible] = React.useState(() => !document.hidden);
  React.useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

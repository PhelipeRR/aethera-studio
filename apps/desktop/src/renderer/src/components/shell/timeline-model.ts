// Pure model of the shell timeline (lote 50.03, D-5): real events of one day, ordered, with a "now" marker.
import type { TaskStatus } from '@neuralbridge/shared/domain';
import type { StatusTone } from '../ui/glass-model';

export interface TimelineEvent {
  id: string;
  /** ISO timestamp of when it happened. */
  at: string;
  label: string;
  detail?: string;
  tone?: StatusTone;
  href?: string;
}

export interface PlacedTimelineEvent extends TimelineEvent {
  time: string;
  /** 0..1 along the day window. */
  position: number;
  /** Too close to the previous visible label: draw only the marker (the label stays in the title and for screen readers). */
  compact: boolean;
}

/** Minimum distance between two visible labels, as a share of the day (about 2.6 hours, ~130 px on a 1,200 px rail). */
export const LABEL_SPACING = 0.11;

export interface TimelineModel {
  events: PlacedTimelineEvent[];
  /** 0..1, or null when "now" is outside the window (a past day). */
  now: number | null;
  nowLabel: string;
}

const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Keeps the events of `day` (local time), sorted, placed on a 0..1 axis. Invalid dates are dropped, never guessed. */
export function timelineModel(events: readonly TimelineEvent[], now: Date, day: Date = now): TimelineModel {
  const start = startOfDay(day).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  const placed = events
    .map((event) => ({ event, time: new Date(event.at).getTime() }))
    .filter(({ time }) => Number.isFinite(time) && time >= start && time < end)
    .sort((a, b) => a.time - b.time)
    .map(({ event, time }) => ({ ...event, time: timeFormat.format(time), position: (time - start) / (end - start), compact: false }));
  let lastLabel = Number.NEGATIVE_INFINITY;
  for (const event of placed) {
    event.compact = event.position - lastLabel < LABEL_SPACING;
    if (!event.compact) lastLabel = event.position;
  }
  const nowTime = now.getTime();
  return { events: placed, now: nowTime >= start && nowTime < end ? (nowTime - start) / (end - start) : null, nowLabel: timeFormat.format(now) };
}

interface TaskLike {
  id: string;
  prompt: string;
  status: TaskStatus;
  projectName: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt?: string | null;
}

const TASK_TONE: Record<TaskStatus, StatusTone> = {
  pending: 'unknown',
  planning: 'unknown',
  running: 'warning',
  awaiting_approval: 'warning',
  validating: 'warning',
  paused: 'unknown',
  completed: 'ok',
  failed: 'error',
  cancelled: 'unknown',
};

/** Task history as timeline events: the moment it finished, else started, else was created. */
export function taskEvents(tasks: readonly TaskLike[]): TimelineEvent[] {
  return tasks.map((task) => {
    const prompt = task.prompt.trim().replace(/\s+/g, ' ');
    return {
      id: task.id,
      at: task.finishedAt ?? task.startedAt ?? task.createdAt,
      label: prompt.length > 48 ? `${prompt.slice(0, 47)}…` : prompt || 'Tarefa',
      ...(task.projectName ? { detail: task.projectName } : {}),
      tone: TASK_TONE[task.status],
      href: `/runs/${task.id}`,
    };
  });
}

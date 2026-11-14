import type { TaskStatus } from '@neuralbridge/shared/domain';
import type { TaskSummary } from '@neuralbridge/shared/tasks';

export interface ConversationItem {
  id: string;
  title: string;
  /** Latest message: orders the list and picks the group. */
  lastAt: string;
  status: TaskStatus;
  projectId: string | null;
  projectName: string | null;
  renamed: boolean;
}

export interface ConversationGroup {
  label: 'Hoje' | 'Ontem' | 'Últimos 7 dias' | 'Anteriores';
  items: ConversationItem[];
}

const LABELS: ConversationGroup['label'][] = ['Hoje', 'Ontem', 'Últimos 7 dias', 'Anteriores'];

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function groupOf(at: string, now: Date): ConversationGroup['label'] {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(at))) / 86_400_000);
  return days <= 0 ? 'Hoje' : days === 1 ? 'Ontem' : days <= 7 ? 'Últimos 7 dias' : 'Anteriores';
}

/**
 * Turns the task list (newest first) into the conversation history: one entry per conversation, named
 * by the user or by its first request, ordered by its latest message and grouped by calendar day.
 * The search matches the name and every request of the conversation.
 */
/** Projects in tree order, each with its depth, for lists that show the hierarchy. */
export function projectTree<T extends { id: string; parentProjectId: string | null }>(projects: readonly T[]): { project: T; depth: number }[] {
  const ids = new Set(projects.map((project) => project.id));
  const walk = (parent: string | null, depth: number): { project: T; depth: number }[] => projects.filter((project) => (project.parentProjectId && ids.has(project.parentProjectId) ? project.parentProjectId : null) === parent).flatMap((project) => [{ project, depth }, ...walk(project.id, depth + 1)]);
  return walk(null, 0);
}

export function conversationGroups(tasks: readonly TaskSummary[], query: string, now: Date): ConversationGroup[] {
  const conversations = new Map<string, ConversationItem & { text: string[] }>();
  for (const task of tasks) {
    const entry = conversations.get(task.threadId);
    if (!entry) {
      conversations.set(task.threadId, {
        id: task.threadId,
        title: task.threadTitle ?? task.prompt,
        lastAt: task.createdAt,
        status: task.status,
        projectId: task.projectId,
        projectName: task.projectName,
        renamed: task.threadTitle !== null,
        text: [task.threadTitle ?? '', task.prompt],
      });
    } else {
      entry.text.push(task.prompt);
      if (task.id === task.threadId && !entry.renamed) entry.title = task.prompt;
    }
  }
  const needle = fold(query.trim());
  const groups = new Map<ConversationGroup['label'], ConversationItem[]>();
  for (const { text, ...item } of conversations.values()) {
    if (needle && !text.some((part) => fold(part).includes(needle))) continue;
    const label = groupOf(item.lastAt, now);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return LABELS.flatMap((label) => {
    const items = groups.get(label);
    return items ? [{ label, items: items.sort((a, b) => b.lastAt.localeCompare(a.lastAt)) }] : [];
  });
}

/** Distance from the end, in pixels, within which new content keeps the view pinned to the bottom. */
const PINNED_DISTANCE = 120;

export function isNearBottom(element: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= PINNED_DISTANCE;
}

const COMPOSER_MAX_HEIGHT = 240;

/** Textarea height for its content: never below one comfortable line, never above the cap (then it scrolls). */
export function nextComposerHeight(contentHeight: number, minHeight: number): number {
  return Math.min(COMPOSER_MAX_HEIGHT, Math.max(minHeight, contentHeight));
}

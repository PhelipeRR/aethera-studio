import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@neuralbridge/shared';
import { conversationGroups, isNearBottom, nextComposerHeight } from '../src/renderer/src/features/tasks/chat-model.js';

const NOW = new Date('2026-10-29T15:00:00');

function task(id: string, at: string, extra: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    prompt: `pedido ${id}`,
    projectId: null,
    projectName: null,
    mode: 'auto',
    status: 'completed',
    parentTaskId: null,
    threadId: id,
    threadTitle: null,
    model: null,
    summary: null,
    error: null,
    createdAt: new Date(at).toISOString(),
    startedAt: null,
    finishedAt: null,
    agents: [],
    tokens: { input: null, output: null, cached: null, costUsd: null },
    filesChanged: 0,
    images: [],
    ...extra,
  };
}

describe('conversation history', () => {
  // Newest first, as tasks:list returns them.
  const tasks = [
    task('c2', '2026-10-29T14:00:00', { threadId: 'c', parentTaskId: 'c', prompt: 'continuação', status: 'running' }),
    task('a', '2026-10-29T09:00:00', { prompt: 'Explique o cache', threadTitle: 'Cache de sessão' }),
    task('c', '2026-10-28T23:30:00', { prompt: 'Corrija o checkout' }),
    task('d', '2026-10-24T10:00:00', { prompt: 'Planeje a migração' }),
    task('e', '2026-09-01T10:00:00', { prompt: 'Revise o README' }),
  ];

  it('lists each conversation once, by its name or first request, in calendar groups', () => {
    const groups = conversationGroups(tasks, '', NOW);
    expect(groups.map((group) => [group.label, group.items.map((item) => item.title)])).toEqual([
      ['Hoje', ['Corrija o checkout', 'Cache de sessão']],
      ['Últimos 7 dias', ['Planeje a migração']],
      ['Anteriores', ['Revise o README']],
    ]);
    // The conversation moves up with its latest message and shows that one's status.
    expect(groups[0]?.items[0]).toMatchObject({ id: 'c', lastAt: tasks[0]?.createdAt, status: 'running' });
  });

  it('puts yesterday apart from today by the calendar, not by 24 hours', () => {
    const groups = conversationGroups([task('y', '2026-10-28T20:00:00')], '', new Date('2026-10-29T08:00:00'));
    expect(groups.map((group) => group.label)).toEqual(['Ontem']);
  });

  it('searches names and every request of the conversation, ignoring case and accents', () => {
    expect(conversationGroups(tasks, 'SESSAO', NOW).flatMap((group) => group.items.map((item) => item.id))).toEqual(['a']);
    expect(conversationGroups(tasks, 'continuacao', NOW).flatMap((group) => group.items.map((item) => item.id))).toEqual(['c']);
    expect(conversationGroups(tasks, 'nada disso', NOW)).toEqual([]);
  });
});

describe('scrolling', () => {
  it('follows new content only when the reader is already near the end', () => {
    expect(isNearBottom({ scrollTop: 900, clientHeight: 500, scrollHeight: 1450 })).toBe(true);
    expect(isNearBottom({ scrollTop: 400, clientHeight: 500, scrollHeight: 1450 })).toBe(false);
    expect(isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(true);
  });
});

describe('composer', () => {
  it('grows with the text up to a limit', () => {
    expect(nextComposerHeight(20, 44)).toBe(44);
    expect(nextComposerHeight(120, 44)).toBe(120);
    expect(nextComposerHeight(900, 44)).toBe(240);
  });
});

import { describe, expect, it } from 'vitest';
import { createGitAutomationMonitor, type GitAutomation, type GitRefSnapshot } from '../src/git-automation-monitor.js';
import type { GitEvent } from '../src/git-triggers.js';

const automation: GitAutomation = { id: 'a1', projectId: 'p1', workflowId: 'w1', trigger: { refs: ['refs/heads/main'] }, enabled: true, concurrencyLimit: 1, hourlyLimit: 20, failureBreaker: 3 };

function monitor(options: { refs?: GitRefSnapshot[]; automation?: Partial<GitAutomation>; active?: number; hourly?: number; failures?: number; paths?: string[]; cursor?: string | null } = {}) {
  const cursors = new Map<string, string>();
  if (options.cursor !== null) cursors.set('a1:refs/heads/main', options.cursor ?? 'old');
  const state = { refs: options.refs ?? [{ ref: 'refs/heads/main', hash: 'new' }] };
  const events: { status: string; reason?: string | null }[] = [];
  const dispatched: GitEvent[] = [];
  const instance = createGitAutomationMonitor({
    list: async () => [{ ...automation, ...options.automation }],
    refs: async () => state.refs,
    paths: async () => options.paths ?? [],
    cursor: async (id, ref) => cursors.get(`${id}:${ref}`) ?? null,
    saveCursor: async (id, ref, hash) => { cursors.set(`${id}:${ref}`, hash); },
    known: async (event) => dispatched.some((item) => item.commitHash === event.commitHash),
    saveEvent: async (event) => { events.push(event); },
    activeRuns: async () => options.active ?? 0,
    dispatchedSince: async () => options.hourly ?? 0,
    failedInARow: async () => options.failures ?? 0,
    dispatch: async (_automation, event) => { dispatched.push(event); return 'run-1'; },
  });
  return { instance, state, cursors, events, dispatched };
}

describe('git automation monitor', () => {
  it('takes the first sight of a ref as the starting line, not as a new commit', async () => {
    const { instance, dispatched, cursors } = monitor({ cursor: null });
    await instance.poll();
    expect(dispatched).toEqual([]);
    expect(cursors.get('a1:refs/heads/main')).toBe('new');
  });

  it('dispatches a new commit once, and again for the next one', async () => {
    const { instance, state, dispatched, events } = monitor();
    await instance.poll();
    await instance.poll();
    expect(dispatched.map((event) => event.commitHash)).toEqual(['new']);
    expect(events).toEqual([expect.objectContaining({ status: 'dispatched', runId: 'run-1' })]);
    state.refs = [{ ref: 'refs/heads/main', hash: 'newer' }];
    await instance.poll();
    expect(dispatched).toHaveLength(2);
  });

  it('holds the commit while the automation is at its concurrency limit', async () => {
    const { instance, dispatched, cursors } = monitor({ active: 1 });
    await instance.poll();
    expect(dispatched).toEqual([]);
    expect(cursors.get('a1:refs/heads/main')).toBe('old');
  });

  it('records a discard at the hourly limit instead of running', async () => {
    const { instance, dispatched, events } = monitor({ hourly: 20 });
    await instance.poll();
    expect(dispatched).toEqual([]);
    expect(events[0]).toMatchObject({ status: 'discarded', reason: expect.stringContaining('hora') });
  });

  it('stops an automation that keeps failing', async () => {
    const { instance, dispatched } = monitor({ failures: 3 });
    await instance.poll();
    expect(dispatched).toEqual([]);
  });

  it('only fires for the watched paths', async () => {
    const trigger = { refs: ['refs/heads/main'], pathGlobs: ['src/**'] };
    const quiet = monitor({ automation: { trigger }, paths: ['docs/a.md'] });
    await quiet.instance.poll();
    expect(quiet.dispatched).toEqual([]);
    const loud = monitor({ automation: { trigger }, paths: ['src/app.ts'] });
    await loud.instance.poll();
    expect(loud.dispatched[0]?.paths).toEqual(['src/app.ts']);
  });

  it('ignores a disabled automation', async () => {
    const { instance, dispatched } = monitor({ automation: { enabled: false } });
    await instance.poll();
    expect(dispatched).toEqual([]);
  });
});

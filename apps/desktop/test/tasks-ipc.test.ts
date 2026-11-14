import { IpcChannel } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { registerTasksIpcHandlers, type TasksIpcDependencies } from '../src/main/handlers/tasks.js';
import type { TaskService } from '../src/main/tasks.js';

type Listener = (event: { senderFrame: { url: string } | null }, payload: unknown) => Promise<unknown>;

class FakeIpc {
  readonly handlers = new Map<string, Listener>();
  handle(channel: string, listener: Listener): void { this.handlers.set(channel, listener); }
  invoke(channel: string, payload: unknown, url = 'file:///app/index.html'): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`missing_handler:${channel}`);
    return handler({ senderFrame: { url } }, payload);
  }
}

const detail = { id: 't1', projectId: 'api', status: 'completed', summary: 'ok', error: null, steps: [] };

function setup(overrides: Partial<TasksIpcDependencies> = {}) {
  const calls: string[] = [];
  const opened: string[] = [];
  let budget = 2_000_000;
  const tasks = {
    approve: (id: string) => calls.push(`approve:${id}`),
    cancel: (id: string) => calls.push(`cancel:${id}`),
    get: () => detail,
    start: async () => ({ id: 't1' }),
    idle: async () => undefined,
  } as unknown as TaskService;
  const ipc = new FakeIpc();
  registerTasksIpcHandlers(ipc, {
    tasks,
    projectRoot: () => 'C:\\projetos\\api',
    shell: { reveal: (path) => opened.push(`reveal:${path}`), open: async (path) => (opened.push(`open:${path}`), null) },
    agents: [],
    analytics: { tokens: () => { throw new Error('not used'); }, budget: () => budget, saveBudget: (value) => { budget = value; } },
    ...overrides,
  }, (url) => url === 'file:///app/index.html');
  return { ipc, calls, opened };
}

describe('tasks IPC handler group', () => {
  it('maps approval and cancellation onto the task service', async () => {
    const { ipc, calls } = setup();
    await expect(ipc.invoke(IpcChannel.tasksApprove, { id: 't1' })).resolves.toEqual({ ok: true });
    await expect(ipc.invoke(IpcChannel.tasksCancel, { id: 't1' })).resolves.toEqual({ ok: true });
    expect(calls).toEqual(['approve:t1', 'cancel:t1']);
  });

  it('rejects untrusted senders and answers unavailable while the database is down', async () => {
    const { ipc, calls } = setup();
    await expect(ipc.invoke(IpcChannel.tasksApprove, { id: 't1' }, 'https://evil.example')).rejects.toThrow('Untrusted sender');
    expect(calls).toEqual([]);
    const offline = setup({ tasks: null });
    await expect(offline.ipc.invoke(IpcChannel.tasksApprove, { id: 't1' })).rejects.toThrow(/unavailable/);
  });

  it('opens task outputs only inside the project folder', async () => {
    const { ipc, opened } = setup();
    await expect(ipc.invoke(IpcChannel.tasksOutputFile, { id: 't1', path: '../../Windows/system32/cmd.exe', action: 'open' })).rejects.toThrow();
    expect(opened).toEqual([]);
  });

  it('refuses a swarm that needs approval before starting any task', async () => {
    const { ipc } = setup();
    await expect(ipc.invoke(IpcChannel.tasksSwarmRun, { prompt: 'implementar fluxo com segurança e credenciais', projectId: 'api', approved: false, tokenBudget: 200_000 })).rejects.toThrow(/approval_required/);
  });

  it('reads and saves the token budget', async () => {
    const { ipc } = setup();
    await expect(ipc.invoke(IpcChannel.analyticsBudgetSave, { tokenBudget: 500_000 })).resolves.toBe(500_000);
    await expect(ipc.invoke(IpcChannel.analyticsBudget, undefined)).resolves.toBe(500_000);
  });
});

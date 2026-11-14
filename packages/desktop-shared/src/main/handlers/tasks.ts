import { createSwarmService, type DesktopShellPort } from '@neuralbridge/orchestrator';
import { IpcChannel, type AgentStatus, type IpcOutput } from '@neuralbridge/shared';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';
import { resolveOutputPath } from '../outputs.js';
import type { TaskService } from '../tasks.js';

export type TokenPeriod = '24h' | '7d' | '30d' | 'all';

export interface TasksIpcDependencies {
  /** Null while the database is unavailable: every task channel then answers "unavailable". */
  tasks: TaskService | null;
  projectRoot: (projectId: string) => string;
  shell: DesktopShellPort;
  agents: ReadonlyArray<{ detect(options: { refresh?: boolean }): Promise<AgentStatus> }>;
  analytics: {
    tokens: (period: TokenPeriod) => IpcOutput<typeof IpcChannel.analyticsTokens>;
    budget: () => number;
    saveBudget: (tokenBudget: number) => void;
  };
}

/**
 * Work capability: the chat/runs task lifecycle (start, approval, cancellation, pause, threads),
 * Agent Swarm, agent status and token analytics. Execution stays in TaskEngine behind TaskService;
 * this module only maps validated IPC requests onto it.
 */
export function registerTasksIpcHandlers(ipc: IpcMainLike, dependencies: TasksIpcDependencies, isTrustedSender: (url: string) => boolean): void {
  const need = (): TaskService => {
    if (!dependencies.tasks) throw new Error('unavailable: O banco de dados está indisponível.');
    return dependencies.tasks;
  };
  const ok = { ok: true as const };
  const swarm = createSwarmService({ start: (input) => need().start(input), idle: () => need().idle(), get: (id) => need().get(id) });

  registerIpcHandler(ipc, IpcChannel.tasksStart, (input) => need().start(input), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksGitReviewStart, (input) => need().startGitReview(input), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksSmartCommitStart, (input) => need().startSmartCommit(input), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksResume, ({ id, prompt, images }) => need().resume(id, prompt, images), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksHeal, ({ id }) => need().heal(id), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksImage, async ({ id, index }) => need().image(id, index), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksApprove, async ({ id }) => (need().approve(id), ok), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksCancel, async ({ id }) => (need().cancel(id), ok), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksPause, async ({ id }) => (need().pause(id), ok), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksRetryCapacity, async ({ id }) => (need().retryCapacity(id), ok), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksCapacityAutoResume, async ({ id, enabled }) => (need().setCapacityAutoResume(id, enabled), ok), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksResumePaused, async ({ id }) => (need().resumePaused(id), ok), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksList, async (filter) => need().list(filter), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksGet, async ({ id }) => need().get(id), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksGitReviewGet, async ({ id }) => need().gitReview(id), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksSmartCommitGet, async ({ id }) => need().smartCommit(id), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksOutputFile, async ({ id, path, action }) => {
    const task = need().get(id);
    if (!task.projectId) throw new Error('forbidden: A tarefa não tem projeto.');
    // The path is resolved inside the project root; the renderer cannot point outside it.
    const target = resolveOutputPath(dependencies.projectRoot(task.projectId), path, action);
    if (action === 'reveal') dependencies.shell.reveal(target);
    else {
      const failure = await dependencies.shell.open(target);
      if (failure) throw new Error(`failed: ${failure}`);
    }
    return ok;
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksThread, async ({ id }) => need().thread(id), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksRenameThread, async ({ id, title }) => (need().renameThread(id, title), ok), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksDeleteThread, async ({ id }) => need().deleteThread(id), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksModels, async () => need().models(), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksSwarmPlan, async ({ prompt, tokenBudget }) => swarm.plan(prompt, tokenBudget), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.tasksSwarmRun, async (input) => swarm.run(input), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.agentsStatus, ({ refresh }) => Promise.all(dependencies.agents.map((agent) => agent.detect({ refresh }))), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.analyticsTokens, async ({ period }) => dependencies.analytics.tokens(period), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.analyticsBudget, async () => dependencies.analytics.budget(), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.analyticsBudgetSave, async ({ tokenBudget }) => (dependencies.analytics.saveBudget(tokenBudget), tokenBudget), isTrustedSender);
}

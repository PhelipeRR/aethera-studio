export type MissionTaskStatus = 'pending' | 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';
export type MissionState = { id: string; status: 'running' | 'paused' | 'completed' | 'blocked' | 'failed' | 'cancelled'; tasks: Array<{ id: string; prompt: string; dependsOn: string[]; status: MissionTaskStatus; attempts: number; taskId?: string; error?: string }>; maxAttempts: number; maxDurationMs: number; maxCostUsd: number; startedAt: number; costUsd: number };
type Ports = { load: (id: string) => Promise<MissionState | null>; save: (state: MissionState) => Promise<void>; startTask: (task: MissionState['tasks'][number]) => Promise<string>; validateAcceptance: (task: MissionState['tasks'][number]) => Promise<boolean>; now?: () => number };
export function createAutonomousMissionMode(ports: Ports) {
  const active = new Map<string, MissionState>();
  const now = ports.now ?? Date.now;
  const next = async (state: MissionState) => {
    if (state.status !== 'running') return;
    if ((state.maxDurationMs > 0 && now() - state.startedAt > state.maxDurationMs) || (state.maxCostUsd > 0 && state.costUsd >= state.maxCostUsd)) { state.status = 'blocked'; await ports.save(state); return; }
    const task = state.tasks.find((candidate) => candidate.status === 'pending' && candidate.dependsOn.every((id) => state.tasks.find((item) => item.id === id)?.status === 'completed'));
    if (!task) { if (state.tasks.every((item) => item.status === 'completed')) state.status = 'completed'; else if (state.tasks.some((item) => ['blocked', 'failed', 'cancelled'].includes(item.status))) state.status = 'blocked'; await ports.save(state); return; }
    if (task.attempts >= state.maxAttempts) { task.status = 'blocked'; task.error = 'Limite de tentativas atingido.'; await ports.save(state); return; }
    task.attempts++; task.status = 'running'; task.taskId = await ports.startTask(task); await ports.save(state);
  };
  return {
    async recover(id: string) { const state = await ports.load(id); if (!state) return; active.set(id, state); await next(state); },
    async recoverAll(ids: readonly string[]) { for (const id of ids) await this.recover(id); },
    async onTask(event: { taskId: string; status: string; costUsd?: number }) { for (const state of active.values()) { const task = state.tasks.find((item) => item.taskId === event.taskId); if (!task) continue; state.costUsd += event.costUsd ?? 0; if (event.status === 'cancelled') task.status = 'cancelled'; else if (event.status !== 'completed') { if (task.attempts < state.maxAttempts) task.status = 'pending'; else { task.status = 'failed'; task.error = `Task status: ${event.status}`; } } else if (await ports.validateAcceptance(task)) task.status = 'completed'; else if (task.attempts >= state.maxAttempts) { task.status = 'blocked'; task.error = 'Critérios de aceite não validados.'; } else task.status = 'pending'; await ports.save(state); await next(state); } },
    async pause(id: string) { const state = active.get(id); if (state) { state.status = 'paused'; await ports.save(state); } },
    async cancel(id: string) { const state = active.get(id); if (state) { state.status = 'cancelled'; for (const task of state.tasks.filter((item) => item.status === 'running')) task.status = 'cancelled'; await ports.save(state); } },
    get: (id: string) => active.get(id),
  };
}

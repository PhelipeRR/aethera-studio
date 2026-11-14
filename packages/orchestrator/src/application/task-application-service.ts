import type { TaskEngine, AttachedImage, StartInput } from '../engine.js';

/** Application seam for IPC and future non-Electron hosts. It owns no execution state. */
export function createTaskApplicationService(engine: Pick<TaskEngine, 'start' | 'resume' | 'approve' | 'cancel' | 'pause' | 'resumePaused' | 'retryCapacity' | 'setCapacityAutoResume' | 'idle'>) {
  return {
    start(input: StartInput): Promise<string> { return engine.start(input); },
    resume(taskId: string, prompt: string, images: AttachedImage[] = []): Promise<string> { return engine.resume(taskId, prompt, images); },
    approve(taskId: string): void { engine.approve(taskId); },
    cancel(taskId: string): void { engine.cancel(taskId); },
    pause(taskId: string): void { engine.pause(taskId); },
    resumePaused(taskId: string): void { engine.resumePaused(taskId); },
    retryCapacity(taskId: string): void { engine.retryCapacity(taskId); },
    setCapacityAutoResume(taskId: string, enabled: boolean): void { engine.setCapacityAutoResume(taskId, enabled); },
    idle(): Promise<void> { return engine.idle(); },
  };
}

export type TaskApplicationService = ReturnType<typeof createTaskApplicationService>;

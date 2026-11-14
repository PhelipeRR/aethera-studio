import { inArray } from 'drizzle-orm';
import { tasks, type DatabaseHandle } from '@neuralbridge/database';
import type { TaskEngine, TaskLeases, TaskUpdate } from '@neuralbridge/orchestrator';
import type { TaskService } from '../tasks.js';
import { callCore, EngineEventStream, type CoreConnection } from './task-client.js';

/*
 * CORE-06, tasks group: the desktop becomes an adapter. The renderer keeps the same IPC; behind it:
 * - starting work (chat, resume, heal, Git review, smart commit, swarm) goes to the Core, the executor;
 * - commands on an existing task (approve, cancel, pause…) go to whoever holds its lease (Core or desktop);
 * - reads stay local (the same database, WAL), exactly as before;
 * - the Core's engine updates are re-emitted on the desktop engine's emitter, so every existing listener (windows,
 *   Companion, workflows, missions, profile refresh) keeps working unchanged.
 * If the Core is not running (disabled, failed, restarting), work runs in the desktop as before; leases keep each task
 * to a single executor either way. NB_CORE_TASKS=main keeps the whole group in the desktop (rollback switch).
 */

const ACTIVE = ['pending', 'planning', 'running', 'awaiting_approval', 'validating', 'paused'] as const;

/** Images are bytes on the IPC; over HTTP they travel as base64 and the Core restores them before validation. */
function encodeImages<T extends { images?: { name: string; data: Uint8Array }[] | undefined }>(input: T): Omit<T, 'images'> & { images?: { name: string; dataBase64: string }[] } {
  const { images, ...rest } = input;
  return images ? { ...rest, images: images.map((image) => ({ name: image.name, dataBase64: Buffer.from(image.data).toString('base64') })) } : rest;
}

export interface HybridDeps {
  local: TaskService;
  engine: TaskEngine;
  handle: DatabaseHandle;
  connection: () => CoreConnection | null;
  log: (event: string, fields?: Record<string, string | number | null>) => void;
}

export function createHybridTaskService(deps: HybridDeps): TaskService & { attachEvents: (subscribe: (listener: (connection: CoreConnection | null) => void) => () => void) => () => void } {
  const { local, engine } = deps;
  const leases: TaskLeases = engine.leases;
  const core = (): CoreConnection | null => deps.connection();
  const internal = <T>(connection: CoreConnection, command: string, body: unknown) => callCore<T>(connection, 'POST', `/internal/v1/tasks/${command}`, body);

  /** The Core when it holds this task's lease; the desktop otherwise. */
  const ownerOf = (id: string): CoreConnection | null => {
    const connection = core();
    const lease = leases.current(id);
    return connection && lease && connection.executorId && lease.ownerInstanceId === connection.executorId ? connection : null;
  };
  const startOn = async <T>(command: string, body: unknown, fallback: () => Promise<T>): Promise<T> => {
    const connection = core();
    return connection ? internal<T>(connection, command, body) : fallback();
  };
  const commandOn = async (id: string, command: string, body: unknown, fallback: () => void): Promise<void> => {
    const connection = ownerOf(id);
    if (connection) await internal(connection, command, body);
    else fallback();
  };

  const stream = new EngineEventStream((update) => {
    // Same object shape as the desktop engine emits; listeners cannot tell where the task ran.
    engine.emit('task', update as TaskUpdate);
  }, deps.log);

  return {
    ...local,
    start: (input) => startOn('start', encodeImages(input), () => local.start(input)),
    startGitReview: (input) => startOn('git-review-start', input, () => local.startGitReview(input)),
    startSmartCommit: (input) => startOn('smart-commit-start', input, () => local.startSmartCommit(input)),
    resume: (id, prompt, images) => startOn('resume', encodeImages({ id, prompt, ...(images ? { images } : {}) }), () => local.resume(id, prompt, images)),
    heal: (id) => startOn('heal', { id }, () => local.heal(id)),
    // Synchronous on the IPC side today: forwarding is fire-and-report, failures are logged and the task's state shows it.
    approve: (id) => { void commandOn(id, 'approve', { id }, () => local.approve(id)).catch((error: unknown) => deps.log('core.command_failed', { command: 'approve', message: error instanceof Error ? error.message : null })); },
    cancel: (id) => { void commandOn(id, 'cancel', { id }, () => local.cancel(id)).catch((error: unknown) => deps.log('core.command_failed', { command: 'cancel', message: error instanceof Error ? error.message : null })); },
    pause: (id) => { void commandOn(id, 'pause', { id }, () => local.pause(id)).catch((error: unknown) => deps.log('core.command_failed', { command: 'pause', message: error instanceof Error ? error.message : null })); },
    resumePaused: (id) => { void commandOn(id, 'resume-paused', { id }, () => local.resumePaused(id)).catch((error: unknown) => deps.log('core.command_failed', { command: 'resume-paused', message: error instanceof Error ? error.message : null })); },
    retryCapacity: (id) => { void commandOn(id, 'retry-capacity', { id }, () => local.retryCapacity(id)).catch((error: unknown) => deps.log('core.command_failed', { command: 'retry-capacity', message: error instanceof Error ? error.message : null })); },
    setCapacityAutoResume: (id, enabled) => { void commandOn(id, 'capacity-auto-resume', { id, enabled }, () => local.setCapacityAutoResume(id, enabled)).catch((error: unknown) => deps.log('core.command_failed', { command: 'capacity-auto-resume', message: error instanceof Error ? error.message : null })); },
    /** Waits for the desktop's own runs and for tasks the Core is executing (by lease), e.g. a swarm in progress. */
    async idle() {
      await local.idle();
      for (;;) {
        const connection = core();
        if (!connection?.executorId) return;
        const running = deps.handle.db.select({ id: tasks.id, owner: tasks.ownerInstanceId }).from(tasks).where(inArray(tasks.status, [...ACTIVE])).all().filter((row) => row.owner === connection.executorId);
        if (!running.length) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    },
    attachEvents(subscribe) {
      const stop = subscribe((connection) => stream.connect(connection));
      stream.connect(core());
      return () => { stop(); stream.stop(); };
    },
  };
}

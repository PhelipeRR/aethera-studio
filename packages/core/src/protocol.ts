import { z } from 'zod';

/*
 * CORE-03: the supervision channel between the desktop (Electron main) and the embedded Core child process.
 * It runs over Node's IPC pipe (child_process.fork), never over the network. It carries lifecycle only (ready,
 * heartbeat, shutdown); domain traffic goes through the HTTP API in later lots.
 */

export const CORE_EXIT = {
  ok: 0,
  /** Another live Core already owns this data folder (core.lock). Not a crash: never restarted. */
  alreadyRunning: 3,
  /** Configuration, lock or listen failure before readiness. */
  startupFailed: 4,
  /** Graceful shutdown did not finish in time. */
  shutdownTimeout: 5,
} as const;

export const CORE_TIMING = {
  /** The supervisor gives up on a Core that is not ready by then. */
  readyTimeoutMs: 15_000,
  heartbeatMs: 5_000,
  /** Missed heartbeats before the supervisor treats the Core as hung. */
  missedHeartbeats: 3,
  /** Embedded Core shuts itself down when the desktop stopped pinging for this long. */
  parentSilenceMs: 30_000,
  /** Graceful shutdown budget before the Core forces its exit (and the supervisor kills it). */
  shutdownTimeoutMs: 5_000,
} as const;

export const parentMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ping'), seq: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('shutdown'), reason: z.enum(['desktop-quit', 'restart', 'disabled']) }),
]);
export type ParentMessage = z.infer<typeof parentMessageSchema>;

export const coreMessageSchema = z.discriminatedUnion('type', [
  /** desktopToken: the bearer the desktop uses on the Core API; it travels only on this pipe, never on the network or disk. */
  z.strictObject({ type: z.literal('ready'), port: z.number().int().min(1).max(65_535), instanceId: z.string().uuid(), version: z.string().max(40), pid: z.number().int().positive(), desktopToken: z.string().regex(/^[0-9a-f]{64}$/).optional(), executorId: z.string().max(80).optional() }),
  z.strictObject({ type: z.literal('pong'), seq: z.number().int().nonnegative() }),
  z.strictObject({ type: z.literal('already-running'), port: z.number().int().min(1).max(65_535).nullable(), instanceId: z.string().uuid(), pid: z.number().int().positive() }),
  z.strictObject({ type: z.literal('stopping'), reason: z.string().max(40) }),
]);
export type CoreMessage = z.infer<typeof coreMessageSchema>;

/** Response header with the instance id, so a probe can tell this Core from a process that reused its PID or port. */
export const INSTANCE_HEADER = 'Singularity-Core-Instance';

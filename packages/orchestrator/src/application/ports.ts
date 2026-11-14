import type { RunMode, TaskDetail } from '@neuralbridge/shared';

/**
 * Small ports the application services depend on. The Electron main process (or a test) provides the
 * adapters; services never import Electron, the database schema or a provider client directly.
 */

/** Time source, so services and their tests agree on "now". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** The part of the task service that orchestration needs: start, wait, read. */
export interface TaskPort {
  start(input: { prompt: string; projectId: string | null; mode: RunMode }): Promise<{ id: string }>;
  idle(): Promise<void>;
  get(id: string): Pick<TaskDetail, 'status' | 'summary' | 'error' | 'steps'>;
}

/** Opens or reveals a file the user owns; implemented with Electron's shell in the desktop app. */
export interface DesktopShellPort {
  reveal(path: string): void;
  /** Resolves to an error message when the OS could not open the file. */
  open(path: string): Promise<string | null>;
}

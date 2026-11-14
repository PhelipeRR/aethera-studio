import { join, resolve } from 'node:path';
import { resolveLocalWorkerCommand, type LocalWorkerCommand, type ResolveLocalWorkerInput } from '@neuralbridge/orchestrator';

export interface DesktopLocalWorkerInput extends Pick<ResolveLocalWorkerInput, 'platform' | 'exists' | 'baseEnv'> {
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  userDataPath: string;
  /** An absolute interpreter chosen by the user or a provisioning step. */
  pythonPath?: string;
}

/**
 * Where the worker lives. Installed, its sources are read-only resources and the venv goes under user data, so an update
 * neither needs write access to the install nor loses the interpreter. Null means no worker: suggestions take the model path.
 */
export function resolveDesktopLocalWorker(input: DesktopLocalWorkerInput): LocalWorkerCommand | null {
  const { isPackaged, resourcesPath, appPath, userDataPath, ...rest } = input;
  if (isPackaged) return resolveLocalWorkerCommand({ ...rest, workerRoot: join(resourcesPath, 'local-worker'), venvDir: join(userDataPath, 'local-worker', '.venv') });
  return resolveLocalWorkerCommand({ ...rest, workerRoot: resolve(appPath, '..', '..', 'packages', 'local-worker') });
}

import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDesktopLocalWorker } from '../src/main/local-worker.js';

const base = { resourcesPath: resolve('/app/resources'), appPath: resolve('/repo/apps/desktop'), userDataPath: resolve('/data'), platform: 'win32' as const, exists: () => true };

describe('resolveDesktopLocalWorker', () => {
  it('uses the package sources and venv in development', () => {
    const command = resolveDesktopLocalWorker({ ...base, isPackaged: false });
    expect(command?.executable).toBe(join(resolve('/repo/packages/local-worker'), '.venv', 'Scripts', 'python.exe'));
    expect(command?.cwd).toBe(join(resolve('/repo/packages/local-worker'), 'src'));
  });

  it('reads packaged sources from resources and keeps the venv in user data', () => {
    const command = resolveDesktopLocalWorker({ ...base, isPackaged: true });
    expect(command?.executable).toBe(join(base.userDataPath, 'local-worker', '.venv', 'Scripts', 'python.exe'));
    expect(command?.cwd).toBe(join(base.resourcesPath, 'local-worker', 'src'));
  });

  it('never reads sources from inside app.asar', () => {
    const command = resolveDesktopLocalWorker({ ...base, isPackaged: true, appPath: join(base.resourcesPath, 'app.asar') });
    expect(command?.cwd).not.toContain('app.asar');
  });

  it('honours a pinned absolute interpreter and refuses a bare command', () => {
    const pythonPath = resolve('/pinned/python.exe');
    expect(resolveDesktopLocalWorker({ ...base, isPackaged: true, pythonPath })?.executable).toBe(pythonPath);
    expect(resolveDesktopLocalWorker({ ...base, isPackaged: true, pythonPath: 'python' })).toBeNull();
  });

  it('means no worker when nothing was provisioned', () => {
    expect(resolveDesktopLocalWorker({ ...base, isPackaged: true, exists: () => false })).toBeNull();
  });
});

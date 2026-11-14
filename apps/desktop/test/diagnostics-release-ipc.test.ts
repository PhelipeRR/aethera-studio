import { describe, expect, it } from 'vitest';
import { IpcChannel, type AppInfo, type AppStatus } from '@neuralbridge/shared';
import { registerDiagnosticsReleaseIpcHandlers } from '../src/main/handlers/diagnostics-release.js';

type Listener = (event: { senderFrame: { url: string } | null }, payload: unknown) => Promise<unknown>;

class FakeIpc {
  readonly handlers = new Map<string, Listener>();

  handle(channel: string, listener: Listener): void {
    this.handlers.set(channel, listener);
  }

  async invoke(channel: string, payload: unknown, url = 'file:///app/index.html'): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`missing_handler:${channel}`);
    return handler({ senderFrame: { url } }, payload);
  }
}

const appInfo: AppInfo = { name: 'NeuralBridge', version: '0.1.58', platform: 'win32', electron: '38.0.0' };
const appStatus: AppStatus = { database: { ok: true, file: 'C:\\Users\\test\\brain.db' }, configuration: { ok: true, file: 'C:\\Users\\test\\preferences.json' } };

function setup(overrides: {
  getAppInfo?: () => AppInfo | Promise<AppInfo>;
  getAppStatus?: () => AppStatus | Promise<AppStatus>;
} = {}) {
  const calls: string[] = [];
  const ipc = new FakeIpc();
  registerDiagnosticsReleaseIpcHandlers(ipc, {
    getAppInfo: overrides.getAppInfo ?? (() => { calls.push('info'); return appInfo; }),
    getAppStatus: overrides.getAppStatus ?? (() => { calls.push('status'); return appStatus; }),
  }, (url) => url === 'file:///app/index.html');
  return { ipc, calls };
}

describe('diagnostics/release IPC handler group', () => {
  it('keeps version/build and health return values compatible', async () => {
    const { ipc, calls } = setup();

    await expect(ipc.invoke(IpcChannel.appInfo, undefined)).resolves.toEqual(appInfo);
    await expect(ipc.invoke(IpcChannel.appStatus, undefined)).resolves.toEqual(appStatus);
    expect(calls).toEqual(['info', 'status']);
  });

  it('rejects invalid payloads and untrusted senders before dependencies run', async () => {
    const { ipc, calls } = setup();

    await expect(ipc.invoke(IpcChannel.appInfo, {})).rejects.toThrow('Invalid payload');
    await expect(ipc.invoke(IpcChannel.appStatus, {}, 'https://evil.example')).rejects.toThrow('Untrusted sender');
    expect(calls).toEqual([]);
  });

  it('propagates health failures without exposing credentials', async () => {
    const { ipc } = setup({ getAppStatus: async () => { throw new Error('health_check_failed'); } });

    await expect(ipc.invoke(IpcChannel.appStatus, undefined)).rejects.toThrow('health_check_failed');

    const result = await ipc.invoke(IpcChannel.appInfo, undefined);
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('apiKey');
    expect(result).not.toHaveProperty('clientSecret');
  });

  it('rejects secret-bearing output instead of returning it to the renderer', async () => {
    const { ipc } = setup({
      getAppInfo: () => ({ ...appInfo, token: 'secret' } as AppInfo & { token: string }),
    });

    await expect(ipc.invoke(IpcChannel.appInfo, undefined)).rejects.toThrow(/unrecognized|token/i);
  });
});

import { describe, expect, it } from 'vitest';
import { IpcChannel } from '@neuralbridge/shared';
import { currentCorrelationId } from '@neuralbridge/orchestrator';
import { registerIpcHandler, type IpcMainLike, type IpcSenderInfo } from '../src/main/ipc/handle.js';

type Listener = (event: IpcSenderInfo, payload: unknown) => Promise<unknown>;

function fakeIpcMain(): IpcMainLike & { invoke(channel: string, senderUrl: string, payload: unknown): Promise<unknown> } {
  const handlers = new Map<string, Listener>();
  return {
    handle: (channel, listener) => {
      handlers.set(channel, listener as Listener);
    },
    invoke: (channel, senderUrl, payload) => {
      const listener = handlers.get(channel);
      if (!listener) throw new Error(`no handler for ${channel}`);
      return listener({ senderFrame: { url: senderUrl } }, payload);
    },
  };
}

const trusted = (url: string): boolean => url.startsWith('http://localhost:5173');

describe('registerIpcHandler', () => {
  it('passes validated input to the handler and returns validated output', async () => {
    const ipc = fakeIpcMain();
    registerIpcHandler(ipc, IpcChannel.themeSet, async ({ source }) => source, trusted);
    await expect(ipc.invoke(IpcChannel.themeSet, 'http://localhost:5173/', { source: 'light' })).resolves.toBe('light');
  });

  it('rejects invalid payloads without calling the handler', async () => {
    const ipc = fakeIpcMain();
    let called = false;
    registerIpcHandler(
      ipc,
      IpcChannel.themeSet,
      async ({ source }) => {
        called = true;
        return source;
      },
      trusted,
    );
    await expect(ipc.invoke(IpcChannel.themeSet, 'http://localhost:5173/', { source: 'rm -rf' })).rejects.toThrow(/invalid payload/i);
    expect(called).toBe(false);
  });

  it('rejects calls from frames outside the app', async () => {
    const ipc = fakeIpcMain();
    registerIpcHandler(ipc, IpcChannel.themeGet, async () => 'dark' as const, trusted);
    await expect(ipc.invoke(IpcChannel.themeGet, 'https://evil.example/', undefined)).rejects.toThrow(/untrusted sender/i);
  });
  it('runs each accepted request under its own correlation id', async () => {
    const ipc = fakeIpcMain();
    const seen: Array<string | undefined> = [];
    registerIpcHandler(ipc, IpcChannel.themeSet, async ({ source }) => { seen.push(currentCorrelationId()); return source; }, trusted);
    await ipc.invoke(IpcChannel.themeSet, 'http://localhost:5173/', { source: 'light' });
    await ipc.invoke(IpcChannel.themeSet, 'http://localhost:5173/', { source: 'dark' });
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[0]).not.toBe(seen[1]);
    expect(currentCorrelationId()).toBeUndefined();
  });
});

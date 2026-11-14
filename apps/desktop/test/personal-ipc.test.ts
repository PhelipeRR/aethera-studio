/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { IpcChannel } from '@neuralbridge/shared';
import { registerPersonalIpcHandlers } from '../src/main/handlers/personal.js';
import { PersonalAccountManager } from '../src/main/personal/account-manager.js';

describe('personal IPC', () => {
  it('returns sanitized accounts and accepts disconnect', async () => {
    const handlers = new Map<string, (event: any, payload: any) => Promise<unknown>>();
    const ipc = { handle: (channel: string, fn: any) => handlers.set(channel, fn) };
    const manager = new PersonalAccountManager({ saveToken: () => undefined, clearToken: () => undefined });
    manager.connect({ accountId: 'a1', provider: 'gmail', identifier: 'me', scopes: ['gmail.readonly'] }, { accessToken: 'secret', refreshToken: 'r', expiresAt: 1, scopes: [] });
    registerPersonalIpcHandlers(ipc, manager, () => true);
    await expect(handlers.get(IpcChannel.personalAccountsList)?.({ senderFrame: { url: 'app://trusted' } }, undefined)).resolves.toEqual([{ accountId: 'a1', provider: 'gmail', identifier: 'me', scopes: ['gmail.readonly'], state: 'connected' }]);
    await expect(handlers.get(IpcChannel.personalAccountDisconnect)?.({ senderFrame: { url: 'app://trusted' } }, { accountId: 'a1' })).resolves.toEqual({ ok: true });
  });
});

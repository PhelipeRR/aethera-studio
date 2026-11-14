/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { PersonalActionExecutor } from '../src/main/personal/action-executor.js';

describe('PersonalActionExecutor', () => {
  it('executes an approved mail action through the Gmail adapter', async () => {
    const sent: any[] = [];
    const executor = new PersonalActionExecutor({ token: () => ({ accessToken: 'token', refreshToken: 'refresh', expiresAt: 1, scopes: [] }), gmail: () => ({ send: async (input: any) => { sent.push(input); return { id: 'm1' }; } }) as any, calendar: () => { throw new Error('not expected'); } });
    await expect(executor.execute({ actionId: 'a', sessionId: null, actionType: 'mail.send', risk: 'confirm', summary: 'Enviar', fingerprint: 'f', createdAt: '2026-11-10T00:00:00.000Z', expiresAt: '2026-11-11T00:00:00.000Z', payload: { text: JSON.stringify({ to: ['boss@example.com'], subject: 'Report', body: 'Olá' }), projectId: 'account:a1' } } as any)).resolves.toContain('m1');
    expect(sent[0]).toMatchObject({ body: 'Olá' });
  });

  it('rejects unknown action types closed', async () => {
    const executor = new PersonalActionExecutor({ token: () => ({ accessToken: 'token', refreshToken: 'refresh', expiresAt: 1, scopes: [] }), gmail: () => { throw new Error('not expected'); }, calendar: () => { throw new Error('not expected'); } });
    await expect(executor.execute({ actionId: 'a', actionType: 'mail.delete', payload: { text: 'x' } } as any)).rejects.toThrow(/unsupported/);
  });
});

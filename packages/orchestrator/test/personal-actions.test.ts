/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { PersonalActionService } from '../src/personal-actions.js';

describe('PersonalActionService', () => {
  it('turns mail sends into confirmation-required broker requests', () => {
    const requests: any[] = [];
    const service = new PersonalActionService({ run: async (request) => { requests.push(request); return { actionId: request.actionId, status: 'requested', message: 'Aguardando confirmação humana.' }; }, decide: async () => ({ actionId: 'a', status: 'completed', message: 'ok' }) });
    return expect(service.sendMail({ accountId: 'a1', to: ['boss@example.com'], subject: 'Report', body: 'Olá' })).resolves.toMatchObject({ status: 'requested' }).then(() => {
      expect(requests[0]).toMatchObject({ actionType: 'mail.send', risk: 'confirm', summary: 'Enviar e-mail para boss@example.com: Report', payload: { projectId: 'account:a1' } });
      expect(JSON.parse(requests[0].payload.text)).toMatchObject({ to: ['boss@example.com'], subject: 'Report', body: 'Olá' });
      expect(requests[0].fingerprint).toHaveLength(64);
    });
  });

  it('uses the same action fingerprint for a repeated calendar request', async () => {
    const requests: any[] = [];
    const service = new PersonalActionService({ run: async (request) => { requests.push(request); return { actionId: request.actionId, status: 'requested', message: 'pending' }; }, decide: async () => ({ actionId: 'a', status: 'completed', message: 'ok' }) });
    await service.createEvent({ accountId: 'a1', summary: 'Review', start: '2026-11-10T10:00:00-03:00', end: '2026-11-10T11:00:00-03:00' });
    await service.createEvent({ accountId: 'a1', summary: 'Review', start: '2026-11-10T10:00:00-03:00', end: '2026-11-10T11:00:00-03:00' });
    expect(requests[0].fingerprint).toBe(requests[1].fingerprint);
  });
});

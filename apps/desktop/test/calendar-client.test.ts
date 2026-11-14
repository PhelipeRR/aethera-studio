import { describe, expect, it } from 'vitest';
import { GoogleCalendarClient } from '../src/main/personal/calendar-client.js';

describe('GoogleCalendarClient', () => {
  it('lists events in an RFC3339 window', async () => {
    const urls: string[] = [];
    const client = new GoogleCalendarClient('token', async (input) => { urls.push(String(input)); return new Response(JSON.stringify({ items: [{ id: 'e1', summary: 'Review', start: { dateTime: '2026-11-10T10:00:00-03:00' }, end: { dateTime: '2026-11-10T11:00:00-03:00' } }] })); });
    await expect(client.listEvents('2026-11-10T00:00:00-03:00', '2026-11-11T00:00:00-03:00')).resolves.toEqual([{ id: 'e1', summary: 'Review', start: '2026-11-10T10:00:00-03:00', end: '2026-11-10T11:00:00-03:00' }]);
    expect(urls[0]).toContain('timeMin=2026-11-10T00%3A00%3A00-03%3A00');
  });

  it('creates and cancels events through explicit methods', async () => {
    const methods: string[] = [];
    const client = new GoogleCalendarClient('token', async (_input, init) => { methods.push(init?.method ?? 'GET'); return new Response(JSON.stringify({ id: 'e1', summary: 'Review', start: { dateTime: '2026-11-10T10:00:00-03:00' }, end: { dateTime: '2026-11-10T11:00:00-03:00' } })); });
    await expect(client.createEvent({ summary: 'Review', start: '2026-11-10T10:00:00-03:00', end: '2026-11-10T11:00:00-03:00' })).resolves.toMatchObject({ id: 'e1' });
    await expect(client.cancelEvent('e1')).resolves.toBe(true);
    expect(methods).toEqual(['POST', 'DELETE']);
  });

  it('returns incremental events and the next sync token', async () => {
    const client = new GoogleCalendarClient('token', async () => new Response(JSON.stringify({ items: [{ id: 'e2', summary: 'New', start: { dateTime: '2026-11-10T12:00:00-03:00' }, end: { dateTime: '2026-11-10T13:00:00-03:00' } }], nextSyncToken: 'next' })));
    await expect(client.sync('old')).resolves.toMatchObject({ syncToken: 'next', events: [{ id: 'e2' }] });
  });
});

import { describe, expect, it } from 'vitest';
import { GmailClient } from '../src/main/personal/gmail-client.js';

describe('GmailClient', () => {
  it('searches messages with bearer auth and returns metadata only', async () => {
    const requests: Request[] = [];
    const client = new GmailClient('token', async (input, init) => { requests.push(new Request(input, init)); return new Response(JSON.stringify({ messages: [{ id: 'm1', threadId: 't1' }], resultSizeEstimate: 1 })); });
    await expect(client.search('from:boss')).resolves.toEqual({ ids: [{ id: 'm1', threadId: 't1' }], estimate: 1 });
    expect(requests[0]?.url).toContain('/messages?q=from%3Aboss');
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer token');
  });

  it('rejects non-success responses without exposing the token', async () => {
    const client = new GmailClient('super-secret', async () => new Response('nope', { status: 401 }));
    await expect(client.search('x')).rejects.toThrow(/Gmail 401/);
    await expect(client.search('x')).rejects.not.toThrow(/super-secret/);
  });

  it('reads metadata and sends only through explicit methods', async () => {
    const bodies: string[] = [];
    const client = new GmailClient('token', async (_input, init) => { bodies.push(String(init?.body ?? '')); return new Response(JSON.stringify({ id: 'm1', threadId: 't1', payload: { headers: [{ name: 'Subject', value: 'Hi' }] } })); });
    await expect(client.read('m1')).resolves.toMatchObject({ id: 'm1', threadId: 't1', subject: 'Hi' });
    await expect(client.send({ to: ['a@b.test'], subject: 'Hello', body: 'Text' })).resolves.toEqual({ id: 'm1' });
    expect(Buffer.from(JSON.parse(bodies[1] ?? '{}').raw, 'base64url').toString()).toContain('Subject: Hello');
  });

  it('resolves the connected email from the profile endpoint', async () => {
    const client = new GmailClient('token', async () => new Response(JSON.stringify({ emailAddress: 'me@example.com' })));
    await expect(client.profile()).resolves.toEqual({ emailAddress: 'me@example.com' });
  });

  it('returns incremental history records and the next history id', async () => {
    const client = new GmailClient('token', async () => new Response(JSON.stringify({ history: [{ id: 'h2', messagesAdded: [{ message: { id: 'm2', threadId: 't2' } }] }], historyId: 'h2' })));
    await expect(client.history('h1')).resolves.toEqual({ historyId: 'h2', messages: [{ id: 'm2', threadId: 't2' }] });
  });
});

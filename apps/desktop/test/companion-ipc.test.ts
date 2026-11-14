import { describe, expect, it } from 'vitest';
import { IpcChannel, IpcEvent } from '@neuralbridge/shared';
import { registerCompanionIpcHandlers } from '../src/main/companion-ipc.js';

const sessionId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const baseSession = { sessionId, taskId, agent: 'claude' as const, projectId: 'project-1', providerSessionId: 'provider-1', status: 'running' as const, connection: 'connected' as const, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };

class FakeSender {
  id = 7;
  destroyed = false;
  sent: Array<{ channel: string; payload: unknown }> = [];
  private destroyedListeners: Array<() => void> = [];
  isDestroyed = () => this.destroyed;
  send = (channel: string, payload: unknown) => this.sent.push({ channel, payload });
  once = (_event: 'destroyed', listener: () => void) => this.destroyedListeners.push(listener);
  destroy = () => { this.destroyed = true; for (const listener of this.destroyedListeners) listener(); };
}

function harness(enabled = true) {
  type Handler = (event: { senderFrame: { url: string }; sender: FakeSender }, payload: unknown) => Promise<unknown>;
  const handlers = new Map<string, Handler>();
  const ipc = { handle: (channel: string, listener: Handler) => handlers.set(channel, listener), removeHandler: (channel: string) => handlers.delete(channel) };
  const subscriptions = new Map<string, () => void>();
  const registry = {
    list: (query: { activeOnly?: boolean }) => query.activeOnly ? [] : [baseSession],
    get: (id: string) => id === sessionId ? baseSession : null,
    events: () => [],
    subscribe: (subscription: { subscriptionId: string }) => { subscriptions.set(subscription.subscriptionId, () => subscriptions.delete(subscription.subscriptionId)); return () => { subscriptions.delete(subscription.subscriptionId); }; },
  };
  const dispose = registerCompanionIpcHandlers(ipc, registry, (url) => url === 'app://trusted', () => enabled);
  const sender = new FakeSender();
  const invoke = (channel: string, payload: unknown, url = 'app://trusted') => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`missing handler: ${channel}`);
    return handler({ senderFrame: { url }, sender }, payload);
  };
  return { handlers, registry, sender, invoke, dispose };
}

describe('companion IPC', () => {
  it('validates trusted senders and bounded query inputs', async () => {
    const h = harness();
    await expect(h.invoke(IpcChannel.companionSessions, {}, 'https://evil.test')).rejects.toThrow('Untrusted sender');
    await expect(h.invoke(IpcChannel.companionSessions, { limit: 1000 })).rejects.toThrow();
    await expect(h.invoke(IpcChannel.companionSessions, {})).resolves.toMatchObject({ items: [baseSession] });
  });

  it('supports read-only queries and cleans subscriptions on window destruction', async () => {
    const h = harness();
    await expect(h.invoke(IpcChannel.companionSession, { sessionId })).resolves.toEqual(baseSession);
    await expect(h.invoke(IpcChannel.companionEvents, { sessionId })).resolves.toEqual({ items: [], nextOffset: null });
    const result = await h.invoke(IpcChannel.companionSubscribe, { filter: {} }) as { subscriptionId: string };
    expect(result.subscriptionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.sender.sent).toHaveLength(0);
    h.sender.destroy();
    await expect(h.invoke(IpcChannel.companionUnsubscribe, { subscriptionId: result.subscriptionId })).resolves.toEqual({ ok: true });
    expect(h.handlers.has(IpcChannel.companionSessions)).toBe(true);
    h.dispose();
    expect(h.handlers.size).toBe(0);
  });

  it('does not expose a renderer publication or approval channel', () => {
    const h = harness();
    expect(h.handlers.has(IpcEvent.companionChanged)).toBe(false);
    expect([...h.handlers.keys()]).not.toContain('companion:publish');
    h.dispose();
  });

  it('fails closed while the Companion extension is disabled', async () => {
    const h = harness(false);
    await expect(h.invoke(IpcChannel.companionSessions, {})).rejects.toThrow('extension_disabled');
    await expect(h.invoke(IpcChannel.companionSubscribe, { filter: {} })).rejects.toThrow('extension_disabled');
    h.dispose();
  });
});

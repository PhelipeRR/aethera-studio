import { randomUUID } from 'node:crypto';
import { IpcChannel, IpcEvent, parseIpcInput, parseIpcOutput, type IpcChannelName, type IpcInput } from '@neuralbridge/shared';
import { companionEventPageSchema, companionSessionPageSchema, companionSubscriptionResultSchema, companionOkSchema, type CompanionEvent, type CompanionEventFilter } from '@neuralbridge/shared/companion';
import type { CompanionSessionRegistry } from '@neuralbridge/orchestrator';

export interface CompanionSender {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
  once?(event: 'destroyed', listener: () => void): void;
}
export interface CompanionIpcEvent { senderFrame: { url: string } | null; sender: CompanionSender; }
export interface CompanionIpcMainLike {
  handle(channel: string, listener: (event: CompanionIpcEvent, payload: unknown) => Promise<unknown>): void;
  removeHandler?(channel: string): void;
}

type ReadRegistry = Pick<CompanionSessionRegistry, 'list' | 'get' | 'events' | 'subscribe'>;

export function registerCompanionIpcHandlers(ipc: CompanionIpcMainLike, registry: ReadRegistry | null, isTrustedSender: (url: string) => boolean, isEnabled: () => boolean = () => true): () => void {
  const subscriptions = new Map<number, Map<string, () => void>>();
  const channels = [IpcChannel.companionSessions, IpcChannel.companionSession, IpcChannel.companionEvents, IpcChannel.companionSubscribe, IpcChannel.companionUnsubscribe] as const;
  const read = <C extends IpcChannelName>(channel: C, handler: (input: IpcInput<C>, event: CompanionIpcEvent) => unknown): void => {
    ipc.handle(channel, async (event, payload) => {
      if (!isTrustedSender(event.senderFrame?.url ?? '')) throw new Error(`Untrusted sender for ${channel}`);
      if (channel !== IpcChannel.companionUnsubscribe && !isEnabled()) throw new Error('extension_disabled: Companion está desativado.');
      const input = parseIpcInput(channel, payload);
      return parseIpcOutput(channel, await handler(input, event));
    });
  };
  const requireRegistry = (): ReadRegistry => {
    if (!registry) throw new Error('unavailable: Companion registry is unavailable');
    return registry;
  };
  read(IpcChannel.companionSessions, (input) => {
    const items = requireRegistry().list(input);
    const nextOffset = items.length < input.limit ? null : input.offset + items.length;
    return companionSessionPageSchema.parse({ items, nextOffset });
  });
  read(IpcChannel.companionSession, (input) => requireRegistry().get(input.sessionId));
  read(IpcChannel.companionEvents, (input) => {
    const items = requireRegistry().events(input.sessionId, input);
    const nextOffset = items.length < input.limit ? null : input.offset + items.length;
    return companionEventPageSchema.parse({ items, nextOffset });
  });
  read(IpcChannel.companionSubscribe, (input, event) => {
    const subscriptionId = randomUUID();
    const unsubscribe = requireRegistry().subscribe({ subscriptionId, filter: input.filter as CompanionEventFilter, createdAt: new Date().toISOString() }, (companionEvent: CompanionEvent) => {
      if (event.sender.isDestroyed()) return;
      event.sender.send(IpcEvent.companionChanged, { subscriptionId, event: companionEvent });
    });
    let owned = subscriptions.get(event.sender.id);
    if (!owned) { owned = new Map(); subscriptions.set(event.sender.id, owned); }
    owned.set(subscriptionId, unsubscribe);
    event.sender.once?.('destroyed', () => remove(event.sender.id, subscriptionId));
    return companionSubscriptionResultSchema.parse({ subscriptionId });
  });
  read(IpcChannel.companionUnsubscribe, (input, event) => {
    remove(event.sender.id, input.subscriptionId);
    return companionOkSchema.parse({ ok: true });
  });
  function remove(windowId: number, subscriptionId: string): void {
    const owned = subscriptions.get(windowId);
    const unsubscribe = owned?.get(subscriptionId);
    unsubscribe?.();
    owned?.delete(subscriptionId);
    if (owned?.size === 0) subscriptions.delete(windowId);
  }
  return () => {
    for (const owned of subscriptions.values()) for (const unsubscribe of owned.values()) unsubscribe();
    subscriptions.clear();
    for (const channel of channels) ipc.removeHandler?.(channel);
  };
}

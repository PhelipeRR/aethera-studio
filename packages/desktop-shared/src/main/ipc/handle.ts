import { randomUUID } from 'node:crypto';
import { withCorrelation } from '@neuralbridge/orchestrator';
import { parseIpcInput, parseIpcOutput, type IpcChannelName, type IpcInput, type IpcOutput } from '@neuralbridge/shared';

export interface IpcSenderInfo {
  senderFrame: { url: string } | null;
}

/** The subset of Electron's ipcMain used here, so handlers can be tested without Electron. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: IpcSenderInfo, payload: unknown) => Promise<unknown>): void;
}

export class IpcRejectedError extends Error {
  override name = 'IpcRejectedError';
}

export function registerIpcHandler<C extends IpcChannelName>(
  ipc: IpcMainLike,
  channel: C,
  handler: (input: IpcInput<C>) => Promise<IpcOutput<C>>,
  isTrustedSender: (url: string) => boolean,
): void {
  ipc.handle(channel, async (event, payload) => {
    const senderUrl = event.senderFrame?.url ?? '';
    if (!isTrustedSender(senderUrl)) {
      throw new IpcRejectedError(`Untrusted sender for ${channel}`);
    }
    let input: IpcInput<C>;
    try {
      input = parseIpcInput(channel, payload);
    } catch {
      throw new IpcRejectedError(`Invalid payload for ${channel}`);
    }
    // Every accepted request gets its own correlation id; tasks, evidence and integration calls it starts inherit it.
    return parseIpcOutput(channel, await withCorrelation(randomUUID(), () => handler(input)));
  });
}

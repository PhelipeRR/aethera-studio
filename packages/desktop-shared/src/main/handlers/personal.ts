import { IpcChannel, parseIpcOutput } from '@neuralbridge/shared';
import type { PersonalAccountManager } from '../personal/account-manager.js';
import type { PersonalActionService } from '@neuralbridge/orchestrator';
import type { PersonalNotificationRepository } from '@neuralbridge/database';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

export interface PersonalIpcOAuth { importClient(): Promise<{ configured: true; clientId: string }>; connect(options: { gmailSend?: boolean | undefined; calendarWrite?: boolean | undefined }): Promise<{ connected: true; scopes: string[] }>; }
export function registerPersonalIpcHandlers(ipc: IpcMainLike, manager: PersonalAccountManager, isTrustedSender: (url: string) => boolean, oauth?: PersonalIpcOAuth, actions?: PersonalActionService, notifications?: PersonalNotificationRepository): void {
  registerIpcHandler(ipc, IpcChannel.personalAccountsList, async () => parseIpcOutput(IpcChannel.personalAccountsList, manager.list()), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.personalAccountDisconnect, async ({ accountId }) => { manager.disconnect(accountId); return parseIpcOutput(IpcChannel.personalAccountDisconnect, { ok: true }); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.personalGoogleImportClient, async () => { if (!oauth) throw new Error('unavailable: OAuth Google não configurado.'); return parseIpcOutput(IpcChannel.personalGoogleImportClient, await oauth.importClient()); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.personalGoogleConnect, async (options) => { if (!oauth) throw new Error('unavailable: OAuth Google não configurado.'); return parseIpcOutput(IpcChannel.personalGoogleConnect, await oauth.connect(options ?? {})); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.personalActionSendMail, async (input) => { if (!actions) throw new Error('unavailable: ações pessoais indisponíveis.'); return parseIpcOutput(IpcChannel.personalActionSendMail, await actions.sendMail(input)); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.personalActionCreateEvent, async (input) => { if (!actions) throw new Error('unavailable: ações pessoais indisponíveis.'); return parseIpcOutput(IpcChannel.personalActionCreateEvent, await actions.createEvent(input)); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.personalActionDecide, async (input) => { if (!actions) throw new Error('unavailable: ações pessoais indisponíveis.'); return parseIpcOutput(IpcChannel.personalActionDecide, await actions.decide(input)); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.personalNotificationsList, async (input) => { if (!notifications) throw new Error('unavailable: notificações pessoais indisponíveis.'); return parseIpcOutput(IpcChannel.personalNotificationsList, notifications.list(input?.unreadOnly ?? false)); }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.personalNotificationRead, async ({ id }) => { if (!notifications) throw new Error('unavailable: notificações pessoais indisponíveis.'); notifications.markRead(id); return parseIpcOutput(IpcChannel.personalNotificationRead, { ok: true }); }, isTrustedSender);
}

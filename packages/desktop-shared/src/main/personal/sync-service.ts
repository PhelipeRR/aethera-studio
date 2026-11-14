import type { PersonalAccountMetadata } from './account-manager.js';
import type { IntegrationTokens } from '../security/integration-token-store.js';
import type { GmailClient } from './gmail-client.js';
import type { GoogleCalendarClient } from './calendar-client.js';
import type { PersonalSyncRepository, PersonalNotificationRepository } from '@neuralbridge/database';

export interface PersonalSyncServiceDeps { accounts(): PersonalAccountMetadata[]; token(accountId: string): IntegrationTokens | null; gmail(token: string): GmailClient; calendar(token: string): GoogleCalendarClient; sync: PersonalSyncRepository; notifications: PersonalNotificationRepository; onError(accountId: string, error: unknown): void; }
export class PersonalSyncService {
  constructor(private readonly deps: PersonalSyncServiceDeps) {}
  async run(): Promise<{ accounts: number; events: number }> {
    let events = 0; const accounts = this.deps.accounts().filter((account) => account.state === 'connected');
    for (const account of accounts) { const token = this.deps.token(account.accountId); if (!token) continue; try { events += account.provider === 'gmail' ? await this.syncGmail(account.accountId, token.accessToken) : account.provider === 'calendar' ? await this.syncCalendar(account.accountId, token.accessToken) : 0; } catch (error) { this.deps.onError(account.accountId, error); } }
    return { accounts: accounts.length, events };
  }
  private async syncGmail(accountId: string, accessToken: string): Promise<number> { const client = this.deps.gmail(accessToken); const cursor = this.deps.sync.cursor(accountId, 'gmail-history'); if (!cursor) { const profile = await client.profile(); this.deps.sync.saveCursor(accountId, 'gmail-history', String(profile.messagesTotal ?? 0)); return 0; } const result = await client.history(cursor); this.deps.sync.saveCursor(accountId, 'gmail-history', result.historyId); let added = 0; for (const message of result.messages) if (this.deps.sync.markProcessed(accountId, `gmail:${message.id}`)) { this.deps.notifications.push({ id: `gmail:${accountId}:${message.id}`, priority: 'normal', channel: 'desktop', groupKey: `gmail:${accountId}`, title: 'Novo e-mail recebido', metadata: { accountId, messageId: message.id }, dedupeKey: `gmail:${accountId}:${message.id}`, createdAt: new Date().toISOString() }); added++; } return added; }
  private async syncCalendar(accountId: string, accessToken: string): Promise<number> { const client = this.deps.calendar(accessToken); const cursor = this.deps.sync.cursor(accountId, 'calendar-sync-token'); if (!cursor) return 0; const result = await client.sync(cursor); this.deps.sync.saveCursor(accountId, 'calendar-sync-token', result.syncToken); return result.events.reduce((count, event) => count + (this.deps.sync.markProcessed(accountId, `calendar:${event.id}`) ? 1 : 0), 0); }
}

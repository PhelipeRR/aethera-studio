import type { IntegrationTokens } from '../security/integration-token-store.js';
import type { PersonalConnectorStatus } from '@neuralbridge/shared';

export interface PersonalAccountMetadata { accountId: string; provider: 'gmail' | 'calendar' | 'whatsapp'; identifier: string; scopes: string[]; state: PersonalConnectorStatus['state']; }
export interface PersonalAccountTokenPort { saveToken(accountId: string, token: IntegrationTokens): void; clearToken(accountId: string): void; }
export interface PersonalAccountMetadataPort { load(): PersonalAccountMetadata[]; save(account: PersonalAccountMetadata): void; delete(accountId: string): void; }

/** Owns the account seam: metadata is safe to expose, tokens never are. */
export class PersonalAccountManager {
  private readonly accounts = new Map<string, PersonalAccountMetadata>();
  constructor(private readonly tokens: PersonalAccountTokenPort, private readonly metadata?: PersonalAccountMetadataPort) { for (const account of metadata?.load() ?? []) this.accounts.set(account.accountId, { ...account, scopes: [...account.scopes] }); }
  connect(metadata: Omit<PersonalAccountMetadata, 'state'>, token: IntegrationTokens): void { this.tokens.saveToken(metadata.accountId, token); const account = { ...metadata, state: 'connected' as const }; this.accounts.set(metadata.accountId, account); this.metadata?.save(account); }
  list(): PersonalAccountMetadata[] { return [...this.accounts.values()].map((account) => ({ ...account, scopes: [...account.scopes] })); }
  disconnect(accountId: string): boolean { if (!this.accounts.delete(accountId)) return false; this.tokens.clearToken(accountId); this.metadata?.delete(accountId); return true; }
  markError(accountId: string): void { const account = this.accounts.get(accountId); if (account) { account.state = 'error'; this.metadata?.save(account); } }
}

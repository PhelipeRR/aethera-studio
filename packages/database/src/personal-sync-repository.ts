import { and, eq } from 'drizzle-orm';
import { personalProcessedEvents, personalSyncState } from './schema.js';
import type { Db } from './open.js';

export class PersonalSyncRepository {
  constructor(private readonly db: Db) {}
  cursor(accountId: string, resource: string): string | null { return this.db.select().from(personalSyncState).where(and(eq(personalSyncState.accountId, accountId), eq(personalSyncState.resource, resource))).get()?.cursor ?? null; }
  saveCursor(accountId: string, resource: string, cursor: string): void { this.db.insert(personalSyncState).values({ accountId, resource, cursor, updatedAt: new Date().toISOString() }).onConflictDoUpdate({ target: [personalSyncState.accountId, personalSyncState.resource], set: { cursor, updatedAt: new Date().toISOString() } }).run(); }
  markProcessed(accountId: string, eventKey: string): boolean { try { this.db.insert(personalProcessedEvents).values({ accountId, eventKey, processedAt: new Date().toISOString() }).run(); return true; } catch { return false; } }
}

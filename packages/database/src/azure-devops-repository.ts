import { eq, and, asc } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { azureDevOpsCache, azureDevOpsConnections } from './schema.js';
import type { Db } from './open.js';
import { azureDevOpsCapabilitiesSchema, azureDevOpsConnectionInputSchema, azureDevOpsConnectionStatusSchema, type AzureDevOpsCapabilities, type AzureDevOpsConnectionInput, type AzureDevOpsConnectionStatus } from '@neuralbridge/shared';

export class AzureDevOpsRepository {
  constructor(private readonly db: Db) {}
  saveConnection(input: AzureDevOpsConnectionInput, status: AzureDevOpsConnectionStatus = 'disconnected', capabilities: AzureDevOpsCapabilities | null = null): string {
    const value = azureDevOpsConnectionInputSchema.parse(input); const existing = this.db.select({ id: azureDevOpsConnections.id }).from(azureDevOpsConnections).where(and(eq(azureDevOpsConnections.baseUrl, value.baseUrl), eq(azureDevOpsConnections.collection, value.collection), eq(azureDevOpsConnections.project, value.project))).get(); const id = existing?.id ?? randomUUID();
    this.db.insert(azureDevOpsConnections).values({ id, ...value, capabilities: JSON.stringify(capabilities ?? {}), status }).onConflictDoUpdate({ target: azureDevOpsConnections.id, set: { status, readOnly: value.readOnly, capabilities: JSON.stringify(capabilities ?? {}), updatedAt: new Date().toISOString() } }).run(); return id;
  }
  connection(id: string) { const row = this.db.select().from(azureDevOpsConnections).where(eq(azureDevOpsConnections.id, id)).get(); if (!row) return null; return { ...row, status: azureDevOpsConnectionStatusSchema.parse(row.status), capabilities: azureDevOpsCapabilitiesSchema.safeParse(JSON.parse(row.capabilities)).success ? JSON.parse(row.capabilities) as AzureDevOpsCapabilities : null }; }
  connections() { return this.db.select().from(azureDevOpsConnections).orderBy(asc(azureDevOpsConnections.updatedAt)).all().map((row) => ({ ...row, status: azureDevOpsConnectionStatusSchema.parse(row.status), capabilities: azureDevOpsCapabilitiesSchema.safeParse(JSON.parse(row.capabilities)).success ? JSON.parse(row.capabilities) as AzureDevOpsCapabilities : null })); }
  setStatus(id: string, status: AzureDevOpsConnectionStatus, capabilities?: AzureDevOpsCapabilities): void { this.db.update(azureDevOpsConnections).set({ status, ...(capabilities ? { capabilities: JSON.stringify(capabilities) } : {}), updatedAt: new Date().toISOString() }).where(eq(azureDevOpsConnections.id, id)).run(); }
  saveCache(connectionId: string, entityType: string, entityId: string, payload: unknown): void { this.db.insert(azureDevOpsCache).values({ connectionId, entityType, entityId, payload: JSON.stringify(payload), fetchedAt: new Date().toISOString() }).onConflictDoUpdate({ target: [azureDevOpsCache.connectionId, azureDevOpsCache.entityType, azureDevOpsCache.entityId], set: { payload: JSON.stringify(payload), fetchedAt: new Date().toISOString() } }).run(); }
  listCache(connectionId: string, entityType?: string) { const rows = this.db.select().from(azureDevOpsCache).where(entityType ? and(eq(azureDevOpsCache.connectionId, connectionId), eq(azureDevOpsCache.entityType, entityType)) : eq(azureDevOpsCache.connectionId, connectionId)).orderBy(asc(azureDevOpsCache.fetchedAt)).all(); return rows.map((row) => ({ kind: row.entityType, id: row.entityId, payload: JSON.parse(row.payload) as unknown, fetchedAt: row.fetchedAt })); }
}

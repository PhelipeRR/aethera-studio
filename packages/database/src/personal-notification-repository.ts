import { and, eq, isNull } from 'drizzle-orm';
import { personalNotifications } from './schema.js';
import type { Db } from './open.js';

export interface PersistedPersonalNotification { id: string; priority: 'low' | 'normal' | 'high' | 'urgent'; channel: string; groupKey?: string; title: string; metadata?: Record<string, unknown>; dedupeKey: string; readAt?: string; createdAt: string; }
export class PersonalNotificationRepository {
  constructor(private readonly db: Db) {}
  list(unreadOnly = false): PersistedPersonalNotification[] { const rows = (unreadOnly ? this.db.select().from(personalNotifications).where(isNull(personalNotifications.readAt)) : this.db.select().from(personalNotifications)).all(); return rows.map((row) => ({ id: row.id, priority: row.priority as PersistedPersonalNotification['priority'], channel: row.channel, ...(row.groupKey ? { groupKey: row.groupKey } : {}), title: row.title, metadata: parseMetadata(row.metadataJson), dedupeKey: row.dedupeKey, ...(row.readAt ? { readAt: row.readAt } : {}), createdAt: row.createdAt })); }
  push(notification: Omit<PersistedPersonalNotification, 'readAt'>): boolean { try { this.db.insert(personalNotifications).values({ id: notification.id, priority: notification.priority, channel: notification.channel, groupKey: notification.groupKey ?? null, title: notification.title, metadataJson: JSON.stringify(notification.metadata ?? {}), dedupeKey: notification.dedupeKey, readAt: null, createdAt: notification.createdAt }).run(); return true; } catch { return false; } }
  markRead(id: string): boolean { return this.db.update(personalNotifications).set({ readAt: new Date().toISOString() }).where(and(eq(personalNotifications.id, id), isNull(personalNotifications.readAt))).run().changes > 0; }
}
function parseMetadata(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }

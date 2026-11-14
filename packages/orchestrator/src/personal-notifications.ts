export type PersonalNotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export interface PersonalNotification { id: string; dedupeKey: string; groupKey?: string; title: string; priority: PersonalNotificationPriority; createdAt: string; readAt?: string; }
export interface QuietHours { quietFrom: string; quietTo: string; }

export class PersonalNotificationCenter {
  private readonly items = new Map<string, PersonalNotification>();
  constructor(private readonly quiet?: QuietHours) {}
  push(notification: PersonalNotification): boolean { if ([...this.items.values()].some((item) => item.dedupeKey === notification.dedupeKey)) return false; this.items.set(notification.id, { ...notification }); return true; }
  markRead(id: string): boolean { const item = this.items.get(id); if (!item || item.readAt) return false; item.readAt = new Date().toISOString(); return true; }
  pending(now: string): PersonalNotification[] { if (this.isQuiet(now)) return []; return [...this.items.values()].filter((item) => !item.readAt).sort((a, b) => priority(b.priority) - priority(a.priority) || a.createdAt.localeCompare(b.createdAt)); }
  grouped(now: string): Array<{ groupKey: string; items: PersonalNotification[] }> { const groups = new Map<string, PersonalNotification[]>(); for (const item of this.pending(now)) { const key = item.groupKey ?? item.id; groups.set(key, [...(groups.get(key) ?? []), item]); } return [...groups].map(([groupKey, items]) => ({ groupKey, items })); }
  private isQuiet(value: string): boolean { if (!this.quiet) return false; const time = value.slice(11, 16); const { quietFrom, quietTo } = this.quiet; return quietFrom <= quietTo ? time >= quietFrom && time < quietTo : time >= quietFrom || time < quietTo; }
}
function priority(value: PersonalNotificationPriority): number { return { low: 0, normal: 1, high: 2, urgent: 3 }[value]; }

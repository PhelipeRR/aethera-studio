import { describe, expect, it } from 'vitest';
import { PersonalNotificationCenter } from '../src/personal-notifications.js';

describe('PersonalNotificationCenter', () => {
  it('deduplicates and groups notifications while respecting quiet hours', () => {
    const center = new PersonalNotificationCenter({ quietFrom: '22:00', quietTo: '07:00' });
    expect(center.push({ id: 'n1', dedupeKey: 'mail:1', groupKey: 'mail', title: 'Important mail', priority: 'high', createdAt: '2026-11-10T23:00:00-03:00' })).toBe(true);
    expect(center.push({ id: 'n2', dedupeKey: 'mail:1', groupKey: 'mail', title: 'Duplicate', priority: 'normal', createdAt: '2026-11-10T23:01:00-03:00' })).toBe(false);
    expect(center.pending('2026-11-10T23:02:00-03:00')).toEqual([]);
    expect(center.pending('2026-11-10T12:00:00-03:00')).toHaveLength(1);
    expect(center.markRead('n1')).toBe(true);
    expect(center.pending('2026-11-10T12:00:00-03:00')).toEqual([]);
  });
});

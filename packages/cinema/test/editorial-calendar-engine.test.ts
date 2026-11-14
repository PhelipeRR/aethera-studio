import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EditorialCalendarEngine,
  analyzeCalendarHealth,
  formatInTimezone,
  localDateTimeToUtcIso,
  suggestSmartSchedule,
} from '../src/calendar/editorial-calendar-engine.js';

const tempDirs: string[] = [];

function createTempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-cal-'));
  tempDirs.push(dir);
  return join(dir, 'editorial-calendar-store.json');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('EditorialCalendarEngine 2.0', () => {
  it('persists events, enforces Review Room gate, tracks reschedule history, and handles DST/IANA timezones', () => {
    const storePath = createTempStorePath();
    const engine = new EditorialCalendarEngine(storePath, 'America/Sao_Paulo');

    // DST transition check in America/New_York (spring forward vs standard time)
    const winterIso = localDateTimeToUtcIso('2026-01-15', '18:00', 'America/New_York');
    const summerIso = localDateTimeToUtcIso('2026-07-15', '18:00', 'America/New_York');
    expect(formatInTimezone(winterIso, 'America/New_York').timeHHmm).toBe('18:00');
    expect(formatInTimezone(summerIso, 'America/New_York').timeHHmm).toBe('18:00');
    expect(formatInTimezone(summerIso, 'America/New_York').dstActive).toBe(true);

    // Unapproved event can be planned, but CANNOT be scheduled for auto-publish
    const draft = engine.upsertEvent({
      title: 'TOP 10 Jogos de 2027',
      description: 'Ranking completo',
      channelId: 'main_yt',
      channelName: 'Canal Principal',
      platform: 'youtube',
      format: 'top10',
      plannedDateIso: '2026-11-17T21:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      status: 'producing',
      reviewApproved: false,
    });

    expect(() =>
      engine.schedulePlatformPublish({ id: draft.id, publishAtIso: '2026-11-17T21:00:00.000Z' }),
    ).toThrow(/review_approval_required/);

    // Move planned date & verify rescheduleHistory
    const moved = engine.moveEvent({
      id: draft.id,
      targetDateIso: '2026-11-20T21:00:00.000Z',
      targetKind: 'planned',
      reason: 'Ajuste de pauta',
    });
    expect(moved.rescheduleHistory).toHaveLength(1);
    expect(moved.rescheduleHistory[0]?.toIso).toBe('2026-11-20T21:00:00.000Z');

    // Approve in Review Room -> now platform scheduling succeeds
    engine.upsertEvent({ ...moved, reviewApproved: true, status: 'approved' });
    const scheduled = engine.schedulePlatformPublish({
      id: draft.id,
      publishAtIso: '2026-11-20T21:00:00.000Z',
    });
    expect(scheduled.status).toBe('scheduled');
    expect(scheduled.scheduledPublishAtIso).toBe('2026-11-20T21:00:00.000Z');

    // Reload from disk and verify persistence
    const reloaded = new EditorialCalendarEngine(storePath);
    expect(reloaded.getSnapshot().events).toHaveLength(1);
    expect(reloaded.getSnapshot().events[0]?.rescheduleHistory).toHaveLength(1);
  });

  it('detects conflicts, delays, near-publish unapproved alerts, gaps, recurring series, and smart metric-based suggestions', () => {
    const storePath = createTempStorePath();
    const engine = new EditorialCalendarEngine(storePath, 'America/Sao_Paulo');

    // Published video with real metrics at 19:00 local (22:00Z)
    engine.upsertEvent({
      title: 'Análise Elden Ring',
      description: 'Sucesso de audiência',
      channelId: 'main_yt',
      channelName: 'Canal Principal',
      platform: 'youtube',
      format: 'analysis',
      plannedDateIso: '2026-11-10T22:00:00.000Z',
      scheduledPublishAtIso: '2026-11-10T22:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      status: 'published',
      reviewApproved: true,
      metrics: { views: 85_000, ctr: 8.4 },
    });

    // Two conflicting events within 30 minutes + unapproved near publish
    const evA = engine.upsertEvent({
      title: 'Nostalgia PS2',
      description: 'Clássicos',
      channelId: 'main_yt',
      channelName: 'Canal Principal',
      platform: 'youtube',
      format: 'nostalgia',
      plannedDateIso: '2026-11-15T21:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      status: 'in_review',
      reviewApproved: false,
    });
    const evB = engine.upsertEvent({
      title: 'Curiosidades GTA 6',
      description: 'Segredos do trailer',
      channelId: 'main_yt',
      channelName: 'Canal Principal',
      platform: 'youtube',
      format: 'curiosities',
      plannedDateIso: '2026-11-15T21:30:00.000Z',
      timezone: 'America/Sao_Paulo',
      status: 'failed',
      reviewApproved: false,
      integrationError: 'YouTube quota exceeded',
    });

    const health = analyzeCalendarHealth(engine.getSnapshot().events, '2026-11-14T18:00:00.000Z', '2026-11-14', 14);
    expect(health.conflictEventIds).toContain(evA.id);
    expect(health.conflictEventIds).toContain(evB.id);
    expect(health.unapprovedNearPublishIds).toContain(evA.id);
    expect(health.integrationFailureIds).toContain(evB.id);
    expect(health.contentGaps.length).toBeGreaterThan(0);

    // Recurring series ("Notícias de Games" every Friday 18:00)
    const series = engine.upsertSeries({
      name: 'Notícias de Games',
      channelId: 'main_yt',
      channelName: 'Canal Principal',
      platform: 'youtube',
      format: 'news',
      weekday: 5,
      timeHHmm: '18:00',
      timezone: 'America/Sao_Paulo',
      leadDaysForProduction: 3,
      promptTemplate: 'Resumo semanal',
      active: true,
    });
    const generated = engine.generateSeriesOccurrences(series.id, 3, '2026-11-14T12:00:00.000Z');
    expect(generated.length).toBeGreaterThanOrEqual(2);

    // Smart suggestions use real metrics (19:00) and balance Shorts
    const suggestions = suggestSmartSchedule({
      events: engine.getSnapshot().events,
      defaultChannel: { channelId: 'main_yt', channelName: 'Canal Principal' },
      timezone: 'America/Sao_Paulo',
      nowIso: '2026-11-14T18:00:00.000Z',
    });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.platform === 'youtube_shorts')).toBe(true);
  });
});

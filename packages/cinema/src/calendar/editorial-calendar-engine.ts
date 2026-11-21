import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RecapChapterMarker } from '../recap/recap-chapter-markers.js';
import type { YouTubeTimelineChapter } from './youtube-chapter-generator.js';

export type CalendarEventStatus =
  | 'draft'
  | 'scripting'
  | 'producing'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

export type CalendarPlatform = 'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok';

export type ProductionSourceMode = 'manual_project' | 'ai_cinema' | 'manga_recap' | 'media_library';

export interface PlatformDestinationState {
  platform: CalendarPlatform;
  status: CalendarEventStatus;
  title: string;
  description: string;
  hashtags: string[];
  tags?: string[];
  thumbnailUrl?: string;
  videoPath?: string;
  aspectRatio?: '16:9' | '9:16';
  remoteId?: string;
  remoteUrl?: string;
  lastError?: string;
  publishedAtIso?: string;
  attempts?: number;
  updatedAtIso?: string;
}

export interface RightsVerificationState {
  verified: boolean;
  verifiedAtIso?: string;
  sourceAuthorized: boolean;
  musicAndSfxLicensed: boolean;
  noProhibitedWatermarks: boolean;
  transformativeEditorialUse: boolean;
  notes?: string;
}

export interface QualityGatesReadinessState {
  gateF?: 'pass' | 'needs_review' | 'fail';
  gateG?: 'pass' | 'needs_review' | 'fail';
  gateH?: 'pass' | 'needs_review' | 'fail';
  allMandatoryPassed: boolean;
}

export interface RecapPublicationBinding {
  runId: string;
  seriesProjectId?: string;
  workTitle: string;
  chapterNumbers: number[];
  chapterMarkers?: RecapChapterMarker[];
  singleVideoMode: boolean;
}

export interface YouTubeLongFormStudioMeta {
  tags: string[];
  savedTitleVersions: string[];
  chapters: YouTubeTimelineChapter[];
  thumbnailApproved: boolean;
  thumbnailPath?: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
  categoryId?: string;
  defaultLanguage?: string;
}

export interface PublicationAuditEntry {
  id: string;
  timestampIso: string;
  action:
    | 'created'
    | 'scheduled'
    | 'rescheduled'
    | 'platform_publishing'
    | 'platform_published'
    | 'platform_failed'
    | 'cancelled'
    | 'platform_cancelled'
    | 'metadata_updated'
    | 'rights_verified'
    | 'thumbnail_updated'
    | 'chapters_updated';
  actor: 'user' | 'cloud_worker' | 'system';
  platform?: CalendarPlatform;
  detail: string;
}

export type CalendarFormat =
  | 'long'
  | 'short'
  | 'top10'
  | 'news'
  | 'analysis'
  | 'nostalgia'
  | 'curiosities'
  | 'documentary';

export interface RescheduleHistoryEntry {
  fromIso: string;
  toIso: string;
  targetKind: 'planned' | 'scheduled';
  changedAt: string;
  reason?: string;
}

export interface EditorialCalendarMetrics {
  views?: number;
  ctr?: number;
  avgViewDurationSec?: number;
}

export interface EditorialCalendarEvent {
  id: string;
  /** Identificador único compartilhado entre Calendário e Central de Publicações (evita duplicação) */
  publicationId?: string;
  title: string;
  description: string;
  channelId: string;
  channelName: string;
  platform: CalendarPlatform;
  /** Múltiplas plataformas vinculadas ao mesmo agendamento unificado (YouTube, Instagram, TikTok, Shorts) */
  platforms?: CalendarPlatform[];
  /** Estado independente por plataforma — falha em uma não bloqueia as demais */
  platformTargets?: Partial<Record<CalendarPlatform, PlatformDestinationState>>;
  format: CalendarFormat;
  productionMode?: ProductionSourceMode;
  projectId?: string;
  thumbnailUrl?: string;
  videoPath?: string;
  videoDurationMs?: number;
  cloudMediaKey?: string;
  /** Data/hora editorial planejada pela equipe (independente do agendamento na plataforma) */
  plannedDateIso: string;
  /** Data/hora efetivamente agendada na plataforma (YouTube/Instagram/TikTok); exige aprovação + direitos */
  scheduledPublishAtIso?: string;
  /** Fuso horário IANA (ex.: America/Sao_Paulo) */
  timezone: string;
  status: CalendarEventStatus;
  reviewApproved: boolean;
  reviewApprovedAt?: string;
  qualityGates?: QualityGatesReadinessState;
  rightsVerification?: RightsVerificationState;
  recapBinding?: RecapPublicationBinding;
  youtubeStudio?: YouTubeLongFormStudioMeta;
  integrationError?: string;
  seriesId?: string;
  batchSeriesId?: string;
  /** Antecipação recomendada para iniciar produção (dias antes da data planejada) */
  productionLeadDays?: number;
  metrics?: EditorialCalendarMetrics;
  rescheduleHistory: RescheduleHistoryEntry[];
  auditLog?: PublicationAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface RecurringSeriesRule {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  platform: CalendarPlatform;
  format: CalendarFormat;
  /** 0 = Domingo .. 6 = Sábado */
  weekday: number;
  /** HH:mm no fuso horário IANA da série */
  timeHHmm: string;
  timezone: string;
  leadDaysForProduction: number;
  promptTemplate: string;
  active: boolean;
  createdAt: string;
}

export interface EditorialCalendarStoreSnapshot {
  schemaVersion: 1;
  defaultTimezone: string;
  events: EditorialCalendarEvent[];
  series: RecurringSeriesRule[];
}

export interface CalendarGapPeriod {
  startDayKey: string;
  endDayKey: string;
  daysCount: number;
}

export interface CalendarHealthReport {
  conflictEventIds: string[];
  delayedEventIds: string[];
  unapprovedNearPublishIds: string[];
  integrationFailureIds: string[];
  contentGaps: CalendarGapPeriod[];
}

export interface SmartScheduleSuggestion {
  id: string;
  suggestedDateIso: string;
  timezone: string;
  channelId: string;
  channelName: string;
  platform: CalendarPlatform;
  format: CalendarFormat;
  suggestedTitle: string;
  rationale: string;
  confidence: number;
  productionStartIso: string;
}

export function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function formatInTimezone(
  iso: string,
  timezone: string,
): { dayKey: string; timeHHmm: string; offsetLabel: string; dstActive: boolean } {
  const tz = isValidIanaTimezone(timezone) ? timezone : 'America/Sao_Paulo';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { dayKey: '1970-01-01', timeHHmm: '00:00', offsetLabel: 'UTC', dstActive: false };
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  const dayKey = `${get('year')}-${get('month')}-${get('day')}`;
  const timeHHmm = `${hour}:${get('minute')}`;

  const offsetParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  }).formatToParts(date);
  const offsetLabel = offsetParts.find((p) => p.type === 'timeZoneName')?.value ?? tz;

  // Detect DST by comparing January vs July offsets in the same IANA timezone
  const janOffset = getTimezoneOffsetMinutes(new Date(Date.UTC(date.getUTCFullYear(), 0, 1, 12, 0)), tz);
  const julOffset = getTimezoneOffsetMinutes(new Date(Date.UTC(date.getUTCFullYear(), 6, 1, 12, 0)), tz);
  const curOffset = getTimezoneOffsetMinutes(date, tz);
  const dstActive = janOffset !== julOffset && curOffset === Math.max(janOffset, julOffset);

  return { dayKey, timeHHmm, offsetLabel, dstActive };
}

function getTimezoneOffsetMinutes(date: Date, tz: string): number {
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: tz }));
  return Math.round((tzDate.getTime() - utcDate.getTime()) / 60_000);
}

/**
 * Converts a local wall-clock YYYY-MM-DD + HH:mm in a specific IANA timezone
 * into a UTC ISO string, preserving DST transitions accurately.
 */
export function localDateTimeToUtcIso(dayKey: string, timeHHmm: string, timezone: string): string {
  const tz = isValidIanaTimezone(timezone) ? timezone : 'America/Sao_Paulo';
  const [y, m, d] = dayKey.split('-').map(Number);
  const [hh, mm] = timeHHmm.split(':').map(Number);
  const approxUtc = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0));
  const offsetMin = getTimezoneOffsetMinutes(approxUtc, tz);
  const adjusted = new Date(approxUtc.getTime() - offsetMin * 60_000);
  // Second pass handles exact DST boundary hour
  const offsetMin2 = getTimezoneOffsetMinutes(adjusted, tz);
  if (offsetMin2 !== offsetMin) {
    return new Date(approxUtc.getTime() - offsetMin2 * 60_000).toISOString();
  }
  return adjusted.toISOString();
}

export function getEffectiveEventIso(ev: EditorialCalendarEvent): string {
  return ev.scheduledPublishAtIso ?? ev.plannedDateIso;
}

export function canAutoPublishEvent(ev: EditorialCalendarEvent): { allowed: boolean; reason?: string } {
  if (!ev.reviewApproved) {
    return {
      allowed: false,
      reason: 'Aprovação pendente na Sala de Revisão: vídeos não aprovados não podem ser publicados automaticamente.',
    };
  }
  if (ev.qualityGates && !ev.qualityGates.allMandatoryPassed) {
    return {
      allowed: false,
      reason: 'Gates de qualidade obrigatórios (Gate F/G/H) ainda não foram aprovados para publicação.',
    };
  }
  if (ev.rightsVerification && !ev.rightsVerification.verified) {
    return {
      allowed: false,
      reason: 'Verificação de direitos de uso do material pendente antes de autorizar a publicação.',
    };
  }
  return { allowed: true };
}

export function analyzeCalendarHealth(
  events: EditorialCalendarEvent[],
  nowIso = new Date().toISOString(),
  windowStartDayKey?: string,
  windowDays = 30,
): CalendarHealthReport {
  const nowMs = Date.parse(nowIso);
  const conflictSet = new Set<string>();
  const delayedIds: string[] = [];
  const unapprovedNearIds: string[] = [];
  const failureIds: string[] = [];

  for (let i = 0; i < events.length; i += 1) {
    const a = events[i]!;
    const aMs = Date.parse(getEffectiveEventIso(a));

    if (a.status === 'failed' || Boolean(a.integrationError)) {
      failureIds.push(a.id);
    }

    if (
      !Number.isNaN(aMs) &&
      aMs < nowMs &&
      (a.status === 'draft' || a.status === 'scripting' || a.status === 'producing' || a.status === 'in_review')
    ) {
      delayedIds.push(a.id);
    }

    if (
      !a.reviewApproved &&
      !Number.isNaN(aMs) &&
      aMs >= nowMs &&
      aMs - nowMs <= 48 * 3600 * 1_000 &&
      a.status !== 'published'
    ) {
      unapprovedNearIds.push(a.id);
    }

    for (let j = i + 1; j < events.length; j += 1) {
      const b = events[j]!;
      if (a.channelId !== b.channelId || a.platform !== b.platform) continue;
      const bMs = Date.parse(getEffectiveEventIso(b));
      if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && Math.abs(aMs - bMs) < 90 * 60 * 1_000) {
        conflictSet.add(a.id);
        conflictSet.add(b.id);
      }
    }
  }

  // Detect content gaps (>= 3 consecutive days without any event)
  const occupiedDays = new Set<string>();
  for (const ev of events) {
    occupiedDays.add(formatInTimezone(getEffectiveEventIso(ev), ev.timezone).dayKey);
  }
  const startBase = windowStartDayKey
    ? new Date(`${windowStartDayKey}T12:00:00Z`)
    : new Date(Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), new Date(nowMs).getUTCDate(), 12, 0));

  const contentGaps: CalendarGapPeriod[] = [];
  let gapStart: string | null = null;
  let gapLen = 0;
  let prevDayKey = '';

  for (let offset = 0; offset < windowDays; offset += 1) {
    const d = new Date(startBase.getTime() + offset * 86_400_000);
    const dayKey = d.toISOString().slice(0, 10);
    if (!occupiedDays.has(dayKey)) {
      if (!gapStart) gapStart = dayKey;
      gapLen += 1;
    } else {
      if (gapStart && gapLen >= 3) {
        contentGaps.push({ startDayKey: gapStart, endDayKey: prevDayKey, daysCount: gapLen });
      }
      gapStart = null;
      gapLen = 0;
    }
    prevDayKey = dayKey;
  }
  if (gapStart && gapLen >= 3) {
    contentGaps.push({ startDayKey: gapStart, endDayKey: prevDayKey, daysCount: gapLen });
  }

  return {
    conflictEventIds: [...conflictSet],
    delayedEventIds: delayedIds,
    unapprovedNearPublishIds: unapprovedNearIds,
    integrationFailureIds: failureIds,
    contentGaps,
  };
}

export function suggestSmartSchedule(input: {
  events: EditorialCalendarEvent[];
  defaultChannel: { channelId: string; channelName: string };
  timezone: string;
  nowIso?: string;
}): SmartScheduleSuggestion[] {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const publishedWithMetrics = input.events.filter(
    (e) => e.status === 'published' && typeof e.metrics?.views === 'number',
  );

  // Derive best weekday/hour from real metrics if available
  let bestLongHour = '18:00';
  let bestSource = 'Heurística editorial para canais de games (pico noturno 18h).';
  if (publishedWithMetrics.length > 0) {
    const top = [...publishedWithMetrics].sort((a, b) => (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0))[0]!;
    const fmt = formatInTimezone(getEffectiveEventIso(top), input.timezone);
    bestLongHour = fmt.timeHHmm;
    bestSource = `Baseado em métricas reais: "${top.title}" atingiu ${top.metrics?.views?.toLocaleString('pt-BR')} views às ${fmt.timeHHmm}.`;
  }

  const health = analyzeCalendarHealth(input.events, nowIso, undefined, 21);
  const longCount = input.events.filter((e) => e.platform === 'youtube' && e.format !== 'short').length;
  const shortsCount = input.events.filter((e) => e.platform === 'youtube_shorts' || e.format === 'short').length;

  const suggestions: SmartScheduleSuggestion[] = [];
  const gapTargets = health.contentGaps.slice(0, 3);
  const fallbackStart = new Date(Date.parse(nowIso) + 2 * 86_400_000).toISOString().slice(0, 10);

  const slots = gapTargets.length > 0
    ? gapTargets.map((g) => g.startDayKey)
    : [fallbackStart, new Date(Date.parse(nowIso) + 5 * 86_400_000).toISOString().slice(0, 10)];

  slots.forEach((dayKey, idx) => {
    const recommendShort = shortsCount < longCount || idx % 2 === 1;
    const platform: CalendarPlatform = recommendShort ? 'youtube_shorts' : 'youtube';
    const format: CalendarFormat = recommendShort ? 'short' : idx === 0 ? 'analysis' : 'top10';
    const hour = recommendShort ? '12:30' : bestLongHour;
    const suggestedDateIso = localDateTimeToUtcIso(dayKey, hour, input.timezone);
    const leadDays = recommendShort ? 1 : 4;
    const productionStartIso = new Date(Date.parse(suggestedDateIso) - leadDays * 86_400_000).toISOString();

    suggestions.push({
      id: `sug_${dayKey}_${idx + 1}`,
      suggestedDateIso,
      timezone: input.timezone,
      channelId: input.defaultChannel.channelId,
      channelName: input.defaultChannel.channelName,
      platform,
      format,
      suggestedTitle: recommendShort
        ? 'Short: Curiosidade rápida / Bastidor de Game'
        : idx === 0
          ? 'Análise aprofundada ou Documentário da Semana'
          : 'TOP 10 temático para preenchimento de grade',
      rationale: recommendShort
        ? `Equilíbrio Longos/Shorts (${longCount} longos vs ${shortsCount} Shorts) preenchendo lacuna em ${dayKey}.`
        : bestSource,
      confidence: publishedWithMetrics.length > 0 ? 0.9 : 0.78,
      productionStartIso,
    });
  });

  return suggestions;
}

export class EditorialCalendarEngine {
  private readonly storePath: string | null;
  private snapshot: EditorialCalendarStoreSnapshot;

  constructor(storePath?: string, defaultTimezone = 'America/Sao_Paulo') {
    this.storePath = storePath ?? null;
    this.snapshot = this.load(defaultTimezone);
  }

  private load(defaultTimezone: string): EditorialCalendarStoreSnapshot {
    if (this.storePath && existsSync(this.storePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.storePath, 'utf8')) as EditorialCalendarStoreSnapshot;
        if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.events)) {
          return {
            schemaVersion: 1,
            defaultTimezone: parsed.defaultTimezone || defaultTimezone,
            events: parsed.events,
            series: Array.isArray(parsed.series) ? parsed.series : [],
          };
        }
      } catch {
        // fall through to fresh store
      }
    }
    return {
      schemaVersion: 1,
      defaultTimezone: isValidIanaTimezone(defaultTimezone) ? defaultTimezone : 'America/Sao_Paulo',
      events: [],
      series: [],
    };
  }

  private persist(): void {
    if (!this.storePath) return;
    mkdirSync(dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.snapshot, null, 2), 'utf8');
    renameSync(tmp, this.storePath);
  }

  getSnapshot(): EditorialCalendarStoreSnapshot {
    return {
      ...this.snapshot,
      events: this.snapshot.events.map((e) => ({ ...e, rescheduleHistory: [...e.rescheduleHistory] })),
      series: this.snapshot.series.map((s) => ({ ...s })),
    };
  }

  upsertEvent(
    input: Omit<EditorialCalendarEvent, 'id' | 'rescheduleHistory' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): EditorialCalendarEvent {
    const now = new Date().toISOString();
    const tz = isValidIanaTimezone(input.timezone) ? input.timezone : this.snapshot.defaultTimezone;
    const sharedPubId = input.publicationId ?? input.id;
    const existingIdx = this.snapshot.events.findIndex(
      (e) => (input.id && e.id === input.id) || (sharedPubId && (e.publicationId === sharedPubId || e.id === sharedPubId)),
    );

    if (input.status === 'scheduled' && !input.reviewApproved) {
      throw new Error('review_approval_required: vídeos não aprovados na Sala de Revisão não podem ser agendados para publicação automática.');
    }
    if (input.status === 'scheduled' && input.qualityGates && !input.qualityGates.allMandatoryPassed) {
      throw new Error('quality_gates_required: os Gates de qualidade obrigatórios precisam ser aprovados antes de agendar.');
    }
    if (input.status === 'scheduled' && input.rightsVerification && !input.rightsVerification.verified) {
      throw new Error('rights_verification_required: conclua a verificação de direitos de uso antes de agendar.');
    }

    if (existingIdx >= 0) {
      const prev = this.snapshot.events[existingIdx]!;
      const updated: EditorialCalendarEvent = {
        ...prev,
        ...input,
        id: prev.id,
        publicationId: prev.publicationId ?? sharedPubId ?? prev.id,
        timezone: tz,
        rescheduleHistory: [...prev.rescheduleHistory],
        auditLog: input.auditLog ?? prev.auditLog ?? [],
        updatedAt: now,
      };
      this.snapshot.events[existingIdx] = updated;
      this.persist();
      return updated;
    }

    const canonicalId = input.id ?? sharedPubId ?? `cal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const created: EditorialCalendarEvent = {
      ...input,
      id: canonicalId,
      publicationId: sharedPubId ?? canonicalId,
      timezone: tz,
      rescheduleHistory: [],
      auditLog: input.auditLog ?? [
        {
          id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestampIso: now,
          action: input.status === 'scheduled' ? 'scheduled' : 'created',
          actor: 'user',
          detail: `Evento criado no calendário unificado (${(input.platforms ?? [input.platform]).join(', ')}).`,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    this.snapshot.events.push(created);
    this.persist();
    return created;
  }

  moveEvent(input: {
    id: string;
    targetDateIso: string;
    targetKind?: 'planned' | 'scheduled';
    reason?: string;
  }): EditorialCalendarEvent {
    const idx = this.snapshot.events.findIndex((e) => e.id === input.id);
    if (idx < 0) {
      throw new Error(`not_found: evento ${input.id} não encontrado.`);
    }
    if (Number.isNaN(Date.parse(input.targetDateIso))) {
      throw new Error('invalid_date: data de destino inválida.');
    }
    const prev = this.snapshot.events[idx]!;
    const kind = input.targetKind ?? (prev.scheduledPublishAtIso ? 'scheduled' : 'planned');
    if (kind === 'scheduled' && !prev.reviewApproved) {
      throw new Error('review_approval_required: aprove o vídeo na Sala de Revisão antes de reagendar a publicação na plataforma.');
    }
    const fromIso = kind === 'scheduled' ? (prev.scheduledPublishAtIso ?? prev.plannedDateIso) : prev.plannedDateIso;
    const now = new Date().toISOString();

    const updated: EditorialCalendarEvent = {
      ...prev,
      ...(kind === 'scheduled'
        ? { scheduledPublishAtIso: input.targetDateIso }
        : { plannedDateIso: input.targetDateIso }),
      rescheduleHistory: [
        ...prev.rescheduleHistory,
        {
          fromIso,
          toIso: input.targetDateIso,
          targetKind: kind,
          changedAt: now,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      ],
      updatedAt: now,
    };
    this.snapshot.events[idx] = updated;
    this.persist();
    return updated;
  }

  schedulePlatformPublish(input: { id: string; publishAtIso: string }): EditorialCalendarEvent {
    const idx = this.snapshot.events.findIndex((e) => e.id === input.id);
    if (idx < 0) throw new Error(`not_found: evento ${input.id} não encontrado.`);
    const ev = this.snapshot.events[idx]!;
    const gate = canAutoPublishEvent(ev);
    if (!gate.allowed) {
      throw new Error(`review_approval_required: ${gate.reason}`);
    }
    const now = new Date().toISOString();
    const { integrationError: _clearedError, ...rest } = ev;
    const updated: EditorialCalendarEvent = {
      ...rest,
      scheduledPublishAtIso: input.publishAtIso,
      status: 'scheduled',
      updatedAt: now,
    };
    this.snapshot.events[idx] = updated;
    this.persist();
    return updated;
  }

  deleteEvent(id: string): boolean {
    const before = this.snapshot.events.length;
    this.snapshot.events = this.snapshot.events.filter((e) => e.id !== id && e.publicationId !== id);
    if (this.snapshot.events.length === before) return false;
    this.persist();
    return true;
  }

  cancelSchedule(input: {
    id: string;
    platform?: CalendarPlatform;
    reason?: string;
    confirmIrreversible?: boolean;
  }): EditorialCalendarEvent {
    const idx = this.snapshot.events.findIndex((e) => e.id === input.id || e.publicationId === input.id);
    if (idx < 0) throw new Error(`not_found: evento ${input.id} não encontrado.`);
    const prev = this.snapshot.events[idx]!;
    const now = new Date().toISOString();

    if (prev.status === 'published' && !input.confirmIrreversible) {
      throw new Error('confirmation_required: confirmação explícita obrigatória para alterar uma publicação já enviada.');
    }

    if (input.platform && prev.platformTargets?.[input.platform]) {
      const target = prev.platformTargets[input.platform]!;
      if (target.status === 'published' && !input.confirmIrreversible) {
        throw new Error(`confirmation_required: a publicação em ${input.platform} já foi enviada e exige confirmação explícita.`);
      }
      const nextTargets: Partial<Record<CalendarPlatform, PlatformDestinationState>> = {
        ...prev.platformTargets,
        [input.platform]: {
          ...target,
          status: 'cancelled',
          updatedAtIso: now,
        },
      };
      const remainingActive = Object.values(nextTargets).some(
        (t) => t && (t.status === 'scheduled' || t.status === 'publishing' || t.status === 'published'),
      );
      const updated: EditorialCalendarEvent = {
        ...prev,
        platformTargets: nextTargets,
        status: remainingActive ? prev.status : 'cancelled',
        auditLog: [
          ...(prev.auditLog ?? []),
          {
            id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestampIso: now,
            action: 'platform_cancelled',
            actor: 'user',
            platform: input.platform,
            detail: input.reason ?? `Agendamento cancelado para ${input.platform}.`,
          },
        ],
        updatedAt: now,
      };
      this.snapshot.events[idx] = updated;
      this.persist();
      return updated;
    }

    const nextTargets: Partial<Record<CalendarPlatform, PlatformDestinationState>> | undefined = prev.platformTargets
      ? Object.fromEntries(
          Object.entries(prev.platformTargets).map(([k, v]) => [
            k,
            v && v.status !== 'published' ? { ...v, status: 'cancelled' as const, updatedAtIso: now } : v,
          ]),
        )
      : undefined;

    const updated: EditorialCalendarEvent = {
      ...prev,
      ...(nextTargets ? { platformTargets: nextTargets } : {}),
      status: prev.status === 'published' ? 'published' : 'cancelled',
      auditLog: [
        ...(prev.auditLog ?? []),
        {
          id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestampIso: now,
          action: 'cancelled',
          actor: 'user',
          detail: input.reason ?? 'Agendamento cancelado pelo usuário.',
        },
      ],
      updatedAt: now,
    };
    this.snapshot.events[idx] = updated;
    this.persist();
    return updated;
  }

  upsertSeries(
    input: Omit<RecurringSeriesRule, 'id' | 'createdAt'> & { id?: string },
  ): RecurringSeriesRule {
    const tz = isValidIanaTimezone(input.timezone) ? input.timezone : this.snapshot.defaultTimezone;
    const existingIdx = input.id ? this.snapshot.series.findIndex((s) => s.id === input.id) : -1;
    if (existingIdx >= 0) {
      const prev = this.snapshot.series[existingIdx]!;
      const updated: RecurringSeriesRule = { ...prev, ...input, id: prev.id, timezone: tz };
      this.snapshot.series[existingIdx] = updated;
      this.persist();
      return updated;
    }
    const created: RecurringSeriesRule = {
      ...input,
      id: input.id ?? `ser_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timezone: tz,
      createdAt: new Date().toISOString(),
    };
    this.snapshot.series.push(created);
    this.persist();
    return created;
  }

  generateSeriesOccurrences(seriesId: string, weeksAhead = 4, fromIso = new Date().toISOString()): EditorialCalendarEvent[] {
    const rule = this.snapshot.series.find((s) => s.id === seriesId);
    if (!rule) throw new Error(`not_found: série ${seriesId} não encontrada.`);
    const created: EditorialCalendarEvent[] = [];
    const startMs = Date.parse(fromIso);
    const totalDays = weeksAhead * 7;

    for (let offset = 0; offset <= totalDays; offset += 1) {
      const d = new Date(startMs + offset * 86_400_000);
      const dayKey = formatInTimezone(d.toISOString(), rule.timezone).dayKey;
      const candidateIso = localDateTimeToUtcIso(dayKey, rule.timeHHmm, rule.timezone);
      const localDate = new Date(candidateIso);
      if (localDate.getUTCDay() !== rule.weekday && new Date(`${dayKey}T12:00:00Z`).getUTCDay() !== rule.weekday) {
        continue;
      }
      if (Date.parse(candidateIso) < startMs - 60_000) continue;

      const alreadyExists = this.snapshot.events.some(
        (e) => e.seriesId === rule.id && formatInTimezone(e.plannedDateIso, rule.timezone).dayKey === dayKey,
      );
      if (alreadyExists) continue;

      const leadMs = rule.leadDaysForProduction * 86_400_000;
      const shouldStartProducing = Date.parse(candidateIso) - leadMs <= startMs;

      created.push(
        this.upsertEvent({
          title: `${rule.name} — ${dayKey}`,
          description: rule.promptTemplate,
          channelId: rule.channelId,
          channelName: rule.channelName,
          platform: rule.platform,
          format: rule.format,
          plannedDateIso: candidateIso,
          timezone: rule.timezone,
          status: shouldStartProducing ? 'scripting' : 'draft',
          reviewApproved: false,
          seriesId: rule.id,
          productionLeadDays: rule.leadDaysForProduction,
        }),
      );
    }
    return created;
  }
}

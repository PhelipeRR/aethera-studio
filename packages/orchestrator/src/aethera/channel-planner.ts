import type { ProductionBrief } from '@neuralbridge/shared';

export type AetheraPlatform = 'youtube' | 'tiktok' | 'instagram' | 'custom';
export type AetheraApprovalPolicy = 'manual' | 'auto_after_qa' | 'autopilot';
export type AetheraPublicationStatus = 'planned' | 'producing' | 'in_review' | 'scheduled' | 'published' | 'failed';

export interface AetheraAutopilotConfig {
  enabled: boolean;
  frequencyPerWeek: number;
  preferredWeekdays: number[]; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  preferredTime: string; // HH:mm
  timezone: string;
  themes: string[];
  approvalPolicy: AetheraApprovalPolicy;
}

export interface AetheraChannelProfile {
  id: string;
  platform: AetheraPlatform;
  name: string;
  language: string;
  audience: string;
  visualStyle: string;
  connected: boolean;
  autopilot: AetheraAutopilotConfig;
}

export interface AetheraVideoChapter {
  timestamp: string;
  seconds: number;
  title: string;
}

export interface AetheraVideoMetadata {
  title: string;
  alternativeTitles: string[];
  description: string;
  tags: string[];
  hashtags: string[];
  chapters: AetheraVideoChapter[];
  category: string;
  playlists: string[];
  pinnedComment: string;
  credits: string;
}

export interface AetheraCalendarItem {
  id: string;
  channelId: string;
  channelName: string;
  runId?: string;
  title: string;
  topic: string;
  scheduledAtIso: string;
  status: AetheraPublicationStatus;
  progress: number; // 0..1
  thumbnailUrl?: string;
  hasConflict?: boolean;
  issueMessage?: string;
  metadata?: AetheraVideoMetadata;
}

const WEEKDAY_TOKENS: { pattern: RegExp; day: number }[] = [
  { pattern: /\bdom(?:ingo)?\b/iu, day: 0 },
  { pattern: /\bseg(?:unda)?(?:-feira)?\b/iu, day: 1 },
  { pattern: /\bter(?:[cç]a)?(?:-feira)?\b/iu, day: 2 },
  { pattern: /\bqua(?:rta)?(?:-feira)?\b/iu, day: 3 },
  { pattern: /\bqui(?:nta)?(?:-feira)?\b/iu, day: 4 },
  { pattern: /\bsex(?:ta)?(?:-feira)?\b/iu, day: 5 },
  { pattern: /\bs[aá]b(?:ado)?\b/iu, day: 6 },
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${pad2(mins)}:${pad2(rem)}`;
}

/**
 * RF-09: Generates discovery-optimized metadata grounded in the actual video brief and chapters.
 */
export function generateVideoMetadata(
  brief: ProductionBrief,
  opts: { channelName?: string; chapterTitles?: string[]; credits?: string[] } = {},
): AetheraVideoMetadata {
  const cleanTopic = brief.topic.trim();
  const baseTitle = cleanTopic.length > 72 ? `${cleanTopic.slice(0, 69)}...` : cleanTopic;
  const words = cleanTopic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const uniqueTags = [...new Set(words)].slice(0, 10);
  const hashtags = uniqueTags.slice(0, 4).map((t) => `#${t}`);

  const rawChapters = opts.chapterTitles?.length
    ? opts.chapterTitles
    : ['Introdução', 'Contexto e Análise', 'Destaques Principais', 'Conclusão'];
  const stepSec = Math.max(15, Math.floor(brief.targetDurationSeconds / rawChapters.length));
  const chapters: AetheraVideoChapter[] = rawChapters.map((title, idx) => {
    const sec = idx === 0 ? 0 : idx * stepSec;
    return { timestamp: formatTimestamp(sec), seconds: sec, title };
  });

  const chaptersBlock = chapters.map((c) => `${c.timestamp} — ${c.title}`).join('\n');
  const creditsText = opts.credits?.length
    ? opts.credits.join(' · ')
    : 'Materiais visuais e trilha sonora com proveniência registrada no Aethera Studio.';

  return {
    title: baseTitle,
    alternativeTitles: [
      `${baseTitle} | Análise Completa`,
      `Tudo sobre: ${baseTitle}`,
      `${baseTitle} — O Guia Definitivo`,
    ],
    description: `${cleanTopic}\n\nCapítulos:\n${chaptersBlock}\n\n${hashtags.join(' ')}\n\nCréditos: ${creditsText}`,
    tags: uniqueTags,
    hashtags,
    chapters,
    category: /jogo|game|elden|rpg/iu.test(cleanTopic) ? 'Gaming' : 'Education',
    playlists: [opts.channelName ? `${opts.channelName} — Destaques` : 'Produções Aethera'],
    pinnedComment: `Qual parte de "${baseTitle}" mais chamou sua atenção? Comente abaixo!`,
    credits: creditsText,
  };
}

/**
 * RF-09: Adjusts existing metadata according to a natural-language prompt.
 */
export function refineMetadataByPrompt(current: AetheraVideoMetadata, prompt: string): AetheraVideoMetadata {
  const clean = prompt.trim();
  if (!clean) return current;
  let next = { ...current };

  if (/curt[oa]|diret[oa]|impactante/iu.test(clean)) {
    next = {
      ...next,
      title: next.alternativeTitles[0] ?? next.title.slice(0, 55),
    };
  }
  if (/tag|hashtag|seo/iu.test(clean)) {
    const stopwords = new Set(['deixe', 'mais', 'curto', 'curta', 'adicione', 'adiciona', 'tags', 'hashtag', 'hashtags', 'para', 'como', 'sobre', 'título', 'titulo', 'vídeo', 'video']);
    const extra = clean
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !stopwords.has(w) && !next.tags.includes(w))
      .slice(0, 5);
    next = {
      ...next,
      tags: [...next.tags, ...extra].slice(0, 15),
      hashtags: [...new Set([...next.hashtags, ...extra.map((e) => `#${e}`)])].slice(0, 6),
    };
  }
  if (/coment[aá]rio/iu.test(clean)) {
    next = { ...next, pinnedComment: clean };
  }
  return next;
}

/**
 * RF-11: Detects schedule conflicts when two items on the same channel are within 60 minutes.
 */
export function detectScheduleConflicts(items: readonly AetheraCalendarItem[]): AetheraCalendarItem[] {
  const sorted = [...items].sort((a, b) => Date.parse(a.scheduledAtIso) - Date.parse(b.scheduledAtIso));
  const conflictIds = new Set<string>();
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];
      if (!a || !b || a.channelId !== b.channelId) continue;
      const diffMs = Math.abs(Date.parse(b.scheduledAtIso) - Date.parse(a.scheduledAtIso));
      if (diffMs < 60 * 60 * 1_000) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }
  return items.map((item) => ({
    ...item,
    hasConflict: conflictIds.has(item.id),
    ...(conflictIds.has(item.id) ? { issueMessage: 'Conflito de horário neste canal (< 60 min).' } : {}),
  }));
}

/**
 * RF-11: Reschedules a calendar item (drag-and-drop) and recomputes conflicts.
 */
export function rescheduleCalendarItem(
  items: readonly AetheraCalendarItem[],
  itemId: string,
  newScheduledAtIso: string,
): AetheraCalendarItem[] {
  const updated = items.map((item) => (item.id === itemId ? { ...item, scheduledAtIso: newScheduledAtIso } : item));
  return detectScheduleConflicts(updated);
}

/**
 * RF-13: Parses a natural-language editorial planning prompt (e.g. "três vídeos por semana... segunda, quarta e sexta, às 18h")
 * and distributes non-duplicate topics across future calendar slots.
 */
export function planEditorialCalendar(input: {
  prompt: string;
  channel: AetheraChannelProfile;
  startDate?: Date;
  weeks?: number;
  existingTopics?: readonly string[];
}): AetheraCalendarItem[] {
  const clean = input.prompt.trim();
  const countMap: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, três: 3, quatro: 4, cinco: 5 };
  const freqDigit = /(\d+)\s*v[ií]deos?\s*por\s*semana/iu.exec(clean);
  const freqWord = /(um|uma|dois|duas|tr[eê]s|quatro|cinco)\s*v[ií]deos?\s*por\s*semana/iu.exec(clean);
  const parsedFreq = freqDigit
    ? Number(freqDigit[1])
    : freqWord?.[1]
      ? (countMap[freqWord[1].toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')] ?? 3)
      : input.channel.autopilot.frequencyPerWeek;

  const detectedWeekdays = WEEKDAY_TOKENS.filter((t) => t.pattern.test(clean)).map((t) => t.day);
  const weekdays = detectedWeekdays.length ? detectedWeekdays : input.channel.autopilot.preferredWeekdays;

  const timeMatch = /[àa]s?\s*(\d{1,2})(?:h|:(\d{2}))/iu.exec(clean);
  const hour = timeMatch ? Math.min(23, Number(timeMatch[1])) : Number(input.channel.autopilot.preferredTime.split(':')[0] ?? 18);
  const minute = timeMatch?.[2] ? Math.min(59, Number(timeMatch[2])) : Number(input.channel.autopilot.preferredTime.split(':')[1] ?? 0);

  const weeks = Math.max(1, Math.min(8, input.weeks ?? (/m[eê]s/iu.test(clean) ? 4 : 1)));
  const totalVideos = Math.max(1, Math.min(32, parsedFreq * weeks));

  const usedTopics = new Set((input.existingTopics ?? []).map((t) => t.trim().toLowerCase()));
  const baseDate = input.startDate ? new Date(input.startDate.getTime()) : new Date();
  baseDate.setHours(hour, minute, 0, 0);

  const slots: Date[] = [];
  const cursor = new Date(baseDate.getTime());
  for (let guard = 0; guard < 90 && slots.length < totalVideos; guard += 1) {
    if (weekdays.includes(cursor.getDay()) && cursor.getTime() >= baseDate.getTime()) {
      slots.push(new Date(cursor.getTime()));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const themeSeed = input.channel.autopilot.themes[0] ?? 'conteúdo';
  const items: AetheraCalendarItem[] = [];
  let seq = 1;
  for (const slot of slots) {
    let topic = `${clean} — Episódio ${seq} (${themeSeed})`;
    while (usedTopics.has(topic.toLowerCase())) {
      seq += 1;
      topic = `${clean} — Episódio ${seq} (${themeSeed})`;
    }
    usedTopics.add(topic.toLowerCase());
    items.push({
      id: `cal-${input.channel.id}-${seq}`,
      channelId: input.channel.id,
      channelName: input.channel.name,
      title: `Episódio ${seq}: ${themeSeed}`,
      topic,
      scheduledAtIso: slot.toISOString(),
      status: input.channel.autopilot.approvalPolicy === 'autopilot' ? 'scheduled' : 'planned',
      progress: 0,
    });
    seq += 1;
  }

  return detectScheduleConflicts(items);
}

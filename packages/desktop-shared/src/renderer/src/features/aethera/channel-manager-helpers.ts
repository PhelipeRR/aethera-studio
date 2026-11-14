import {
  normalizeChannelConfig,
  type AutonomyMode,
  type ChannelEditorialStrategyConfig,
  type ChannelFormat,
  type ChannelIdentityConfig,
  type ContentChannel,
} from '@neuralbridge/shared';

export interface ChannelFormState {
  id: string;
  isNew: boolean;
  name: string;
  niche: string;
  audience: string;
  tone: string;
  autonomy: AutonomyMode;
  budgetUsd: number;
  concurrencyLimit: number;
  identity: ChannelIdentityConfig;
  editorialStrategy: ChannelEditorialStrategyConfig;
}

export const CHANNEL_FORMAT_OPTIONS: ReadonlyArray<{ id: ChannelFormat; label: string; hint: string }> = [
  { id: 'top10', label: 'TOPs / Listas', hint: 'Rankings com ritmo ágil e ganchos entre posições.' },
  { id: 'news', label: 'Notícias', hint: 'Cobertura factual rápida com fontes verificadas.' },
  { id: 'analysis', label: 'Análises', hint: 'Crítica técnica, narrativa e comparativa aprofundada.' },
  { id: 'nostalgia', label: 'Nostalgia', hint: 'Retrospectiva emocional com contexto histórico.' },
  { id: 'documentary', label: 'Documentários', hint: 'Investigação em atos com arco dramático.' },
  { id: 'shorts', label: 'Shorts', hint: 'Vertical 9:16 com gancho nos primeiros 2 segundos.' },
];

export const YOUTUBE_CATEGORIES: ReadonlyArray<string> = [
  'Gaming',
  'Entertainment',
  'Science & Technology',
  'Education',
  'Film & Animation',
  'News & Politics',
];

export const TIMEZONE_OPTIONS: ReadonlyArray<string> = [
  'America/Sao_Paulo',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/Lisbon',
  'Europe/London',
  'UTC',
];

export const WEEKDAY_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'monday', label: 'Segunda' },
  { id: 'tuesday', label: 'Terça' },
  { id: 'wednesday', label: 'Quarta' },
  { id: 'thursday', label: 'Quinta' },
  { id: 'friday', label: 'Sexta' },
  { id: 'saturday', label: 'Sábado' },
  { id: 'sunday', label: 'Domingo' },
];

export const FONT_OPTIONS: ReadonlyArray<string> = [
  'Inter',
  'Space Grotesk',
  'Bebas Neue',
  'Montserrat',
  'IBM Plex Mono',
  'Cinzel',
];

export function buildEmptyChannelForm(id: string): ChannelFormState {
  const normalized = normalizeChannelConfig({
    tone: '',
    autonomy: 'assisted',
    identity: {},
    editorialStrategy: {},
  });
  return {
    id,
    isNew: true,
    name: '',
    niche: '',
    audience: '',
    tone: '',
    autonomy: 'assisted',
    budgetUsd: 5,
    concurrencyLimit: 2,
    identity: normalized.identity,
    editorialStrategy: normalized.editorialStrategy,
  };
}

export function buildFormFromChannel(channel: ContentChannel): ChannelFormState {
  const normalized = normalizeChannelConfig(channel);
  return {
    id: channel.id,
    isNew: false,
    name: channel.name,
    niche: channel.niche,
    audience: channel.audience,
    tone: channel.tone || normalized.editorialStrategy.narrativeTone,
    autonomy: channel.autonomy,
    budgetUsd: channel.budgetUsd,
    concurrencyLimit: channel.concurrencyLimit,
    identity: normalized.identity,
    editorialStrategy: normalized.editorialStrategy,
  };
}

export function toChannelSavePayload(form: ChannelFormState) {
  return {
    id: form.id,
    workspaceId: 'default',
    name: form.name.trim(),
    niche: form.niche.trim(),
    audience: form.audience.trim(),
    tone: form.tone.trim() || form.editorialStrategy.narrativeTone.trim(),
    autonomy: form.autonomy,
    budgetUsd: Number.isFinite(form.budgetUsd) ? Math.max(0, form.budgetUsd) : 0,
    concurrencyLimit: Number.isFinite(form.concurrencyLimit) ? Math.max(1, Math.min(32, Math.round(form.concurrencyLimit))) : 1,
    identity: form.identity as unknown as Record<string, unknown>,
    editorialStrategy: {
      ...form.editorialStrategy,
      narrativeTone: form.tone.trim() || form.editorialStrategy.narrativeTone.trim(),
    } as unknown as Record<string, unknown>,
  };
}

function draftKey(channelId: string): string {
  return `aethera.channel.draft.${channelId}`;
}

export function loadChannelDraft(channelId: string): ChannelFormState | null {
  try {
    const raw = globalThis.localStorage?.getItem(draftKey(channelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChannelFormState;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function saveChannelDraft(form: ChannelFormState): void {
  try {
    globalThis.localStorage?.setItem(draftKey(form.id), JSON.stringify(form));
  } catch {
    // ignore storage quota errors
  }
}

export function clearChannelDraft(channelId: string): void {
  try {
    globalThis.localStorage?.removeItem(draftKey(channelId));
  } catch {
    // ignore
  }
}

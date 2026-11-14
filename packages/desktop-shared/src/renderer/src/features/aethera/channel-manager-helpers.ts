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

export function validateChannelForm(form: ChannelFormState): string[] {
  const errors: string[] = [];
  if (!form.id || form.id.length > 200) {
    errors.push('ID do canal inválido (deve ter entre 1 e 200 caracteres).');
  }
  const name = form.name.trim();
  if (!name) {
    errors.push('Nome do canal é obrigatório.');
  } else if (name.length > 200) {
    errors.push('Nome do canal excede o limite de 200 caracteres.');
  }
  if (form.niche.trim().length > 300) {
    errors.push('Nicho excede o limite de 300 caracteres.');
  }
  if (form.audience.trim().length > 500) {
    errors.push('Público-alvo excede o limite de 500 caracteres.');
  }
  const tone = form.tone.trim() || form.editorialStrategy.narrativeTone.trim();
  if (tone.length > 500) {
    errors.push('Tom narrativo excede o limite de 500 caracteres.');
  }
  if (!Number.isFinite(form.budgetUsd) || form.budgetUsd < 0 || form.budgetUsd > 1_000_000) {
    errors.push('Orçamento (USD) deve estar entre 0 e 1.000.000.');
  }
  if (!Number.isFinite(form.concurrencyLimit) || form.concurrencyLimit < 1 || form.concurrencyLimit > 32) {
    errors.push('Concorrência máxima deve estar entre 1 e 32.');
  }
  return errors;
}

function buildSharedChannelFields(form: ChannelFormState) {
  const tone = form.tone.trim() || form.editorialStrategy.narrativeTone.trim();
  return {
    id: form.id,
    name: form.name.trim(),
    niche: form.niche.trim(),
    audience: form.audience.trim(),
    tone,
    autonomy: form.autonomy,
    budgetUsd: Number.isFinite(form.budgetUsd) ? Math.max(0, Math.min(1_000_000, form.budgetUsd)) : 0,
    concurrencyLimit: Number.isFinite(form.concurrencyLimit) ? Math.max(1, Math.min(32, Math.round(form.concurrencyLimit))) : 1,
    identity: form.identity as unknown as Record<string, unknown>,
    editorialStrategy: {
      ...form.editorialStrategy,
      narrativeTone: tone,
    } as unknown as Record<string, unknown>,
  };
}

export function toChannelCreatePayload(form: ChannelFormState) {
  return {
    ...buildSharedChannelFields(form),
    workspaceId: 'default',
  };
}

export function toChannelUpdatePayload(form: ChannelFormState) {
  return buildSharedChannelFields(form);
}

export function toChannelSavePayload(form: ChannelFormState) {
  return form.isNew ? toChannelCreatePayload(form) : toChannelUpdatePayload(form);
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

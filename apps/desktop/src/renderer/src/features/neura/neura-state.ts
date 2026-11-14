import type { NeuraState, Suggestion } from '@neuralbridge/shared/neura-state';
import type { MascotState } from '../companion/companion-state';

export type NeuraActivity = 'off' | 'paused' | 'meeting' | 'listening' | 'idle';

export function neuraActivity(state: NeuraState): NeuraActivity {
  if (!state.enabled) return 'off';
  if (state.paused) return 'paused';
  if (state.meeting) return 'meeting';
  return state.voice ? 'listening' : 'idle';
}

/** What is being observed has to stay visible even in the capsule, so this reads the session before anything else. */
export function neuraBadge(state: NeuraState): string | null {
  const activity = neuraActivity(state);
  if (activity === 'paused') return 'Void pausado';
  if (state.suggestions.some((item) => item.status === 'pending')) return 'Sugestão pronta';
  if (state.pendingActions.length) return 'Confirmar ação';
  if (activity === 'meeting') return state.meeting?.capabilities.audio ? 'Ouvindo a call' : 'Reunião';
  return activity === 'listening' ? 'Ouvindo' : null;
}

/** Long enough to read at a calm pace, short enough not to linger over the desktop. */
export function replyBubbleMs(text: string): number {
  return Math.min(25_000, 5_000 + text.length * 60);
}

/** What the user is waiting on after asking. Null once the answer is being heard, or when nothing was asked. */
export function neuraWaitLabel(state: NeuraState | null, preparingVoice: boolean): string | null {
  if (state?.processing) return 'Pensando';
  return preparingVoice ? 'Preparando a voz' : null;
}

/**
 * Null keeps the Companion's own state: Neura only takes the mascot when it has something to say. Waiting for the wake
 * word is always on, so on its own it shows nothing; `called` is the short window after "Neura" was heard.
 */
export function neuraMascot(state: NeuraState, called = false): MascotState | null {
  const activity = neuraActivity(state);
  if (activity === 'off' || activity === 'paused') return null;
  if (state.pendingActions.length || state.suggestions.some((item) => item.status === 'pending')) return 'waiting';
  if (state.drafting || state.processing) return 'thinking';
  return activity === 'listening' && called ? 'voiceListening' : null;
}

/** Newest first: in a call, the latest thing said is the one that needs an answer. */
export function pendingSuggestions(state: NeuraState): Suggestion[] {
  return state.suggestions.filter((item) => item.status === 'pending').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const REASONS: Record<Suggestion['decision']['reason'], string> = { utterance: 'idioma da pergunta', meeting: 'idioma da reunião', user_preference: 'sua preferência', model: 'idioma identificado pelo agente' };

export function languageBadge(suggestion: Suggestion): string {
  return `${suggestion.decision.responseLanguage.toUpperCase()} • ${REASONS[suggestion.decision.reason]}`;
}

export const NEURA_ERRORS: Record<string, string> = {
  meeting_input_source_failed: 'Não consegui ouvir a call. Abra o VoiceStudio. Se já estiver aberto, troque o ditado para outro modelo e volte ao Parakeet.',
  neura_disabled: 'Ative o Void em Configurações.',
  neura_paused: 'O Void está pausado.',
  neura_consent_required: 'Autorize em Configurações antes de começar.',
  neura_not_found: 'Isso já não está disponível.',
  voice_unavailable: 'O reconhecimento de voz não está disponível.',
};

export function neuraError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const code = Object.keys(NEURA_ERRORS).find((key) => message.includes(key));
  return code ? NEURA_ERRORS[code] ?? '' : 'Não foi possível concluir.';
}

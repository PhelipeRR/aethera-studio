import type { CompanionEvent, CompanionSession, CompanionSessionStatus } from '@neuralbridge/shared/companion';

export type MascotState = 'idle' | 'running' | 'thinking' | 'resting' | 'waiting' | 'success' | 'error' | 'disconnected' | 'degraded' | 'listening' | 'musicPaused' | 'voiceListening' | 'speaking';
export type MascotReaction = Extract<MascotState, 'success' | 'error'>;

/** Long enough to be noticed, short enough that a finished task does not look current. */
export const REACTION_MS = 2_600;

const TITLE_LIMIT = 120;
const ENDED = new Set<CompanionSessionStatus>(['completed', 'failed', 'cancelled', 'disconnected']);
const PRIORITY: Partial<Record<CompanionSessionStatus, number>> = { waiting_permission: 5, waiting_input: 5, running: 4, discovering: 3, paused: 2, idle: 1 };

export const AGENT_LABELS: Record<CompanionSession['agent'], string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
export const STATUS_LABELS: Record<CompanionSessionStatus, string> = { discovering: 'Descobrindo', idle: 'Disponível', running: 'Executando', waiting_permission: 'Aguardando permissão', waiting_input: 'Interação necessária', paused: 'Pausada', completed: 'Concluída', failed: 'Com erro', cancelled: 'Cancelada', disconnected: 'Desconectado' };
export const MASCOT_LABELS: Record<MascotState, string> = { idle: 'em espera', running: 'executando', thinking: 'pensando', resting: 'aguardando', waiting: 'interação necessária', success: 'concluído', error: 'erro', disconnected: 'desconectado', degraded: 'conexão degradada', listening: 'ouvindo música', musicPaused: 'música pausada', voiceListening: 'ouvindo você', speaking: 'falando' };

export function isActive(session: CompanionSession): boolean { return !ENDED.has(session.status); }

/** The session the mascot speaks for: whatever needs the user first, then what is working, then the latest. */
export function primarySession(sessions: readonly CompanionSession[]): CompanionSession | null {
  let best: CompanionSession | null = null;
  for (const session of sessions) {
    if (!best) { best = session; continue; }
    const rank = PRIORITY[session.status] ?? 0; const bestRank = PRIORITY[best.status] ?? 0;
    if (rank > bestRank || (rank === bestRank && Date.parse(session.updatedAt) > Date.parse(best.updatedAt))) best = session;
  }
  return best;
}

/** Resting expression for a session. Success and error are reactions to a transition, so a finished session settles to idle. */
export function mascotState(session: CompanionSession | null): MascotState {
  if (!session) return 'idle';
  if (session.connection === 'disconnected' || session.status === 'disconnected') return 'disconnected';
  if (session.connection === 'degraded') return 'degraded';
  switch (session.status) {
    case 'running': return 'running';
    case 'discovering': return 'thinking';
    case 'paused': return 'resting';
    case 'waiting_input': case 'waiting_permission': return 'waiting';
    default: return 'idle';
  }
}

/** After this long with nothing to show, an idle mascot dozes off. */
export const DOZE_AFTER_MS = 10 * 60_000;

/** Dozing is only ever a quieter idle: anything with something to say keeps the mascot awake. */
export function dozing(state: MascotState, idleSinceMs: number, nowMs: number): MascotState {
  return state === 'idle' && nowMs - idleSinceMs >= DOZE_AFTER_MS ? 'resting' : state;
}

/** Music only colours an idle mascot: anything an agent is doing, or a reaction to it, always speaks first. */
export function withMusic(state: MascotState, playback: { isPlaying: boolean } | null | undefined): MascotState {
  if (state !== 'idle' || !playback) return state;
  return playback.isPlaying ? 'listening' : 'musicPaused';
}

/** Speech is never cut short: a reaction waits for the sentence, and a lost connection is the only thing above it. */
export function resolveMascotState({ available, speaking, reaction, neura, session, playback }: { available: boolean; speaking: boolean; reaction: MascotReaction | null; neura: MascotState | null; session: MascotState; playback: { isPlaying: boolean } | null }): MascotState {
  if (!available) return 'disconnected';
  if (speaking) return 'speaking';
  return reaction ?? neura ?? withMusic(session, playback);
}

/**
 * Compares the sessions with what was last seen and returns the reaction a real transition earns.
 * The first snapshot has no "before", so history loaded at startup never makes the mascot celebrate.
 */
export function detectReaction(previous: ReadonlyMap<string, CompanionSessionStatus> | null, sessions: readonly CompanionSession[]): MascotReaction | null {
  if (!previous) return null;
  let reaction: MascotReaction | null = null;
  for (const session of sessions) {
    const before = previous.get(session.sessionId);
    if (before === session.status) continue;
    if (session.status === 'failed') return 'error';
    if (session.status === 'completed') reaction = 'success';
  }
  return reaction;
}

/** The HUD floats over everything, screen shares included: only the first line of a request, and only so much of it. */
export function taskTitle(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0] ?? '';
  return line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line;
}

export function formatDuration(session: CompanionSession, now: number): string {
  const end = isActive(session) ? now : Date.parse(session.updatedAt);
  const total = Math.max(0, Math.floor((end - Date.parse(session.startedAt)) / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

export type TimelineTone = 'ok' | 'info' | 'warn' | 'error';
export interface TimelineItem { id: string; label: string; tone: TimelineTone; at: string; }

function describeEvent(event: CompanionEvent): { label: string; tone: TimelineTone } {
  switch (event.kind) {
    case 'session_started': return { label: 'Execução iniciada', tone: 'ok' };
    case 'prompt_submitted': return { label: 'Pedido enviado', tone: 'info' };
    case 'tool_started': return { label: `Ferramenta: ${event.tool}`, tone: 'info' };
    case 'tool_finished': return { label: `${event.ok ? 'Concluiu' : 'Falhou'}: ${event.tool}`, tone: event.ok ? 'ok' : 'error' };
    case 'file_changed': return { label: `Arquivo alterado: ${event.path.split(/[\\/]/).pop() ?? event.path}`, tone: 'info' };
    case 'notification': return { label: 'Atividade do agente', tone: 'info' };
    case 'status_changed': return { label: STATUS_LABELS[event.status], tone: 'info' };
    case 'session_ended': return { label: `Sessão ${STATUS_LABELS[event.status].toLowerCase()}`, tone: event.status === 'completed' ? 'ok' : event.status === 'failed' ? 'error' : 'warn' };
    case 'error': return { label: 'Erro reportado pelo agente', tone: 'error' };
    case 'raw': return { label: 'Evento do agente', tone: 'info' };
  }
}

/** Newest first; a burst of identical events (streamed text, mostly) reads as one line. */
export function timeline(events: readonly CompanionEvent[], limit: number): TimelineItem[] {
  const items: TimelineItem[] = [];
  for (const event of events) {
    const { label, tone } = describeEvent(event);
    if (items.at(-1)?.label === label) continue;
    items.push({ id: event.eventId, label, tone, at: event.occurredAt });
    if (items.length === limit) break;
  }
  return items;
}

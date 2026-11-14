import { describe, expect, it } from 'vitest';
import { danceTiming } from '../src/renderer/src/features/companion/companion-motion';
import { detectReaction, formatDuration, MASCOT_LABELS, mascotState, primarySession, resolveMascotState, taskTitle, timeline, withMusic, DOZE_AFTER_MS, dozing } from '../src/renderer/src/features/companion/companion-state';
import type { CompanionEvent, CompanionSession, CompanionSessionStatus } from '@neuralbridge/shared/companion';

const session = (overrides: Partial<CompanionSession> = {}): CompanionSession => ({ sessionId: '00000000-0000-4000-8000-000000000001', taskId: '00000000-0000-4000-8000-000000000002', agent: 'claude', projectId: null, providerSessionId: 'provider', status: 'idle', connection: 'connected', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides });
const seen = (status: CompanionSessionStatus) => new Map([['00000000-0000-4000-8000-000000000001', status]]);

describe('NeuralBridge mascot state mapping', () => {
  it('maps real session states without inventing activity', () => {
    expect(mascotState(null)).toBe('idle');
    expect(mascotState(session({ status: 'running' }))).toBe('running');
    expect(mascotState(session({ status: 'discovering' }))).toBe('thinking');
    expect(mascotState(session({ status: 'paused' }))).toBe('resting');
    expect(mascotState(session({ status: 'waiting_input' }))).toBe('waiting');
    expect(mascotState(session({ status: 'waiting_permission' }))).toBe('waiting');
  });

  it('settles finished sessions to idle, because success and error are reactions', () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) expect(mascotState(session({ status }))).toBe('idle');
  });

  it('prioritizes transport health over session status', () => {
    expect(mascotState(session({ status: 'running', connection: 'disconnected' }))).toBe('disconnected');
    expect(mascotState(session({ status: 'running', connection: 'degraded' }))).toBe('degraded');
    expect(mascotState(session({ status: 'disconnected' }))).toBe('disconnected');
  });
});

describe('mascot reactions', () => {
  it('does not celebrate history loaded at startup', () => {
    expect(detectReaction(null, [session({ status: 'completed' })])).toBeNull();
    expect(detectReaction(null, [session({ status: 'failed' })])).toBeNull();
  });

  it('reacts once to a live transition', () => {
    expect(detectReaction(seen('running'), [session({ status: 'completed' })])).toBe('success');
    expect(detectReaction(seen('running'), [session({ status: 'failed' })])).toBe('error');
    expect(detectReaction(seen('completed'), [session({ status: 'completed' })])).toBeNull();
  });

  it('reacts to a session that started and ended between two reads', () => {
    expect(detectReaction(new Map(), [session({ status: 'completed' })])).toBe('success');
  });

  it('does not treat a user cancellation as an error', () => {
    expect(detectReaction(seen('running'), [session({ status: 'cancelled' })])).toBeNull();
  });

  it('lets a failure win over a simultaneous success', () => {
    const other = session({ sessionId: '00000000-0000-4000-8000-000000000003', status: 'failed' });
    expect(detectReaction(new Map([['00000000-0000-4000-8000-000000000001', 'running'], [other.sessionId, 'running']]), [session({ status: 'completed' }), other])).toBe('error');
  });
});

describe('primary session', () => {
  it('prefers what needs the user, then what is working, then the latest', () => {
    const done = session({ sessionId: '00000000-0000-4000-8000-00000000000a', status: 'completed', updatedAt: '2026-11-02T10:00:00.000Z' });
    const running = session({ sessionId: '00000000-0000-4000-8000-00000000000b', status: 'running', updatedAt: '2026-11-02T09:00:00.000Z' });
    const waiting = session({ sessionId: '00000000-0000-4000-8000-00000000000c', status: 'waiting_input', updatedAt: '2026-11-02T08:00:00.000Z' });
    expect(primarySession([])).toBeNull();
    expect(primarySession([done, running])?.sessionId).toBe(running.sessionId);
    expect(primarySession([done, running, waiting])?.sessionId).toBe(waiting.sessionId);
    expect(primarySession([done, { ...done, sessionId: running.sessionId, updatedAt: '2026-11-02T11:00:00.000Z' }])?.sessionId).toBe(running.sessionId);
  });
});

describe('expanded panel facts', () => {
  it('shows only the first line of a task, within a limit', () => {
    expect(taskTitle('  Corrigir o login\nsenha=hunter2\n')).toBe('Corrigir o login');
    const long = taskTitle('x'.repeat(500));
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('stops the clock of a finished session', () => {
    const start = '2026-11-02T10:00:00.000Z';
    expect(formatDuration(session({ status: 'running', startedAt: start }), Date.parse(start) + 3_723_000)).toBe('01:02:03');
    expect(formatDuration(session({ status: 'completed', startedAt: start, updatedAt: '2026-11-02T10:00:09.000Z' }), Date.parse(start) + 3_723_000)).toBe('00:00:09');
  });

  it('collapses bursts of identical events and keeps the file name only', () => {
    const base = { sessionId: '00000000-0000-4000-8000-000000000001', taskId: '00000000-0000-4000-8000-000000000002', agent: 'claude' as const, sequence: 0, occurredAt: '2026-11-02T10:00:00.000Z', receivedAt: '2026-11-02T10:00:00.000Z', control: 'observed' as const };
    const event = (id: number, rest: object) => ({ ...base, eventId: `00000000-0000-4000-8000-0000000000${String(id).padStart(2, '0')}`, ...rest }) as CompanionEvent;
    const items = timeline([event(1, { kind: 'notification', summary: 'a' }), event(2, { kind: 'notification', summary: 'b' }), event(3, { kind: 'file_changed', path: 'C:\\secret\\dir\\app.ts', additions: null, deletions: null })], 8);
    expect(items.map((item) => item.label)).toEqual(['Atividade do agente', 'Arquivo alterado: app.ts']);
  });
});

describe('music on the mascot', () => {
  it('only colours an idle mascot', () => {
    expect(withMusic('idle', { isPlaying: true })).toBe('listening');
    expect(withMusic('idle', { isPlaying: false })).toBe('musicPaused');
    expect(withMusic('idle', null)).toBe('idle');
    for (const state of ['running', 'waiting', 'success', 'error', 'disconnected', 'degraded'] as const) expect(withMusic(state, { isPlaying: true })).toBe(state);
  });
});

describe('Mascot state priority', () => {
  const base = { available: true, speaking: false, reaction: null, neura: null, session: 'idle', playback: null } as const;

  it('puts a lost connection above everything', () => {
    expect(resolveMascotState({ ...base, available: false, speaking: true })).toBe('disconnected');
  });

  it('never cuts speech short for a reaction', () => {
    expect(resolveMascotState({ ...base, speaking: true, reaction: 'success' })).toBe('speaking');
  });

  it('orders reaction, Neura, session and music', () => {
    expect(resolveMascotState({ ...base, reaction: 'error', neura: 'waiting' })).toBe('error');
    expect(resolveMascotState({ ...base, neura: 'waiting', session: 'running' })).toBe('waiting');
    expect(resolveMascotState({ ...base, session: 'running', playback: { isPlaying: true } })).toBe('running');
    expect(resolveMascotState({ ...base, playback: { isPlaying: true } })).toBe('listening');
  });

  it('names what each listening means', () => {
    expect(MASCOT_LABELS.voiceListening).toBe('ouvindo você');
    expect(MASCOT_LABELS.listening).toBe('ouvindo música');
    expect(MASCOT_LABELS.speaking).toBe('falando');
  });
});

describe('dozing', () => {
  it('turns only a long idle into rest', () => {
    expect(dozing('idle', 0, DOZE_AFTER_MS - 1)).toBe('idle');
    expect(dozing('idle', 0, DOZE_AFTER_MS)).toBe('resting');
    expect(dozing('listening', 0, DOZE_AFTER_MS * 2)).toBe('listening');
  });
});

describe('danceTiming', () => {
  it('bounces once per beat, in phase with the track position', () => {
    expect(danceTiming(null, 0)).toBeNull();
    expect(danceTiming({ tempoBpm: 120, progressMs: 1_250, sampledAt: 0 }, 0)).toEqual({ beatMs: 500, delayMs: -250 });
    expect(danceTiming({ tempoBpm: 120, progressMs: 1_250, sampledAt: 0 }, 100)).toEqual({ beatMs: 500, delayMs: -350 });
  });
});


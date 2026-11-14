import { describe, expect, it } from 'vitest';
import {
  companionHudStateSchema,
  companionEventSchema,
  companionAgentCapabilitiesSchema,
  companionPermissionDecisionSchema,
  companionPermissionRequestSchema,
  companionSessionSchema,
  companionSubscriptionSchema,
  type CompanionEvent,
} from '../src/companion.js';

const ids = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  taskId: '00000000-0000-4000-8000-000000000002',
  eventId: '00000000-0000-4000-8000-000000000003',
  requestId: '00000000-0000-4000-8000-000000000004',
  decisionId: '00000000-0000-4000-8000-000000000005',
};
const at = '2026-11-01T12:00:00.000Z';

describe('Companion contracts', () => {
  it('accepts a session with an unambiguous task, project and provider session', () => {
    const session = companionSessionSchema.parse({
      sessionId: ids.sessionId,
      taskId: ids.taskId,
      agent: 'claude',
      projectId: 'project-1',
      providerSessionId: 'claude-session-1',
      status: 'running',
      connection: 'connected',
      startedAt: at,
      updatedAt: at,
    });
    expect(session).toMatchObject({ agent: 'claude', taskId: ids.taskId, projectId: 'project-1' });
  });

  it('rejects a session without task identity or with an invalid status', () => {
    expect(() => companionSessionSchema.parse({ sessionId: ids.sessionId, taskId: null, agent: 'codex', projectId: null, providerSessionId: null, status: 'running', connection: 'connected', startedAt: at, updatedAt: at })).toThrow();
    expect(() => companionSessionSchema.parse({ sessionId: ids.sessionId, taskId: null, agent: 'opencode', projectId: null, providerSessionId: null, status: 'unknown', connection: 'connected', startedAt: at, updatedAt: at })).toThrow();
  });

  it('preserves observed events while marking unsupported permission requests as uncontrollable', () => {
    const observed: CompanionEvent = { eventId: ids.eventId, sessionId: ids.sessionId, taskId: ids.taskId, agent: 'opencode', sequence: 4, occurredAt: at, receivedAt: at, kind: 'tool_started', control: 'observed', tool: 'edit', summary: 'editing file' };
    expect(companionEventSchema.parse(observed)).toEqual(observed);

    const permission = companionPermissionRequestSchema.parse({ requestId: ids.requestId, sessionId: ids.sessionId, taskId: ids.taskId, agent: 'opencode', sequence: 5, fingerprint: 'a'.repeat(64), action: 'write', summary: 'write file', scope: { paths: ['src/a.ts'], commands: [] }, control: 'uncontrollable', transport: 'terminal', expiresAt: '2026-11-01T12:02:00.000Z', createdAt: at });
    expect(permission.control).toBe('uncontrollable');
    expect(() => companionPermissionDecisionSchema.parse({ decisionId: ids.decisionId, requestId: ids.requestId, sessionId: ids.sessionId, decision: 'allow', decidedAt: at, idempotencyKey: 'not-a-uuid' })).toThrow();
  });

  it('requires an expiring, replay-safe decision tied to the exact request', () => {
    const decision = companionPermissionDecisionSchema.parse({ decisionId: ids.decisionId, requestId: ids.requestId, sessionId: ids.sessionId, decision: 'deny', decidedAt: at, idempotencyKey: ids.decisionId });
    expect(decision).toMatchObject({ decision: 'deny', requestId: ids.requestId, sessionId: ids.sessionId });
    expect(() => companionPermissionRequestSchema.parse({ requestId: ids.requestId, sessionId: ids.sessionId, taskId: ids.taskId, agent: 'claude', sequence: 1, fingerprint: 'bad', action: 'write', summary: 'x', scope: { paths: [], commands: [] }, control: 'controllable', transport: 'native', expiresAt: at, createdAt: at })).toThrow();
  });

  it('validates capability and subscription contracts without allowing unbounded filters', () => {
    expect(companionAgentCapabilitiesSchema.parse({ agent: 'codex', observation: true, permissionRequests: true, externalApproval: false, externalQuestionAnswer: false, controlTransport: 'terminal', checkedAt: at, warnings: [] })).toMatchObject({ agent: 'codex', externalApproval: false });
    expect(companionSubscriptionSchema.parse({ subscriptionId: ids.eventId, filter: { sessionIds: [ids.sessionId], kinds: ['tool_started'] }, createdAt: at })).toMatchObject({ subscriptionId: ids.eventId });
    expect(() => companionSubscriptionSchema.parse({ subscriptionId: ids.eventId, filter: { sessionIds: Array.from({ length: 101 }, () => ids.sessionId) }, createdAt: at })).toThrow();
  });

  it('carries the stage layout with the HUD state', () => {
    const state = { visible: true, mode: 'mascot', alwaysOnTop: true, layout: { origin: { x: 1100, y: 600 }, mascot: { x: 664, y: 292 }, compact: { x: 366, y: 292 }, side: 'right' } };
    expect(companionHudStateSchema.parse(state)).toEqual(state);
    expect(() => companionHudStateSchema.parse({ ...state, layout: { ...state.layout, side: 'up' } })).toThrow();
  });
});

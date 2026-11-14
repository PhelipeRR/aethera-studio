import { describe, expect, it } from 'vitest';
import { COMPUTER_ACTION_RISKS, computerActionDecisionSchema, computerActionRequestSchema, type ComputerActionRisk, type ComputerActionStatus } from '../src/index.js';

const at = '2026-11-02T12:00:00.000Z';
const id = '00000000-0000-4000-8000-000000000001';
const request = { actionId: id, sessionId: null, actionType: 'open_app', risk: 'safe', summary: 'Abrir o Bloco de Notas', fingerprint: 'open_app:notepad', expiresAt: at, createdAt: at };

describe('Computer action contracts', () => {
  it('accepts every risk level', () => {
    for (const risk of COMPUTER_ACTION_RISKS) expect(computerActionRequestSchema.safeParse({ ...request, risk }).success).toBe(true);
    const typed: ComputerActionRisk = 'confirm';
    const status: ComputerActionStatus = 'expired';
    expect([typed, status]).toEqual(['confirm', 'expired']);
  });

  it('rejects unknown risk levels, extra fields and oversized payloads', () => {
    expect(computerActionRequestSchema.safeParse({ ...request, risk: 'yolo' }).success).toBe(false);
    expect(computerActionRequestSchema.safeParse({ ...request, command: 'format c:' }).success).toBe(false);
    expect(computerActionRequestSchema.safeParse({ ...request, summary: 'x'.repeat(20_001) }).success).toBe(false);
    expect(computerActionRequestSchema.safeParse({ ...request, fingerprint: 'x'.repeat(129) }).success).toBe(false);
    expect(computerActionDecisionSchema.safeParse({ actionId: id, decision: 'maybe', decidedAt: at }).success).toBe(false);
  });
});

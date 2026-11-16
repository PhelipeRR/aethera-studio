import { describe, expect, it } from 'vitest';
import {
  approvalStatesSchema,
  defaultApprovalStates,
  recordHumanAestheticDecision,
  recordSemanticFidelity,
  recordTechnicalAudit,
  releaseReadiness,
} from '../src/index.js';

const passingAudit = { passed: true, findings: [] };
const failingAudit = {
  passed: false,
  findings: [
    { code: 'TEXT_TOO_SMALL_AT_224', severity: 'critical' },
    { code: 'TEXT_SMALL_AT_224', severity: 'warning' },
  ],
};

describe('CS-9 — independent approval states', () => {
  it('starts with nothing approved and is not release-ready', () => {
    const r = releaseReadiness(defaultApprovalStates());
    expect(r.ready).toBe(false);
    expect(r.blockers).toHaveLength(3);
  });

  it('a technical pass never implies semantic fidelity or human aesthetic approval', () => {
    const s = recordTechnicalAudit(defaultApprovalStates(), passingAudit);
    expect(s.technical.status).toBe('passed');
    expect(s.semanticFidelity.status).toBe('not_evaluated');
    expect(s.humanAesthetic.status).toBe('pending');
    expect(releaseReadiness(s).ready).toBe(false);
  });

  it('a human approval is recorded even when the technical gate fails, and does not hide the failure', () => {
    let s = recordTechnicalAudit(defaultApprovalStates(), failingAudit);
    s = recordHumanAestheticDecision(s, { decision: 'approved', reviewer: 'Phelipe' });
    expect(s.humanAesthetic).toMatchObject({ status: 'approved', reviewer: 'Phelipe' });
    expect(s.technical).toMatchObject({ status: 'failed', criticalCodes: ['TEXT_TOO_SMALL_AT_224'] });
    const r = releaseReadiness(s);
    expect(r.ready).toBe(false);
    expect(r.blockers.join(' ')).toContain('TEXT_TOO_SMALL_AT_224');
  });

  it('re-running the technical audit keeps the human decision untouched', () => {
    let s = recordHumanAestheticDecision(defaultApprovalStates(), { decision: 'rejected', reviewer: 'Phelipe', notes: 'fundo genérico' });
    s = recordTechnicalAudit(s, passingAudit);
    expect(s.humanAesthetic).toMatchObject({ status: 'rejected', reviewer: 'Phelipe', notes: 'fundo genérico' });
  });

  it('refuses an anonymous aesthetic decision', () => {
    expect(() => recordHumanAestheticDecision(defaultApprovalStates(), { decision: 'approved', reviewer: '  ' })).toThrow();
  });

  it('semantic fidelity is not confirmed when a claimed identity lacks references or does not match', () => {
    const insufficient = recordSemanticFidelity(defaultApprovalStates(), {
      topicMatches: true,
      identity: { subject: 'Johnny Silverhand', status: 'insufficient_references' },
    });
    expect(insufficient.semanticFidelity.status).toBe('unverified');

    const notConfirmed = recordSemanticFidelity(defaultApprovalStates(), {
      topicMatches: true,
      identity: { subject: 'Malenia', status: 'not_confirmed' },
    });
    expect(notConfirmed.semanticFidelity.status).toBe('rejected');

    const offTopic = recordSemanticFidelity(defaultApprovalStates(), { topicMatches: false });
    expect(offTopic.semanticFidelity.status).toBe('rejected');
  });

  it('is release-ready only when technical, semantic fidelity and human aesthetic all agree', () => {
    let s = recordTechnicalAudit(defaultApprovalStates(), passingAudit);
    s = recordSemanticFidelity(s, { topicMatches: true, identity: { subject: 'Hornet', status: 'confirmed', evidence: 'refs' } });
    expect(releaseReadiness(s).ready).toBe(false);
    s = recordHumanAestheticDecision(s, { decision: 'approved', reviewer: 'Phelipe' });
    expect(releaseReadiness(s)).toEqual({ ready: true, blockers: [] });
    expect(approvalStatesSchema.parse(s)).toEqual(s);
  });
});

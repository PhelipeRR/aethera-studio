import { createHash, randomUUID } from 'node:crypto';
import type { ComputerActionDecision, ComputerActionRequest, ComputerActionResult } from '@neuralbridge/shared';

interface PersonalActionBroker { run(request: ComputerActionRequest): Promise<ComputerActionResult>; decide(input: ComputerActionDecision): Promise<ComputerActionResult>; }
const expiry = () => new Date(Date.now() + 5 * 60_000).toISOString();
const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class PersonalActionService {
  constructor(private readonly broker: PersonalActionBroker, private readonly onDecision?: (result: ComputerActionResult) => void) {}
  sendMail(input: { accountId: string; to: string[]; subject: string; body: string }): Promise<ComputerActionResult> {
    const summary = `Enviar e-mail para ${input.to.join(', ')}: ${input.subject}`;
    return this.broker.run({ actionId: randomUUID(), sessionId: null, actionType: 'mail.send', risk: 'confirm', summary, fingerprint: fingerprint({ action: 'mail.send', ...input }), createdAt: new Date().toISOString(), expiresAt: expiry(), payload: { text: JSON.stringify({ accountId: input.accountId, to: input.to, subject: input.subject, body: input.body }), projectId: `account:${input.accountId}` } });
  }
  createEvent(input: { accountId: string; summary: string; start: string; end: string }): Promise<ComputerActionResult> {
    const summary = `Criar evento: ${input.summary}`;
    return this.broker.run({ actionId: randomUUID(), sessionId: null, actionType: 'calendar.create', risk: 'confirm', summary, fingerprint: fingerprint({ action: 'calendar.create', ...input }), createdAt: new Date().toISOString(), expiresAt: expiry(), payload: { text: JSON.stringify({ summary: input.summary, start: input.start, end: input.end }) } });
  }
  async decide(input: ComputerActionDecision): Promise<ComputerActionResult> { const result = await this.broker.decide(input); this.onDecision?.(result); return result; }
}

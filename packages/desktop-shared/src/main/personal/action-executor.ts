import type { ComputerActionExecutor } from '@neuralbridge/orchestrator';
import type { ComputerActionRequest } from '@neuralbridge/shared';
import type { IntegrationTokens } from '../security/integration-token-store.js';
import type { GmailClient } from './gmail-client.js';
import type { GoogleCalendarClient } from './calendar-client.js';

interface ActionExecutorDeps { token(accountId: string): IntegrationTokens | null; gmail(accessToken: string): GmailClient; calendar(accessToken: string): GoogleCalendarClient; }
export class PersonalActionExecutor implements ComputerActionExecutor {
  constructor(private readonly deps: ActionExecutorDeps) {}
  async execute(request: ComputerActionRequest): Promise<string> {
    const accountId = request.payload?.projectId?.replace(/^account:/u, '') ?? '';
    const tokens = this.deps.token(accountId);
    if (!tokens) throw new Error('auth_required: conta pessoal não conectada.');
    if (request.actionType === 'mail.send') { const input = JSON.parse(request.payload?.text ?? '{}') as { to?: unknown; subject?: unknown; body?: unknown }; if (!Array.isArray(input.to) || !input.to.every((value) => typeof value === 'string') || typeof input.subject !== 'string' || typeof input.body !== 'string') throw new Error('invalid: payload de envio de e-mail inválido.'); const result = await this.deps.gmail(tokens.accessToken).send({ to: input.to, subject: input.subject, body: input.body }); return `E-mail enviado (${result.id}).`; }
    if (request.actionType === 'calendar.create') { const event = JSON.parse(request.payload?.text ?? '{}') as { summary: string; start: string; end: string }; const result = await this.deps.calendar(tokens.accessToken).createEvent(event); return `Evento criado (${result.id}).`; }
    throw new Error(`unsupported: ação pessoal ${request.actionType}`);
  }
}

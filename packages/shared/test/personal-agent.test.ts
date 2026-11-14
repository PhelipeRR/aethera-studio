import { describe, expect, it } from 'vitest';
import { personalActionSchema, personalConnectorStatusSchema, personalIntentSchema } from '../src/personal-agent.js';

describe('personal agent contracts', () => {
  it('accepts a read-only Gmail intent and rejects unknown tools', () => {
    expect(personalIntentSchema.parse({ kind: 'mail.search', accountId: 'acct-1', query: 'from:boss', readOnly: true })).toMatchObject({ kind: 'mail.search' });
    expect(() => personalIntentSchema.parse({ kind: 'mail.send', accountId: 'acct-1', to: 'a@b.test', subject: 'x', body: 'y', readOnly: true })).toThrow();
  });

  it('requires an explicit confirmation for mutating actions', () => {
    expect(personalActionSchema.parse({ action: 'mail.send', accountId: 'acct-1', preview: 'Enviar para a@b.test: Olá', requiresConfirmation: true })).toMatchObject({ requiresConfirmation: true });
    expect(() => personalActionSchema.parse({ action: 'calendar.create', accountId: 'acct-1', preview: 'evento', requiresConfirmation: false })).toThrow();
  });

  it('keeps connector status bounded and serializable', () => {
    expect(personalConnectorStatusSchema.parse({ provider: 'gmail', state: 'connected', accountId: 'acct-1', scopes: ['gmail.readonly'] })).toEqual({ provider: 'gmail', state: 'connected', accountId: 'acct-1', scopes: ['gmail.readonly'] });
  });
});

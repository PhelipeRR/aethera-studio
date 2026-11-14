import { z } from 'zod';

export const personalProviderSchema = z.enum(['gmail', 'google-calendar', 'whatsapp']);
export const personalConnectorStateSchema = z.enum(['disconnected', 'connecting', 'connected', 'error', 'revoked']);
export const personalConnectorStatusSchema = z.strictObject({
  provider: personalProviderSchema,
  state: personalConnectorStateSchema,
  accountId: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1).max(200)).max(64),
});
export type PersonalConnectorStatus = z.infer<typeof personalConnectorStatusSchema>;

const accountId = z.string().min(1).max(200);
const readOnly = z.literal(true);
export const personalIntentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('mail.search'), accountId, query: z.string().trim().min(1).max(2_000), readOnly }),
  z.strictObject({ kind: z.literal('mail.read'), accountId, messageId: z.string().min(1).max(500), readOnly }),
  z.strictObject({ kind: z.literal('calendar.list'), accountId, from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }), readOnly }),
  z.strictObject({ kind: z.literal('mail.send'), accountId, to: z.string().email(), subject: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(20_000), readOnly: z.literal(false).optional() }),
]);
export type PersonalIntent = z.infer<typeof personalIntentSchema>;

export const personalActionSchema = z.strictObject({
  action: z.enum(['mail.send', 'calendar.create', 'calendar.update', 'calendar.cancel']),
  accountId,
  preview: z.string().trim().min(1).max(20_000),
  requiresConfirmation: z.literal(true),
});
export type PersonalAction = z.infer<typeof personalActionSchema>;

export const personalScopeSchema = z.enum(['gmail.readonly', 'gmail.compose', 'gmail.send', 'calendar.readonly', 'calendar.events']);
export const PERSONAL_AGENT_EXTENSION_ID = 'personal-agent' as const;

import { z } from 'zod';

export const COMPUTER_ACTION_RISKS = ['safe', 'confirm', 'blocked'] as const;
export type ComputerActionRisk = (typeof COMPUTER_ACTION_RISKS)[number];
export const COMPUTER_ACTION_STATUSES = ['requested', 'approved', 'denied', 'expired', 'cancelled', 'completed', 'failed', 'blocked'] as const;
export type ComputerActionStatus = (typeof COMPUTER_ACTION_STATUSES)[number];
export const computerActionRequestSchema = z.strictObject({
  actionId: z.string().uuid(), sessionId: z.string().uuid().nullable(), actionType: z.string().trim().min(1).max(200), risk: z.enum(COMPUTER_ACTION_RISKS), summary: z.string().trim().min(1).max(20_000), fingerprint: z.string().trim().min(1).max(128), expiresAt: z.string().datetime({ offset: true }), createdAt: z.string().datetime({ offset: true }), payload: z.strictObject({ text: z.string().trim().min(1).max(4_000), projectId: z.string().trim().min(1).max(200).optional(), targetWindow: z.string().regex(/^\d{1,20}$/u).optional(), targetElement: z.strictObject({ automationId: z.string().max(200).optional(), name: z.string().max(500).optional(), controlType: z.string().max(200).optional() }).optional() }).optional(),
});
export type ComputerActionRequest = z.infer<typeof computerActionRequestSchema>;
export const computerActionDecisionSchema = z.strictObject({ actionId: z.string().uuid(), decision: z.enum(['allow', 'deny', 'cancel']), decidedAt: z.string().datetime({ offset: true }) });
export type ComputerActionDecision = z.infer<typeof computerActionDecisionSchema>;
export const computerActionResultSchema = z.strictObject({ actionId: z.string().uuid(), status: z.enum(COMPUTER_ACTION_STATUSES), message: z.string().trim().min(1).max(20_000) });
export type ComputerActionResult = z.infer<typeof computerActionResultSchema>;

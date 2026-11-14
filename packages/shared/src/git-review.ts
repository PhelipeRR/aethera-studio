import { z } from 'zod';
import type { AgentId } from './domain.js';

export const GIT_REVIEW_SCOPE_KINDS = ['working-tree', 'commit', 'range'] as const;
export type GitReviewScopeKind = (typeof GIT_REVIEW_SCOPE_KINDS)[number];

export const gitReviewScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('working-tree') }),
  z.strictObject({ kind: z.literal('commit'), commit: z.string().regex(/^[0-9a-f]{7,64}$/i) }),
  z.strictObject({ kind: z.literal('range'), base: z.string().min(1).max(250), head: z.string().min(1).max(250) }),
]);

export type GitReviewScope = z.infer<typeof gitReviewScopeSchema>;

export const gitReviewStartInputSchema = z.strictObject({
  projectId: z.string().min(1).max(64),
  agent: z.enum(['auto', 'claude', 'codex']),
  scope: gitReviewScopeSchema,
});

export type GitReviewStartInput = z.infer<typeof gitReviewStartInputSchema>;

export const gitReviewSeveritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const gitReviewConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const gitReviewFindingSchema = z.strictObject({
  id: z.string().min(1).max(80),
  severity: gitReviewSeveritySchema,
  confidence: gitReviewConfidenceSchema,
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(4_000),
  file: z.string().min(1).max(1_024).nullable(),
  startLine: z.number().int().positive().nullable(),
  endLine: z.number().int().positive().nullable(),
  evidence: z.string().max(4_000),
  suggestion: z.string().max(4_000).nullable(),
  patch: z.string().max(80_000).nullable(),
});

export type GitReviewFinding = z.infer<typeof gitReviewFindingSchema>;

export const gitReviewReportSchema = z.strictObject({
  taskId: z.string().min(1).max(100),
  scope: gitReviewScopeSchema,
  agent: z.enum(['claude', 'codex']),
  generatedAt: z.string().datetime(),
  summary: z.string().min(1).max(4_000),
  findings: z.array(gitReviewFindingSchema).max(50),
  references: z.array(z.string().max(1_024)).max(100),
  truncated: z.boolean(),
});

export type GitReviewReport = z.infer<typeof gitReviewReportSchema>;

/** Provider output has no stable id and is intentionally narrower than the persisted report. */
export const gitReviewProviderSchema = z.strictObject({
  summary: z.string().min(1).max(4_000),
  findings: z.array(
    z.strictObject({
      severity: gitReviewSeveritySchema,
      confidence: gitReviewConfidenceSchema,
      title: z.string().min(1).max(300),
      description: z.string().min(1).max(4_000),
      file: z.string().min(1).max(1_024).nullable(),
      startLine: z.number().int().positive().nullable(),
      endLine: z.number().int().positive().nullable(),
      evidence: z.string().max(4_000),
      suggestion: z.string().max(4_000).nullable(),
      patch: z.string().max(80_000).nullable(),
    }),
  ).max(50),
});

export type GitReviewProviderResult = z.infer<typeof gitReviewProviderSchema>;

export type GitReviewAgent = Extract<AgentId, 'claude' | 'codex'> | 'auto';

/** Unified diff supplied for an explicit, user-confirmed suggestion application. */
export const gitPatchSchema = z.string().min(1).max(80_000);

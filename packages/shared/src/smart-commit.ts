import { z } from 'zod';
import type { AgentId } from './domain.js';

export const smartCommitStartInputSchema = z.strictObject({
  projectId: z.string().min(1).max(64),
  agent: z.enum(['auto', 'claude', 'codex']),
});

export type SmartCommitStartInput = z.infer<typeof smartCommitStartInputSchema>;

const conventionalSubject = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9][a-z0-9._/-]{0,40}\))?!?: [^\r\n]{1,100}$/;

export const smartCommitProviderSchema = z.strictObject({
  subject: z.string().regex(conventionalSubject),
  body: z.string().max(4_000),
  prTitle: z.string().min(1).max(200),
  prBody: z.string().max(8_000),
  checklist: z.array(z.string().min(1).max(300)).max(20),
  changelog: z.string().max(4_000),
  documentationImpact: z.string().max(4_000),
});

export type SmartCommitProviderResult = z.infer<typeof smartCommitProviderSchema>;

export const smartCommitReportSchema = z.strictObject({
  taskId: z.string().min(1).max(100),
  agent: z.enum(['claude', 'codex']),
  generatedAt: z.string().datetime(),
  files: z.array(z.string().min(1).max(1_024)).max(500),
  truncated: z.boolean(),
  proposal: smartCommitProviderSchema,
});

export type SmartCommitReport = z.infer<typeof smartCommitReportSchema>;
export type SmartCommitAgent = Extract<AgentId, 'claude' | 'codex'> | 'auto';

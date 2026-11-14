import { z } from 'zod';

export const evidenceSchema = z.strictObject({
  id: z.string().min(1), taskId: z.string().min(1), attempt: z.number().int().nonnegative(),
  command: z.string().max(2_000).nullable(), agent: z.string().max(100).nullable(),
  files: z.array(z.string().max(1_000)).max(2_000), tests: z.array(z.string().max(2_000)).max(2_000),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(),
  output: z.string().max(100_000), artifactRefs: z.array(z.string().max(1_000)).max(2_000),
  correlationId: z.string().min(1),
});
export type Evidence = z.infer<typeof evidenceSchema>;

const SECRET = /(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|(?:token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+)/giu;
/** Redacts common credential-shaped values before evidence is persisted or exported. */
export function redactEvidence(value: string): string {
  return value.replaceAll(SECRET, '[REDACTED]');
}

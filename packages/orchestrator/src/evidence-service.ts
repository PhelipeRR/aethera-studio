import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { redactSecrets } from '@neuralbridge/agents';
import { executionSnapshots, taskEvidence, type DatabaseHandle } from '@neuralbridge/database';
import { evidenceSchema, redactEvidence, type Evidence } from '@neuralbridge/shared';
import { systemClock, type Clock } from './application/ports.js';

export interface EvidenceInput {
  taskId: string;
  attempt: number;
  command?: string | null;
  agent?: string | null;
  files?: unknown;
  tests?: unknown;
  startedAt?: string | undefined;
  finishedAt?: string | null;
  output?: string;
  artifactRefs?: unknown;
  correlationId?: string;
  /** Identity of the side effect. The same key is recorded at most once; a replay returns null. */
  sideEffectKey?: string;
}

const OUTPUT_LIMIT = 100_000;
const COMMAND_LIMIT = 2_000;

/** Both redactors: the shared credential-shape rules and the agent output rules (Bearer, PATs, env assignments). */
function redact(value: string): string {
  return redactSecrets(redactEvidence(value));
}

function strings(value: unknown, max: number): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 2_000).map((item) => redact(item).slice(0, max)) : [];
}

/** Persists one structured, redacted evidence record and links it to the task snapshot. */
export function createEvidenceService(handle: DatabaseHandle, clock: Clock = systemClock) {
  return {
    has(id: string): boolean {
      return Boolean(handle.db.select({ id: taskEvidence.id }).from(taskEvidence).where(eq(taskEvidence.id, id)).get());
    },
    record(input: EvidenceInput): Evidence | null {
      const id = input.sideEffectKey ?? randomUUID();
      if (input.sideEffectKey && this.has(id)) return null;
      const parsed = evidenceSchema.safeParse({
        id, taskId: input.taskId, attempt: input.attempt,
        command: typeof input.command === 'string' ? redact(input.command).slice(0, COMMAND_LIMIT) : null,
        agent: typeof input.agent === 'string' ? input.agent : null,
        files: strings(input.files, 1_000), tests: strings(input.tests, 2_000),
        startedAt: input.startedAt ?? clock.now().toISOString(), finishedAt: input.finishedAt ?? null,
        output: redact(input.output ?? '').slice(0, OUTPUT_LIMIT), artifactRefs: strings(input.artifactRefs, 1_000),
        correlationId: input.correlationId ?? randomUUID(),
      });
      if (!parsed.success) return null;
      const evidence = parsed.data;
      handle.db.insert(taskEvidence).values({ id: evidence.id, taskId: evidence.taskId, attempt: evidence.attempt, correlationId: evidence.correlationId, payload: JSON.stringify(evidence), createdAt: evidence.startedAt }).onConflictDoNothing().run();
      const snapshot = handle.db.select({ evidenceIds: executionSnapshots.evidenceIds }).from(executionSnapshots).where(eq(executionSnapshots.taskId, evidence.taskId)).get();
      if (snapshot) {
        const ids = [...new Set([...JSON.parse(snapshot.evidenceIds) as string[], evidence.id])];
        handle.db.update(executionSnapshots).set({ evidenceIds: JSON.stringify(ids), updatedAt: clock.now().toISOString() }).where(eq(executionSnapshots.taskId, evidence.taskId)).run();
      }
      return evidence;
    },
  };
}

export type EvidenceService = ReturnType<typeof createEvidenceService>;

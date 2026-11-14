import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executionSnapshots, openDatabase, projects, taskEvidence, tasks } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { createEvidenceService } from '../src/evidence-service.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');

describe('EvidenceService', () => {
  it('redacts, persists, and links structured evidence', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-evidence-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
    try {
      handle.db.insert(projects).values({ id: 'p', name: 'P', rootPath: 'C:/p', rules: '' }).run();
      handle.db.insert(tasks).values({ id: 't', prompt: 'p', projectId: 'p', mode: 'codex', status: 'running' }).run();
      handle.db.insert(executionSnapshots).values({ taskId: 't', phase: 'executing', attempt: 1, updatedAt: new Date().toISOString() }).run();
      const evidence = createEvidenceService(handle).record({ taskId: 't', attempt: 1, command: 'token=do-not-store', output: 'api_key=hidden', files: ['src/a.ts'], tests: ['npm test'] });
      expect(evidence).toMatchObject({ taskId: 't', attempt: 1, files: ['src/a.ts'], tests: ['npm test'] });
      expect(evidence?.output).toContain('[REDACTED]');
      expect(handle.db.select().from(taskEvidence).where(eq(taskEvidence.taskId, 't')).all()).toHaveLength(1);
      expect(JSON.parse(handle.db.select().from(executionSnapshots).where(eq(executionSnapshots.taskId, 't')).get()?.evidenceIds ?? '[]')).toEqual([evidence?.id]);
    } finally {
      handle.close();
    }
  });
});

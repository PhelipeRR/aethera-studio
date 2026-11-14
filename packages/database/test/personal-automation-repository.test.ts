import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, PersonalAutomationRepository } from '../src/index.js';

describe('PersonalAutomationRepository', () => {
  it('persists rules, next runs and idempotent run states', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'personal-auto-')), 'db.sqlite'), { migrationsFolder: new URL('../migrations', import.meta.url).pathname.replace(/^\//u, '') });
    const repository = new PersonalAutomationRepository(handle.db);
    repository.saveRule({ id: 'a1', intervalMs: 1000, nextRunAt: 0, state: 'active', action: { kind: 'notify', title: 'Test' } });
    expect(repository.listRules()).toMatchObject([{ id: 'a1', intervalMs: 1000, nextRunAt: 0, state: 'active', action: { kind: 'notify', title: 'Test' } }]);
    expect(repository.hasRun('a1:0')).toBe(false);
    repository.saveRun('a1:0', 'completed');
    expect(repository.hasRun('a1:0')).toBe(true);
    repository.saveRun('a1:1', 'awaiting_approval', 'action-1');
    expect(repository.resolveAction('action-1', 'completed')).toBe(true);
    handle.close();
  });
});

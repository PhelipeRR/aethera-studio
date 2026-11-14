import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTransactionalSkillInstaller } from '../src/skills/index.js';

const manifest = (name: string) => `---\nname: ${name}\ndescription: test skill\n---\n`;
async function setup(): Promise<{ root: string; source: string; destinationRoot: string; journalRoot: string; stagingRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'nb-installer-'));
  const source = join(root, 'source'); const destinationRoot = join(root, 'managed'); const journalRoot = join(root, 'journal'); const stagingRoot = join(root, 'staging');
  await mkdir(source, { recursive: true }); await writeFile(join(source, 'SKILL.md'), manifest('Demo Skill'), 'utf8');
  return { root, source, destinationRoot, journalRoot, stagingRoot };
}

describe('Transactional skills installer', () => {
  it('installs a new skill only after fingerprint-bound authorization', async () => {
    const paths = await setup(); const installer = createTransactionalSkillInstaller({ journalRoot: paths.journalRoot });
    const prepared = await installer.prepare({ skillId: 'demo', source: paths.source, destination: join(paths.destinationRoot, 'demo'), allowedDestinationRoot: paths.destinationRoot, stagingRoot: paths.stagingRoot, journalRoot: paths.journalRoot, scope: 'global' });
    expect(prepared.transaction.state).toBe('awaiting_approval');
    await expect(installer.commit(prepared.transaction.id, { ...prepared.authorization, fingerprint: 'wrong' })).rejects.toThrow('authorization_mismatch');
    const completed = await installer.commit(prepared.transaction.id, prepared.authorization);
    expect(completed.state).toBe('completed');
    expect(await readFile(join(paths.destinationRoot, 'demo', 'SKILL.md'), 'utf8')).toContain('Demo Skill');
  });

  it('backs up an update and supports explicitly authorized rollback', async () => {
    const paths = await setup(); const destination = join(paths.destinationRoot, 'demo'); await mkdir(destination, { recursive: true }); await writeFile(join(destination, 'SKILL.md'), manifest('Old Skill'), 'utf8');
    const installer = createTransactionalSkillInstaller({ journalRoot: paths.journalRoot }); const prepared = await installer.prepare({ skillId: 'demo', source: paths.source, destination, allowedDestinationRoot: paths.destinationRoot, stagingRoot: paths.stagingRoot, journalRoot: paths.journalRoot, scope: 'global' }); const completed = await installer.commit(prepared.transaction.id, prepared.authorization);
    expect(completed.operation).toBe('update'); expect(completed.backupPath).not.toBeNull();
    const rollback = await installer.rollback(completed.id, { ...prepared.authorization, operation: 'rollback', summary: 'rollback', fingerprint: completed.fingerprint });
    expect(rollback.state).toBe('rolled_back'); expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toContain('Old Skill');
  });

  it('cancels before commit and marks interrupted journal entries for recovery', async () => {
    const paths = await setup(); const installer = createTransactionalSkillInstaller({ journalRoot: paths.journalRoot }); const prepared = await installer.prepare({ skillId: 'demo', source: paths.source, destination: join(paths.destinationRoot, 'demo'), allowedDestinationRoot: paths.destinationRoot, stagingRoot: paths.stagingRoot, journalRoot: paths.journalRoot, scope: 'project', agent: 'codex' });
    const cancelled = await installer.cancel(prepared.transaction.id); expect(cancelled.state).toBe('cancelled'); await expect(stat(prepared.transaction.stagingPath)).rejects.toThrow();
    const second = await installer.prepare({ skillId: 'demo2', source: paths.source, destination: join(paths.destinationRoot, 'demo2'), allowedDestinationRoot: paths.destinationRoot, stagingRoot: paths.stagingRoot, journalRoot: paths.journalRoot, scope: 'project' });
    const journal = await installer.readJournal(second.transaction.id); journal.state = 'committing'; await writeFile(join(paths.journalRoot, `${second.transaction.id}.json`), JSON.stringify(journal), 'utf8');
    expect((await installer.recover()).find((item) => item.id === second.transaction.id)?.state).toBe('recovery_required');
  });

  it('rejects destination traversal and source changes after preparation', async () => {
    const paths = await setup(); const installer = createTransactionalSkillInstaller({ journalRoot: paths.journalRoot });
    await expect(installer.prepare({ skillId: 'bad', source: paths.source, destination: join(paths.destinationRoot, '..', 'outside'), allowedDestinationRoot: paths.destinationRoot, stagingRoot: paths.stagingRoot, journalRoot: paths.journalRoot, scope: 'global' })).rejects.toThrow('invalid_skill_destination');
    const prepared = await installer.prepare({ skillId: 'changed', source: paths.source, destination: join(paths.destinationRoot, 'changed'), allowedDestinationRoot: paths.destinationRoot, stagingRoot: paths.stagingRoot, journalRoot: paths.journalRoot, scope: 'global' });
    await writeFile(join(paths.source, 'SKILL.md'), manifest('Changed Skill'), 'utf8');
    await expect(installer.commit(prepared.transaction.id, prepared.authorization)).rejects.toThrow('fingerprint_changed');
  });

  it('rechecks an expected destination fingerprint after acquiring the destination lock', async () => {
    const paths = await setup(); const destination = join(paths.destinationRoot, 'guarded'); await mkdir(destination, { recursive: true }); await writeFile(join(destination, 'SKILL.md'), manifest('Original'), 'utf8');
    const installer = createTransactionalSkillInstaller({ journalRoot: paths.journalRoot }); const prepared = await installer.prepare({ skillId: 'guarded', source: paths.source, destination, allowedDestinationRoot: paths.destinationRoot, stagingRoot: paths.stagingRoot, journalRoot: paths.journalRoot, scope: 'global', expectedDestinationFingerprint: '0'.repeat(64) });
    await expect(installer.commit(prepared.transaction.id, prepared.authorization)).rejects.toThrow('destination_changed');
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toContain('Original');
  });
});

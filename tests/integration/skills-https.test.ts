import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installRemoteSkillRepository } from '@neuralbridge/workspace';
import { startGitHttpsFixture, type GitHttpsFixture } from '../helpers/git-https-fixture.js';

let fixture: GitHttpsFixture | undefined;
afterEach(async () => { await fixture?.close(); fixture = undefined; });

describe('controlled HTTPS skill repository', () => {
  it('clones a real git repository over HTTPS using only the fixture CA', async () => {
    fixture = await startGitHttpsFixture();
    const destinationRoot = await mkdtemp(join(tmpdir(), 'nb-skill-installed-')); const dest = join(destinationRoot, 'installed');
    const limits = { timeoutMs: 30_000, maxBytes: 1_000_000, maxFiles: 20, caFile: fixture.caFile };
    const installed = await installRemoteSkillRepository(fixture.url, dest, ['localhost'], true, limits);
    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toContain('name: Remote');
    await fixture.publishVersion('---\nname: Remote\ndescription: Controlled v2\n---\nUpdated', 'v2');
    await installRemoteSkillRepository(fixture.url, dest, ['localhost'], true, limits);
    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toContain('Controlled v2');
    fixture.failNextUpdate();
    await expect(installRemoteSkillRepository(fixture.url, dest, ['localhost'], true, limits)).rejects.toThrow();
    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toContain('Controlled v2');
  });
});

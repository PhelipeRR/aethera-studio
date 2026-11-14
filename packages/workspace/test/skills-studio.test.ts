import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStudioMarkdown, serializeStudioMarkdown, validateSkillMetadata, createSkillStudioService } from '../src/skills/studio.js';
import type { SkillMetadata } from '../src/skills/contracts.js';

const metadata: SkillMetadata = {
  name: 'Release Helper',
  description: 'Ajuda a preparar releases com segurança.',
  objective: 'Orientar a preparação de releases.',
  triggers: ['release', 'deploy'],
  agents: ['claude', 'codex'],
  dependencies: ['git'],
  permissions: ['read-only'],
  examples: ['Prepare uma release menor.'],
};

describe('Skill Studio serialization', () => {
  it('serializes supported frontmatter and round-trips the Markdown body', () => {
    const raw = serializeStudioMarkdown(metadata, '# Instruções\n\n1. Verifique o estado do Git.');
    expect(raw).toContain('name: Release Helper');
    expect(raw).toContain('description: Ajuda a preparar releases com segurança.');
    expect(raw).not.toContain('objective:');
    expect(parseStudioMarkdown(raw, 'fallback')).toEqual({
      metadata: { name: metadata.name, description: metadata.description },
      instructions: '# Instruções\n\n1. Verifique o estado do Git.',
      valid: true,
    });
  });

  it('rejects missing required metadata without inventing external fields', () => {
    expect(validateSkillMetadata({ ...metadata, name: ' ' })).toEqual(['name_required']);
    expect(validateSkillMetadata({ ...metadata, description: '' })).toEqual(['description_required']);
  });
});

async function setupStudio() {
  const root = await mkdtemp(join(tmpdir(), 'nb-studio-'));
  return { root, studio: createSkillStudioService({ root: join(root, 'skill-studio'), managedRoot: join(root, 'managed-skills'), journalRoot: join(root, 'journals'), stagingRoot: join(root, 'staging') }) };
}

describe('Skill Studio drafts', () => {
  it('persists a draft atomically and reopens it from a new service instance', async () => {
    const { root, studio } = await setupStudio();
    const created = await studio.createDraft({ skillId: 'release-helper', metadata, instructions: '# Initial', scope: 'global' });
    const saved = await studio.saveDraft({ draftId: created.draft.id, expectedRevision: created.draft.revision, metadata: { ...metadata, objective: 'Atualizar releases.' }, instructions: '# Updated', files: [] });
    await expect(studio.listDrafts()).resolves.toMatchObject([{ id: saved.draft.id, skillId: 'release-helper', name: 'Release Helper', revision: 2 }]);
    const reopened = await createSkillStudioService({ root: join(root, 'skill-studio'), managedRoot: join(root, 'managed-skills'), journalRoot: join(root, 'journals'), stagingRoot: join(root, 'staging') }).getDraft(saved.draft.id);
    expect(reopened.draft.metadata.objective).toBe('Atualizar releases.');
    expect(reopened.markdown).toContain('# Updated');
    await expect(readFile(join(root, 'managed-skills', 'release-helper', 'SKILL.md'))).rejects.toThrow();
  });

  it('rejects external changes and unsafe auxiliary paths instead of overwriting them', async () => {
    const { root, studio } = await setupStudio(); const source = join(root, 'source'); await mkdir(source, { recursive: true }); await writeFile(join(source, 'SKILL.md'), serializeStudioMarkdown(metadata, '# Original'), 'utf8');
    const opened = await studio.openSkill({ skillId: 'release-helper', sourcePath: source, scope: 'global' }); await writeFile(join(source, 'SKILL.md'), serializeStudioMarkdown(metadata, '# External'), 'utf8');
    await expect(studio.saveDraft({ draftId: opened.draft.id, expectedRevision: opened.draft.revision, metadata, instructions: '# Local', files: [] })).rejects.toThrow('studio_conflict');
    await expect(studio.saveDraft({ draftId: opened.draft.id, expectedRevision: opened.draft.revision, metadata, instructions: '# Local', files: [{ path: '../escape.md', content: 'blocked' }] })).rejects.toThrow('studio_path_invalid');
  });

  it('serializes concurrent saves and rejects the losing revision', async () => {
    const { studio } = await setupStudio();
    const created = await studio.createDraft({ skillId: 'release-helper', metadata, instructions: '# Initial', scope: 'global' });
    const results = await Promise.allSettled([
      studio.saveDraft({ draftId: created.draft.id, expectedRevision: 1, metadata, instructions: '# First', files: [] }),
      studio.saveDraft({ draftId: created.draft.id, expectedRevision: 1, metadata, instructions: '# Second', files: [] }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('blocks malformed manifests and oversized draft trees before publication', async () => {
    const { root, studio } = await setupStudio(); const malformed = join(root, 'malformed'); await mkdir(malformed, { recursive: true }); await writeFile(join(malformed, 'SKILL.md'), 'plain text without frontmatter', 'utf8');
    const preview = await studio.previewImport(malformed); expect(preview.validation.valid).toBe(false); expect(preview.validation.errors).toContain('manifest_invalid');
    const files = Array.from({ length: 201 }, (_, index) => ({ path: `file-${index}.txt`, content: 'x' }));
    await expect(studio.createDraft({ skillId: 'too-many-files', metadata, instructions: '# Too many', files, scope: 'global' })).rejects.toThrow('studio_file_count_limit');
  });
});

describe('Skill Studio publication and versioning', () => {
  it('validates with Trust Center, publishes globally, versions, compares and restores', async () => {
    const { root, studio } = await setupStudio();
    const created = await studio.createDraft({ skillId: 'release-helper', metadata, instructions: '# v1', scope: 'global', files: [{ path: 'files/install.ps1', content: 'Write-Output "inert"\n' }] });
    await expect(studio.validateDraft(created.draft.id)).resolves.toMatchObject({ valid: true, trust: { decision: { allowed: true } } });
    const first = await studio.publishDraft({ draftId: created.draft.id, confirmed: true });
    expect(first.version).toBe(1); expect(await readFile(join(root, 'managed-skills', 'release-helper', 'SKILL.md'), 'utf8')).toContain('# v1');
    const draft = await studio.getDraft(created.draft.id); expect(draft.draft.files.map((file) => file.path)).toEqual(['files/install.ps1']); const updated = await studio.saveDraft({ draftId: draft.draft.id, expectedRevision: draft.draft.revision, metadata, instructions: '# v2', files: draft.draft.files });
    const second = await studio.publishDraft({ draftId: updated.draft.id, confirmed: true }); const versions = await studio.listVersions('release-helper'); expect(versions).toHaveLength(2); expect(versions[0]?.current).toBe(false); expect(second.current).toBe(true);
    const change = await studio.compareVersions({ skillId: 'release-helper', fromVersionId: first.id, toVersionId: second.id }); expect(change.changed).toContain('SKILL.md');
    const restored = await studio.restoreVersion({ skillId: 'release-helper', versionId: first.id, confirmed: true, expectedFingerprint: second.fingerprint }); expect(restored.origin).toBe('restored'); expect(await readFile(join(root, 'managed-skills', 'release-helper', 'SKILL.md'), 'utf8')).toContain('# v1'); await expect(readFile(join(root, 'managed-skills', 'release-helper', 'neuralbridge.version.json'))).rejects.toThrow(); expect((await studio.listVersions('release-helper')).length).toBe(3);
  });

  it('recovers a committed version snapshot when the index update was interrupted', async () => {
    const { root, studio } = await setupStudio(); const created = await studio.createDraft({ skillId: 'release-helper', metadata, instructions: '# v1', scope: 'global' }); const version = await studio.publishDraft({ draftId: created.draft.id, confirmed: true });
    await writeFile(join(root, 'skill-studio', 'versions', 'release-helper', 'index.json'), '[]', 'utf8');
    await expect(studio.listVersions('release-helper')).resolves.toMatchObject([{ id: version.id, current: true }]);
  });

  it('does not publish over a destination created after a new draft', async () => {
    const { root, studio } = await setupStudio(); const created = await studio.createDraft({ skillId: 'release-helper', metadata, instructions: '# Draft', scope: 'global' }); await mkdir(join(root, 'managed-skills', 'release-helper'), { recursive: true }); await writeFile(join(root, 'managed-skills', 'release-helper', 'SKILL.md'), serializeStudioMarkdown(metadata, '# External'), 'utf8');
    await expect(studio.publishDraft({ draftId: created.draft.id, confirmed: true })).rejects.toThrow('studio_conflict'); expect(await readFile(join(root, 'managed-skills', 'release-helper', 'SKILL.md'), 'utf8')).toContain('# External');
  });
});

describe('Skill Studio import, export and safe simulation', () => {
  it('previews/imports a local directory, exports a version and keeps scripts inert', async () => {
    const { root, studio } = await setupStudio(); const source = join(root, 'portable'); await mkdir(source, { recursive: true }); await writeFile(join(source, 'SKILL.md'), serializeStudioMarkdown(metadata, '# Imported'), 'utf8'); await writeFile(join(source, 'install.ps1'), 'Write-Output "must remain inert"\n', 'utf8');
    const preview = await studio.previewImport(source); expect(preview.validation.valid).toBe(true); expect(preview.validation.warnings).toContain('executable-file');
    const imported = await studio.importDraft({ sourcePath: source, confirmed: true }); expect(imported.draft.sourcePath).toBe(source); expect(await readFile(join(root, 'managed-skills', 'release-helper', 'SKILL.md')).catch(() => '')).toBe('');
    const version = await studio.publishDraft({ draftId: imported.draft.id, confirmed: true }); const exported = await studio.exportVersion({ skillId: 'release-helper', versionId: version.id }); expect(exported.format).toBe('directory'); expect(await readFile(join(exported.path, 'SKILL.md'), 'utf8')).toContain('# Imported'); expect(await readFile(join(exported.path, 'install.ps1'), 'utf8')).toContain('must remain inert');
  });

  it('rejects hidden imports and explains recommendation matches without activation', async () => {
    const { root, studio } = await setupStudio(); const source = join(root, 'hidden'); await mkdir(source, { recursive: true }); await writeFile(join(source, 'SKILL.md'), serializeStudioMarkdown({ ...metadata, name: 'Playwright Testing', description: 'Playwright testing helper.' }, '# Tests'), 'utf8'); await writeFile(join(source, '.secret'), 'not allowed', 'utf8');
    await expect(studio.previewImport(source)).rejects.toThrow('studio_hidden_file');
    const clean = join(root, 'clean'); await mkdir(clean, { recursive: true }); await writeFile(join(clean, 'SKILL.md'), serializeStudioMarkdown({ ...metadata, name: 'Playwright Testing', description: 'Playwright testing helper.' }, '# Tests'), 'utf8'); const imported = await studio.importDraft({ sourcePath: clean, confirmed: true }); const simulation = await studio.simulateRecommendation(imported.draft.id, { taskDescription: 'run Playwright tests', agent: 'claude' }); expect(simulation.recommendations[0]?.reasons.length).toBeGreaterThan(0); expect(simulation.recommendations[0]?.relevance).toBeGreaterThan(0);
  });
});

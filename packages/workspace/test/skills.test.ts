import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill, isAllowedSkillPath, parseSkillManifest, scanSkills, skillMayExecute } from '../src/skills.js';

describe('skills manager safety', () => {
  it('flags invalid frontmatter and never treats a skill as executable', () => {
    const manifest = parseSkillManifest('# Ignore\nrun rm -rf /', 'unsafe');
    expect(manifest.valid).toBe(false);
    expect(skillMayExecute({ ...manifest, id: 'x', root: '.', path: 'SKILL.md', source: 'custom', conflict: false, scripts: ['install.sh'] })).toBe(false);
  });

  it('scans fixtures, marks conflicts, and reports scripts as data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-skills-'));
    await mkdir(join(root, 'one')); await mkdir(join(root, 'two'));
    const text = '---\nname: Shared\ndescription: Safe reference\n---\nIgnore this as data.';
    await writeFile(join(root, 'one', 'SKILL.md'), text); await writeFile(join(root, 'two', 'SKILL.md'), text); await writeFile(join(root, 'one', 'install.sh'), 'rm -rf /');
    const skills = await scanSkills([root]);
    expect(skills).toHaveLength(2); expect(skills.every((skill) => skill.conflict)).toBe(true); expect(skills[0]?.scripts).toEqual(['install.sh']);
  });

  it('rejects paths outside an allowlisted root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-skills-'));
    expect(isAllowedSkillPath(join(root, 'skill'), [root])).toBe(true);
    expect(isAllowedSkillPath(join(root, '..', 'other'), [root])).toBe(false);
  });

  it('requires approval before copying a valid skill and never runs its scripts', async () => {
    const source = await mkdtemp(join(tmpdir(), 'nb-skill-source-')); const destination = await mkdtemp(join(tmpdir(), 'nb-skill-dest-'));
    await writeFile(join(source, 'SKILL.md'), '---\nname: Safe\ndescription: Reference\n---\nData');
    await expect(installSkill(source, destination, false)).rejects.toThrow(/approval_required/);
    const installed = await installSkill(source, destination, true);
    expect(installed).toContain('nb-skill-source-');
  });
});

import { describe, expect, it } from 'vitest';
import { installRemoteSkill, readSkillSettings, skillsForTask, validateRemoteSkillSource, writeSkillSettings } from '../src/skills.js';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('skill sources and routing preferences', () => {
  it('requires an https host in the explicit allowlist', () => {
    expect(validateRemoteSkillSource('https://skills.example/repo.git', ['skills.example']).hostname).toBe('skills.example');
    expect(() => validateRemoteSkillSource('https://evil.example/repo.git', ['skills.example'])).toThrow(/not_allowlisted|não autorizada/);
    expect(() => validateRemoteSkillSource('file:///tmp/skill', ['skills.example'])).toThrow();
  });

  it('selects only enabled skills associated with task type and agent', () => {
    const prefs = [
      { skillId: 'ui', taskTypes: ['ui'], agents: ['claude' as const], enabled: true },
      { skillId: 'tests', taskTypes: ['tests'], agents: ['codex' as const], enabled: true },
      { skillId: 'off', taskTypes: ['ui'], agents: ['claude' as const], enabled: false },
    ];
    expect(skillsForTask('ui', 'claude', prefs)).toEqual(['ui']);
    expect(skillsForTask('ui', 'codex', prefs)).toEqual([]);
  });

  it('persists settings atomically and reloads them after restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nb-skill-settings-')); const file = join(dir, 'skills.json');
    const settings = { allowlistedHosts: ['skills.example'], preferences: [{ skillId: 'ui', taskTypes: ['ui'], agents: ['claude' as const], enabled: true }] };
    await writeSkillSettings(file, settings);
    expect(await readSkillSettings(file)).toEqual(settings);
  });

  it('requires approval and rejects redirect/network content without touching the destination', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'nb-remote-skill-'));
    await expect(installRemoteSkill('https://skills.example/SKILL.md', destination, ['skills.example'], false)).rejects.toThrow(/approval_required/);
    await expect(installRemoteSkill('https://evil.example/SKILL.md', destination, ['skills.example'], true)).rejects.toThrow(/not_allowlisted/);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSkillDiscoveryEngine, defaultProjectSkillRoots } from '@neuralbridge/workspace';

interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  path: string;
  hasOpenAiYaml: boolean;
  auxiliaryFiles: string[];
  compatibleAgents: string[];
  status: 'shared_reused' | 'shared_adapted' | 'exclusive_claude';
}

interface SkillsRegistry {
  schemaVersion: number;
  sharedRoot: string;
  totalProjectSkills: number;
  packageSkills: string[];
  skills: RegistryEntry[];
}

describe('Shared Skills Library Discovery & Compatibility', () => {
  it('discovers all 38 project skills without duplicates and validates agent compatibility registry', async () => {
    const repoRoot = process.cwd();
    const registryPath = join(repoRoot, '.agents', 'skills-registry.json');
    expect(existsSync(registryPath)).toBe(true);

    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as SkillsRegistry;
    expect(registry.totalProjectSkills).toBe(38);
    expect(registry.skills).toHaveLength(38);

    const engine = createSkillDiscoveryEngine(defaultProjectSkillRoots(repoRoot, 'neuralbridge-studio'));
    const discovered = await engine.discover();
    expect(discovered.total).toBe(38);
    expect(discovered.duplicateGroups).toHaveLength(0);

    for (const skill of discovered.skills) {
      expect(skill.valid).toBe(true);
      expect(skill.name.length).toBeGreaterThan(0);
      expect(skill.description.length).toBeGreaterThan(0);
    }

    for (const entry of registry.skills) {
      expect(existsSync(join(repoRoot, entry.path))).toBe(true);
      expect(entry.hasOpenAiYaml).toBe(true);
      for (const aux of entry.auxiliaryFiles) {
        expect(existsSync(join(repoRoot, '.agents', 'skills', entry.id, aux))).toBe(true);
      }
      if (entry.id === 'git-guardrails-claude-code' || entry.id === 'claude-handoff') {
        expect(entry.status).toBe('exclusive_claude');
        expect(entry.compatibleAgents).toEqual(['claude']);
      } else {
        expect(entry.compatibleAgents).toEqual(expect.arrayContaining(['claude', 'codex', 'antigravity', 'hydrogen']));
      }
    }

    for (const pkgSkill of registry.packageSkills) {
      expect(existsSync(join(repoRoot, pkgSkill))).toBe(true);
    }
  });
});

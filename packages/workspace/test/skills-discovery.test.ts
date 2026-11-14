import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSkillDiscoveryEngine, defaultGlobalSkillRoots, defaultProjectSkillRoots } from '../src/skills/index.js';

async function skill(root: string, folder: string, content: string): Promise<void> {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), content, 'utf8');
}

const valid = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\nInstructions are data.\n`;

describe('Skills Discovery Engine', () => {
  it('discovers global, project and agent-specific skills deterministically', async () => {
    const home = await mkdtemp(join(tmpdir(), 'nb-discovery-'));
    const project = await mkdtemp(join(tmpdir(), 'nb-project-'));
    await skill(join(home, '.agents', 'skills'), 'remotion-best-practices', valid('Remotion Best Practices', 'Animações e vídeo'));
    await skill(join(project, '.claude', 'skills'), 'React', valid('React', 'Componentes com acentuação'));
    const engine = createSkillDiscoveryEngine([...defaultGlobalSkillRoots(home), ...defaultProjectSkillRoots(project, 'p1')]);
    const result = await engine.discover();
    expect(result.skills.map((item) => item.name)).toEqual(['React', 'Remotion Best Practices']);
    expect(result.skills.find((item) => item.name.startsWith('React'))?.scope).toBe('project');
    expect((await engine.list({ agent: 'codex' })).map((item) => item.name)).toEqual(['Remotion Best Practices']);
  });

  it('normalizes unicode search, reports invalid manifests and conflicts without deleting alternatives', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-discovery-'));
    await skill(root, 'one', valid('Café Tools', 'Descrição de teste'));
    await skill(root, 'two', valid('Cafe Tools', 'Outra origem'));
    await skill(root, 'invalid', 'not frontmatter');
    const result = await createSkillDiscoveryEngine([{ path: root, scope: 'global', source: 'agents' }]).discover();
    expect(result.skills).toHaveLength(3);
    expect(result.duplicateGroups.some((group) => group.reason === 'same-name')).toBe(true);
    expect(result.skills.filter((item) => item.conflict)).toHaveLength(2);
    expect((await createSkillDiscoveryEngine([{ path: root, scope: 'global' }]).list({ text: 'cafe' }))).toHaveLength(2);
  });

  it('ignores missing roots and symlinked roots in read-only discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-discovery-'));
    const target = await mkdtemp(join(tmpdir(), 'nb-target-'));
    await skill(target, 'outside', valid('Outside', 'Não deve ser alcançada pela raiz symlink'));
    await symlink(target, join(root, 'linked'), 'junction');
    const result = await createSkillDiscoveryEngine([{ path: join(root, 'missing'), scope: 'global' }, { path: join(root, 'linked'), scope: 'global' }]).discover();
    expect(result.skills).toEqual([]);
  });
});

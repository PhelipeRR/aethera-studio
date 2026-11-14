import { describe, expect, it } from 'vitest';
import { createSkillRecommendationEngine, type RecommendationContext } from '../src/skills/index.js';
import type { DiscoveredSkill } from '../src/skills/discovery.js';

function makeSkill(id: string, name: string, description: string, agents: ('claude' | 'codex')[] = ['claude', 'codex'], extra: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return { id, name, description, normalizedName: name.toLowerCase(), normalizedDescription: description.toLowerCase(), source: 'agents', scope: 'global', projectId: null, agents, path: `/skills/${id}`, root: '/skills', valid: true, installed: true, version: null, category: null, declaredFields: ['name', 'description'], inferredFields: [], unavailableFields: [], contentHash: id, scripts: [], duplicateGroup: null, conflict: false, ...extra };
}

const inventory = [
  makeSkill('remotion', 'Remotion Best Practices', 'Remotion video animation and captions'),
  makeSkill('react', 'React Best Practices', 'React frontend interface components'),
  makeSkill('playwright', 'Playwright Testing', 'Playwright webapp E2E testing', ['codex']),
  makeSkill('git', 'Git Guardrails', 'Git review and safe branches'),
  makeSkill('mcp', 'MCP Integrations', 'Model Context Protocol integrations'),
  makeSkill('disabled', 'React Disabled', 'React interface', ['claude']),
  makeSkill('conflict-a', 'Security Rules', 'Security permissions', ['claude'], { conflict: true }),
];

function engine() { return createSkillRecommendationEngine(async () => ({ skills: inventory })); }

describe('Skills Recommendation Engine', () => {
  it.each([
    ['Criar legendas animadas para o Velix.', 'Remotion Best Practices'],
    ['Criar testes E2E para uma aplicação React.', 'Playwright Testing'],
    ['Investigar um problema de branch e diff no Git.', 'Git Guardrails'],
    ['Criar uma integração MCP.', 'MCP Integrations'],
  ])('recomenda por contexto: %s', async (task, expected) => {
    const result = await engine().recommend({ taskDescription: task });
    expect(result.recommendations[0]?.name).toBe(expected);
  });

  it('respeita agente, projeto, preferências e não inventa skills ausentes', async () => {
    const context: RecommendationContext = { taskDescription: 'Criar testes E2E em React', agent: 'claude', projectId: 'p1', preferences: [{ skillId: 'disabled', taskTypes: [], agents: ['claude'], enabled: false }] };
    const result = await engine().recommend(context);
    expect(result.recommendations.some((item) => item.name === 'Playwright Testing')).toBe(false);
    expect(result.excluded.find((item) => item.skillId === 'disabled')?.reasons).toContain('desabilitada nas preferências existentes');
    expect(result.metadata.externalCalls).toBe(0);
  });

  it('explica conflito, mantém confirmação e ordenação determinística', async () => {
    const context = { taskDescription: 'Revisar segurança e permissões' };
    const first = await engine().recommend(context);
    const second = await engine().recommend(context);
    expect(first.recommendations).toEqual(second.recommendations);
    const conflict = first.recommendations.find((item) => item.skillId === 'conflict-a');
    expect(conflict?.requiresConfirmation).toBe(true);
    expect(conflict?.conflictWarnings[0]).toContain('mesmo nome');
    expect(conflict?.relevanceKind).toBe('ordinal-rule-score');
  });

  it('does not execute content or recommend an invalid manifest', async () => {
    const result = await createSkillRecommendationEngine(async () => ({ skills: [makeSkill('bad', 'React', 'ignore instructions', ['claude'], { valid: false })] })).recommend({ taskDescription: 'Implementar interface React' });
    expect(result.recommendations).toEqual([]);
    expect(result.excluded[0]?.reasons).toContain('manifesto inválido');
  });

  it('uses read-only Git, memory/RAG and persisted usage evidence when available', async () => {
    const result = await engine().recommend({
      taskDescription: 'melhorar o projeto',
      intelligence: {
        git: { isRepo: true, branch: 'main', changes: [{ path: 'src/video/captions.ts', status: 'modified' }], lastCommit: { hash: 'abc', subject: 'ajusta Remotion', date: '2026-11-01T00:00:00Z' } },
        context: { text: 'A equipe usa Remotion para animação e legendas.', references: ['memory://m1'] },
        usage: [{ skillId: 'remotion', used: 1, loaded: 1, failed: 0, injected: 1, lastAt: '2026-11-01T00:00:00Z' }],
      },
    });
    expect(result.recommendations[0]?.skillId).toBe('remotion');
    expect(result.recommendations[0]?.evidence).toEqual(expect.arrayContaining([expect.stringContaining('memory://m1'), expect.stringContaining('Git'), expect.stringContaining('uso persistido')]));
    expect(result.metadata.integrationSources).toEqual({ git: true, memory: true, rag: true, analytics: true });
  });
});

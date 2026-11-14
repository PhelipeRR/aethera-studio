import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import type { ProjectDependency } from '@neuralbridge/shared';
import { BrainService, buildProjectProfile, loadProjectProfile, profileContext, projectScope, projectTaskContext, RagEngine, saveProjectProfile, type Actor } from '../src/index.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const user: Actor = { kind: 'user', client: 'electron' };
const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

async function setup() {
  const base = await mkdtemp(join(tmpdir(), 'nb-profile-'));
  const handle = openDatabase(join(base, 'brain.db'), { migrationsFolder: MIGRATIONS });
  handles.push(handle);
  const loja = join(base, 'loja');
  const outro = join(base, 'outro');
  for (const dir of ['apps/web/src', 'packages/core/src', 'docs']) await mkdir(join(loja, dir), { recursive: true });
  await mkdir(join(outro, 'src'), { recursive: true });
  await writeFile(join(loja, 'apps/web/src/checkout.ts'), 'export function finalizarCompra() {}\nexport const TAXA = 1;');
  await writeFile(join(loja, 'packages/core/src/pool.ts'), 'export class Pool {}');
  await writeFile(join(loja, 'docs/arquitetura.md'), '# Arquitetura\nMonorepo.');
  await writeFile(join(loja, 'README.md'), '# Loja');
  await writeFile(join(outro, 'src/segredo.ts'), 'export function doOutro() {}');
  handle.db.insert(projects).values([{ id: 'loja', name: 'Loja', rootPath: loja }, { id: 'outro', name: 'Outro', rootPath: outro }]).run();
  const rag = new RagEngine(handle);
  const brain = new BrainService(handle);
  return { handle, rag, brain, loja, outro };
}

const deps: ProjectDependency[] = [{ name: 'react', version: '19.3.0', kind: 'runtime', source: 'apps/web/package.json' }];
const NOW = '2026-10-29T12:00:00.000Z';

describe('project profile', () => {
  it('describes modules, dependencies, decisions and recurring problems of this project only, each with its source', async () => {
    const { handle, rag, brain, loja, outro } = await setup();
    const index = await rag.indexProject('loja', loja);
    await rag.indexProject('outro', outro);
    const scope = projectScope('loja', false);
    const decision = brain.store({ title: 'Monorepo com npm workspaces', content: 'Decidimos usar npm workspaces.', type: 'decision', projectId: 'loja' }, scope, user).memory;
    brain.setConfidence(decision.id, 'reviewed');
    const fix1 = brain.store({ title: 'Timeout no pool', content: 'Pool pequeno.', type: 'bug_fix', projectId: 'loja', tags: ['postgres', 'pool'] }, scope, user).memory;
    const fix2 = brain.store({ title: 'Deadlock no checkout', content: 'Transação longa.', type: 'bug_fix', projectId: 'loja', tags: ['postgres'] }, scope, user).memory;
    brain.store({ title: 'Decisão do outro', content: 'Não é da loja.', type: 'decision', projectId: 'outro' }, projectScope('outro', false), user);

    const profile = buildProjectProfile(handle, { projectId: 'loja', stack: null, dependencies: deps, index, previous: null, now: NOW });
    expect(profile.modules).toEqual([
      { path: '(raiz)', files: 1, symbolCount: 0, symbols: [] },
      { path: 'apps/web', files: 1, symbolCount: 2, symbols: ['TAXA', 'finalizarCompra'] },
      { path: 'docs', files: 1, symbolCount: 0, symbols: [] },
      { path: 'packages/core', files: 1, symbolCount: 1, symbols: ['Pool'] },
    ]);
    expect(profile.index).toMatchObject({ files: 4, indexed: 4, limited: false });
    expect(profile.dependencies).toEqual(deps);
    expect(profile.decisions).toEqual([{ id: decision.id, title: 'Monorepo com npm workspaces', confidence: 'reviewed' }]);
    expect(profile.problems).toEqual([
      { tag: 'postgres', occurrences: 2, memories: [{ id: fix2.id, title: 'Deadlock no checkout', confidence: 'unverified' }, { id: fix1.id, title: 'Timeout no pool', confidence: 'unverified' }] },
    ]);
    expect(JSON.stringify(profile)).not.toMatch(/segredo|doOutro|Decisão do outro/);
    expect(profile.changes).toBeNull();
  });

  it('is the same for the same inputs, is stored per project, and says what changed since the previous one', async () => {
    const { handle, rag, loja } = await setup();
    const first = buildProjectProfile(handle, { projectId: 'loja', stack: null, dependencies: deps, index: await rag.indexProject('loja', loja), previous: null, now: NOW });
    expect(buildProjectProfile(handle, { projectId: 'loja', stack: null, dependencies: deps, index: await rag.indexProject('loja', loja), previous: null, now: NOW })).toEqual({
      ...first,
      index: { ...first.index, indexed: 0, skipped: 4 },
    });
    saveProjectProfile(handle, first);
    expect(loadProjectProfile(handle, 'loja')).toEqual(first);
    expect(loadProjectProfile(handle, 'outro')).toBeNull();

    // Delta: a new module, one gone, a new dependency; only the changed file is read again.
    await mkdir(join(loja, 'services/api'), { recursive: true });
    await writeFile(join(loja, 'services/api/server.ts'), 'export function listen() {}');
    await import('node:fs/promises').then(({ rm }) => rm(join(loja, 'docs'), { recursive: true }));
    const next = buildProjectProfile(handle, {
      projectId: 'loja',
      stack: null,
      dependencies: [...deps, { name: 'zod', version: '4.0.0', kind: 'runtime', source: 'package.json' }],
      index: await rag.indexProject('loja', loja),
      previous: loadProjectProfile(handle, 'loja'),
      now: NOW,
    });
    expect(next.index).toMatchObject({ indexed: 1, skipped: 3, removed: 1 });
    expect(next.changes).toEqual({ modulesAdded: ['services/api'], modulesRemoved: ['docs'], dependenciesAdded: ['zod'], dependenciesRemoved: [] });
  });

  it('becomes a short, bounded context for the tasks of that project', async () => {
    const { handle, rag, brain, loja } = await setup();
    brain.store({ title: 'Monorepo com npm workspaces', content: 'x', type: 'decision', projectId: 'loja' }, projectScope('loja', false), user);
    const profile = buildProjectProfile(handle, { projectId: 'loja', stack: { stacks: ['node'], packageManager: 'npm', evidence: {} }, dependencies: deps, index: await rag.indexProject('loja', loja), previous: null, now: NOW });
    const text = profileContext(profile, 2000);
    expect(text).toContain('Perfil técnico do projeto');
    expect(text).toContain('apps/web');
    expect(text).toContain('react');
    expect(text).toContain('Monorepo com npm workspaces');
    expect(profileContext(profile, 120).length).toBeLessThanOrEqual(120);
  });

  it('shares the task context budget with the memories, and is a verifiable reference', async () => {
    const { handle, rag, loja } = await setup();
    const profile = buildProjectProfile(handle, { projectId: 'loja', stack: null, dependencies: deps, index: await rag.indexProject('loja', loja), previous: null, now: NOW });
    const hit = { id: 'm1', title: 'Cache', type: 'decision' as const, projectId: 'loja', tags: [], snippet: 'Usa Redis. '.repeat(200), score: 1, matchedBy: ['text' as const], confidence: 'reviewed' as const };
    const context = projectTaskContext(profile, [hit], 300);
    expect(context.references).toEqual(['profile://loja', 'memory://m1']);
    expect(context.text.startsWith('[profile://loja] Perfil técnico do projeto')).toBe(true);
    expect(context.estimatedTokens).toBeLessThanOrEqual(300);
    // Without a profile it is the memory context alone.
    expect(projectTaskContext(null, [hit], 300).references).toEqual(['memory://m1']);
  });
});

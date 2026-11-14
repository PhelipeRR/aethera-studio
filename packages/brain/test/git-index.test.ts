import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, projects, tasks, taskSteps, type DatabaseHandle } from '@neuralbridge/database';
import { readGitHistory } from '@neuralbridge/workspace';
import { BrainService, commitRelations, indexGitHistory, knownCommits, projectScope, RagEngine, searchGitHistory, type Actor } from '../src/index.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const user: Actor = { kind: 'user', client: 'electron' };
const handles: DatabaseHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.close();
});

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'nb-gitidx-'));
  const root = join(base, 'loja');
  mkdirSync(join(root, 'src'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@x.dev', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 5;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Cria o pool');
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 20;\nconst key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
  writeFileSync(join(root, '.env'), 'DATABASE_URL=postgres://user:senha@db/loja\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Corrige timeout no checkout aumentando o pool');
  const handle = openDatabase(join(base, 'brain.db'), { migrationsFolder: MIGRATIONS });
  handles.push(handle);
  handle.db.insert(projects).values([{ id: 'loja', name: 'Loja', rootPath: root }, { id: 'outro', name: 'Outro', rootPath: join(base, 'outro') }]).run();
  return { handle, root, git };
}

describe('Git history in the index', () => {
  it('indexes each commit and changed file once, without secrets or sensitive files, and finds a solution with commit, file and line', async () => {
    const { handle, root } = setup();
    const history = await readGitHistory(root, { known: knownCommits(handle, 'loja') });
    expect(indexGitHistory(handle, 'loja', history)).toEqual({ commits: 2, files: 3, alreadyKnown: 0, limited: false, branches: 1 });
    expect(knownCommits(handle, 'loja').size).toBe(2);
    expect(indexGitHistory(handle, 'loja', await readGitHistory(root, { known: knownCommits(handle, 'loja') }))).toMatchObject({ commits: 0 });

    const hits = searchGitHistory(handle, 'loja', 'timeout checkout pool');
    expect(hits[0]).toMatchObject({ subject: 'Corrige timeout no checkout aumentando o pool', author: 'Ana' });
    const fileHit = searchGitHistory(handle, 'loja', 'size').find((hit) => hit.file === 'src/pool.ts');
    expect(fileHit?.reference).toMatch(/^git:\/\/[0-9a-f]{40}\/src\/pool\.ts:1-1$/);
    const all = JSON.stringify(handle.sqlite.prepare("SELECT content FROM rag_chunks WHERE project_id = 'loja'").all());
    expect(all).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(all).not.toContain('senha@db');
    expect(all).toContain('possível segredo');
    expect(searchGitHistory(handle, 'outro', 'timeout')).toEqual([]);
  });

  it('keeps commits when the file index is rebuilt', async () => {
    const { handle, root } = setup();
    indexGitHistory(handle, 'loja', await readGitHistory(root, { known: new Set() }));
    await new RagEngine(handle).indexProject('loja', root);
    expect(knownCommits(handle, 'loja').size).toBe(2);
  });

  it('relates a commit to the memories citing its files and the tasks that changed them', async () => {
    const { handle, root } = setup();
    const history = await readGitHistory(root, { known: new Set() });
    indexGitHistory(handle, 'loja', history);
    const fix = history.commits[0];
    const brain = new BrainService(handle);
    const memory = brain.store({ title: 'Pool do checkout', content: 'Pool com 20 conexões.', type: 'bug_fix', projectId: 'loja', sourceRef: 'src/pool.ts:1' }, projectScope('loja', false), user).memory;
    brain.store({ title: 'Outra coisa', content: 'x', type: 'decision', projectId: 'loja', sourceRef: 'src/outro.ts' }, projectScope('loja', false), user);
    handle.db.insert(tasks).values({ id: 't1', prompt: 'Corrija o timeout', projectId: 'loja', mode: 'codex', status: 'completed', createdAt: fix?.date ?? '' }).run();
    handle.db.insert(taskSteps).values({ id: 't1-s', taskId: 't1', position: 0, agent: 'codex', kind: 'implement', status: 'completed', filesChanged: JSON.stringify(['src/pool.ts']) }).run();
    expect(commitRelations(handle, 'loja', fix?.hash ?? '')).toEqual({
      files: ['.env', 'src/pool.ts'],
      memories: [{ id: memory.id, title: 'Pool do checkout', confidence: 'unverified' }],
      tasks: [{ id: 't1', prompt: 'Corrija o timeout' }],
    });
  });
});

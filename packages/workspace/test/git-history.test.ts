import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readGitHistory } from '../src/git-history.js';

function repo() {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-gith-')), 'loja');
  mkdirSync(join(root, 'src'), { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Ana Dev', '-c', 'user.email=ana@exemplo.dev', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 5;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Cria o pool de conexões');
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 20;\n// timeout no checkout\n');
  git('commit', '-q', '-am', 'Corrige timeout no checkout', '-m', 'O pool de 5 conexões esgotava no pico.');
  git('mv', 'src/pool.ts', 'src/db-pool.ts');
  git('commit', '-q', '-m', 'Renomeia pool');
  git('checkout', '-q', '-b', 'feature/cache.v2');
  writeFileSync(join(root, 'src', 'cache.ts'), 'export const ttl = 60;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Cache de sessão');
  git('checkout', '-q', 'main');
  return { root, git };
}

describe('readGitHistory', () => {
  it('reads commits of every local branch with message, author name, files and the first changed line', async () => {
    const { root } = repo();
    const history = await readGitHistory(root, { known: new Set() });
    expect(history).toMatchObject({ isRepo: true, limited: false });
    expect(history.branches.map((branch) => branch.name).sort()).toEqual(['feature/cache.v2', 'main']);
    expect(history.refs).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'feature/cache.v2', kind: 'local' }), expect.objectContaining({ name: 'main', kind: 'local' })]));
    expect(history.head).toBe('main');
    expect(history.commits.map((commit) => commit.subject)).toEqual(['Cache de sessão', 'Renomeia pool', 'Corrige timeout no checkout', 'Cria o pool de conexões']);
    const fix = history.commits.find((commit) => commit.subject === 'Corrige timeout no checkout');
    expect(fix).toMatchObject({ author: 'Ana Dev', body: 'O pool de 5 conexões esgotava no pico.', files: [{ path: 'src/pool.ts', status: 'modified', line: 1, binary: false }] });
    expect(fix?.files[0]?.patch).toContain('+export const size = 20;');
    expect(JSON.stringify(history)).not.toContain('ana@exemplo.dev');
    expect(history.commits.find((commit) => commit.subject === 'Renomeia pool')?.files[0]).toMatchObject({ path: 'src/db-pool.ts', status: 'renamed', previousPath: 'src/pool.ts' });
  });

  it('skips commits it already knows, stops at the commit limit, and cuts long diffs', async () => {
    const { root, git } = repo();
    const all = await readGitHistory(root, { known: new Set() });
    const known = new Set(all.commits.slice(1).map((commit) => commit.hash));
    expect((await readGitHistory(root, { known })).commits.map((commit) => commit.subject)).toEqual(['Cache de sessão']);
    expect(await readGitHistory(root, { known: new Set(), maxCommits: 2 })).toMatchObject({ limited: true, commits: [{}, {}] });
    writeFileSync(join(root, 'src', 'grande.ts'), Array.from({ length: 4000 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
    git('add', '.');
    git('commit', '-q', '-m', 'Arquivo grande');
    const big = (await readGitHistory(root, { known: new Set(all.commits.map((commit) => commit.hash)), maxPatchBytes: 2000 })).commits[0]?.files[0];
    expect(big).toMatchObject({ truncated: true });
    expect(big?.patch.length).toBeLessThanOrEqual(2000);
  });

  it('paginates from a stable cursor and rejects rewritten refs', async () => {
    const { root, git } = repo();
    const first = await readGitHistory(root, { known: new Set(), maxCommits: 2 });
    expect(first.commits).toHaveLength(2);
    const cursor = first.nextCursor;
    if (!cursor) throw new Error('cursor de paginação ausente');
    const second = await readGitHistory(root, { known: new Set(), maxCommits: 2, cursor });
    expect(second.commits.map((item) => item.hash)).not.toEqual(expect.arrayContaining(first.commits.map((item) => item.hash)));
    expect(second.nextCursor).toBeNull();
    git('checkout', '-q', '-b', 'rewritten');
    await expect(readGitHistory(root, { known: new Set(), maxCommits: 2, cursor })).rejects.toThrow(/histórico Git mudou/);
  });

  it('runs no repository hooks or configured programs, and says when there is no repository', async () => {
    const { root, git } = repo();
    const marker = join(root, 'PWNED');
    const hook = join(root, '.git', 'evil.sh').replaceAll('\\', '/');
    writeFileSync(hook, `#!/bin/sh\necho x > "${marker.replaceAll('\\', '/')}"\n`);
    git('config', 'diff.external', `"${hook}"`);
    git('config', 'core.fsmonitor', `"${hook}"`);
    await readGitHistory(root, { known: new Set() });
    expect(existsSync(marker)).toBe(false);
    expect(await readGitHistory(mkdtempSync(join(tmpdir(), 'nb-norepo-')), { known: new Set() })).toEqual({ isRepo: false, branches: [], commits: [], limited: false });
  });
});

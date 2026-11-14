import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitInfo, gitLineStats, gitRepositories } from '../src/git.js';
import { readGitHistory } from '../src/git-history.js';

const makeGit = (cwd: string) => (...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], { cwd, stdio: 'ignore' });

describe('Git Intelligence 2.0 audit matrix', () => {
  it('covers unborn, detached, rename, binary and Unicode paths without mutating fixtures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-git-audit-'));
    const git = makeGit(root);
    git('init', '-q', '-b', 'main');
    expect((await gitInfo(root)).lastCommit).toBeNull();
    writeFileSync(join(root, 'ação.txt'), 'um\n');
    writeFileSync(join(root, 'imagem.bin'), Buffer.from([0, 1, 2]));
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    renameSync(join(root, 'ação.txt'), join(root, 'renomeado.txt'));
    git('add', '-A');
    const info = await gitInfo(root);
    expect(info.changes).toEqual(expect.arrayContaining([{ path: 'renomeado.txt', status: 'renamed' }]));
    expect(await gitLineStats(root)).toEqual(expect.arrayContaining([
      { path: 'ação.txt', added: 0, removed: 1 },
      { path: 'renomeado.txt', added: 1, removed: 0 },
    ]));
    git('checkout', '--detach', '-q', 'HEAD');
    expect((await gitInfo(root)).branch).toBeNull();
    expect((await readGitHistory(root, { known: new Set() })).isRepo).toBe(true);
  });

  it('finds a linked worktree and does not mistake a missing Git folder for a repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-git-worktree-'));
    const repo = join(root, 'repo');
    mkdirSync(repo);
    const git = makeGit(repo);
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repo, 'README.md'), 'x\n');
    git('add', '.'); git('commit', '-q', '-m', 'base');
    const linked = join(root, 'linked');
    git('worktree', 'add', '-q', linked, '-b', 'linked');
    expect(await gitRepositories(linked)).toEqual(['']);
    expect(existsSync(join(linked, '.git'))).toBe(true);
    expect(await gitRepositories(join(root, 'missing'))).toEqual([]);
  });

  it('identifies a real submodule without recursing into it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-git-submodule-'));
    const dependency = join(root, 'dependency');
    mkdirSync(dependency);
    const dependencyGit = makeGit(dependency);
    dependencyGit('init', '-q', '-b', 'main');
    writeFileSync(join(dependency, 'lib.ts'), 'export const value = 1;\n');
    dependencyGit('add', '.'); dependencyGit('commit', '-q', '-m', 'dependency');
    const repo = join(root, 'repo');
    mkdirSync(repo);
    const git = makeGit(repo);
    git('init', '-q', '-b', 'main');
    git('-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', dependency, 'modules/dependency');
    git('commit', '-q', '-m', 'add submodule');
    expect(await gitRepositories(repo)).toEqual(['']);
    expect(await gitRepositories(join(repo, 'modules', 'dependency'))).toEqual(['']);
    expect((await readGitHistory(repo, { known: new Set() })).isRepo).toBe(true);
  });

  it('returns a degraded result when the Git executable is unavailable and recovers afterwards', async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-git-missing-'));
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = mkdtempSync(join(tmpdir(), 'nb-no-git-'));
      await expect(gitInfo(root)).resolves.toEqual({ isRepo: false, branch: null, changes: [], lastCommit: null });
      await expect(gitRepositories(root)).resolves.toEqual([]);
    } finally {
      process.env.PATH = originalPath;
    }
    await expect(gitInfo(root)).resolves.toEqual({ isRepo: false, branch: null, changes: [], lastCommit: null });
  });
});

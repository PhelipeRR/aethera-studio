import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cloneRepository, createProjectFolder, gitApplyPatch, gitBranches, gitCherryPick, gitCommit, gitCreateBranch, gitDeleteBranch, gitOperationState, gitPush, gitRevert, gitStage, gitRenameBranch, gitStashApply, gitStashCreate, gitStashDrop, gitStashes, gitSwitchBranch, gitSyncStatus, gitUnstage, gitWorkingTree, initRepository, validateCloneUrl } from '../src/git-write.js';

let base: string;
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir }).toString().trim();

beforeEach(() => { base = realpathSync(mkdtempSync(join(tmpdir(), 'nb-gitwrite-'))); });

describe('initRepository', () => {
  it('creates a repository in a folder without one', async () => {
    await initRepository(base);
    expect(git(base, 'rev-parse', '--show-toplevel').replaceAll('/', '\\').toLowerCase()).toBe(base.toLowerCase());
  });

  it('never touches a folder that is already a repository', async () => {
    git(base, 'init', '-q');
    await expect(initRepository(base)).rejects.toThrow(/já é um repositório/);
    await expect(initRepository(base, { allowNested: true })).rejects.toThrow(/já é um repositório/);
  });

  it('asks before nesting a repository inside another', async () => {
    git(base, 'init', '-q');
    const inner = join(base, 'dentro');
    mkdirSync(inner);
    await expect(initRepository(inner)).rejects.toThrow(/^confirm_nested:/);
    expect(existsSync(join(inner, '.git'))).toBe(false);
    await initRepository(inner, { allowNested: true });
    expect(existsSync(join(inner, '.git'))).toBe(true);
  });
});

describe('createProjectFolder', () => {
  it('creates the structure, the ignore file of the technology and the repository', async () => {
    const created = await createProjectFolder({ parent: base, name: 'NovoProjeto', technology: 'node' });
    expect(created.path).toBe(join(base, 'NovoProjeto'));
    expect(readFileSync(join(created.path, 'README.md'), 'utf8')).toContain('NovoProjeto');
    expect(readFileSync(join(created.path, '.gitignore'), 'utf8')).toContain('node_modules');
    expect(existsSync(join(created.path, '.git'))).toBe(true);
  });

  it('uses the ignore file of .NET', async () => {
    const created = await createProjectFolder({ parent: base, name: 'Api', technology: 'dotnet' });
    expect(readFileSync(join(created.path, '.gitignore'), 'utf8')).toContain('obj/');
  });

  it('refuses an existing folder and leaves it alone', async () => {
    mkdirSync(join(base, 'existe'));
    writeFileSync(join(base, 'existe', 'a.txt'), 'x');
    await expect(createProjectFolder({ parent: base, name: 'existe', technology: 'other' })).rejects.toThrow(/já existe/);
    expect(existsSync(join(base, 'existe', '.git'))).toBe(false);
  });

  it.each(['..', 'a/b', 'a\\b', 'CON', 'nome:ruim', ' '])('refuses the name %j', async (name) => {
    await expect(createProjectFolder({ parent: base, name, technology: 'other' })).rejects.toThrow(/invalid/);
  });

  it('asks before creating inside a repository', async () => {
    git(base, 'init', '-q');
    await expect(createProjectFolder({ parent: base, name: 'novo', technology: 'other' })).rejects.toThrow(/^confirm_nested:/);
    expect(existsSync(join(base, 'novo'))).toBe(false);
    await createProjectFolder({ parent: base, name: 'novo', technology: 'other', allowNested: true });
    expect(existsSync(join(base, 'novo', '.git'))).toBe(true);
  });
});

describe('cloneRepository', () => {
  it.each([
    'https://github.com/org/repo.git',
    'ssh://git@github.com/org/repo.git',
    'git@github.com:org/repo.git',
  ])('accepts %s', (url) => expect(validateCloneUrl(url)).toBe(true));

  it.each([
    'ext::sh -c touch%20pwned',
    'file:///C:/segredo',
    '--upload-pack=calc',
    'C:\\pasta\\repo',
    'http://github.com/org/repo.git',
    'https://github.com/org/repo.git --depth=1',
  ])('refuses %s', (url) => expect(validateCloneUrl(url)).toBe(false));

  it('clones a repository without running its hooks or template', async () => {
    const source = join(base, 'origem');
    mkdirSync(source);
    git(source, 'init', '-q', '-b', 'main');
    writeFileSync(join(source, 'a.txt'), 'x');
    git(source, 'add', '.');
    git(source, 'commit', '-q', '-m', 'inicial');
    const target = join(base, 'destino');
    await cloneRepository(`file:///${source.replaceAll('\\', '/')}`, target, { allowedSchemes: ['file'] });
    expect(readFileSync(join(target, 'a.txt'), 'utf8')).toBe('x');
  });

  it('refuses a destination that already has content', async () => {
    const target = join(base, 'cheio');
    mkdirSync(target);
    writeFileSync(join(target, 'a.txt'), 'x');
    await expect(cloneRepository('https://github.com/org/repo.git', target)).rejects.toThrow(/vazia/);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(cloneRepository('https://github.com/org/repo.git', join(base, 'novo'), { signal: controller.signal })).rejects.toThrow(/cancel/i);
  });
});

describe('working tree staging', () => {
  it('lists and stages/unstages real files without accepting traversal', async () => {
    git(base, 'init', '-q', '-b', 'main');
    writeFileSync(join(base, 'tracked.txt'), 'one\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    writeFileSync(join(base, 'tracked.txt'), 'two\n'); writeFileSync(join(base, 'new.txt'), 'new\n');
    expect(await gitWorkingTree(base)).toEqual(expect.arrayContaining([
      { path: 'tracked.txt', status: 'unstaged', staged: false, unstaged: true },
      { path: 'new.txt', status: 'untracked', staged: false, unstaged: false },
    ]));
    await gitStage(base, ['tracked.txt']);
    expect(await gitWorkingTree(base)).toEqual(expect.arrayContaining([{ path: 'tracked.txt', status: 'staged', staged: true, unstaged: false }]));
    await gitUnstage(base, ['tracked.txt']);
    await expect(gitStage(base, ['../outside.txt'])).rejects.toThrow(/^invalid:/);
  });
});

describe('AI patch application', () => {
  it('validates and applies a real unified patch without staging or committing', async () => {
    git(base, 'init', '-q', '-b', 'main');
    writeFileSync(join(base, 'app.ts'), 'export const value = 1;\n');
    git(base, 'add', '.');
    git(base, 'commit', '-q', '-m', 'base');
    const head = git(base, 'rev-parse', 'HEAD');
    const patch = 'diff --git a/app.ts b/app.ts\nindex 5f5c8f5..c4d4f4f 100644\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';

    await gitApplyPatch(base, patch);

    expect(readFileSync(join(base, 'app.ts'), 'utf8').replaceAll('\r\n', '\n')).toBe('export const value = 2;\n');
    expect(git(base, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(base, 'diff', '--cached')).toBe('');
  });

  it('applies a provider-style multiline patch through stdin', async () => {
    git(base, 'init', '-q', '-b', 'main');
    writeFileSync(join(base, 'auth.ts'), 'export function isAdmin(role: string): boolean {\n  return true;\n}\n');
    git(base, 'add', '.');
    git(base, 'commit', '-q', '-m', 'base');
    const patch = 'diff --git a/auth.ts b/auth.ts\n--- a/auth.ts\n+++ b/auth.ts\n@@ -1,3 +1,3 @@\n export function isAdmin(role: string): boolean {\n-  return true;\n+  return role === "admin";\n }';
    await gitApplyPatch(base, patch);
    expect(readFileSync(join(base, 'auth.ts'), 'utf8').replaceAll('\r\n', '\n')).toContain('role === "admin"');
  });

  it.each([
    'diff --git a/../outside.txt b/../outside.txt\n--- a/../outside.txt\n+++ b/../outside.txt\n@@ -0,0 +1 @@\n+pwned\n',
    'diff --git a/C:/outside.txt b/C:/outside.txt\n--- a/C:/outside.txt\n+++ b/C:/outside.txt\n@@ -0,0 +1 @@\n+pwned\n',
    'not a unified diff\n',
  ])('rejects unsafe patch input %j before touching the repository', async (patch) => {
    git(base, 'init', '-q', '-b', 'main');
    writeFileSync(join(base, 'app.ts'), 'export const value = 1;\n');
    git(base, 'add', '.');
    git(base, 'commit', '-q', '-m', 'base');
    const before = readFileSync(join(base, 'app.ts'), 'utf8');

    await expect(gitApplyPatch(base, patch)).rejects.toThrow(/^invalid:/);

    expect(readFileSync(join(base, 'app.ts'), 'utf8')).toBe(before);
    expect(git(base, 'status', '--porcelain')).toBe('');
  });

  it('rejects an obsolete patch and preserves an existing local edit', async () => {
    git(base, 'init', '-q', '-b', 'main');
    writeFileSync(join(base, 'app.ts'), 'export const value = 1;\n');
    git(base, 'add', '.');
    git(base, 'commit', '-q', '-m', 'base');
    const patch = 'diff --git a/app.ts b/app.ts\nindex 5f5c8f5..c4d4f4f 100644\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
    writeFileSync(join(base, 'app.ts'), 'export const value = local;\n');

    await expect(gitApplyPatch(base, patch)).rejects.toThrow(/Git recusou|patch|aplic/i);

    expect(readFileSync(join(base, 'app.ts'), 'utf8')).toBe('export const value = local;\n');
  });
});

describe('branch manager', () => {
  it('creates, renames, switches and deletes local branches safely', async () => {
    git(base, 'init', '-q', '-b', 'main'); writeFileSync(join(base, 'a.txt'), 'a\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    await gitCreateBranch(base, 'feature/ui');
    expect((await gitBranches(base)).some((branch) => branch.name === 'feature/ui' && !branch.current)).toBe(true);
    await gitSwitchBranch(base, 'feature/ui');
    await gitRenameBranch(base, 'feature/ui', 'feature/renamed');
    await gitSwitchBranch(base, 'main');
    await expect(gitDeleteBranch(base, 'main')).rejects.toThrow(/atual/);
    await gitDeleteBranch(base, 'feature/renamed');
    await expect(gitCreateBranch(base, 'bad..name')).rejects.toThrow(/^invalid:/);
  });

  it('refuses switching with local changes', async () => {
    git(base, 'init', '-q', '-b', 'main'); writeFileSync(join(base, 'a.txt'), 'a\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    git(base, 'branch', 'other'); writeFileSync(join(base, 'a.txt'), 'changed\n');
    await expect(gitSwitchBranch(base, 'other')).rejects.toThrow(/Working tree sujo/);
  });

  it('protects branches checked out by another real worktree', async () => {
    git(base, 'init', '-q', '-b', 'main'); writeFileSync(join(base, 'a.txt'), 'a\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    git(base, 'branch', 'shared'); const linked = `${base}-linked`; git(base, 'worktree', 'add', '-q', linked, 'shared');
    await expect(gitDeleteBranch(base, 'shared')).rejects.toThrow(/outra worktree/); await expect(gitSwitchBranch(base, 'shared')).rejects.toThrow(/worktree|Working tree/i);
    expect(git(base, 'branch', '--show-current')).toBe('main'); expect(git(linked, 'branch', '--show-current')).toBe('shared');
  });
});

describe('stash and commit manager', () => {
  it('does not execute repository hooks under the SAFE_WRITE policy', async () => {
    git(base, 'init', '-q', '-b', 'main'); writeFileSync(join(base, 'a.txt'), 'base\n'); await gitStage(base, ['a.txt']); await gitCommit(base, 'base');
    const marker = join(base, 'hook-sentinel'); writeFileSync(join(base, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\nprintf executed > "${marker.replaceAll('\\', '/')}"\nexit 1\n`);
    writeFileSync(join(base, 'a.txt'), 'safe write\n'); await gitStage(base, ['a.txt']); await gitCommit(base, 'safe commit');
    expect(existsSync(marker)).toBe(false); expect(git(base, 'log', '-1', '--format=%s')).toBe('safe commit');
  });

  it('creates, lists, applies, drops a stash and commits staged content', async () => {
    git(base, 'init', '-q', '-b', 'main'); writeFileSync(join(base, 'a.txt'), 'a\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    writeFileSync(join(base, 'a.txt'), 'changed\n'); await gitStashCreate(base, 'save work');
    const stashes = await gitStashes(base); const stash = stashes[0]; expect(stash?.ref).toBe('stash@{0}'); if (!stash) throw new Error('fixture did not create a stash');
    await gitStashApply(base, stash.ref); expect(readFileSync(join(base, 'a.txt'), 'utf8')).toContain('changed');
    await gitStashDrop(base, stash.ref);
    await gitStage(base, ['a.txt']); await gitCommit(base, 'commit change');
    expect(git(base, 'log', '-1', '--format=%s')).toBe('commit change');
  });

  it('includes untracked files only when requested and validates stash refs', async () => {
    git(base, 'init', '-q', '-b', 'main'); writeFileSync(join(base, 'a.txt'), 'a\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    writeFileSync(join(base, 'new.txt'), 'new\n'); await gitStashCreate(base, 'with new', true); expect(git(base, 'status', '--porcelain')).toBe('');
    await expect(gitStashApply(base, 'stash@{999}')).rejects.toThrow(/Stash não encontrado/);
  });
});

describe('remote synchronization', () => {
  it('reports pending local commits and pushes them explicitly to the tracked remote', async () => {
    const remote = join(base, 'remote.git');
    mkdirSync(remote);
    git(remote, 'init', '--bare', '-q');
    git(base, 'init', '-q', '-b', 'main');
    writeFileSync(join(base, 'a.txt'), 'base\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    git(base, 'remote', 'add', 'origin', remote);
    git(base, 'push', '-q', '-u', 'origin', 'main');
    writeFileSync(join(base, 'a.txt'), 'local\n'); await gitStage(base, ['a.txt']); await gitCommit(base, 'local change');

    await expect(gitSyncStatus(base)).resolves.toMatchObject({ branch: 'main', upstream: 'origin/main', remote: 'origin', ahead: 1, behind: 0, remotes: ['origin'], pending: [expect.objectContaining({ subject: 'local change' })] });
    await gitPush(base);
    await expect(gitSyncStatus(base)).resolves.toMatchObject({ ahead: 0, behind: 0, pending: [] });
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(git(base, 'rev-parse', 'HEAD'));
  });
});

describe('revert and cherry-pick recovery', () => {
  it('reverts and cherry-picks real commits, refusing dirty trees', async () => {
    git(base, 'init', '-q', '-b', 'main'); writeFileSync(join(base, 'a.txt'), 'a\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    writeFileSync(join(base, 'a.txt'), 'b\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'change'); const commit = git(base, 'rev-parse', 'HEAD');
    await gitRevert(base, commit); expect(readFileSync(join(base, 'a.txt'), 'utf8').replaceAll('\r\n', '\n')).toBe('a\n');
    git(base, 'switch', '-c', 'cherry', `${commit}^`); await gitCherryPick(base, commit); expect(git(base, 'log', '-1', '--format=%s')).toBe('change');
    writeFileSync(join(base, 'a.txt'), 'local\n'); await expect(gitRevert(base, commit)).rejects.toThrow(/working tree/i);
  });

  it('reports a conflict and only resolves it through an explicit action', async () => {
    git(base, 'init', '-q', '-b', 'main'); writeFileSync(join(base, 'a.txt'), 'base\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'base');
    git(base, 'switch', '-c', 'feature'); writeFileSync(join(base, 'a.txt'), 'feature\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'feature'); const feature = git(base, 'rev-parse', 'HEAD');
    git(base, 'switch', 'main'); writeFileSync(join(base, 'a.txt'), 'main\n'); git(base, 'add', '.'); git(base, 'commit', '-q', '-m', 'main');
    await expect(gitCherryPick(base, feature)).rejects.toThrow(); const state = await gitOperationState(base); expect(state.operation).toBe('cherry-pick'); expect(state.conflicts).toContain('a.txt');
    await import('../src/git-write.js').then(({ gitResolveOperation }) => gitResolveOperation(base, 'cherry-pick', 'abort')); expect((await gitOperationState(base)).operation).toBeNull();
  });
});

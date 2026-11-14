import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { gitChangedPaths, gitCompareRefs, gitDiffFiles, gitRepositories, gitDiffRange, readGitRefs } from '../src/git.js';

function repository(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
}

describe('a folder that groups repositories', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nb-repos-'));
    repository(join(root, 'backoffice'));
    repository(join(root, 'root'));
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'nota.md'), 'solta\n');
  });

  it('finds the repositories one level down, and a real repository as itself', async () => {
    expect((await gitRepositories(root)).sort()).toEqual(['backoffice', 'root']);
    expect(await gitRepositories(join(root, 'root'))).toEqual(['']);
    expect(await gitRepositories(join(root, 'docs'))).toEqual([]);
  });

  it('reports changes of every repository relative to the project', async () => {
    writeFileSync(join(root, 'backoffice', 'app.ts'), 'export const a = 2;\n');
    writeFileSync(join(root, 'root', 'novo.ts'), 'export const b = 1;\n');
    expect((await gitChangedPaths(root)).sort()).toEqual(['backoffice/app.ts', 'root/novo.ts']);
  });

  it('reads the diff of each file where it lives, with paths relative to the project', async () => {
    writeFileSync(join(root, 'backoffice', 'app.ts'), 'export const a = 2;\n');
    writeFileSync(join(root, 'root', 'novo.ts'), 'export const b = 1;\n');
    const diff = await gitDiffFiles(root, ['backoffice/app.ts', 'root/novo.ts']);
    expect(diff.text).toContain('diff --git a/backoffice/app.ts b/backoffice/app.ts');
    expect(diff.text).toContain('+export const a = 2;');
    expect(diff.text).toContain('diff --git a/root/novo.ts b/root/novo.ts');
    expect(diff.unreviewed).toEqual([]);
  });

  it('lists what it could not read instead of passing it as clean', async () => {
    const diff = await gitDiffFiles(root, ['backoffice/app.ts', 'docs/nota.md', '../fora.ts']);
    expect(diff.text).toBe('');
    expect(diff.unreviewed).toEqual(['backoffice/app.ts', 'docs/nota.md', '../fora.ts']);
  });

  it('reads refs and a safe diff range without accepting option-like refs', async () => {
    const repo = join(root, 'root');
    writeFileSync(join(repo, 'app.ts'), 'export const a = 2;\n');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo });
    git('add', '.'); git('commit', '-q', '-m', 'segunda');
    await expect(readGitRefs(repo)).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ ref: 'refs/heads/main' })]));
    await expect(gitDiffRange(repo, 'HEAD~1', 'HEAD')).resolves.toContain('+export const a = 2;');
    await expect(gitDiffRange(repo, '--output=/tmp/x', 'HEAD')).rejects.toThrow(/ref/);
  });

  it('compares refs directly and from their real merge-base', async () => {
    const repo = join(root, 'root');
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repo });
    writeFileSync(join(repo, 'app.ts'), 'export const a = 2;\n');
    git('add', '.'); git('commit', '-q', '-m', 'segunda');
    git('checkout', '-q', '-b', 'feature');
    writeFileSync(join(repo, 'feature.ts'), 'export const feature = true;\n');
    git('add', '.'); git('commit', '-q', '-m', 'feature');
    const direct = await gitCompareRefs(repo, 'main', 'feature');
    expect(direct.mode).toBe('direct');
    expect(direct.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'feature.ts', status: 'added' })]));
    const common = await gitCompareRefs(repo, 'main', 'feature', 'merge-base');
    expect(common.mergeBase).toMatch(/^[0-9a-f]{40}$/);
    expect(common.files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'feature.ts', status: 'added' })]));
    await expect(gitCompareRefs(repo, 'missing', 'feature')).rejects.toThrow(/ref Git/);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { gitStagedDiff } from '../src/git.js';

let root: string;
const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.dev', ...args], { cwd: root, stdio: 'ignore' });

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'nb-smart-commit-diff-')));
  mkdirSync(root, { recursive: true });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(root, 'app.ts'), 'export const answer = 41;\n');
  git('add', 'app.ts');
  git('commit', '-q', '-m', 'initial');
});

describe('gitStagedDiff', () => {
  it('returns the staged diff only, excluding unstaged and untracked content', async () => {
    writeFileSync(join(root, 'app.ts'), 'export const answer = 42;\n');
    git('add', 'app.ts');
    writeFileSync(join(root, 'app.ts'), 'export const answer = 43;\n');
    writeFileSync(join(root, 'notes.txt'), 'not staged\n');

    const result = await gitStagedDiff(root);

    expect(result.truncated).toBe(false);
    expect(result.text).toContain('-export const answer = 41;');
    expect(result.text).toContain('+export const answer = 42;');
    expect(result.text).not.toContain('+export const answer = 43;');
    expect(result.text).not.toContain('notes.txt');
  });
});

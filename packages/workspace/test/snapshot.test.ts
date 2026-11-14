import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedSince, restoreSnapshot, takeSnapshot } from '../src/snapshot.js';

function repo() {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-snap-')), 'loja');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'original a\n');
  writeFileSync(join(root, 'src', 'b.ts'), 'original b\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  return root;
}
const read = (root: string, file: string) => readFileSync(join(root, file), 'utf8');

describe('working-tree snapshot', () => {
  it('restores exactly the files the fix touched: user edits come back, new files go, clean files return to HEAD', async () => {
    const root = repo();
    // The user's own unsaved work before the fix.
    writeFileSync(join(root, 'src', 'a.ts'), 'edição do usuário\n');
    writeFileSync(join(root, 'rascunho.md'), 'rascunho do usuário\n');
    const snapshot = await takeSnapshot(root);
    // The fix changes things.
    writeFileSync(join(root, 'src', 'a.ts'), 'fix em a\n');
    writeFileSync(join(root, 'src', 'b.ts'), 'fix em b\n');
    writeFileSync(join(root, 'src', 'novo.ts'), 'arquivo novo\n');
    writeFileSync(join(root, 'rascunho.md'), 'fix no rascunho\n');
    const restored = await restoreSnapshot(root, snapshot, ['src/a.ts', 'src/b.ts', 'src/novo.ts', 'rascunho.md']);
    expect(restored.sort()).toEqual(['rascunho.md', 'src/a.ts', 'src/b.ts', 'src/novo.ts']);
    expect(read(root, 'src/a.ts')).toBe('edição do usuário\n');
    expect(read(root, 'src/b.ts')).toBe('original b\n');
    expect(read(root, 'rascunho.md')).toBe('rascunho do usuário\n');
    expect(existsSync(join(root, 'src', 'novo.ts'))).toBe(false);
  });

  it('touches nothing it was not asked to, and nothing outside the project', async () => {
    const root = repo();
    const snapshot = await takeSnapshot(root);
    writeFileSync(join(root, 'src', 'b.ts'), 'mudança fora da correção\n');
    const outside = join(mkdtempSync(join(tmpdir(), 'nb-snap-out-')), 'x.txt');
    writeFileSync(outside, 'fora\n');
    expect(await restoreSnapshot(root, snapshot, ['../x.txt', outside])).toEqual([]);
    expect(read(root, 'src/b.ts')).toBe('mudança fora da correção\n');
    expect(readFileSync(outside, 'utf8')).toBe('fora\n');
  });

  it('refuses to snapshot a folder that is not a Git repository', async () => {
    await expect(takeSnapshot(mkdtempSync(join(tmpdir(), 'nb-snap-norepo-')))).rejects.toThrow(/Git/);
  });
});

describe('changedSince', () => {
  it('lists every file whose content moved since the snapshot, including ones the user had already edited', async () => {
    const root = repo();
    writeFileSync(join(root, 'src', 'a.ts'), 'edição do usuário\n');
    writeFileSync(join(root, 'notas.md'), 'rascunho\n');
    const snapshot = await takeSnapshot(root);
    writeFileSync(join(root, 'src', 'a.ts'), 'fix em a\n');
    writeFileSync(join(root, 'src', 'novo.ts'), 'novo\n');
    expect((await changedSince(root, snapshot)).sort()).toEqual(['src/a.ts', 'src/novo.ts']);
  });
});

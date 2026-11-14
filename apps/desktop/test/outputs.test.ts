import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canOpenOutput } from '@neuralbridge/shared';
import { resolveOutputPath } from '../src/main/outputs.js';

function project(): string {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-out-')), 'meu projeto');
  mkdirSync(join(root, 'docs'), { recursive: true });
  writeFileSync(join(root, 'docs', 'notes.md'), '# x');
  writeFileSync(join(root, 'run.cmd'), 'echo x');
  return root;
}

describe('resolveOutputPath', () => {
  it('resolves a file of the run, relative or absolute, inside the project', () => {
    const root = project();
    expect(resolveOutputPath(root, 'docs/notes.md', 'open')).toBe(join(root, 'docs', 'notes.md'));
    expect(resolveOutputPath(root, join(root, 'docs', 'notes.md'), 'reveal')).toBe(join(root, 'docs', 'notes.md'));
  });

  it('refuses paths outside the project and files that no longer exist', () => {
    const root = project();
    expect(() => resolveOutputPath(root, '../fora.txt', 'reveal')).toThrow(/forbidden/);
    expect(() => resolveOutputPath(root, 'C:\\Windows\\win.ini', 'reveal')).toThrow(/forbidden/);
    expect(() => resolveOutputPath(root, 'docs/sumiu.md', 'reveal')).toThrow(/not_found/);
  });

  it('only shows in the folder what Windows would run when opened', () => {
    const root = project();
    expect(() => resolveOutputPath(root, 'run.cmd', 'open')).toThrow(/forbidden/);
    expect(resolveOutputPath(root, 'run.cmd', 'reveal')).toBe(join(root, 'run.cmd'));
  });
});

describe('canOpenOutput', () => {
  it('blocks executable and script types, case-insensitively', () => {
    expect(['a.md', 'b.png', 'c.ts', 'd.pdf'].map(canOpenOutput)).toEqual([true, true, true, true]);
    expect(['a.exe', 'b.BAT', 'c.js', 'd.ps1', 'e.lnk', 'f.vbs', 'g.msi', 'h.hta', 'i.url', 'noext'].map(canOpenOutput)).toEqual(Array(10).fill(false));
  });
});

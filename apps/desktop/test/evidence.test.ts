import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEvidence } from '../src/main/evidence.js';

function project() {
  const root = join(mkdtempSync(join(tmpdir(), 'nb-evidence-')), 'loja');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 20;');
  writeFileSync(join(root, 'src', 'cache.ts'), 'export const ttl = 60;');
  // Both written well before the memory below was last updated.
  const old = new Date('2026-10-01T10:00:00Z');
  utimesSync(join(root, 'src', 'pool.ts'), old, old);
  utimesSync(join(root, 'src', 'cache.ts'), old, old);
  return root;
}

const since = '2026-10-20T10:00:00.000Z';
const file = (ref: string) => ({ kind: 'file' as const, ref, createdAt: since });

describe('checkEvidence', () => {
  it('finds files that are still there and unchanged since the memory was last updated', () => {
    const root = project();
    expect(checkEvidence([file('src/pool.ts'), file(`${join(root, 'src', 'cache.ts')}:12`)], root, since)).toEqual([
      { kind: 'file', ref: 'src/pool.ts', status: 'ok' },
      { kind: 'file', ref: `${join(root, 'src', 'cache.ts')}:12`, status: 'ok' },
    ]);
  });

  it('reports a file that disappeared or changed after the memory', () => {
    const root = project();
    writeFileSync(join(root, 'src', 'cache.ts'), 'export const ttl = 120;');
    expect(checkEvidence([file('src/apagado.ts'), file('src/cache.ts:3-9')], root, since).map((item) => item.status)).toEqual(['missing', 'changed']);
  });

  it('never looks outside the project, and leaves tasks, conversations and links unchecked', () => {
    const root = project();
    const outside = join(mkdtempSync(join(tmpdir(), 'nb-evidence-out-')), 'segredo.txt');
    writeFileSync(outside, 'x');
    const evidence = [file('../fora.txt'), file(outside), { kind: 'task' as const, ref: 'task:t1', createdAt: since }, { kind: 'url' as const, ref: 'https://x.dev', createdAt: since }];
    expect(checkEvidence(evidence, root, since).map((item) => item.status)).toEqual(['unchecked', 'unchecked', 'unchecked', 'unchecked']);
    // A global memory has no project folder to check files against.
    expect(checkEvidence([file('src/pool.ts')], null, since)).toEqual([{ kind: 'file', ref: 'src/pool.ts', status: 'unchecked' }]);
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAntigravityCli, findAntigravityCli } from '../src/main/antigravity-cli.js';

describe('Antigravity CLI detection (agy)', () => {
  it('resolves NB_ANTIGRAVITY_CLI override when executable exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-agy-'));
    const fakeCli = join(dir, process.platform === 'win32' ? 'agy.exe' : 'agy');
    writeFileSync(fakeCli, 'stub');

    expect(findAntigravityCli({ NB_ANTIGRAVITY_CLI: fakeCli, PATH: '' })).toBe(fakeCli);
  });

  it('reports unavailable cleanly when CLI is missing in isolated env', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'aethera-agy-empty-'));
    const status = await detectAntigravityCli({
      refresh: true,
      env: { PATH: empty, Path: empty, LOCALAPPDATA: empty },
    });

    expect(status.id).toBe('antigravity');
    if (process.platform === 'win32') {
      expect(status.installed).toBe(false);
      expect(status.problems.length).toBeGreaterThan(0);
    }
  });
});

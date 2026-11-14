import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkWorkspacePreflight } from '../src/workspace-preflight.js';

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('workspace preflight', () => {
  it('confirms a writable workspace without leaving a probe file', () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-preflight-'));
    temporary.push(root);
    expect(checkWorkspacePreflight(root)).toMatchObject({ ok: true, writable: true, cwd: root });
  });
  it('reports a missing workspace without creating it', () => {
    const root = join(tmpdir(), `nb-missing-${Date.now()}`);
    expect(checkWorkspacePreflight(root)).toMatchObject({ ok: false, writable: false });
  });
});

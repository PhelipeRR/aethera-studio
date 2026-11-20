import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AetheraEvolutionCore } from '../../../packages/cinema/src/index.js';
import { StagedCinemaPipeline, type StagedPipelineDeps } from '../src/main/cinema-pipeline.js';

/**
 * Regression: the science E2E harness (untyped .mjs) omitted the required `onPackageReady` callback. The pipeline
 * accepted the deps, spent ~465 s acquiring/downloading media and only crashed at 74% (montagem) with
 * "this.deps.onPackageReady is not a function". Required host callbacks must be rejected at construction, before
 * any expensive work, with an error that names the missing dependency.
 */
const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function baseDeps(root: string): StagedPipelineDeps {
  return {
    jobsDir: join(root, 'jobs'),
    mediaDir: join(root, 'media'),
    outputDir: join(root, 'renders'),
    evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
    onPackageReady: () => {},
    onRenderReady: () => {},
  };
}

describe('StagedCinemaPipeline — required host callbacks contract', () => {
  it('rejects deps without onPackageReady at construction, before any job or workspace is created', () => {
    const root = makeTempDir('aethera-deps-pkg-');
    const deps = baseDeps(root) as Partial<StagedPipelineDeps>;
    delete deps.onPackageReady;

    expect(() => new StagedCinemaPipeline(deps as StagedPipelineDeps)).toThrow(/onPackageReady/);
    // Fail-fast: nothing was started, so no job file exists to be left half-produced.
    expect(existsSync(join(root, 'jobs')) ? readdirSync(join(root, 'jobs')) : []).toEqual([]);
  });

  it('rejects deps without onRenderReady at construction', () => {
    const root = makeTempDir('aethera-deps-render-');
    const deps = baseDeps(root) as Partial<StagedPipelineDeps>;
    delete deps.onRenderReady;

    expect(() => new StagedCinemaPipeline(deps as StagedPipelineDeps)).toThrow(/onRenderReady/);
  });

  it('rejects a required callback that is present but not a function', () => {
    const root = makeTempDir('aethera-deps-type-');
    const deps = { ...baseDeps(root), onPackageReady: 'persist' } as unknown as StagedPipelineDeps;

    expect(() => new StagedCinemaPipeline(deps)).toThrow(/onPackageReady/);
  });

  it('accepts deps that provide every required callback', () => {
    const root = makeTempDir('aethera-deps-ok-');
    expect(() => new StagedCinemaPipeline(baseDeps(root))).not.toThrow();
  });
});

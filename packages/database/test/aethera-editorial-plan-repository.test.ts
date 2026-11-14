import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nextEditorialPlan, type EditorialPlan } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AetheraEditorialPlanRepository, openDatabase, videoProjects, VelixProductionRepository, type DatabaseHandle } from '../src/index.js';

const MIGRATIONS = resolve(import.meta.dirname, '../migrations');
const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../shared/test/fixtures/smart-director/farol.json'), 'utf8')) as { plan: EditorialPlan };
let handle: DatabaseHandle;
let runId: string;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-editorial-')), 'db.sqlite'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: join(tmpdir(), 'aethera-vp') }).run();
  runId = new VelixProductionRepository(handle).createRun({ projectId: 'vp', brief: { schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } }, productionType: 'explainer', topic: 'Faróis', targetDurationSeconds: 60, language: 'pt-BR', audience: 'curiosos', tone: 'calmo', narrativeStyle: 'documentário', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 0 }, estimatedCostUsd: 0, agent: 'claude' }).id;
});
afterEach(() => handle.close());

const output = (plan: EditorialPlan) => ({ reading: plan.reading, concept: plan.concept, segments: plan.segments });

describe('AetheraEditorialPlanRepository', () => {
  it('stores versions once, keeps identical decisions on the same version and never rewrites a stored one', () => {
    const repository = new AetheraEditorialPlanRepository(handle.db);
    const first = nextEditorialPlan([], { productionId: runId, scriptKey: fixture.plan.basedOn.scriptKey, director: fixture.plan.director, output: output(fixture.plan) });
    repository.save(runId, first);
    expect(repository.save(runId, first)).toEqual(first);
    const same = nextEditorialPlan(repository.history(runId), { productionId: runId, scriptKey: first.basedOn.scriptKey, director: first.director, output: output(fixture.plan) });
    expect(same.version).toBe(1);
    const changed = output(fixture.plan);
    changed.segments = changed.segments.map((segment, index) => index === 0 ? { ...segment, intensity: segment.intensity === 1 ? 0.5 : 1 } : segment);
    const second = nextEditorialPlan(repository.history(runId), { productionId: runId, scriptKey: first.basedOn.scriptKey, director: first.director, output: changed });
    expect(second.version).toBe(2);
    repository.save(runId, second);
    expect(() => repository.save(runId, { ...second, version: 1 })).toThrow(/não é reescrita/u);
    expect(repository.latest(runId)?.version).toBe(2);
    expect(repository.latest(runId, 'outro-roteiro')).toBeNull();
  });

  it('approves only by a named person and only the version that was shown', () => {
    const repository = new AetheraEditorialPlanRepository(handle.db);
    const plan = repository.save(runId, nextEditorialPlan([], { productionId: runId, scriptKey: fixture.plan.basedOn.scriptKey, director: fixture.plan.director, output: output(fixture.plan) }));
    expect(() => repository.save(runId, { ...plan, version: 9, status: 'approved' })).toThrow(/rascunho/u);
    expect(() => repository.approve({ runId, version: 1, hash: plan.hash, approvedBy: ' ' })).toThrow(/quem aprova/u);
    expect(() => repository.approve({ runId, version: 1, hash: 'outro', approvedBy: 'Editor' })).toThrow(/mudou/u);
    expect(repository.approve({ runId, version: 1, hash: plan.hash, approvedBy: 'Editor' }).status).toBe('approved');
    expect(repository.approval(runId, 1)?.approvedBy).toBe('Editor');
    expect(repository.latest(runId)?.status).toBe('approved');
  });
});

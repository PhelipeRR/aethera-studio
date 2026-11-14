import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { openDatabase, VelixDiscoveryRepository, videoProjects } from '../src/index.js';

const migrationsFolder = join(import.meta.dirname, '../migrations');
const handles: Array<ReturnType<typeof openDatabase>> = [];
afterEach(() => { while (handles.length) handles.pop()?.close(); });

describe('VelixDiscoveryRepository', () => {
  it('keeps agent sources out of editorial flows until approved, and every bypass fails', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-velix-')), 'db.sqlite'), { migrationsFolder });
    handles.push(handle);
    for (const id of ['p1', 'p2']) handle.db.insert(videoProjects).values({ id, name: id, rootPath: `C:\\${id}` }).run();
    const repository = new VelixDiscoveryRepository(handle.db);
    const source = (url: string) => repository.saveReference({ projectId: 'p1', url, kind: 'texto', title: url, publisher: 'x', retrievedAt: '2026-11-01T00:00:00.000Z', reviewStatus: 'pending', agent: 'codex', executionId: 'exec-1' });
    const kept = source('https://a.example/kept');
    const dropped = source('https://a.example/dropped');
    expect(repository.listProject('p1').references).toEqual([]);
    expect(repository.pendingReferences('p1').map((row) => row.url)).toHaveLength(2);
    expect(() => repository.decideReference('p2', kept.id, 'approved')).toThrow(/not_found/);
    repository.decideReference('p1', kept.id, 'approved');
    repository.decideReference('p1', dropped.id, 'rejected');
    expect(repository.listProject('p1').references.map((row) => row.url)).toEqual(['https://a.example/kept']);
    expect(() => repository.decideReference('p1', dropped.id, 'approved')).toThrow(/not_found/);
    expect(() => repository.decideReference('p1', kept.id, 'rejected')).toThrow(/not_found/);
    expect(repository.pendingReferences('p1')).toEqual([]);
    expect(repository.referenceUrls('p1').has('https://a.example/dropped')).toBe(true);
    expect(repository.listProject('p2').references).toEqual([]);
  });

  it('persists searches, references, rights and clips and reloads them by project', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-velix-')), 'db.sqlite'), { migrationsFolder });
    handles.push(handle);
    handle.db.insert(videoProjects).values({ id: 'p1', name: 'Video', rootPath: 'C:/Video' }).run();
    const repository = new VelixDiscoveryRepository(handle.db);
    const search = repository.createSearch({ projectId: 'p1', niche: 'games', query: 'gameplay', provider: 'youtube', status: 'completed' });
    repository.updateSearch(search.id, 'completed');
    const reference = repository.saveReference({ projectId: 'p1', searchId: search.id, url: 'https://example.com/video', kind: 'video', title: 'Gameplay', publisher: 'Autor', retrievedAt: '2026-10-31T00:00:00.000Z' });
    repository.saveRights({ projectId: 'p1', referenceId: reference.id, owner: 'Autor', sourceUrl: reference.url, license: 'own', evidence: 'receipt', verifiedAt: '2026-10-31T00:00:00.000Z', credit: null, restrictions: [], status: 'verified_allowed' });
    repository.saveClip({ projectId: 'p1', referenceId: reference.id, start: 0, end: 2.5, confidence: 0.8, criteria: ['scene-cut'], accepted: false });
    const asset = repository.saveAsset({ projectId: 'p1', path: 'gameplay.mp4', bytes: 10, sha256: 'hash', rightsStatus: 'verified_allowed' });
    repository.saveAnalysis({ projectId: 'p1', assetId: asset.id, metadata: { duration: 2.5, width: 320, height: 180 }, sceneCuts: [0, 2.5], silences: [] });
    expect(repository.listProject('p1')).toMatchObject({ searches: [{ id: search.id }], references: [{ id: reference.id }], rights: [{ status: 'verified_allowed' }], clips: [{ end: 2.5 }], assets: [{ id: asset.id }], analyses: [{ assetId: asset.id }] });
  });
  it('persists immutable editorial versions and approvals per project', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-velix-editorial-')), 'db.sqlite'), { migrationsFolder }); handles.push(handle); handle.db.insert(videoProjects).values([{ id: 'p1', name: 'One', rootPath: 'one' }, { id: 'p2', name: 'Two', rootPath: 'two' }]).run();
    const repository = new VelixDiscoveryRepository(handle.db); const idea = repository.createIdea({ projectId: 'p1', mode: 'commentary', topic: 'Tema', style: 'analítico', status: 'draft' });
    const brief = repository.saveEditorialVersion({ projectId: 'p1', ideaId: idea.id, kind: 'brief', content: 'brief v1' }); repository.decideEditorial({ projectId: 'p1', versionId: brief.id, decision: 'approved', note: 'ok' });
    const script = repository.saveEditorialVersion({ projectId: 'p1', ideaId: idea.id, sourceVersionId: brief.id, kind: 'script', content: 'script v1', agent: 'claude', model: 'provider-default', executionId: 'run-1', generatedAt: '2026-10-31T00:00:00.000Z' });
    repository.decideEditorial({ projectId: 'p1', versionId: script.id, decision: 'approved', note: 'aprovado' });
    expect(repository.getApprovedScript('p1', script.id)).toMatchObject({ id: script.id, approved: true, sourceVersionId: brief.id, agent: 'claude', model: 'provider-default', executionId: 'run-1' });
    expect(repository.listEditorial('p1')).toMatchObject({ ideas: [{ id: idea.id, status: 'draft' }], versions: [{ id: brief.id, version: 1, approved: true }, { id: script.id, version: 1, approved: true }] });
    expect(repository.listEditorial('p2')).toEqual({ ideas: [], versions: [], decisions: [] });
    expect(() => repository.updateEditorialVersion(brief.id, 'changed')).toThrow(/imutável/i);
  });
});

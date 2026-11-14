import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, VelixCollageRepository, videoProjects } from '../src/index.js';

const open = (path = join(mkdtempSync(join(tmpdir(), 'nb-collage-')), 'db.sqlite')) => { const handle = openDatabase(path, { migrationsFolder: join(import.meta.dirname, '../migrations') }); if (handle.db.select().from(videoProjects).all().length === 0) handle.db.insert(videoProjects).values({ id: 'p1', name: 'Canal', rootPath: 'C:/canal' }).run(); return handle; };

describe('VelixCollageRepository', () => {
  it('persists approval state and generated paths across a reopen', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'nb-collage-')), 'db.sqlite');
    const first = open(path);
    const repository = new VelixCollageRepository(first.db);
    const job = repository.create({ projectId: 'p1', prompt: 'Uma ponte de papel', aspectRatio: '16:9', durationSeconds: 5, status: 'draft', estimatedCostUsd: 0.1, metaphor: null, stillPath: null, clipPath: null, rightsReferenceId: null, error: null });
    repository.update(job.id, { status: 'completed', clipPath: 'renders/collage.mp4', rightsReferenceId: 'rights-1' });
    expect(repository.get(job.id)).toMatchObject({ status: 'completed', clipPath: 'renders/collage.mp4', rightsReferenceId: 'rights-1' });
    first.close();
    const second = open(path);
    expect(new VelixCollageRepository(second.db).listProject('p1')).toHaveLength(1);
    second.close();
  });
});

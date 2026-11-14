import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase, videoProjects, VelixChannelRepository } from '../src/index.js';

describe('VelixChannelRepository', () => {
  it('round-trips identity and publication data by project without persisting credentials', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-channel-')), 'db.sqlite'), { migrationsFolder: join(import.meta.dirname, '../migrations') });
    handle.db.insert(videoProjects).values({ id: 'p1', name: 'Canal', rootPath: 'C:/canal' }).run();
    const repository = new VelixChannelRepository(handle.db);
    repository.saveIdentity('p1', { schemaVersion: 1, source: 'created', direction: 'editorial', mode: 'dark', tokens: { bg: '#000000' }, fonts: { title: 'inter', accent: 'inter' }, symbol: { style: 'ponto', initials: 'NB' }, tagline: 'Local', palette: ['#000000'], pieces: [], approvedAt: null });
    repository.savePublication('p1', { schemaVersion: 1, id: 'd1', videoAssetId: 'v1', title: 'Vídeo', description: '', tags: [], thumbnailPath: null, privacy: 'private', publishAt: null, categoryId: '22', madeForKids: false, scores: { title: 0, description: 0, tags: 0 }, status: 'draft', youtubeVideoId: null });
    expect(repository.loadIdentity('p1')?.direction).toBe('editorial');
    expect(repository.listPublications('p1')).toHaveLength(1);
    expect(JSON.stringify(repository.loadIdentity('p1'))).not.toMatch(/accessToken|refreshToken|clientSecret/);
    handle.close();
  });
});

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { musicTrackToRealAudioAsset, resolveRealAudioAssets } from '../src/audio/real-audio-assets.js';

const provenance = {
  license: 'CC0',
  origin: 'local-test-library',
  useConditions: 'reusable in audiovisual productions',
};

function audioFile(dir: string, name: string): string {
  const path = join(dir, name);
  writeFileSync(path, Buffer.alloc(2_048, 7));
  return path;
}

describe('music source selection', () => {
  it('falls back from unavailable generated music to an authorized library track', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-music-selection-'));
    const libraryPath = audioFile(dir, 'library.wav');
    const result = await resolveRealAudioAssets({
      music: { path: join(dir, 'missing-generated.wav'), ...provenance, sourceKind: 'generated', providerId: 'ace-step-local' },
      musicLibrary: [{ path: libraryPath, ...provenance, sourceKind: 'library' }],
    });

    expect(result.sources.music).toBe('asset');
    expect(result.music?.path).toBe(libraryPath);
    expect(result.musicSelection).toMatchObject({ source: 'library', attempted: ['generated', 'library'] });
  });

  it('keeps music missing when the authorized library is empty', async () => {
    const result = await resolveRealAudioAssets({ musicLibrary: [] });

    expect(result.sources.music).toBe('missing');
    expect(result.musicSelection).toMatchObject({ source: 'none', attempted: [] });
    expect(result.diagnostics.some((item) => item.includes('music_unavailable'))).toBe(true);
  });

  it('rejects a library candidate without provenance instead of treating it as music', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-music-selection-'));
    const unprovenancedPath = audioFile(dir, 'unknown.wav');
    const result = await resolveRealAudioAssets({
      musicLibrary: [{ path: unprovenancedPath, license: 'unknown', origin: '', useConditions: '', sourceKind: 'library' }],
    });

    expect(result.sources.music).toBe('missing');
    expect(result.musicSelection?.source).toBe('none');
    expect(result.diagnostics.some((item) => item.includes('provenance_missing'))).toBe(true);
  });

  it('adapts an existing authorized library track into the renderer asset contract', () => {
    const track = {
      id: 'library:cyberpunk-bed',
      relativePath: 'audio/cyberpunk-bed.wav',
      sha256: 'a'.repeat(64),
      durationMs: 60_000,
      bpm: 110,
      mood: ['cyberpunk'],
      license: { name: 'CC0', source: 'https://example.com/license', evidence: 'library/cyberpunk-bed.json', scope: 'uso audiovisual não comercial e comercial', expiresAt: null },
      importedAt: '2026-11-17T00:00:00.000Z',
    };

    expect(musicTrackToRealAudioAsset(track, 'C:/project')).toMatchObject({
      path: resolve('C:/project', 'audio/cyberpunk-bed.wav'),
      sourceKind: 'library',
      origin: 'https://example.com/license',
      useConditions: expect.stringContaining('uso audiovisual'),
    });
  });
});

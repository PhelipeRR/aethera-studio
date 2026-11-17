import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRealAudioAssets } from '../src/audio/real-audio-assets.js';

describe('real audio assets', () => {
  it('resolves existing local music, ambience and timed SFX with stable fingerprints', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-audio-assets-'));
    const music = join(dir, 'music.wav');
    const ambience = join(dir, 'ambience.wav');
    const sfx = join(dir, 'whoosh.wav');
    for (const file of [music, ambience, sfx]) writeFileSync(file, Buffer.alloc(2_048, 7));

    const result = await resolveRealAudioAssets({
      music: { path: music, license: 'local_test', origin: 'local_test_library', useConditions: 'test reuse' },
      ambience: { path: ambience, license: 'local_test', origin: 'local_test_library', useConditions: 'test reuse' },
      sfx: [{ id: 'whoosh', path: sfx, license: 'local_test', origin: 'local_test_library', useConditions: 'test reuse', atMs: 1_200, gainDb: -10 }],
    }, { requireRealAudio: true });

    expect(result.valid).toBe(true);
    expect(result.missingRoles).toEqual([]);
    expect(result.music?.fingerprint).toMatch(/^[a-f0-9]{16}$/u);
    expect(result.sfx[0]?.atMs).toBe(1_200);
    expect(result.sources).toEqual({ music: 'asset', ambience: 'asset', sfx: 'asset' });
  });

  it('blocks strict production when a real role is absent, without falling back silently', async () => {
    const result = await resolveRealAudioAssets({}, { requireRealAudio: true });

    expect(result.valid).toBe(false);
    expect(result.missingRoles).toEqual(['music', 'ambience', 'sfx']);
    expect(result.sources).toEqual({ music: 'missing', ambience: 'missing', sfx: 'missing' });
    expect(result.diagnostics.some((item) => item.includes('technical_blocked'))).toBe(true);
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assembleTimeline, type Storyboard } from '@neuralbridge/shared';
import { discoverMotionVelixSfx, motionVelixSfxEvents } from '../src/aethera-sfx.js';

const storyboard = (): Storyboard => ({
  schemaVersion: 1,
  timing: 'measured',
  narrationKey: 'narration-v1',
  scenes: [{
    id: 'scene-1', chapter: 1, narration: 'Primeira cena.', startMs: 0, endMs: 2_000, claimIds: [],
    visualObjective: 'Mostrar gameplay', subjectId: 'game-1', sceneType: 'broll', searchTerms: ['gameplay'],
    visual: { type: 'fallback', kind: 'animation', reason: 'teste' }, onScreenText: 'Gameplay', transition: 'fade', camera: 'static', locked: false, reviewStatus: 'approved',
    audio: { relativePath: 'audio/scene-1.wav', durationMs: 2_000, key: 'narration-1', words: [] },
  }],
});

describe('Aethera AP-05 MotionVelix SFX integration', () => {
  it('discovers only the existing local WAV kit and records hashes', () => {
    const kit = mkdtempSync(join(tmpdir(), 'aethera-sfx-'));
    const sfxRoot = join(kit, 'assets', 'sfx');
    mkdirSync(sfxRoot, { recursive: true });
    writeFileSync(join(sfxRoot, 'swish_suave.wav'), Buffer.from('local-synthesized-sfx'));
    writeFileSync(join(sfxRoot, 'ignore.txt'), 'not audio');

    const manifest = discoverMotionVelixSfx(kit);

    expect(manifest?.assets).toHaveLength(1);
    expect(manifest?.assets[0]).toMatchObject({ id: 'swish_suave', source: 'motionvelix-kit', licenseEvidence: 'motionvelix-user-kit-original-synthesized' });
    expect(manifest?.assets[0]?.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('aligns a local transition SFX to the transition frame', async () => {
    const kit = mkdtempSync(join(tmpdir(), 'aethera-sfx-'));
    const sfxRoot = join(kit, 'assets', 'sfx');
    mkdirSync(sfxRoot, { recursive: true });
    writeFileSync(join(sfxRoot, 'swish_suave.wav'), Buffer.from('local-synthesized-sfx'));
    const manifest = discoverMotionVelixSfx(kit);
    if (!manifest) throw new Error('missing manifest');
    const timeline = assembleTimeline({ runId: 'run-sfx', storyboard: storyboard(), format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 54 } } });

    const events = await motionVelixSfxEvents({ timeline, manifest, probeDurationMs: async () => 240 });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sfxId: 'swish_suave', atMs: 1_750, frame: 53, durationMs: 240, licenseEvidence: 'motionvelix-user-kit-original-synthesized' });
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyAudioMixerUpdates,
  applyPromptRevisionToPackage,
  produceCinemaPackage,
  renderRealCinemaMp4,
  validateSoundMix,
} from '../src/index.js';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('Audio Mixer, Prompt Revision & Real Render Integration', () => {
  it('updates audio mixer buses, validates clipping/loudness, and clamps bounds', () => {
    const pkg = produceCinemaPackage({
      projectId: 'mixer_test_01',
      prompt: 'Documentário sobre astrofísica em 18 segundos',
      targetDurationSec: 18,
      humorIntensity: 35,
    });

    const { soundPlan, validation } = applyAudioMixerUpdates(pkg.soundPlan, [
      { stemRole: 'voiceover', targetGainDb: -1.5 },
      { stemRole: 'music', targetGainDb: -24 },
      { stemRole: 'sfx', muted: true },
    ]);

    const voice = soundPlan.stems.find((s) => s.stemRole === 'voiceover');
    const music = soundPlan.stems.find((s) => s.stemRole === 'music');
    const sfx = soundPlan.stems.find((s) => s.stemRole === 'sfx');

    expect(voice?.targetGainDb).toBe(-1.5);
    expect(music?.targetGainDb).toBe(-24);
    expect(sfx?.muted).toBe(true);
    expect(validation.valid).toBe(true);

    const hotMix = validateSoundMix(
      soundPlan.stems.map((s) => ({ ...s, muted: false, targetGainDb: 9 })),
      soundPlan.platformProfile,
    );
    expect(hotMix.peakRisk).toBe(true);
    expect(hotMix.warnings.length).toBeGreaterThan(0);
  });

  it('applies targeted prompt revisions for music ducking, 3rd scene swap, title removal, and cinematic transitions', () => {
    const pkg = produceCinemaPackage({
      projectId: 'rev_test_01',
      prompt: 'Top 4 chefes de Elden Ring',
      targetDurationSec: 24,
      humorIntensity: 35,
    });

    const r1 = applyPromptRevisionToPackage(pkg, 'Reduza a música durante a narração.');
    expect(r1.affectedBuses).toContain('music');
    expect(r1.requiresAudioReRender).toBe(true);
    expect(r1.requiresVideoReRender).toBe(false);
    expect(r1.pkg.soundPlan.stems.find((s) => s.stemRole === 'music')?.targetGainDb).toBeLessThan(-16);

    const r2 = applyPromptRevisionToPackage(r1.pkg, 'Troque a cena do terceiro jogo.');
    expect(r2.affectedClipIds).toEqual(['clip_3']);
    expect(r2.requiresMediaAcquisition).toBe(true);
    expect(r2.requiresVideoReRender).toBe(true);

    const r3 = applyPromptRevisionToPackage(r2.pkg, 'Remova esse título.', { selectedClipId: 'clip_2' });
    expect(r3.affectedClipIds).toEqual(['clip_2']);
    expect(r3.pkg.timeline.clips.find((c) => c.clipId === 'clip_2')?.effects.some((e) => e.kind === 'hide_title')).toBe(true);
    expect(r3.pkg.timeline.clips.find((c) => c.clipId === 'clip_1')?.effects.some((e) => e.kind === 'hide_title')).toBe(false);

    const r4 = applyPromptRevisionToPackage(r3.pkg, 'Deixe a transição mais cinematográfica.');
    expect(r4.requiresVideoReRender).toBe(true);
    expect(
      r4.pkg.timeline.clips[0]?.effects.some(
        (e) => e.kind === 'transition' && e.params['transitionKind'] === 'dissolve',
      ),
    ).toBe(true);
  });

  it('blocks silent placeholder substitution when requireRealMedia is true and renders real MP4 when allowed', async () => {
    const pkg = produceCinemaPackage({
      projectId: 'real_render_check',
      prompt: 'Teste de renderização audiovisual',
      targetDurationSec: 12,
      humorIntensity: 35,
    });
    const outDir = makeTempDir('aethera-render-test-');

    await expect(
      renderRealCinemaMp4({
        pkg,
        outputDir: outDir,
        fileName: 'blocked.mp4',
        requireRealMedia: true,
        useNvenc: false,
      }),
    ).rejects.toThrow(/missing_real_media/);

    const { soundPlan } = applyAudioMixerUpdates(pkg.soundPlan, [
      { stemRole: 'music', targetGainDb: -22 },
      { stemRole: 'sfx', targetGainDb: -12 },
    ]);
    const pkgWithCustomMix = {
      ...pkg,
      soundPlan,
      colorPlan: {
        ...pkg.colorPlan,
        ffmpegColorFilterChain: 'colorspace=all=bt709:iall=bt709:fast=1,eq=contrast=1.08:saturation=1.05',
      },
    };

    const rendered = await renderRealCinemaMp4({
      pkg: pkgWithCustomMix,
      outputDir: outDir,
      fileName: 'ok.mp4',
      requireRealMedia: false,
      useNvenc: false,
    });

    expect(rendered.probe.videoCodec).toBeTruthy();
    expect(rendered.probe.audioCodec).toBeTruthy();
    expect(rendered.probe.width).toBeGreaterThan(0);
    expect(rendered.probe.durationSec).toBeGreaterThan(5);
    expect(rendered.waveformPeaks.length).toBeGreaterThan(10);
  }, 60_000);
});

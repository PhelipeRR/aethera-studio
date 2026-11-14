import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyColorGradingControls,
  compileColorGradingToFfmpegChain,
  groupClips,
  listBuiltinLuts,
  moveClip,
  probeRealMp4,
  produceCinemaPackage,
  renderRealCinemaMp4,
  setClipAudioFades,
  setClipTransformAndBlend,
  splitClipAtFrame,
  toFrames,
  ungroupClips,
  upsertClipTransition,
  upsertSubtitleClip,
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

describe('NLE Premiere-Grade Timeline, Color, Subtitles & Real Render', () => {
  it('supports split/razor, move, group/ungroup, transform/blend, audio fades, transitions, and subtitles', () => {
    const pkg = produceCinemaPackage({
      projectId: 'nle_ops_01',
      prompt: 'História da exploração espacial em 15 segundos',
      targetDurationSec: 15,
      humorIntensity: 35,
    });

    const firstClip = pkg.timeline.clips.find((c) => c.trackId === 'v1');
    expect(firstClip).toBeDefined();
    if (!firstClip) return;

    const firstStartF = toFrames(firstClip.timelineRange.start, pkg.timeline.fps);
    const firstDurF = toFrames(firstClip.timelineRange.duration, pkg.timeline.fps);
    const splitFrame = firstStartF + Math.floor(firstDurF / 2);

    const splitTimeline = splitClipAtFrame(pkg.timeline, firstClip.clipId, splitFrame);
    expect(splitTimeline.clips.length).toBe(pkg.timeline.clips.length + 1);

    const leftPart = splitTimeline.clips.find((c) => c.clipId === `${firstClip.clipId}_a`);
    const rightPart = splitTimeline.clips.find((c) => c.clipId === `${firstClip.clipId}_b`);
    expect(leftPart).toBeDefined();
    expect(rightPart).toBeDefined();
    if (!leftPart || !rightPart) return;

    expect(
      toFrames(leftPart.timelineRange.duration, splitTimeline.fps) +
        toFrames(rightPart.timelineRange.duration, splitTimeline.fps),
    ).toBe(firstDurF);

    const movedTimeline = moveClip(splitTimeline, rightPart.clipId, 'v2', splitFrame + 15);
    const movedClip = movedTimeline.clips.find((c) => c.clipId === rightPart.clipId);
    expect(movedClip?.trackId).toBe('v2');
    if (!movedClip) return;
    expect(toFrames(movedClip.timelineRange.start, movedTimeline.fps)).toBe(splitFrame + 15);

    const groupedTimeline = groupClips(movedTimeline, [leftPart.clipId, rightPart.clipId], 'grp_hero');
    expect(
      groupedTimeline.clips
        .find((c) => c.clipId === leftPart.clipId)
        ?.effects.find((e) => e.kind === 'group')?.params['groupId'],
    ).toBe('grp_hero');
    expect(
      groupedTimeline.clips
        .find((c) => c.clipId === rightPart.clipId)
        ?.effects.find((e) => e.kind === 'group')?.params['groupId'],
    ).toBe('grp_hero');

    const ungroupedTimeline = ungroupClips(groupedTimeline, [leftPart.clipId]);
    expect(
      ungroupedTimeline.clips
        .find((c) => c.clipId === leftPart.clipId)
        ?.effects.some((e) => e.kind === 'group'),
    ).toBe(false);

    const transformedTimeline = setClipTransformAndBlend(ungroupedTimeline, leftPart.clipId, {
      blendMode: 'screen',
      opacity: 0.85,
      scale: 1.15,
      rotationDeg: 3,
      x: 12,
      y: -8,
      keyframeAtFrame: firstStartF,
    });
    const transformedClip = transformedTimeline.clips.find((c) => c.clipId === leftPart.clipId);
    expect(transformedClip?.effects.find((e) => e.kind === 'blend_mode')?.params['mode']).toBe('screen');
    expect(transformedClip?.keyframes.some((k) => k.property === 'scale' && k.value === 1.15)).toBe(true);
    expect(transformedClip?.keyframes.some((k) => k.property === 'rotation' && k.value === 3)).toBe(true);
    expect(transformedClip?.keyframes.some((k) => k.property === 'opacity' && k.value === 0.85)).toBe(true);

    const fadedTimeline = setClipAudioFades(transformedTimeline, leftPart.clipId, {
      fadeInSec: 0.5,
      fadeOutSec: 0.75,
      gainDb: -2,
    });
    const fadedClip = fadedTimeline.clips.find((c) => c.clipId === leftPart.clipId);
    const envParams = fadedClip?.effects.find((e) => e.kind === 'audio_envelope')?.params;
    expect(envParams?.['fadeInSec']).toBe(0.5);
    expect(envParams?.['fadeOutSec']).toBe(0.75);
    expect(envParams?.['gainDb']).toBe(-2);

    const transitionedTimeline = upsertClipTransition(
      fadedTimeline,
      leftPart.clipId,
      rightPart.clipId,
      'dissolve',
      18,
      'Teste NLE',
    );
    expect(
      transitionedTimeline.transitions.some(
        (t) => t.fromClipId === leftPart.clipId && t.toClipId === rightPart.clipId && t.kind === 'dissolve',
      ),
    ).toBe(true);

    const subtitledTimeline = upsertSubtitleClip(transitionedTimeline, {
      text: 'Missão Apollo em foco',
      startFrames: 12,
      durationFrames: 60,
      animation: 'fade_up',
    });
    const subClip = subtitledTimeline.clips.find((c) => c.trackId === 'sub1');
    expect(subClip).toBeDefined();
    expect(subClip?.label).toBe('Missão Apollo em foco');
    expect(subClip?.effects.some((e) => e.kind === 'subtitle_style')).toBe(true);
  });

  it('compiles visual color grading controls and LUTs into valid FFmpeg chains', () => {
    const luts = listBuiltinLuts();
    expect(luts.length).toBeGreaterThan(0);

    const chain = compileColorGradingToFfmpegChain({
      exposureCompensationEv: 0.25,
      contrastGain: 1.12,
      saturation: 1.18,
      temperatureKelvinDelta: 450,
      curves: { shadows: -0.04, midtones: 0.03, highlights: 0.05 },
      lutId: luts[0]?.lutId,
    });

    expect(chain).toContain('colorspace=all=bt709');
    expect(chain).toContain('eq=');
    expect(chain).toContain('colorbalance=');
    expect(chain).toContain('curves=');

    const pkg = produceCinemaPackage({
      projectId: 'nle_color_01',
      prompt: 'Teste de cor visual',
      targetDurationSec: 10,
      humorIntensity: 35,
    });

    const updatedPlan = applyColorGradingControls(pkg.colorPlan, {
      exposureCompensationEv: -0.1,
      contrastGain: 1.2,
      saturation: 0.9,
      temperatureKelvinDelta: -300,
    });

    expect(updatedPlan.ffmpegColorFilterChain).toContain('eq=');
    expect(updatedPlan.ffmpegColorFilterChain).toContain('contrast=1.2');
    expect(updatedPlan.ffmpegColorFilterChain).toContain('colorbalance=');
  });

  it('renders a real MP4 with split clip, keyframe transform, subtitle burn-in, and visual color grading', async () => {
    const pkg = produceCinemaPackage({
      projectId: 'nle_real_render_01',
      prompt: 'Documentário curto sobre oceanos profundos',
      targetDurationSec: 12,
      humorIntensity: 35,
    });

    const v1Clip = pkg.timeline.clips.find((c) => c.trackId === 'v1');
    expect(v1Clip).toBeDefined();
    if (!v1Clip) return;

    const startF = toFrames(v1Clip.timelineRange.start, pkg.timeline.fps);
    const durF = toFrames(v1Clip.timelineRange.duration, pkg.timeline.fps);
    const splitFrame = startF + Math.floor(durF / 2);

    let timeline = splitClipAtFrame(pkg.timeline, v1Clip.clipId, splitFrame);
    const leftClipId = `${v1Clip.clipId}_a`;
    timeline = setClipTransformAndBlend(timeline, leftClipId, {
      scale: 1.08,
      rotationDeg: 2,
      opacity: 0.95,
      keyframeAtFrame: startF,
    });
    timeline = upsertSubtitleClip(timeline, {
      text: 'Abismo Oceânico',
      startFrames: 10,
      durationFrames: 50,
      animation: 'pop',
    });

    const colorPlan = applyColorGradingControls(pkg.colorPlan, {
      exposureCompensationEv: 0.08,
      contrastGain: 1.1,
      saturation: 1.12,
      temperatureKelvinDelta: 200,
    });

    const outDir = makeTempDir('aethera-nle-render-');
    const rendered = await renderRealCinemaMp4({
      pkg: {
        ...pkg,
        timeline,
        colorPlan,
      },
      outputDir: outDir,
      fileName: 'nle_validated.mp4',
      requireRealMedia: false,
      useNvenc: false,
    });

    const probed = await probeRealMp4(join(outDir, 'nle_validated.mp4'));
    expect(probed.videoCodec).toBeTruthy();
    expect(probed.audioCodec).toBeTruthy();
    expect(probed.width).toBeGreaterThan(0);
    expect(probed.height).toBeGreaterThan(0);
    expect(probed.durationSec).toBeGreaterThan(4);
    expect(rendered.probe.videoCodec).toBe(probed.videoCodec);
    expect(rendered.waveformPeaks.length).toBeGreaterThan(10);
  }, 60_000);
});

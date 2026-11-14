import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { renderVelixClipTimeline } from '../src/velix-clip-render.js';

const exec = promisify(execFile); const ffmpeg = process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe'; const ffprobe = 'C:\\ffmpeg\\bin\\ffprobe.exe';
async function source() { const root = mkdtempSync(join(tmpdir(), 'velix-render-')); const path = join(root, 'source.mp4'); await exec(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', path]); return { root, path }; }

describe('Velix clip timeline render', () => {
  it('renders approved source intervals as one valid MP4 with video and audio', async () => {
    const { root } = await source();
    const result = await renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/cuts.mp4', clips: [{ start: 0, end: 0.7 }, { start: 1.1, end: 1.8 }], rightsStatus: 'verified_allowed', ffmpeg, ffprobe });
    expect(result.duration).toBeGreaterThan(1.1); expect(result.duration).toBeLessThan(1.7); expect(result.hasVideo).toBe(true); expect(result.hasAudio).toBe(true);
  });
  it('rejects unverified rights and invalid intervals before rendering', async () => {
    const { root } = await source();
    await expect(renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/a.mp4', clips: [{ start: 0, end: 1 }], rightsStatus: 'unverified', ffmpeg, ffprobe })).rejects.toThrow(/direitos/i);
    await expect(renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/a.mp4', clips: [{ start: -1, end: 1 }], rightsStatus: 'verified_allowed', ffmpeg, ffprobe })).rejects.toThrow(/intervalo/i);
  });
  it('mixes imported narration with original audio in a real MP4', async () => {
    const { root } = await source();
    await exec(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'aac', join(root, 'voice.m4a')]);
    const result = await renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/mixed.mp4', clips: [{ start: 0, end: 1.5 }], rightsStatus: 'verified_allowed', narrationRelativePath: 'voice.m4a', originalVolume: 0.25, narrationVolume: 1, ffmpeg, ffprobe });
    expect(result.hasVideo).toBe(true); expect(result.hasAudio).toBe(true); expect(result.duration).toBeGreaterThan(1.3); expect(result.duration).toBeLessThan(1.7);
    await renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/original-only.mp4', clips: [{ start: 0, end: 1.5 }], rightsStatus: 'verified_allowed', originalVolume: 0.25, ffmpeg, ffprobe });
    expect(readFileSync(join(root, 'renders', 'mixed.mp4')).equals(readFileSync(join(root, 'renders', 'original-only.mp4')))).toBe(false);
  });
  it('keeps identifiable original and narration frequencies after AAC mixing', async () => {
    const { root } = await source();
    await exec(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=1', '-c:a', 'aac', join(root, 'voice.m4a')]);
    await renderVelixClipTimeline({ root, sourceRelativePath: 'source.mp4', outputRelativePath: 'renders/spectral.mp4', clips: [{ start: 0, end: 1.5 }], rightsStatus: 'verified_allowed', narrationRelativePath: 'voice.m4a', originalVolume: 0.8, narrationVolume: 0.8, ffmpeg, ffprobe });
    const probeBand = async (frequency: number) => {
      const result = await exec(ffmpeg, ['-v', 'info', '-i', join(root, 'renders', 'spectral.mp4'), '-af', `bandpass=f=${frequency}:width_type=h:w=80,volumedetect`, '-f', 'null', '-']);
      const match = result.stderr.match(/mean_volume:\s*(-?\d+(?:\.\d+)?) dB/);
      return Number(match?.[1] ?? '-99');
    };
    expect(await probeBand(440)).toBeGreaterThan(-45);
    expect(await probeBand(880)).toBeGreaterThan(-45);
  });
});

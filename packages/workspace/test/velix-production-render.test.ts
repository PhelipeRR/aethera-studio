import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AetheraAudioPlan, VideoFormat } from '@neuralbridge/shared';
import { assembleProduction, extractStillDataUrl, ffmpegFilters, inspectRenderQuality, missingQualityFilters, probeVideo, renderAssetSegment } from '../src/velix-production-render.js';
import { createAetheraMediaProxy } from '../src/aethera-media-proxy.js';

const exec = promisify(execFile);
const FULL_FFMPEG = process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE = FULL_FFMPEG.replace(/ffmpeg(\.exe)?$/iu, 'ffprobe$1');
// The app renders with the minimal FFmpeg bundled by Remotion (no fps, tpad or lavfi): the cut must work there too.
const BUNDLED_FFMPEG = resolve(import.meta.dirname, '../../../node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe');
const engines = [['full', FULL_FFMPEG], ['bundled', BUNDLED_FFMPEG]].filter(([, path]) => existsSync(path as string)) as Array<[string, string]>;
const format: VideoFormat = { id: 'custom', width: 64, height: 36, fps: 30, aspectRatio: '16:9', safeArea: { top: 0, right: 0, bottom: 0, left: 0 } };
let dir: string;
let source: string;
let ntsc: string;

/** Red channel of one frame, averaged to one pixel: second N of the synthetic source is red 25·N. */
async function red(file: string, frame: 'first' | 'last'): Promise<number> {
  const args = frame === 'first'
    ? ['-v', 'error', '-i', file, '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    : ['-v', 'error', '-sseof', '-0.1', '-i', file, '-vf', 'scale=1:1', '-update', '1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'];
  const { stdout } = await exec(FULL_FFMPEG, args, { encoding: 'buffer', windowsHide: true });
  return (stdout as Buffer)[0] ?? -1;
}
async function frames(file: string): Promise<number> {
  const { stdout } = await exec(FFPROBE, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { windowsHide: true });
  return Number(String(stdout).trim());
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aethera-range-'));
  source = join(dir, 'seconds.mp4');
  ntsc = join(dir, 'ntsc.mp4');
  // Ten seconds; the red channel steps by 25 every second (0, 25, 50 … 225), so a frame tells which second it came from.
  await exec(FULL_FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', "color=c=black:s=64x36:r=30:d=10,format=rgb24,geq=r='25*floor(T)':g='0':b='0'", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', source], { windowsHide: true });
  await exec(FULL_FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=60000/1001:d=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ntsc], { windowsHide: true });
}, 60_000);

describe.each(engines)('renderAssetSegment with the matched range (AP-02, %s FFmpeg)', (name, ffmpeg) => {
  it('extracts a JPEG data URL from the already-downloaded source at the requested time', async () => {
    const dataUrl = await extractStillDataUrl({ ffmpeg, source, kind: 'video', atMs: 7_000 });
    expect(dataUrl).toMatch(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/u);
  }, 60_000);

  it('starts at the matched second instead of second 0', async () => {
    const output = join(dir, `${name}-ranged.mp4`);
    const result = await renderAssetSegment({ ffmpeg, source, kind: 'video', frames: 60, format, output, startMs: 7_000, endMs: 9_000 });
    expect(await frames(output)).toBe(60);
    expect(Math.abs((await red(output, 'first')) - 175)).toBeLessThanOrEqual(10);
    expect(Math.abs((await red(output, 'last')) - 200)).toBeLessThanOrEqual(10);
    expect(result).toEqual({ extendedMs: 0 });
  }, 60_000);

  it('keeps playing the source past a cut shorter than the scene, and says how long', async () => {
    const output = join(dir, `${name}-short.mp4`);
    const result = await renderAssetSegment({ ffmpeg, source, kind: 'video', frames: 60, format, output, startMs: 7_000, endMs: 8_000 });
    expect(await frames(output)).toBe(60);
    expect(Math.abs((await red(output, 'last')) - 200)).toBeLessThanOrEqual(10);
    expect(result.extendedMs).toBe(1_000);
  }, 60_000);

  it('keeps the legacy behaviour without a range: from second 0', async () => {
    const output = join(dir, `${name}-legacy.mp4`);
    await renderAssetSegment({ ffmpeg, source, kind: 'video', frames: 30, format, output });
    expect(await red(output, 'first')).toBeLessThanOrEqual(10);
  }, 60_000);

  it('turns a 59.94 fps source into exactly the frames of the format', async () => {
    const output = join(dir, `${name}-ntsc-30.mp4`);
    await renderAssetSegment({ ffmpeg, source: ntsc, kind: 'video', frames: 75, format, output, startMs: 1_500, endMs: 4_000 });
    expect(await frames(output)).toBe(75);
  }, 60_000);
});

describe.skipIf(!existsSync(FULL_FFMPEG))('Aethera AP-04 proxy', () => {
  it('creates a local 540p seek-friendly proxy without altering rights metadata', async () => {
    const proxy = await createAetheraMediaProxy({ root: dir, assetId: 'asset-1', originalHash: 'a'.repeat(64), sourceRelativePath: 'seconds.mp4', outputRelativePath: 'proxies/asset-1.mp4', ffmpeg: FULL_FFMPEG, ffprobe: FFPROBE });
    expect(proxy).toMatchObject({ schemaVersion: 1, assetId: 'asset-1', relativePath: 'proxies/asset-1.mp4', width: 960, height: 540, codec: 'h264' });
  }, 60_000);
});

describe.skipIf(!existsSync(FULL_FFMPEG))('Quality Director engine capabilities', () => {
  it('uses the full FFmpeg filters to burn captions and measure loudness/clipping', async () => {
    const filters = await ffmpegFilters(FULL_FFMPEG);
    expect([...['subtitles', 'ebur128', 'astats', 'silencedetect', 'blackdetect', 'freezedetect']].every((filter) => filters.has(filter))).toBe(true);
    const narration = join(dir, 'quality-narration.wav');
    const output = join(dir, 'quality-output.mp4');
    const srt = join(dir, 'quality-output.srt');
    await exec(FULL_FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', '-ac', '1', narration], { windowsHide: true });
    writeFileSync(srt, '1\n00:00:00,000 --> 00:00:00,900\nTexto de teste\n');
    const assembled = await assembleProduction({ ffmpeg: FULL_FFMPEG, segments: [source], narration, narrationDurationMs: 1_000, format, output, subtitles: { path: srt, style: 'Fontname=Arial,Fontsize=12' } });
    expect(assembled.captionsBurned).toBe(true);
    expect((await inspectRenderQuality(FULL_FFMPEG, output)).loudness).toEqual(expect.objectContaining({ clippedSamples: expect.any(Number) }));
  }, 60_000);

  it('mixes the validated AP-05 audio plan before muxing the final video', async () => {
    const narration = join(dir, 'audio-plan-narration.wav');
    const sfx = join(dir, 'audio-plan-sfx.wav');
    const output = join(dir, 'audio-plan-output.mp4');
    await exec(FULL_FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '24000', '-ac', '1', narration], { windowsHide: true });
    await exec(FULL_FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.2', '-ar', '24000', '-ac', '1', sfx], { windowsHide: true });
    const plan: AetheraAudioPlan = { schemaVersion: 1, timelineId: 'timeline-audio-plan', targetLufs: -14, truePeakDb: -1, narrationGainDb: 0, music: null, musicGainDb: -12, ducking: [], sfx: [{ id: 'sfx-1', sfxId: 'swish_suave', relativePath: sfx, atMs: 250, durationMs: 200, frame: 8, gainDb: -18, licenseEvidence: 'motionvelix-user-kit-original-synthesized' }], rationale: 'teste' };
    const assembled = await assembleProduction({ ffmpeg: FULL_FFMPEG, segments: [source], narration, narrationDurationMs: 1_000, format, output, subtitles: null, audioPlan: plan });

    expect(assembled.captionsBurned).toBe(false);
    expect((await probeVideo(output, FFPROBE)).hasAudio).toBe(true);
    expect(existsSync(`${output}.video-only.mp4`)).toBe(false);
    expect(existsSync(`${output}.audio.m4a`)).toBe(false);
  }, 60_000);

  it('reports missing mandatory capabilities instead of treating a minimal engine as complete', async () => {
    if (!existsSync(BUNDLED_FFMPEG)) return;
    const missing = await missingQualityFilters(BUNDLED_FFMPEG);
    expect(missing).toContain('subtitles');
    await expect(inspectRenderQuality(BUNDLED_FFMPEG, source)).rejects.toThrow(/filtros obrigatórios ausentes/iu);
  }, 60_000);
});

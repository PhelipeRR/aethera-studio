import { execFile } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_CHOICE, type ProductionStyleChoice } from '@neuralbridge/shared/video-styles';
import { motionMediaTools, motionBrowserExecutable } from '../src/velix-motion.js';
import { renderStyleMix } from '../src/velix-style-mix.js';

const script = { duracao: 4, cenas: [{ at: 0, capitulo: { titulo: 'A' }, blocos: [{ tipo: 'texto', texto: 'A' }] }, { at: 2, capitulo: { titulo: 'B' }, blocos: [{ tipo: 'texto', texto: 'B' }] }] };
const exec = promisify(execFile);

describe('style mix renderer', () => {
  it('rejects a kit style before invoking the render engine', async () => {
    const choice: ProductionStyleChoice = { ...DEFAULT_STYLE_CHOICE, styleId: 'explicativo', scenes: { 'cena-2': { styleId: 'motion-cenas-base' } } };
    await expect(renderStyleMix({ root: process.cwd(), script, choice, outputRelativePath: 'renders/mix.mp4', bundlePath: 'bundle', workerPath: 'worker', runtime: process.execPath, browserExecutable: 'browser', ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' })).rejects.toThrow(/adaptador de segmento kit/);
  });

  it('delegates a kit segment and does not silently route it through Remotion', async () => {
    const choice: ProductionStyleChoice = { ...DEFAULT_STYLE_CHOICE, styleId: 'explicativo' };
    let delegated = 0;
    await expect(renderStyleMix({ root: process.cwd(), script, choice, outputRelativePath: 'renders/mix.mp4', bundlePath: 'bundle', workerPath: 'worker', runtime: process.execPath, browserExecutable: 'browser', ffmpeg: 'missing-ffmpeg', ffprobe: 'missing-ffprobe', renderKitSegment: async () => { delegated += 1; return { outputPath: '.velix-test/segment.mp4' }; } })).rejects.toThrow(/FFmpeg falhou/);
    expect(delegated).toBe(1);
  });

  it('concatenates a real kit segment with a real Remotion segment', async () => {
    const browser = process.env['NB_MOTION_BROWSER'] ?? motionBrowserExecutable(join(process.cwd(), '.motion-runtime'));
    const tools = motionMediaTools(join(process.cwd(), 'apps', 'desktop'));
    if (!browser || !tools) return;
    const root = await mkdtemp(join(tmpdir(), 'velix-style-mix-'));
    await mkdir(join(root, 'fixture'), { recursive: true });
    await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x7c3aed:s=1280x720:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(root, 'fixture', 'kit.mp4')]);
    await exec(process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xf59e0b:s=1280x720:d=0.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(root, 'fixture', 'collage.mp4')]);
    const choice: ProductionStyleChoice = { ...DEFAULT_STYLE_CHOICE, styleId: 'explicativo', scenes: { 'cena-2': { styleId: 'motion-cenas-base' } } };
    const result = await renderStyleMix({ root, script, choice, outputRelativePath: 'renders/hybrid.mp4', bundlePath: join(process.cwd(), 'apps', 'desktop', 'motion-bundle'), workerPath: join(process.cwd(), 'apps', 'desktop', 'motion', 'render-worker.mjs'), runtime: process.execPath, browserExecutable: browser, ffmpeg: tools.ffmpeg, ffprobe: tools.ffprobe, broll: [{ afterScene: 0, relativePath: 'fixture/collage.mp4' }], renderKitSegment: async () => ({ outputPath: 'fixture/kit.mp4' }) });
    expect(result).toMatchObject({ segments: 3, hasAudio: false });
    expect(result.duration).toBeGreaterThan(4);
  }, 120_000);
});

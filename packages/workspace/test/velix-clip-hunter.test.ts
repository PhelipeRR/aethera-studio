import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeAuthorizedVideo } from '../src/velix-clip-hunter.js';

const exec = promisify(execFile);
const ffmpeg = process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const roots: string[] = [];
afterEach(() => { roots.length = 0; });

async function fixture(withAudio = true): Promise<{ root: string; file: string }> {
  const root = mkdtempSync(join(tmpdir(), 'velix-clips-')); roots.push(root);
  const file = join(root, 'gameplay.mp4');
  const args = ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=1', ...(withAudio ? ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1'] : []), '-t', '1', '-pix_fmt', 'yuv420p', ...(withAudio ? ['-shortest'] : []), file];
  await exec(ffmpeg, args, { windowsHide: true });
  return { root, file };
}

describe('Velix Clip Hunter', () => {
  it('extracts real video metadata and returns editable suggestions', async () => {
    const { root } = await fixture();
    const result = await analyzeAuthorizedVideo({ root, relativePath: 'gameplay.mp4', rightsStatus: 'verified_allowed', ffprobe: 'C:\\ffmpeg\\bin\\ffprobe.exe', ffmpeg });
    expect(result.metadata).toMatchObject({ width: 320, height: 180, hasAudio: true });
    expect(result.metadata.duration).toBeGreaterThan(0);
    expect(result.suggestions.every((clip) => clip.start >= 0 && clip.end <= result.metadata.duration)).toBe(true);
  });
  it('rejects a path without verified rights or outside the root', async () => {
    const { root } = await fixture(false);
    await expect(analyzeAuthorizedVideo({ root, relativePath: 'gameplay.mp4', rightsStatus: 'unverified', ffprobe: 'C:\\ffmpeg\\bin\\ffprobe.exe', ffmpeg })).rejects.toThrow(/direitos/i);
    await expect(analyzeAuthorizedVideo({ root, relativePath: '../gameplay.mp4', rightsStatus: 'verified_allowed', ffprobe: 'C:\\ffmpeg\\bin\\ffprobe.exe', ffmpeg })).rejects.toThrow(/raiz/i);
  });
  it('reports a missing executable and supports cancellation', async () => {
    const { root } = await fixture(false);
    await expect(analyzeAuthorizedVideo({ root, relativePath: 'gameplay.mp4', rightsStatus: 'verified_allowed', ffprobe: 'does-not-exist.exe', ffmpeg })).rejects.toThrow(/ffprobe/i);
    const controller = new AbortController(); controller.abort();
    await expect(analyzeAuthorizedVideo({ root, relativePath: 'gameplay.mp4', rightsStatus: 'verified_allowed', ffprobe: 'C:\\ffmpeg\\bin\\ffprobe.exe', ffmpeg, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

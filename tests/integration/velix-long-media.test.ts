import { execFile } from 'node:child_process';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { analyzeAuthorizedVideo, renderVelixClipTimeline } from '@neuralbridge/workspace';
import { describe, expect, it } from 'vitest';

// Measures a one-hour synthetic file end to end, so it stays out of the default run (NB_LONG_MEDIA=1).
const exec = promisify(execFile);
const seconds = Number(process.env['NB_LONG_MEDIA_SECONDS'] ?? 3600);

describe.skipIf(process.env['NB_LONG_MEDIA'] !== '1')('Velix with long media', () => {
  it('analyzes and renders within the job limits', { timeout: 1_800_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-velix-long-'));
    const file = join(root, 'long.mp4');
    await exec('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=15:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-shortest', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', file]);
    const started = Date.now();
    const analysis = await analyzeAuthorizedVideo({ root, relativePath: 'long.mp4', rightsStatus: 'verified_allowed' });
    const analyzed = Date.now();
    const render = await renderVelixClipTimeline({ root, sourceRelativePath: 'long.mp4', outputRelativePath: 'renders/out.mp4', clips: [{ start: seconds / 2, end: seconds / 2 + 30 }], rightsStatus: 'verified_allowed' });
    const rendered = Date.now();
    console.log(`long media: ${seconds}s ${Math.round(statSync(file).size / 1_048_576)}MB analyze=${(analyzed - started) / 1000}s render30s=${(rendered - analyzed) / 1000}s energy=${analysis.energy.length} suggestions=${analysis.suggestions.length} rss=${Math.round(process.memoryUsage().rss / 1_048_576)}MB`);
    expect(analysis.energy.length).toBeLessThanOrEqual(240);
    expect(render).toMatchObject({ hasVideo: true, hasAudio: true });
  });
});

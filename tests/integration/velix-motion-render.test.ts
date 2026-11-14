import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { renderMotionProject } from '@neuralbridge/workspace';
import type { MotionProject } from '@neuralbridge/shared/motion';
import { describe, expect, it } from 'vitest';

// Real Remotion render with its headless browser (NB_MOTION=1, after `npm run build:motion`).
const exec = promisify(execFile);
const desktop = resolve(import.meta.dirname, '../../apps/desktop');
const runtime = createRequire(join(desktop, 'package.json'))('electron') as unknown as string;
const browserExecutable = join(desktop, '../../node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
const paths = { bundlePath: join(desktop, 'motion-bundle'), workerPath: join(desktop, 'motion/render-worker.mjs'), runtime, browserExecutable };
const project: MotionProject = { schemaVersion: 1, templateId: 'velix-base', templateVersion: 1, width: 640, height: 360, fps: 15, captions: [{ text: 'Legenda de teste', startMs: 200, endMs: 1500, timestampMs: null, confidence: null }], scenes: [{ id: 't', kind: 'title', text: 'Velix Motion', subtitle: 'prova de conceito', durationInFrames: 15, transition: 'fade' }, { id: 'b', kind: 'bars', title: 'Dados', source: 'fixture', items: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }], durationInFrames: 15, transition: 'cut' }] };

describe.skipIf(process.env['NB_MOTION'] !== '1')('Motion render', () => {
  it('renders frames, muxes the voice with FFmpeg and passes FFprobe', { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-motion-'));
    await exec('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2', '-c:a', 'aac', join(root, 'voz.m4a')]);
    const started = Date.now();
    const seen: number[] = [];
    const result = await renderMotionProject({ root, project, outputRelativePath: 'renders/motion.mp4', audioRelativePath: 'voz.m4a', ...paths, onProgress: (value) => seen.push(value) });
    console.log(`motion: ${JSON.stringify(result)} ms=${Date.now() - started}`);
    expect(result).toMatchObject({ hasVideo: true, hasAudio: true });
    expect(seen.length).toBeGreaterThan(0);
    expect(existsSync(join(root, 'renders/motion.mp4.part.mp4'))).toBe(false);
  });

  it('measures a composition made of charts', { timeout: 300_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-motion-'));
    const scenes = Array.from({ length: 10 }, (_, index) => ({ id: `b${index}`, kind: 'bars' as const, title: `Dados ${index}`, source: 'fixture', items: Array.from({ length: 8 }, (_item, position) => ({ label: `Item ${position}`, value: position * (index + 1) })), durationInFrames: 30, transition: 'fade' as const }));
    const started = Date.now();
    const result = await renderMotionProject({ root, project: { ...project, width: 1280, height: 720, fps: 30, captions: [], scenes }, outputRelativePath: 'renders/bench.mp4', ...paths });
    console.log(`motion benchmark: ${scenes.length} gráficos, ${result.duration}s de vídeo 1280x720 em ${(Date.now() - started) / 1000}s`);
    expect(result).toMatchObject({ hasVideo: true });
  });

  it('cancels the isolated render and leaves no file behind', { timeout: 120_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'nb-motion-'));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 1_500);
    await expect(renderMotionProject({ root, project, outputRelativePath: 'renders/x.mp4', ...paths, signal: controller.signal })).rejects.toThrow(/cancelado/);
    expect(existsSync(join(root, 'renders/x.mp4'))).toBe(false);
  });
});

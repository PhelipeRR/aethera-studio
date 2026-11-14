import { expect, it } from 'vitest';
import { VisualWorkScheduler } from '../src/aethera/visual-work-scheduler.js';
import { visualRenderScheduler } from '../src/aethera/visual-work-scheduler.js';
import { renderAssetSegment } from '@neuralbridge/workspace';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

it('serializes visual indexing with render, supports queue cancellation, and releases failures', async () => {
  const scheduler = new VisualWorkScheduler();
  const events: string[] = [];
  let finish!: () => void;
  const active = scheduler.run(async () => { events.push('visual'); await new Promise<void>((resolve) => { finish = resolve; }); });
  await Promise.resolve();
  const controller = new AbortController();
  const cancelled = scheduler.run(async () => { events.push('cancelled'); }, controller.signal);
  const render = scheduler.run(async () => { events.push('render'); throw new Error('render failure'); });
  controller.abort();
  await expect(cancelled).rejects.toThrow(/cancel/i);
  expect(events).toEqual(['visual']);
  finish(); await active;
  await expect(render).rejects.toThrow('render failure');
  await scheduler.run(async () => { events.push('next'); });
  expect(events).toEqual(['visual', 'render', 'next']);
});

it('queues the existing FFmpeg renderer behind visual indexing before starting any render work', async () => {
  const root = mkdtempSync(join(tmpdir(), 'as05-render-lock-'));
  let release!: () => void;
  const indexing = visualRenderScheduler.run(() => new Promise<void>((resolve) => { release = resolve; }));
  await Promise.resolve(); await Promise.resolve();
  const controller = new AbortController();
  const render = renderAssetSegment({ ffmpeg: 'as05-must-not-execute', source: 'unused.jpg', kind: 'image', frames: 1, format: { id: 'youtube-long', width: 320, height: 180, fps: 30, aspectRatio: '16:9', safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }, output: join(root, 'render', 'out.mp4'), signal: controller.signal });
  const settled = render.catch(() => undefined);
  try { expect(existsSync(join(root, 'render'))).toBe(false); }
  finally { controller.abort(); release(); await indexing; await settled; }
});

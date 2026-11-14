import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChannelPublication } from '../src/main/channel-publish.js';

describe('channel publication executor', () => {
  it('uploads the MP4 and thumbnail while persisting progress', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-channel-')); await mkdir(join(root, 'renders')); await writeFile(join(root, 'renders', 'video.mp4'), Buffer.from('mp4')); await writeFile(join(root, 'thumb.png'), Buffer.from('png'));
    const updates: string[] = []; const repository = { updatePublicationJob: (_id: string, update: { status: string }) => updates.push(update.status), savePublication: () => undefined } as never;
    const client = { uploadVideo: async () => ({ id: 'yt-1' }), uploadThumbnail: async () => undefined } as never;
    await expect(runChannelPublication({ projectId: 'p1', rootPath: root, outputRelativePath: 'renders/video.mp4', thumbnailRelativePath: 'thumb.png', title: 'Teste', description: '', tags: [], privacy: 'private', publishAt: null, id: 'job-1' }, client, repository, new AbortController().signal)).resolves.toBe('yt-1');
    expect(updates).toEqual(['uploading', 'uploading', 'completed']); await rm(root, { recursive: true, force: true });
  });

  it('persists cancellation and does not report success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nb-channel-cancel-')); await writeFile(join(root, 'video.mp4'), Buffer.from('mp4')); const updates: string[] = []; const repository = { updatePublicationJob: (_id: string, update: { status: string }) => updates.push(update.status), savePublication: () => undefined } as never; const controller = new AbortController();
    const client = { uploadVideo: async (_metadata: unknown, _bytes: Uint8Array, signal?: AbortSignal) => { controller.abort(); if (signal?.aborted) throw new Error('aborted'); await new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); return { id: 'never' }; }, uploadThumbnail: async () => undefined } as never;
    await expect(runChannelPublication({ projectId: 'p1', rootPath: root, outputRelativePath: 'video.mp4', title: 'Teste', description: '', tags: [], privacy: 'private', publishAt: null, id: 'job-2' }, client, repository, controller.signal)).rejects.toThrow();
    expect(updates.at(-1)).toBe('cancelled'); await rm(root, { recursive: true, force: true });
  });
});

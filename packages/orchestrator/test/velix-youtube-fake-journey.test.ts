import { describe, expect, it } from 'vitest';
import { createYouTubeChannelClient } from '../src/velix-youtube-channel.js';

describe('YouTube fake journey', () => {
  it('publishes resumably, resumes after 308, uploads thumbnail and reschedules a private video', async () => {
    let calls = 0;
    let uploaded = false;
    let rescheduled = false;
    const client = createYouTubeChannelClient({ accessToken: 'fixture-token', fetcher: async (url, init) => {
      const value = String(url);
      calls += 1;
      if (value === 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session') {
        if (!uploaded) { uploaded = true; return new Response(null, { status: 308, headers: { range: 'bytes=0-1' } }); }
        return new Response(JSON.stringify({ id: 'fake-video-1' }), { status: 200 });
      }
      if (value.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?') && value.includes('uploadType=resumable')) return new Response('{}', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session' } });
      if (value.startsWith('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?')) return new Response('{}', { status: 200 });
      if (value.includes('/search?')) return new Response(JSON.stringify({ items: [{ id: { videoId: 'fake-video-1' }, snippet: { title: 'Fixture' } }] }), { status: 200 });
      if (value.includes('/videos?part=snippet,status') && init?.method !== 'PUT') return new Response(JSON.stringify({ items: [{ id: 'fake-video-1', snippet: { title: 'Fixture' }, status: { privacyStatus: 'private', publishAt: '2026-11-05T12:00:00.000Z' } }] }), { status: 200 });
      if (value.includes('/videos?part=status')) { rescheduled = true; return new Response('{}', { status: 200 }); }
      throw new Error(`fixture route not handled: ${value}`);
    } });
    const checkpoints: number[] = [];
    await expect(client.uploadVideo({ snippet: { title: 'Fixture' } }, new Uint8Array([1, 2, 3, 4]), undefined, (_url, offset) => checkpoints.push(offset))).resolves.toEqual({ id: 'fake-video-1' });
    await expect(client.uploadThumbnail('fake-video-1', new Uint8Array([1]), 'image/png')).resolves.toBeUndefined();
    await expect(client.listUploadedVideos()).resolves.toEqual([{ id: 'fake-video-1', title: 'Fixture', privacy: 'private', publishAt: '2026-11-05T12:00:00.000Z' }]);
    await expect(client.updateVideo('fake-video-1', { privacyStatus: 'private', publishAt: '2026-11-06T12:00:00.000Z' })).resolves.toBeUndefined();
    expect(checkpoints).toEqual([0, 2]);
    expect(rescheduled).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(6);
  });
});

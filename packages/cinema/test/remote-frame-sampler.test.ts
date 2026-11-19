import { describe, expect, it } from 'vitest';
import {
  computeAdaptiveSampleTimestamps,
  RemoteSamplingCache,
  startChunkedRangeProxy,
} from '../src/analysis/remote-frame-sampler.js';

describe('remote-frame-sampler', () => {
  it('converts open-ended Range requests into bounded chunks and measures real bytes/requests', async () => {
    const upstreamBytes = Buffer.alloc(600 * 1024, 0x42);
    const seenRanges: string[] = [];
    const proxy = await startChunkedRangeProxy({
      upstreamUrl: 'https://cdn.example/video.mp4',
      chunkSizeBytes: 256 * 1024,
      fetchImpl: (async (_url, init) => {
        const rangeHeader = (init?.headers as Record<string, string>)?.['Range'] ?? '';
        seenRanges.push(rangeHeader);
        const m = /bytes=(\d+)-(\d+)/.exec(rangeHeader);
        const start = m ? Number(m[1]) : 0;
        const end = m ? Math.min(upstreamBytes.length - 1, Number(m[2])) : upstreamBytes.length - 1;
        const slice = upstreamBytes.subarray(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${upstreamBytes.length}`,
            'Content-Length': String(slice.length),
          },
        });
      }) as typeof fetch,
    });
    try {
      const res = await fetch(proxy.url, { headers: { Range: 'bytes=0-' } });
      expect(res.status).toBe(206);
      const body = Buffer.from(await res.arrayBuffer());
      expect(body.length).toBe(upstreamBytes.length);
      expect(seenRanges.every((r) => /^bytes=\d+-\d+$/.test(r))).toBe(true);
      expect(proxy.stats.upstreamRequests).toBe(3);
      expect(proxy.stats.bytesTransferred).toBe(upstreamBytes.length);
    } finally {
      await proxy.close();
    }
  });
  it('computes adaptive 3-7 timestamps prioritizing matching chapters and skipping opening splash', () => {
    const shortTs = computeAdaptiveSampleTimestamps({ durationSec: 25 });
    expect(shortTs.length).toBe(3);
    expect(shortTs[0]).toBeGreaterThanOrEqual(3.5);

    const chapteredTs = computeAdaptiveSampleTimestamps({
      durationSec: 240,
      entities: ['Cyberpunk 2077', 'Night City'],
      query: 'Cyberpunk 2077 Night City gameplay',
      chapters: [
        { startSec: 0, endSec: 40, title: 'Intro & Sponsors' },
        { startSec: 90, endSec: 170, title: 'Night City Combat Showcase' },
        { startSec: 170, endSec: 240, title: 'Credits' },
      ],
    });
    expect(chapteredTs.length).toBe(7);
    expect(chapteredTs.every((t) => t >= 90 && t <= 170)).toBe(true);
  });

  it('invalidates RemoteSamplingCache on TTL expiration and sourceVersion change', () => {
    const cache = new RemoteSamplingCache(1_000);
    const now = 10_000;
    cache.set({
      mediaIdentifier: 'https://youtube.com/watch?v=abc',
      intervalKey: '*0:00-0:35',
      sourceVersion: 'v1',
      streamUrl: 'https://cdn.example/video.mp4',
      streamResolvedAtMs: now,
      preDownloadVerdict: 'passed_pre_download',
    });

    expect(cache.get('https://youtube.com/watch?v=abc', '*0:00-0:35', 'v1', now + 500)?.streamUrl).toBe(
      'https://cdn.example/video.mp4',
    );
    expect(cache.get('https://youtube.com/watch?v=abc', '*0:00-0:35', 'v2', now + 500)).toBeUndefined();

    cache.set({
      mediaIdentifier: 'https://youtube.com/watch?v=def',
      intervalKey: '*0:00-0:35',
      sourceVersion: 'v1',
      streamUrl: 'https://cdn.example/video2.mp4',
      streamResolvedAtMs: now,
      preDownloadVerdict: 'rejected_pre_download',
    });
    expect(cache.get('https://youtube.com/watch?v=def', '*0:00-0:35', 'v1', now + 2_000)).toBeUndefined();
  });
});

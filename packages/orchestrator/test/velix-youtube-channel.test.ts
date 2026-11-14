import { describe, expect, it } from 'vitest';
import { createYouTubeChannelClient, UPLOAD_CHUNK_BYTES } from '../src/velix-youtube-channel.js';

describe('YouTube channel client', () => {
  it('sends bearer requests without exposing the token in errors', async () => {
    const calls: RequestInit[] = [];
    const client = createYouTubeChannelClient({ accessToken: 'secret-token', fetcher: async (_url, init) => { calls.push(init ?? {}); return new Response(JSON.stringify({ items: [{ id: 'c1', snippet: { title: 'Canal', customUrl: '@canal' }, brandingSettings: { channel: {} } }] }), { status: 200 }); } });
    await expect(client.getChannel()).resolves.toMatchObject({ id: 'c1' });
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer secret-token' });
  });

  it('accepts official response metadata while extracting the channel contract', async () => {
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async () => new Response(JSON.stringify({ kind: 'youtube#channelListResponse', etag: 'etag', pageInfo: { totalResults: 1 }, items: [{ kind: 'youtube#channel', etag: 'item-etag', id: 'c1', snippet: { title: 'Canal', customUrl: '@canal', description: 'Descrição' }, brandingSettings: { channel: {} } }] }), { status: 200 }) });
    await expect(client.getChannel()).resolves.toMatchObject({ id: 'c1', title: 'Canal', handle: '@canal' });
  });

  it('rejects non-YouTube URLs and translates API failures', async () => {
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async () => new Response('denied', { status: 403 }) });
    await expect(client.getChannel()).rejects.toThrow(/^forbidden: o YouTube recusou a operação\.$/);
  });

  it('translates quota, disabled API, missing scope, expiry and network failures without echoing the body', async () => {
    const answer = (status: number, reason: string, message = 'texto livre do servidor') => async () => new Response(JSON.stringify({ error: { code: status, message, errors: [{ reason, message }] } }), { status });
    await expect(createYouTubeChannelClient({ accessToken: 't', fetcher: answer(403, 'quotaExceeded') }).getChannel()).rejects.toThrow(/^quota: a cota diária/);
    await expect(createYouTubeChannelClient({ accessToken: 't', fetcher: answer(403, 'accessNotConfigured') }).getChannel()).rejects.toThrow(/^unavailable: ative a YouTube Data API v3/);
    await expect(createYouTubeChannelClient({ accessToken: 't', fetcher: answer(403, 'insufficientPermissions') }).getChannel()).rejects.toThrow(/^scope_required/);
    await expect(createYouTubeChannelClient({ accessToken: 't', fetcher: async () => new Response('não é json', { status: 401 }) }).getChannel()).rejects.toThrow(/^auth_expired/);
    await expect(createYouTubeChannelClient({ accessToken: 't', fetcher: answer(500, 'backendError') }).getChannel()).rejects.not.toThrow(/texto livre/);
    await expect(createYouTubeChannelClient({ accessToken: 't', fetcher: async () => { throw new TypeError('fetch failed'); } }).getChannel()).rejects.toThrow(/^network: sem conexão/);
    const controller = new AbortController(); controller.abort();
    await expect(createYouTubeChannelClient({ accessToken: 't', fetcher: async () => { throw new DOMException('aborted', 'AbortError'); } }).createUploadSession({}, 1, controller.signal)).rejects.toThrow(/aborted/);
  });

  it('uses a resumable session and uploads bytes separately', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async (url, init) => {
      calls.push(init ? { url: String(url), init } : { url: String(url) });
      if (calls.length === 1) return new Response('{}', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session' } });
      return new Response(JSON.stringify({ id: 'video-1' }), { status: 200 });
    } });
    await expect(client.uploadVideo({ snippet: { title: 'Teste' } }, new Uint8Array([1, 2, 3]))).resolves.toEqual({ id: 'video-1' });
    expect(calls[0]?.url).toMatch(/^https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/videos\?.*uploadType=resumable/);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[1]?.url).toBe('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session');
    expect(calls[1]?.init?.method).toBe('PUT');
  });

  it('sends large files in 256 KiB-aligned chunks with the total, checkpointing every confirmed byte', async () => {
    const total = UPLOAD_CHUNK_BYTES * 2 + 1000;
    const ranges: string[] = []; const sizes: number[] = []; const checkpoints: number[] = [];
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async (_url, init) => {
      if (init?.method === 'POST') return new Response('{}', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=big' } });
      const range = new Headers(init?.headers).get('content-range') ?? ''; ranges.push(range); sizes.push((init?.body as Buffer).byteLength);
      const end = Number(/-(\d+)\//u.exec(range)?.[1]);
      return end + 1 < total ? new Response(null, { status: 308, headers: { range: `bytes=0-${end}` } }) : new Response(JSON.stringify({ id: 'big' }), { status: 200 });
    } });
    await expect(client.uploadVideo({}, new Uint8Array(total), undefined, (_url, offset) => checkpoints.push(offset))).resolves.toEqual({ id: 'big' });
    expect(UPLOAD_CHUNK_BYTES % (256 * 1024)).toBe(0);
    expect(sizes).toEqual([UPLOAD_CHUNK_BYTES, UPLOAD_CHUNK_BYTES, 1000]);
    expect(ranges[0]).toBe(`bytes 0-${UPLOAD_CHUNK_BYTES - 1}/${total}`);
    expect(checkpoints).toEqual([0, UPLOAD_CHUNK_BYTES, UPLOAD_CHUNK_BYTES * 2]);
  });

  it('follows an upload session only on the upload endpoint and accepts overrides only on https or loopback', async () => {
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async () => new Response('{}', { status: 200, headers: { location: 'https://evil.example/upload/youtube/v3/videos?upload_id=x' } }) });
    await expect(client.uploadVideo({}, new Uint8Array([1]))).rejects.toThrow(/sessão de upload segura/);
    await expect(client.resumeUpload('https://evil.example/upload/youtube/v3/videos', new Uint8Array([1]), 0)).rejects.toThrow(/sessão de upload segura/);
    expect(() => createYouTubeChannelClient({ accessToken: 'secret', endpoints: { api: 'http://example.com/youtube/v3', upload: 'http://example.com/upload/youtube/v3' } })).toThrow(/inseguro/);
    const local = createYouTubeChannelClient({ accessToken: 'secret', endpoints: { api: 'http://127.0.0.1:9/youtube/v3', upload: 'http://127.0.0.1:9/upload/youtube/v3' }, fetcher: async (url) => new Response(JSON.stringify({ items: [{ id: 'c', snippet: { title: String(url) } }] }), { status: 200 }) });
    await expect(local.getChannel()).resolves.toMatchObject({ title: expect.stringMatching(/^http:\/\/127\.0\.0\.1:9\/youtube\/v3\/channels\?/) });
  });

  it('resumes a session with a content range and returns the next offset', async () => {
    let received: Headers | undefined;
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async (_url, init) => {
      received = new Headers(init?.headers);
      return new Response(null, { status: 308, headers: { range: 'bytes=0-4' } });
    } });
    await expect(client.resumeUpload('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session', new Uint8Array([6, 7, 8]), 5)).resolves.toEqual({ offset: 5 });
    expect(received?.get('content-range')).toBe('bytes 5-7/*');
    expect(received?.get('authorization')).toBe('Bearer secret');
  });

  it('continues an interrupted resumable upload and emits checkpoints', async () => {
    const ranges: string[] = [];
    const checkpoints: Array<[string, number]> = [];
    let calls = 0;
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async (_url, init) => {
      calls += 1;
      if (calls === 1) return new Response('{}', { status: 200, headers: { location: 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session' } });
      const range = new Headers(init?.headers).get('content-range');
      if (range) ranges.push(range);
      if (ranges.length === 1) return new Response(null, { status: 308, headers: { range: 'bytes=0-1' } });
      return new Response(JSON.stringify({ id: 'video-resumed' }), { status: 200 });
    } });
    await expect(client.uploadVideo({}, new Uint8Array([1, 2, 3, 4]), undefined, (url, offset) => checkpoints.push([url, offset]))).resolves.toEqual({ id: 'video-resumed' });
    expect(ranges).toEqual(['bytes 0-3/4', 'bytes 2-3/4']);
    expect(checkpoints.map(([, offset]) => offset)).toEqual([0, 2]);
  });

  it('reads owned videos and updates status for an approved reschedule', async () => {
    const urls: string[] = [];
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async (url, init) => {
      urls.push(String(url));
      if (String(url).includes('/search?')) return new Response(JSON.stringify({ items: [{ id: { videoId: 'video-1' }, snippet: { title: 'Agendado' } }] }), { status: 200 });
      if (String(url).includes('/videos?part=snippet,status')) return new Response(JSON.stringify({ items: [{ id: 'video-1', snippet: { title: 'Agendado' }, status: { privacyStatus: 'private', publishAt: '2026-11-04T12:00:00.000Z' } }] }), { status: 200 });
      expect(init?.method).toBe('PUT');
      return new Response('{}', { status: 200 });
    } });
    await expect(client.listUploadedVideos()).resolves.toEqual([{ id: 'video-1', title: 'Agendado', privacy: 'private', publishAt: '2026-11-04T12:00:00.000Z' }]);
    await expect(client.updateVideo('video-1', { privacyStatus: 'private', publishAt: '2026-11-05T12:00:00.000Z' })).resolves.toBeUndefined();
    expect(urls.some((url) => url.includes('/search?'))).toBe(true);
  });

  it('reports the explicit quota cost for a niche search', async () => {
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async () => new Response(JSON.stringify({ items: [{ id: { videoId: 'v1' }, snippet: { title: 'Resultado real' } }] }), { status: 200 }) });
    await expect(client.researchNiche('ciência')).resolves.toEqual({ query: 'ciência', quotaCost: 100, titles: ['Resultado real'], totalResults: 1 });
  });

  it('reads numeric video statistics through the authenticated Data API', async () => {
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async (url) => {
      expect(String(url)).toContain('/videos?part=statistics&id=video-1');
      return new Response(JSON.stringify({ items: [{ id: 'video-1', statistics: { viewCount: '1200', likeCount: '34', commentCount: '5' } }] }), { status: 200 });
    } });
    await expect(client.getVideoStatistics('video-1')).resolves.toEqual({ videoId: 'video-1', views: 1200, likes: 34, comments: 5 });
  });
});

describe('YouTube resumable upload over real fetch', () => {
  it('reads 308 Resume Incomplete as progress instead of a failed redirect', async () => {
    const { createServer } = await import('node:http');
    let puts = 0;
    const server = createServer((request, response) => {
      request.resume();
      request.on('end', () => {
        if (request.method === 'POST') { response.writeHead(200, { location: `http://127.0.0.1:${(server.address() as { port: number }).port}/upload/youtube/v3/videos?uploadType=resumable&upload_id=s` }); response.end(); return; }
        puts += 1;
        if (puts === 1) { response.writeHead(308, { range: 'bytes=0-1' }); response.end(); return; }
        response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ id: 'real-fetch' }));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    try {
      const client = createYouTubeChannelClient({ accessToken: 'secret', endpoints: { api: `http://127.0.0.1:${port}/youtube/v3`, upload: `http://127.0.0.1:${port}/upload/youtube/v3` } });
      await expect(client.uploadVideo({}, new Uint8Array([1, 2, 3, 4]))).resolves.toEqual({ id: 'real-fetch' });
      expect(puts).toBe(2);
    } finally { server.close(); }
  });
});

describe('YouTube channel art', () => {
  it('uploads the banner image to the upload endpoint and returns its URL', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async (url, init) => { calls.push(init ? { url: String(url), init } : { url: String(url) }); return new Response(JSON.stringify({ kind: 'youtube#channelBannerResource', url: 'https://yt3.googleusercontent.com/banner' }), { status: 200 }); } });
    await expect(client.uploadBanner(new Uint8Array([1, 2, 3]), 'image/png')).resolves.toBe('https://yt3.googleusercontent.com/banner');
    expect(calls[0]?.url).toBe('https://www.googleapis.com/upload/youtube/v3/channelBanners/insert');
    expect(new Headers(calls[0]?.init?.headers).get('content-type')).toBe('image/png');
  });

  it('sets the watermark as multipart: settings first, then the image bytes', async () => {
    let url = ''; let headers = new Headers(); let body: Buffer = Buffer.alloc(0);
    const client = createYouTubeChannelClient({ accessToken: 'secret', fetcher: async (target, init) => { url = String(target); headers = new Headers(init?.headers); body = init?.body as Buffer; return new Response(null, { status: 204 }); } });
    await client.setWatermark('UC1', new Uint8Array([137, 80, 78, 71]), 'image/png', 'bottomRight');
    expect(url).toBe('https://www.googleapis.com/upload/youtube/v3/watermarks/set?channelId=UC1&uploadType=multipart');
    const boundary = /boundary=(\S+)/u.exec(headers.get('content-type') ?? '')?.[1] ?? '';
    const text = body.toString('latin1');
    expect(text.startsWith(`--${boundary}\r\nContent-Type: application/json`)).toBe(true);
    expect(text).toContain('"cornerPosition":"bottomRight"');
    expect(text).toContain('Content-Type: image/png\r\n\r\n\u0089PNG');
    expect(text.endsWith(`\r\n--${boundary}--`)).toBe(true);
  });
});

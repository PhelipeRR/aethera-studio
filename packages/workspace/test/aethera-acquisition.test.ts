import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireWithYtDlp, buildAcquisitionArgs, classifyAcquisitionError, parseAcquisitionProgress, parseYtDlpInfo, ytDlpSearch, ytDlpVideoInfo, type YtDlpCommand } from '../src/aethera-acquisition.js';

const FAKE = resolve(import.meta.dirname, 'fixtures/fake-yt-dlp.mjs');
const fake: YtDlpCommand = { command: process.execPath, prefix: [FAKE] };
const withMode = async <T>(mode: string, work: () => Promise<T>, extra: Record<string, string> = {}): Promise<T> => {
  const previous = { ...process.env };
  Object.assign(process.env, { FAKE_YTDLP_MODE: mode, ...extra });
  try { return await work(); } finally { for (const key of ['FAKE_YTDLP_MODE', 'FAKE_YTDLP_LOG', 'FAKE_YTDLP_SOURCE']) { if (previous[key] === undefined) Reflect.deleteProperty(process.env, key); else process.env[key] = previous[key]; } }
};

describe('yt-dlp metadata and search (fake yt-dlp, synthetic data)', () => {
  it('parses the fields the Studio uses and keeps the best video height', () => {
    const info = parseYtDlpInfo(JSON.stringify({ id: 'abcdefghijk', webpage_url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'T', channel: 'C', channel_is_verified: true, duration: 61, upload_date: '20260115', formats: [{ height: 2160, vcodec: 'vp9' }, { height: 4320, vcodec: 'none' }, { height: 1080, vcodec: 'avc1' }] }));
    expect(info).toMatchObject({ id: 'abcdefghijk', maxHeight: 2160, uploadDate: '2026-01-15', channelVerified: true, durationSeconds: 61 });
    expect(parseYtDlpInfo('not json')).toBeNull();
    expect(parseYtDlpInfo(JSON.stringify({ id: 'x', webpage_url: 'file:///x', title: 't' }))).toBeNull();
  });

  it('reads metadata of known URLs and keeps the good ones when one is unavailable', async () => {
    const infos = await ytDlpVideoInfo(fake, ['https://www.youtube.com/watch?v=aaaaaaaaaaa', 'https://www.youtube.com/watch?v=unavailable']);
    expect(infos.map((info) => info.id)).toEqual(['aaaaaaaaaaa']);
    expect(await ytDlpVideoInfo(fake, ['http://insecure.example/x'])).toEqual([]);
  });

  it('searches without an API key and passes the query as one argument', async () => {
    const results = await ytDlpSearch(fake, 'Fixture Quest gameplay; rm -rf /', 2);
    expect(results).toHaveLength(2);
    expect(results[0]?.title).toContain('Fixture Quest gameplay; rm -rf /');
  });
});

describe('acquisition with the fake yt-dlp', () => {
  it('builds 1080p-first, resumable arguments and refuses unsafe names', () => {
    const args = buildAcquisitionArgs({ url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', directory: 'C:/p/media', fileStem: 'trailer-aaa', ffmpeg: 'C:/ffmpeg/ffmpeg.exe' });
    expect(args).toEqual(expect.arrayContaining(['--continue', '--no-overwrites', '--merge-output-format', 'mp4', '--ffmpeg-location', 'C:/ffmpeg/ffmpeg.exe']));
    expect(args[args.indexOf('-f') + 1]).toMatch(/^bv\*\[height>=1080\]/);
    expect(args.at(-1)).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa');
    expect(() => buildAcquisitionArgs({ url: 'https://x.example/v', directory: 'd', fileStem: '../evil' })).toThrow(/nome/);
    expect(() => buildAcquisitionArgs({ url: 'file:///C:/x', directory: 'd', fileStem: 'ok' })).toThrow();
  });

  it('downloads into the project and reports progress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aethera-acq-'));
    const progress: number[] = [];
    const result = await withMode('ok', () => acquireWithYtDlp({ ytDlp: fake, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', root, relativeDir: 'media/aethera/game', fileStem: 'trailer-aaa', onProgress: (item) => progress.push(item.bytesDone) }));
    expect(result.relativePath).toBe('media/aethera/game/trailer-aaa.mp4');
    expect(existsSync(join(root, result.relativePath))).toBe(true);
    expect(progress.at(-1)).toBeGreaterThan(0);
  });

  it('resumes from the partial file after a network failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aethera-acq-'));
    const log = join(root, 'fake.log');
    const request = { ytDlp: fake, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', root, relativeDir: 'media', fileStem: 'trailer-aaa' };
    await expect(withMode('fail-once', () => acquireWithYtDlp(request), { FAKE_YTDLP_LOG: log })).rejects.toThrow(/^network:/);
    expect(existsSync(join(root, 'media/trailer-aaa.mp4.part'))).toBe(true);
    await withMode('fail-once', () => acquireWithYtDlp(request), { FAKE_YTDLP_LOG: log });
    expect(readFileSync(log, 'utf8')).toMatch(/resumed-from \d+/);
  });

  it('cancels a hanging download and leaves the partial file for later', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aethera-acq-'));
    const controller = new AbortController();
    const running = withMode('hang', () => acquireWithYtDlp({ ytDlp: fake, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', root, relativeDir: 'media', fileStem: 'trailer-aaa', signal: controller.signal, onProgress: () => controller.abort() }));
    await expect(running).rejects.toThrow(/^cancelled:/);
    expect(existsSync(join(root, 'media/trailer-aaa.mp4.part'))).toBe(true);
  }, 20_000);

  it('turns a site refusal and a removed video into typed errors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aethera-acq-'));
    await expect(withMode('forbidden', () => acquireWithYtDlp({ ytDlp: fake, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', root, relativeDir: 'media', fileStem: 'x' }))).rejects.toThrow(/^forbidden:.*yt-dlp desatualizado/);
    await expect(withMode('unavailable', () => acquireWithYtDlp({ ytDlp: fake, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', root, relativeDir: 'media', fileStem: 'x' }))).rejects.toThrow(/^unavailable:/);
    await expect(acquireWithYtDlp({ ytDlp: { command: 'definitely-not-installed-yt-dlp', prefix: [] }, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', root, relativeDir: 'media', fileStem: 'x' })).rejects.toThrow(/^tool_missing:/);
    await expect(acquireWithYtDlp({ ytDlp: fake, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', root, relativeDir: '../fora', fileStem: 'x' })).rejects.toThrow(/dentro do projeto/);
  });

  it('classifies errors and parses progress lines', () => {
    expect(classifyAcquisitionError('Read timed out.')).toMatchObject({ code: 'network', retryable: true });
    expect(classifyAcquisitionError('Requested format is not available')).toMatchObject({ code: 'format', retryable: false });
    expect(classifyAcquisitionError('ERROR: Private video')).toMatchObject({ code: 'unavailable', retryable: false });
    expect(parseAcquisitionProgress('NBPROG 512 2048 NA')).toEqual({ bytesDone: 512, bytesTotal: 2048 });
    expect(parseAcquisitionProgress('NBPROG 512 NA 4096.5')).toEqual({ bytesDone: 512, bytesTotal: 4097 });
    expect(parseAcquisitionProgress('[download] 50%')).toBeNull();
  });
});

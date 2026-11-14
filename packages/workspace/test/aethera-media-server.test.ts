import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serveRenderMedia } from '../src/aethera-media-server.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture(): { dir: string; allowed: string; other: string } {
  const dir = mkdtempSync(join(tmpdir(), 'nb-media-server-'));
  dirs.push(dir);
  const allowed = join(dir, 'proxy.mp4');
  const other = join(dir, 'secret.txt');
  writeFileSync(allowed, Buffer.from('0123456789'));
  writeFileSync(other, 'do not serve');
  return { dir, allowed, other };
}

describe('render media server (AP-04)', () => {
  it('serves only the listed files on loopback, with byte ranges for the video decoder', async () => {
    const { allowed } = fixture();
    const server = await serveRenderMedia([allowed]);
    try {
      const url = server.urlFor(allowed);
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/0\/proxy\.mp4$/u);
      const full = await fetch(url);
      expect(full.status).toBe(200);
      expect(full.headers.get('content-type')).toBe('video/mp4');
      expect(full.headers.get('accept-ranges')).toBe('bytes');
      expect(await full.text()).toBe('0123456789');
      const range = await fetch(url, { headers: { range: 'bytes=2-5' } });
      expect(range.status).toBe(206);
      expect(range.headers.get('content-range')).toBe('bytes 2-5/10');
      expect(await range.text()).toBe('2345');
      const open = await fetch(url, { headers: { range: 'bytes=7-' } });
      expect(await open.text()).toBe('789');
      expect((await fetch(url, { headers: { range: 'bytes=20-30' } })).status).toBe(416);
    } finally {
      await server.close();
    }
  });

  it('refuses unlisted files, a wrong token and path tricks', async () => {
    const { allowed, other } = fixture();
    const server = await serveRenderMedia([allowed]);
    try {
      const url = new URL(server.urlFor(allowed));
      const token = url.pathname.split('/')[1];
      expect(() => server.urlFor(other)).toThrow(/não autorizado/iu);
      expect((await fetch(`${url.origin}/${'0'.repeat(32)}/0/proxy.mp4`)).status).toBe(404);
      expect((await fetch(`${url.origin}/${token}/1/secret.txt`)).status).toBe(404);
      expect((await fetch(`${url.origin}/${token}/0/..%2Fsecret.txt`)).status).toBe(404);
      expect((await fetch(url, { method: 'POST' })).status).toBe(405);
    } finally {
      await server.close();
    }
    await expect(fetch(server.urlFor(allowed))).rejects.toThrow();
  });
});
